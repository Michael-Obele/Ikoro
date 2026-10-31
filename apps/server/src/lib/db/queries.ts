/**
 * The change feed and the push path, as SQL. neon-http has no transactions, so each push is ONE
 * statement: a CTE claims the op id and writes the row together.
 */

import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { EntityKind } from '@ikoro/sync';
import { appliedOp, list, REV_SEQUENCE_NAME, task } from './schema';
import type { Database } from './index';
import { db as defaultDb } from './index';

/** One row of the feed, as Postgres returns it over the HTTP driver. */
export interface FeedRow {
	kind: string;
	entity_id: string;
	payload: unknown;
	updated_at: Date | string;
	rev: number | string;
	deleted_at: Date | string | null;
}

/** Reasons the wire protocol can report for a rejected op. */
export type RejectReason = 'stale' | 'unknown-kind' | 'invalid' | 'forbidden';

export type ApplyResult = {
	readonly accepted: { readonly opId: string; readonly entityId: string; readonly rev: number }[];
	readonly rejected: { readonly opId: string; readonly reason: RejectReason }[];
	readonly nextRev: number;
};

/** The table an op targets. `unknown-kind` has no table, so this can fail. */
export function tableForKind(kind: EntityKind) {
	if (kind === 'list') return list;
	if (kind === 'task') return task;
	return null;
}

/** Every kind the server accepts. Mirrors `EntityKind`, kept explicit for the 400 path. */
export const KNOWN_KINDS: readonly EntityKind[] = ['list', 'task'];

// ── pull ─────────────────────────────────────────────────────────────────────

/**
 * The change feed: everything for this user above `since`, ascending, tombstones included.
 * `limit + 1` rows are requested so `hasMore` needs no second query.
 */
export async function fetchChanges(
	userId: string,
	since: number,
	limit: number,
	db: Database = defaultDb
): Promise<FeedRow[]> {
	const rows = await db.execute(sql`
		SELECT * FROM (
			SELECT 'list'::text AS kind, id AS entity_id, payload,
			       updated_at, rev, deleted_at
			FROM list
			WHERE user_id = ${userId} AND rev > ${since}
			UNION ALL
			SELECT 'task'::text AS kind, id AS entity_id, payload,
			       updated_at, rev, deleted_at
			FROM task
			WHERE user_id = ${userId} AND rev > ${since}
		) AS feed
		ORDER BY feed.rev ASC
		LIMIT ${limit + 1}
	`);

	// `db.execute()` returns a RESULT OBJECT on neon-http, not a bare array.
	return (rows as unknown as { rows: FeedRow[] }).rows ?? [];
}

/**
 * The highest rev the server has ever issued, read from the SEQUENCE — correct even for a user
 * with no rows, and immune to the gaps a rollback leaves.
 */
export async function currentRev(db: Database = defaultDb): Promise<number> {
	const rows = await db.execute(sql.raw(`SELECT last_value AS rev FROM ${REV_SEQUENCE_NAME}`));
	const result = (rows as unknown as { rows: { rev: string | number }[] }).rows ?? [];
	const raw = result[0]?.rev;
	return typeof raw === 'number' ? raw : Number(raw ?? 0);
}

// ── push ─────────────────────────────────────────────────────────────────────

/** A validated op, ready to be written. `payload` is already Valibot-checked and stripped. */
export interface PreparedOp {
	readonly id: string;
	readonly kind: EntityKind;
	readonly entityId: string;
	readonly op: 'upsert' | 'delete';
	readonly payload: unknown;
	readonly updatedAt: string;
}

/** Postgres timestamptz -> ISO string, without pulling in a Date round-trip. */
const iso = (value: Date | string): string =>
	value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/**
 * One op, one atomic statement. Returns the rev, or `'replay'` when nothing was written
 * (a duplicate op id or a stale op that lost the LWW guard).
 */
