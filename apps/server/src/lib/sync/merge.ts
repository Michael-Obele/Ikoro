/**
 * The server's merge decision. `mergeRow` is imported, not reimplemented, and the STORED row is
 * passed as `remote` because that side wins ties.
 */

import { mergeRow, type ChangeOp, type EntityKind, type Mergeable } from '@ikoro/sync';
import type { AnyPayload } from './payload';

/** The stored shape of an entity row. */
export interface StoredRow {
	readonly id: string;
	readonly userId: string;
	readonly payload: AnyPayload;
	/** ISO 8601 string. The client LWW clock, stored verbatim as written. */
	readonly updatedAt: string;
	readonly rev: number;
	readonly deletedAt: string | null;
}

/** The candidate write produced by an op, before it is compared. */
export interface IncomingRow {
	readonly id: string;
	readonly userId: string;
	readonly payload: AnyPayload;
	readonly updatedAt: string;
	/** Tombstone instant, or null. Derived from `op === 'delete'`. */
	readonly deletedAt: string | null;
}

export type MergeOutcome =
	| { readonly decision: 'insert'; readonly row: IncomingRow; readonly reason: 'new' }
	| {
			readonly decision: 'update';
			readonly row: IncomingRow;
			readonly reason: 'newer' | 'tombstone';
	  }
	| {
			readonly decision: 'reject';
			readonly reason: 'stale';
			/** The stored row's `updatedAt`, so a client can see how far behind it is. */
			readonly storedUpdatedAt: string;
	  };

/**
 * Turn an op into the row it wants to write. `op: 'delete'` produces a TOMBSTONE, never a DELETE —
 * a removed row would be pushed straight back by a peer that had not seen the delete.
 */
export function incomingFromOp(op: ChangeOp, userId: string): IncomingRow {
	return {
		id: op.entityId,
		userId,
		payload: op.payload as AnyPayload,
		updatedAt: op.updatedAt,
		deletedAt: op.op === 'delete' ? op.updatedAt : null
	};
}

/**
 * Decide what a push does to a stored row: INSERT / UPDATE / REJECT, delegated to `mergeRow` so
 * the SQL layer never invents a comparison of its own.
 */
export function resolveWrite(existing: StoredRow | undefined, incoming: IncomingRow): MergeOutcome {
	if (!existing) {
		return { decision: 'insert', row: incoming, reason: 'new' };
	}

	// Passed by REFERENCE: `mergeRow` returns one of the two objects it was handed, so identity
	// answers "which side won". Fresh literals would make every op look applied.
	const local: Mergeable = incoming;
	const remote: Mergeable = existing;

	// The stored row goes in as `remote` so IT wins ties. See the file header.
	const merged = mergeRow(local, remote);

	if (merged === remote) {
		return { decision: 'reject', reason: 'stale', storedUpdatedAt: existing.updatedAt };
	}

	// A tombstone beating a live row is a real condition on a device with skewed time.
	const reason = incoming.deletedAt !== null && existing.deletedAt === null ? 'tombstone' : 'newer';

	return { decision: 'update', row: incoming, reason };
}

/** The wire shape of one feed row. Matches `changeRowSchema` in `@ikoro/sync`. */
export interface WireChangeRow {
	readonly kind: EntityKind;
	readonly entityId: string;
	readonly payload: AnyPayload;
	readonly updatedAt: string;
	readonly rev: number;
	readonly deletedAt: string | null;
}

/**
 * Project a stored row onto the wire shape. The server decides nothing here — the client merges
 * with `mergeChanges`, so it owes an honest `updatedAt`, `deletedAt` and `rev`.
 */
export function toChangeRow(kind: EntityKind, row: StoredRow): WireChangeRow {
	return {
		kind,
		entityId: row.id,
		payload: row.payload,
		updatedAt: row.updatedAt,
		rev: row.rev,
		deletedAt: row.deletedAt
	};
}
