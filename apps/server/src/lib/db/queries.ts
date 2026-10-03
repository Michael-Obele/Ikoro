/**
 * The change feed and the push path, as SQL.
 *
 * ── Why the push is ONE statement ───────────────────────────────────────────
 * `drizzle-orm/neon-http` has no interactive transactions — `db.transaction()`
 * literally throws `"No transactions support in neon-http driver"`. The
 * available primitive is `db.batch([...])`, which maps to Neon's HTTP array-form
 * transaction. But a batch cannot feed one statement's result into the next, so
 * the conditional "only write if I won the claim" cannot be expressed across
 * separate statements.
 *
 * So it is expressed WITHIN one statement, as a data-modifying CTE:
 *
 *   WITH claim AS (
 *     INSERT INTO applied_op (id, user_id, …) VALUES (…)
 *     ON CONFLICT (id) DO NOTHING
 *     RETURNING id
 *   )
 *   INSERT INTO task (…) SELECT … FROM claim
 *   ON CONFLICT (id) DO UPDATE SET … WHERE task.updated_at < excluded.updated_at
 *   RETURNING rev
 *
 * The claim and the write commit together or not at all. Three properties fall
 * out of that shape, and all three are what the push endpoint promises:
 *
 *  1. **Idempotent by op id.** `ON CONFLICT (id) DO NOTHING` against the primary
 *     key is atomic on its own. Two concurrent retries of the same op race on
 *     the unique index; exactly one gets a row back, and the loser's CTE yields
 *     nothing so its write never runs. There is no read-then-write window to
 *     lose, which is the bug a "check if seen, then apply" implementation has.
 *  2. **No crash window.** A process that dies between "claim" and "write" would
 *     otherwise record an op as applied that was never written — and the client,
 *     which is waiting to hear whether it committed, would never push it again.
 *     In one statement that is unrepresentable.
 *  3. **LWW in the database.** The `ON CONFLICT … DO UPDATE … WHERE` guard is
 *     the same comparison `resolveWrite` makes, expressed where it is actually
 *     needed: at the moment of the write. The TypeScript decision and the SQL
 *     guard are checked against each other in `tests/queries.test.ts`.
 *
 * When `RETURNING` produces no row the caller cannot tell "replay" from "stale"
 * apart by result shape alone, so `applyOps` resolves the ambiguity with one
 * extra read of `applied_op`.
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
 * The change feed: everything for this user above `since`, ascending, tombstones
 * INCLUDED.
 *
 * A `UNION ALL` over the two entity tables, because `list` and `task` are
 * separate tables that share one `rev` sequence. Each branch is an index range
 * scan on `(user_id, rev)`, and Postgres merges the two sorted branches — so the
 * per-table indexes this query depends on are exactly the ones in `schema.ts`.
 *
 * `deletedAt` is NOT filtered. A client that cannot see tombstones will re-push
 * every deleted row it still holds, forever.
 *
 * `limit + 1` rows are requested so `hasMore` can be answered without a second
 * query; the extra row is trimmed by the caller.
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
	// Reading `.rows` is what actually holds the data.
	return (rows as unknown as { rows: FeedRow[] }).rows ?? [];
}

/**
 * The highest rev the server has ever issued.
 *
 * Reads the SEQUENCE rather than `max(rev)` over the tables: a user with no rows
 * still has a correct global high-water mark, and the sequence is immune to the
 * gaps a rolled-back transaction leaves behind.
 */
export async function currentRev(db: Database = defaultDb): Promise<number> {
	const rows = await db.execute(sql.raw(`SELECT last_value AS rev FROM ${REV_SEQUENCE_NAME}`));
	const result = (rows as unknown as { rows: { rev: string | number }[] }).rows ?? [];
	const raw = result[0]?.rev;
	return typeof raw === 'number' ? raw : Number(raw ?? 0);
}

// ── push ─────────────────────────────────────────────────────────────────────

/**
 * A validated op, ready to be written. Produced by the route, consumed here.
 *
 * `payload` is already Valibot-checked and stripped of device-scoped fields.
 */
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
 * One op, one atomic statement.
 *
 * Returns `{ rev }` when the op was applied or was already applied (a replay —
 * the caller cannot tell, and does not need to, because both mean "this op is
 * committed"), or `{ replay: true }` when nothing happened, which means either a
 * duplicate op id or a stale op that lost the LWW guard.
 */
async function applyOne(userId: string, op: PreparedOp, db: Database): Promise<number | 'replay'> {
	const target = tableForKind(op.kind);
	// Unreachable via the route, which filters unknown kinds first. Present so a
	// future caller cannot construct a SQL fragment from an unchecked kind.
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

/**
 * Look up what a previously-seen op id was assigned.
 *
 * Needed because a replay and a stale op both return zero rows from `applyOne`.
 * The distinction matters to the client: a replay is a SUCCESS (the work is
 * committed), while a stale op is a rejection the user may need to resolve.
 */
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
 * Apply a batch, in order, each op independently.
 *
 * Each op is its own atomic statement, so a bad op in the middle of a batch
 * cannot roll back — or be rolled back by — its neighbours. That is deliberate:
 * a client that queued 300 edits should not lose all 300 because edit 151 was
 * malformed. The client reconciles from `accepted` / `rejected`.
 *
 * `userId` comes from the session and ONLY from the session. An op body that
 * carried a `userId` would be an IDOR — it would let any authenticated user
 * write into any other account's rows. `findForbiddenFields` rejects such a body
 * before it gets here, and nothing in this function reads an id from `op`.
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

		// Zero rows. Either we already committed this op id, or the LWW guard
		// rejected it as stale. The ledger tells us which.
		const seen = await lookupAppliedOp(op.id, db);

		if (seen === undefined) {
			// The op id is not ours and it did not apply: the LWW guard rejected
			// a genuinely stale write.
			rejected.push({ opId: op.id, reason: 'stale' });
			continue;
		}

		if (seen.userId !== userId) {
			// Someone else already used this op id. Report nothing about their
			// data — not even the rev — which is what `forbidden` means here.
			rejected.push({ opId: op.id, reason: 'forbidden' });
			continue;
		}

		// A genuine replay: already committed. Succeed, and report the rev the
		// FIRST attempt was given so the client converges on the same number.
		accepted.push({ opId: op.id, entityId: op.entityId, rev: seen.rev ?? 0 });
	}

	return { accepted, rejected, nextRev };
}

/**
 * The stored row for one entity, or undefined.
 *
 * Used by tests and by the debug path. The push path does NOT need it: the
 * decision and the write are the same statement, so there is no read-then-write
 * gap for a concurrent push to slip through.
 */
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
		// `generatedByDefaultAsIdentity` is nullable in drizzle's type even though
		// Postgres makes the column NOT NULL. Coerce rather than cast.
		rev: row.rev ?? 0
	};
}

export { asc, gt };
