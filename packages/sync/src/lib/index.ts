/**
 * The sync wire protocol, shared by app and server so conflict resolution exists once.
 * Last-writer-wins on `updatedAt`; tombstones win; the server is the clock.
 */

import * as v from 'valibot';

export type EntityKind = 'list' | 'task';

/** Bumped only for a wire-incompatible change; the server refuses older clients loudly. */
export const WIRE_VERSION = 1;

/** Client-generated op id: a retried upsert with the same op id must be a no-op. */
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

/** Last-writer-wins, server wins ties, tombstones never resurrect. Symmetric, so edits converge. */
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

	// 3. Tie: the server's copy.
	return remote;
}

/** Compared by VALUE: an identity check would call identical rows a change and re-dirty them forever. */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) {
		if (a[key] !== b[key]) return false;
	}
	return true;
}

/** Rows that actually changed; writing unchanged rows would re-dirty them forever. */
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

/** The push queue is the `dirty` flag, not a separate outbox. */
export function needsPush<T extends { dirty: number }>(row: T): boolean {
	return row.dirty === 1;
}

export type { EntityKind as SyncEntityKind };