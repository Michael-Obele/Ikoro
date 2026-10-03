/**
 * The change feed: pull (GET) and push (POST).
 *
 * ── `userId` is never read from the request ──────────────────────────────────
 * It comes from `event.locals.userId`, which `hooks.server.ts` set from the
 * session. There is no branch anywhere in this file that would honour a
 * `userId` in the query string or the body — and `findForbiddenFields` rejects a
 * payload that carries one, because a payload `userId` is the other way an IDOR
 * gets in, and silently dropping it would hide the attempt.
 *
 * ── What is shared between the two methods ───────────────────────────────────
 * Both validate against `@ikoro/sync` schemas, both clamp their inputs, and both
 * return `nextRev`. A client pulls, pushes, and reads the same cursor type in
 * both directions.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { changesResponseSchema, pushRequestSchema, WIRE_VERSION } from '@ikoro/sync';
import {
	applyOps,
	currentRev,
	fetchChanges,
	KNOWN_KINDS,
	type PreparedOp,
	type RejectReason
} from '#lib/db/queries';
import { findForbiddenFields, validatePayload } from '#lib/sync/payload';
import { toChangeRow, type WireChangeRow } from '#lib/sync/merge';
import {
	clampLimit,
	computeHasMore,
	computeNextRev,
	parseSince,
	isOversizedBatch,
	MAX_PUSH_BODY_BYTES
} from '#lib/sync/cursor';
import { jsonError, validationError, NO_STORE } from '#lib/http/errors';
import { notify } from '#lib/sse/hub';

const JSON_HEADERS = { 'content-type': 'application/json', ...NO_STORE } as const;

// ── pull ─────────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/changes?since=<rev>&limit=500`
 *
 * Returns every row for this user with `rev > since`, ascending, tombstones
 * INCLUDED, capped at `limit`. `nextRev` is the highest rev actually returned —
 * or `since` when nothing came back, so an idle client never rewinds its cursor.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	// `hooks.server.ts` already 401s an unauthenticated request to this path. This
	// is a type-narrowing guard, not a second auth check.
	if (!userId) return jsonError(401, 'unauthorized', 'Sign in with a passkey to use sync.');

	const since = parseSince(url.searchParams.get('since'));
	const limit = clampLimit(url.searchParams.get('limit'));

	const raw = await fetchChanges(userId, since, limit);

	// `fetchChanges` asks for `limit + 1` so `hasMore` costs no extra query. The
	// extra row is dropped here and never reaches the client.
	const page = raw.length > limit ? raw.slice(0, limit) : raw;
	const hasMore = computeHasMore(page, limit);

	const changes: WireChangeRow[] = page.map((row) =>
		toChangeRow(row.kind as 'list' | 'task', {
			id: row.entity_id,
			userId,
			payload: row.payload as WireChangeRow['payload'],
			updatedAt:
				row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
			rev: Number(row.rev),
			deletedAt: row.deleted_at
				? row.deleted_at instanceof Date
					? row.deleted_at.toISOString()
					: String(row.deleted_at)
				: null
		})
	);

	const nextRev = computeNextRev(changes, since);

	// Validated before it leaves. A response that does not satisfy
	// `changesResponseSchema` is a protocol break, and catching it HERE means the
	// client sees a clean 500 instead of a shape it cannot parse.
	const parsed = v.safeParse(changesResponseSchema, { changes, nextRev, hasMore });
	if (!parsed.success) {
		return jsonError(
			500,
			'internal_error',
			'The change feed did not match the wire schema — this is a server bug.',
			parsed.issues.map((i) => `${v.getDotPath(i) ?? '(root)'}: ${i.message}`)
		);
	}

	return new Response(JSON.stringify(parsed.output), { headers: JSON_HEADERS });
};

// ── push ─────────────────────────────────────────────────────────────────────

/**
 * `POST /api/v1/changes`
 *
 * Idempotent by `op.id`, merged with `mergeRow` from `@ikoro/sync`, and each op
 * committed by one atomic statement. See `src/lib/db/queries.ts` for why the
 * claim and the write are a single statement rather than two.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return jsonError(401, 'unauthorized', 'Sign in with a passkey to use sync.');

	// Read the body as text and check its size BEFORE parsing. `request.json()`
	// would happily buffer an unbounded body first, which is the whole attack.
	const raw = await request.text();
	if (raw.length > MAX_PUSH_BODY_BYTES) {
		return jsonError(
			413,
			'payload_too_large',
			`Push body is ${raw.length} bytes; the limit is ${MAX_PUSH_BODY_BYTES}. Send fewer ops per request.`
		);
	}

	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch (cause) {
		return jsonError(
			400,
			'invalid_json',
			`Request body is not valid JSON: ${(cause as Error).message}`
		);
	}

	// Check the wire version BEFORE full schema validation, and that ordering is the
	// whole point.
	//
	// `pushRequestSchema` types `wireVersion` as `v.literal(WIRE_VERSION)`, so a
	// mismatched client would otherwise be rejected by the generic 400 validation
	// path, with a message about an invalid value — technically true, and useless.
	// The actionable answer is "this server speaks version N, you sent M, update
	// the app", and it is a 409, not a 400: the request was well-formed, the
	// client is simply too old or too new.
	if (typeof body === 'object' && body !== null && 'wireVersion' in body) {
		const sent = (body as { wireVersion: unknown }).wireVersion;
		if (sent !== WIRE_VERSION) {
			return jsonError(
				409,
				'wire_version_mismatch',
				`This server speaks wire version ${WIRE_VERSION}; the client sent ${String(sent)}. Update the app.`
			);
		}
	}

	const envelope = v.safeParse(pushRequestSchema, body);
	if (!envelope.success) {
		return validationError(pushRequestSchema, body, 'Push request');
	}

	const { ops } = envelope.output;

	if (isOversizedBatch(ops.length)) {
		return jsonError(
			413,
			'too_many_ops',
			`Batch has ${ops.length} ops; the limit is 500. Split it.`
		);
	}

	// ── per-op validation ─────────────────────────────────────────────────────
	// A malformed op does not fail the batch. A phone that queued 300 edits
	// should not lose all 300 because one payload was truncated by a bad network;
	// the client reconciles from `rejected`.
	const prepared: PreparedOp[] = [];
	const rejected: { opId: string; reason: RejectReason }[] = [];

	for (const op of ops) {
		// A SECOND gate, not the only one. `changeOpSchema` already restricts `kind`
		// to a picklist, so an unknown kind fails the envelope above and this branch
		// is unreachable today. It stays because the alternative — a kind that
		// reaches the SQL layer unchecked — is how a value ends up interpolated into
		// a table name.
		if (!KNOWN_KINDS.includes(op.kind)) {
			rejected.push({ opId: op.id, reason: 'unknown-kind' });
			continue;
		}

		const forbidden = findForbiddenFields(op.payload);
		if (forbidden.length > 0) {
			rejected.push({ opId: op.id, reason: 'forbidden' });
			continue;
		}

		const payload = validatePayload(op.kind, op.payload);
		if (!payload.ok) {
			rejected.push({ opId: op.id, reason: 'invalid' });
			continue;
		}

		prepared.push({
			id: op.id,
			kind: op.kind,
			entityId: op.entityId,
			op: op.op,
			payload: payload.value,
			updatedAt: op.updatedAt
		});
	}

	const result = await applyOps(userId, prepared);

	const allRejected = [...rejected, ...result.rejected];

	// `nextRev` must never be something a client can store and rewind its cursor
	// to. When every op was rejected before touching the database, `applyOps` has
	// no rev to report and returns 0 — and a client that stored that would re-pull
	// its entire history. So in the "nothing was applied" case, report the
	// server's actual high-water mark instead: it is monotonic, it is never a
	// rewind, and it costs one query only on a path that applied no work.
	const nextRev = result.accepted.length > 0 ? result.nextRev : await currentRev();

	// ── notify the user's other devices ───────────────────────────────────────
	// Only when something was actually committed. A pure replay or a stale
	// rejection changes nothing, and waking every stream for it would make a
	// retry storm into a notification storm.
	if (result.accepted.length > 0) {
		notify(userId, 'change', { rev: nextRev });
	}

	return new Response(
		JSON.stringify({ accepted: result.accepted, rejected: allRejected, nextRev }),
		{ headers: JSON_HEADERS }
	);
};
