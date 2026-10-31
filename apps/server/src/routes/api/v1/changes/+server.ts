/**
 * The change feed: pull (GET) and push (POST).
 *
 * `userId` always comes from `event.locals`, never from the query string or body.
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
 * `GET /api/v1/changes?since=<rev>&limit=500` — this user's rows above `since`, ascending,
 * tombstones included.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	// `hooks.server.ts` already 401s an unauthenticated request here; this only narrows the type.
	if (!userId) return jsonError(401, 'unauthorized', 'Sign in with a passkey to use sync.');

	const since = parseSince(url.searchParams.get('since'));
	const limit = clampLimit(url.searchParams.get('limit'));

	const raw = await fetchChanges(userId, since, limit);

	// `fetchChanges` asked for `limit + 1` so `hasMore` costs no extra query; drop the extra row.
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

	// Validated before it leaves: a response that violates the wire schema is a protocol break,
	// so the client gets a clean 500 rather than an unparseable shape.
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
 * `POST /api/v1/changes` — idempotent by `op.id`, merged with `mergeRow`, each op committed by one
 * atomic statement (see `src/lib/db/queries.ts`).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return jsonError(401, 'unauthorized', 'Sign in with a passkey to use sync.');

	// Read as text and check the size BEFORE parsing; `request.json()` buffers an unbounded body.
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

	// Check the wire version BEFORE schema validation: `pushRequestSchema` types it as a literal,
	// so afterwards the client would only get a generic 400. A mismatch is a 409 — the request was
	// well-formed, the client is simply the wrong version.
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
	// One bad op does not fail the batch; the client reconciles from `rejected`.
	const prepared: PreparedOp[] = [];
	const rejected: { opId: string; reason: RejectReason }[] = [];

	for (const op of ops) {
		// A SECOND gate: the envelope's picklist makes this unreachable today, but an
		// unchecked kind must never reach the SQL layer.
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

	// Never report a 0 a client could store and rewind with. When nothing was applied, report the
	// server's high-water mark instead — monotonic, and one query only on a no-op path.
	const nextRev = result.accepted.length > 0 ? result.nextRev : await currentRev();

	// ── notify the user's other devices ───────────────────────────────────────
	// Only when something committed; a replay changes nothing and a retry storm would become a
	// notification storm.
	if (result.accepted.length > 0) {
		notify(userId, 'change', { rev: nextRev });
	}

	return new Response(
		JSON.stringify({ accepted: result.accepted, rejected: allRejected, nextRev }),
		{ headers: JSON_HEADERS }
	);
};