async function applyOne(userId: string, op: PreparedOp, db: Database): Promise<number | 'replay'> {
	const target = tableForKind(op.kind);
	// Unreachable via the route, which filters unknown kinds first. Kept so an unchecked
	// kind can never become a SQL fragment.
	if (!target) throw new Error(`applyOne called with unsupported kind: ${op.kind}`);

	const deletedAt = op.op === 'delete' ? op.updatedAt : null;

	const result = await db.execute(sql`
		WITH claim AS (
			INSERT INTO applied_op (id, user_id, kind, entity_id, created_at)
			VALUES (${op.id}, ${userId}, ${op.kind}, ${op.entityId}, now())
			ON CONFLICT (id) DO NOTHING
			RETURNING id
		)
		INSERT INTO ${target} (id, user_id, payload, updated_at, deleted_at)
		SELECT ${op.entityId}, ${userId}, ${JSON.stringify(op.payload)}::jsonb,
		       ${op.updatedAt}::timestamptz, ${deletedAt}::timestamptz
		FROM claim
		ON CONFLICT (id) DO UPDATE
			SET payload = EXCLUDED.payload,
			    updated_at = EXCLUDED.updated_at,
			    deleted_at = EXCLUDED.deleted_at,
			    rev = nextval(${sql.raw(REV_SEQUENCE_NAME)})
			WHERE ${target}.updated_at < EXCLUDED.updated_at
		RETURNING rev
	`);

	const rows = (result as unknown as { rows: { rev: number | string }[] }).rows ?? [];
	if (rows.length === 0) return 'replay';
	return Number(rows[0].rev);
}

/** Look up what a previously-seen op id was assigned. A replay is a success; a stale op is not. */
async function lookupAppliedOp(
	opId: string,
	db: Database
): Promise<{ rev: number | null; userId: string } | undefined> {
	const rows = await db
		.select({ rev: appliedOp.rev, userId: appliedOp.userId })
		.from(appliedOp)
		.where(eq(appliedOp.id, opId))
		.limit(1);

	return rows[0];
}

/**
 * Apply a batch, in order, each op independently — so one bad op cannot roll back its
 * neighbours. `userId` comes from the session and ONLY from the session.
 */
export async function applyOps(
	userId: string,
	ops: readonly PreparedOp[],
	db: Database = defaultDb
): Promise<ApplyResult> {
	const accepted: ApplyResult['accepted'] = [];
	const rejected: ApplyResult['rejected'] = [];
	let nextRev = 0;

	for (const op of ops) {
		const outcome = await applyOne(userId, op, db);

		if (outcome !== 'replay') {
			accepted.push({ opId: op.id, entityId: op.entityId, rev: outcome });
			if (outcome > nextRev) nextRev = outcome;
			continue;
		}

		// Zero rows: either this op id was already committed, or the LWW guard rejected it.
		const seen = await lookupAppliedOp(op.id, db);

		if (seen === undefined) {
			// Not ours and did not apply: a genuinely stale write.
			rejected.push({ opId: op.id, reason: 'stale' });
			continue;
		}

		if (seen.userId !== userId) {
			// Another account used this op id. Report nothing about their data.
			rejected.push({ opId: op.id, reason: 'forbidden' });
			continue;
		}

		// A replay: already committed. Report the rev the FIRST attempt got.
		accepted.push({ opId: op.id, entityId: op.entityId, rev: seen.rev ?? 0 });
	}

	return { accepted, rejected, nextRev };
}

/** The stored row for one entity, or undefined. Used by tests and the debug path. */
export async function fetchRow(
	kind: EntityKind,
	userId: string,
	entityId: string,
	db: Database = defaultDb
): Promise<{ updatedAt: string; deletedAt: string | null; rev: number } | undefined> {
	const target = tableForKind(kind);
	if (!target) return undefined;

	const rows = await db
		.select({ updatedAt: target.updatedAt, deletedAt: target.deletedAt, rev: target.rev })
		.from(target)
		.where(and(eq(target.userId, userId), eq(target.id, entityId)))
		.limit(1);

	const row = rows[0];
	if (!row) return undefined;
	return {
		updatedAt: iso(row.updatedAt),
		deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
		// `generatedByDefaultAsIdentity` types as nullable though Postgres makes it NOT NULL.
		rev: row.rev ?? 0
	};
}

export { asc, gt };
