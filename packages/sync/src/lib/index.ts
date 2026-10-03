/**
 * The wire protocol, shared verbatim by the app and the server.
 *
 * This file is the contract. Both sides import it, so a field cannot mean two
 * things and a merge rule cannot be implemented twice — and two implementations
 * of conflict resolution IS two behaviours, which is the failure mode that makes
 * sync bugs unreproducible ("it worked on my phone").
 *
 * The model is last-writer-wins on `updatedAt`, with two deliberate refinements:
 *
 *  - **Tombstones win.** A delete is a record with `deletedAt` set, not a
 *    missing row. If it were a missing row, a peer that had not yet seen the
 *    delete would push the task straight back, and the user would watch their
 *    deleted task reappear on its own.
 *  - **The server is the clock.** Client clocks are used only to ORDER changes,
 *    never to decide who is right about a field. A phone whose clock is a week
 *    off must not permanently win every conflict.
 */

import * as v from 'valibot';

export type EntityKind = 'list' | 'task';

/** Bumped only for a wire-incompatible change; the server refuses older clients loudly. */
export const WIRE_VERSION = 1;

/**
 * The client-generated operation id.
 *
 * Idempotency, not identity: a retried `upsert` with the same op id must be a
 * no-op. Without that, a request that timed out *after* the server committed
 * would be applied twice — and on a flaky mobile connection that is the normal
 * case, not the exception.
 */
export const changeOpSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	kind: v.picklist(['list', 'task']),
	entityId: v.pipe(v.string(), v.minLength(1)),
	op: v.picklist(['upsert', 'delete']),
	payload: v.unknown(),
	/** The client clock. The INPUT to last-writer-wins, never the authority. */
	updatedAt: v.pipe(v.string(), v.isoTimestamp())
});

export type ChangeOp = v.InferInput<typeof changeOpSchema>;

export const changeRowSchema = v.object({
	kind: v.picklist(['list', 'task']),
	entityId: v.pipe(v.string(), v.minLength(1)),
	payload: v.unknown(),
	updatedAt: v.pipe(v.string(), v.isoTimestamp()),
	/** Server-assigned, strictly monotonic. The pull cursor. */
	rev: v.pipe(v.number(), v.integer(), v.minValue(1)),
	deletedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp()))
});

export type ChangeRow = v.InferOutput<typeof changeRowSchema>;

export const changesResponseSchema = v.object({
	changes: v.array(changeRowSchema),
	nextRev: v.pipe(v.number(), v.integer(), v.minValue(0)),
	/** True when more rows exist beyond `nextRev`. */
	hasMore: v.optional(v.boolean())
});

export type ChangesResponse = v.InferOutput<typeof changesResponseSchema>;

export const pushRequestSchema = v.object({
	wireVersion: v.literal(WIRE_VERSION),
	ops: v.array(changeOpSchema)
});

export type PushRequest = v.InferInput<typeof pushRequestSchema>;

/** What the server says it did with each op. The client reconciles against this. */
export const pushResultSchema = v.object({
	accepted: v.array(v.object({ opId: v.string(), entityId: v.string(), rev: v.number() })),
	rejected: v.array(
		v.object({
			opId: v.string(),
			reason: v.picklist(['stale', 'unknown-kind', 'invalid', 'forbidden'])
		})
	),
	nextRev: v.pipe(v.number(), v.integer(), v.minValue(0))
});

export type PushResult = v.InferOutput<typeof pushResultSchema>;

// ── merge ───────────────────────────────────────────────────────────────────

/** Anything that can be merged: it has an instant and a tombstone. */
export interface Mergeable {
	updatedAt: string;
	deletedAt?: string | null;
}

/**
 * Last-writer-wins, **server wins ties**, and a tombstone is never resurrected.
 *
 * Three rules, in this order, and the order matters:
 *
 *  1. If exactly one side is deleted, the deleted side wins. This is checked
 *     BEFORE the timestamps on purpose: a user deleting a task on a phone with a
 *     skewed clock must still see it stay deleted.
 *  2. Otherwise the newer `updatedAt` wins.
 *  3. On an exact tie the incoming (server) row wins, so both devices converge
 *     on the same answer rather than each keeping its own.
 *
 * The outcome is symmetric — `mergeRow(a, b)` and `mergeRow(b, a)` return the
 * same value — which is the property that makes concurrent edits converge at all.
 */
export function mergeRow<T extends Mergeable>(local: T | undefined, remote: T): T;
export function mergeRow<T extends Mergeable>(local: T, remote: T | undefined): T;
export function mergeRow<T extends Mergeable>(local: T | undefined, remote: T | undefined): T;
export function mergeRow<T extends Mergeable>(local: T | undefined, remote: T | undefined): T {
	if (!local) return remote as T;
	if (!remote) return local;

	const localDeleted = local.deletedAt != null;
	const remoteDeleted = remote.deletedAt != null;

	// 1. A tombstone is never resurrected, regardless of clocks.
	if (localDeleted !== remoteDeleted) {
		return (localDeleted ? local : remote) as T;
	}

	// 2. Newer wins.
	if (remote.updatedAt > local.updatedAt) return remote;
	if (local.updatedAt > remote.updatedAt) return local;

	// 3. Tie: the server's copy, so every device lands on the same row.
	return remote;
}

/**
 * Do these two rows carry the same data?
 *
 * Compared by VALUE, not identity, and that distinction is load-bearing. On a
 * tie `mergeRow` returns the REMOTE object (server wins ties, so every device
 * converges on the same row) — but the two objects can be deeply identical. An
 * identity check would call that a change, and the caller would write the row
 * back, bump its `updatedAt`, re-dirty it, and push it again on the next pull.
 * That echo never terminates: a device that pulls would immediately have
 * something to push, forever.
 */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) {
		if (a[key] !== b[key]) return false;
	}
	return true;
}

/**
 * Merge a whole change set into what the client already has.
 *
 * Returns only the rows that actually changed, so the caller can skip writes
 * that would bump `updatedAt` and dirty the row again — which, on a device that
 * just pulled, would push the change straight back to the server forever.
 */
export function mergeChanges<T extends Mergeable>(
	local: readonly T[],
	remote: readonly T[],
	key: (row: T) => string
): T[] {
	const index = new Map(local.map((row) => [key(row), row]));
	const changed: T[] = [];

	for (const row of remote) {
		const existing = index.get(key(row));
		if (!existing) {
			changed.push(row);
			continue;
		}
		const merged = mergeRow(existing, row);
		if (shallowEqual(merged as Record<string, unknown>, existing as Record<string, unknown>)) continue;
		changed.push(merged);
	}

	return changed;
}

/**
 * Is this local row ahead of the server's?
 *
 * The push queue is `dirty` flags, not a separate outbox — one `put()` marks a
 * row changed AND needing a push, so there is no second store to keep in step
 * and no atomicity to lose. This function is the query behind it.
 */
export function needsPush<T extends { dirty: number }>(row: T): boolean {
	return row.dirty === 1;
}

export type { EntityKind as SyncEntityKind };