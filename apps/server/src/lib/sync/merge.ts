/**
 * The server's merge decision.
 *
 * ── `mergeRow` IS IMPORTED, NOT REIMPLEMENTED ───────────────────────────────
 * `@ikoro/sync` exports `mergeRow` and it is used here exactly as published.
 * That is not tidiness, it is the whole point of the package: `apps/app` runs
 * the identical function during a pull, so if the server had its own copy, two
 * implementations of conflict resolution would be two behaviours — and the bug
 * would be unreproducible, because it would depend on which device you asked.
 *
 * ── Argument order is the whole trick ───────────────────────────────────────
 * `mergeRow(local, remote)` is "newer wins, and on an exact TIE THE REMOTE
 * WINS". So *whichever side is passed as `remote` wins ties*, and that is the
 * one knob that decides a contested tie.
 *
 * On the server the side that must win a tie is the STORED row: the protocol's
 * tie-break exists so every device converges, and the stored row is the copy
 * every device is converging ON. Handing a tie to the incoming op instead would
 * let an op carrying an identical millisecond timestamp clobber committed data
 * purely because it arrived later — a silent, order-dependent loss.
 *
 * So the incoming row is passed as `local` and the stored row as `remote`:
 *
 *   incoming newer   → newer wins  → incoming applies
 *   incoming older   → newer wins  → stored wins, op reported `stale`
 *   exact tie        → remote wins → stored wins, op reported `stale`
 *   delete vs live   → deleted side wins, regardless of clock
 *
 * Every one of those four outcomes is decided by the library, not here.
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
 * Turn an op into the row it wants to write.
 *
 * `op: 'delete'` produces a TOMBSTONE, never a `DELETE` statement. This is the
 * single most important behaviour in the file: if a delete removed the row, a
 * peer that had not yet seen the delete would push the task straight back and
 * the user would watch their deleted task reappear on its own. The row has to
 * survive until every peer has seen it.
 *
 * The tombstone's `updatedAt` is the op's own `updatedAt` — the instant the
 * deleting device observed. Inventing a server-side "now" instead would hand the
 * server the clock authority the protocol explicitly refuses it.
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
 * Decide what a push does to a stored row.
 *
 * Delegates the conflict rule to `mergeRow` and translates its verdict into an
 * INSERT / UPDATE / REJECT, because the database cannot express "reject" and the
 * SQL layer must not be inventing a comparison of its own.
 */
export function resolveWrite(existing: StoredRow | undefined, incoming: IncomingRow): MergeOutcome {
	if (!existing) {
		return { decision: 'insert', row: incoming, reason: 'new' };
	}

	// `mergeRow` needs only `updatedAt` and `deletedAt`, so both sides are passed
	// by REFERENCE rather than as fresh `{ updatedAt, deletedAt }` literals.
	//
	// That is load-bearing, not a style choice: `mergeRow` returns one of the two
	// objects it was handed, so reference identity is an exact answer to "which
	// side won?". Handing it new literals makes that comparison always false, and
	// every op is then reported as applied — a stale push silently overwrites a
	// newer row, which is the precise corruption the merge rules exist to prevent.
	const local: Mergeable = incoming;
	const remote: Mergeable = existing;

	// The stored row goes in as `remote` so IT wins ties. See the file header.
	const merged = mergeRow(local, remote);

	if (merged === remote) {
		return { decision: 'reject', reason: 'stale', storedUpdatedAt: existing.updatedAt };
	}

	// The incoming row genuinely won. Reporting WHY matters: a tombstone beating
	// a live row means the delete succeeded despite an older clock, which is a
	// real condition on a device with skewed time and worth distinguishing from
	// an ordinary newer write.
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
 * Project a stored row onto the wire shape.
 *
 * The server never decides what a client should merge — `mergeChanges` in
 * `@ikoro/sync` does that, on the client, against its own local copy. What the
 * server owes the client is an honest `updatedAt` and `deletedAt` so the client's
 * merge sees exactly what was committed, and `rev` to advance its cursor past
 * it.
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
