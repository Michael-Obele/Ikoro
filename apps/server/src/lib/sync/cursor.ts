/**
 * Pull-cursor arithmetic.
 *
 * Split out from the route because these are the numbers a client stores as its
 * sync position, and getting one wrong does not throw — it silently skips or
 * replays changes forever. Every branch here is a pure function of its inputs,
 * so all of them are testable without a database.
 */

import type { WireChangeRow } from './merge';

/** The plan's pull page size. Also the hard ceiling — see `clampLimit`. */
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 500;

/** A client's first ever pull. */
export const INITIAL_CURSOR = 0;

/**
 * Parse `?since=`.
 *
 * Anything unparseable, negative, fractional or non-numeric collapses to
 * `INITIAL_CURSOR` rather than erroring. The reason is asymmetric cost: a
 * garbage cursor that 400s means the client is stuck and the user has to
 * reinstall, while a garbage cursor that resets to 0 means the client re-pulls
 * its own history, re-derives identical rows, and converges. `mergeChanges`
 * compares by value precisely so that replay is free.
 *
 * `Number.MAX_SAFE_INTEGER` is treated as the "fully caught up" sentinel some
 * clients use to stop polling; it is passed through, not clamped.
 */
export function parseSince(raw: string | null): number {
	if (raw === null || raw.trim() === '') return INITIAL_CURSOR;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return INITIAL_CURSOR;
	if (parsed < 0) return INITIAL_CURSOR;
	if (!Number.isInteger(parsed)) return INITIAL_CURSOR;
	return parsed;
}

/**
 * Clamp `?limit=` into `[1, MAX_LIMIT]`.
 *
 * The ceiling is not advisory. A client asking for every change since the
 * beginning of time would make the server build one enormous response in
 * memory, and this process is expected to run in 512 MB.
 */
export function clampLimit(raw: string | null): number {
	if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

/**
 * The cursor the client should store after this response.
 *
 * The highest `rev` actually returned — NOT `since + rows.length`. Revs come
 * from one shared sequence but rows are filtered per user, so a user's feed is
 * sparse: revs 7 and 900 can belong to the same user with 892 values in
 * between that are nobody's. Advancing by row count would walk the cursor off
 * the end of the sequence and permanently skip everything in the gaps.
 *
 * Returns `since` unchanged when nothing came back, so an idle client does not
 * rewind its cursor.
 */
export function computeNextRev(rows: readonly WireChangeRow[], since: number): number {
	let highest = since;
	for (const row of rows) {
		if (row.rev > highest) highest = row.rev;
	}
	return highest;
}

/**
 * Is there more after this page?
 *
 * True only when the page came back FULL. A short page is proof there is nothing
 * more, so this costs no extra query and cannot be wrong; a full page means
 * "maybe", and the client's next pull with the new cursor settles it.
 *
 * The element type is `unknown` on purpose: this reads only `length`, and the
 * caller has just sliced driver rows (`FeedRow`) that have not been projected
 * onto the wire shape yet. Typing it as `WireChangeRow[]` would force the
 * projection to happen earlier purely to satisfy a function that never looks at
 * a row.
 */
export function computeHasMore(rows: readonly unknown[], limit: number): boolean {
	return rows.length >= limit;
}

/**
 * A cap on ops per push, for the same memory reason as `MAX_LIMIT`.
 *
 * Sized well above any realistic offline batch: a phone that queued a month of
 * edits does not produce thousands of ops, so this rejects a runaway client or
 * a hostile one without inconveniencing a real one.
 */
export const MAX_PUSH_OPS = 500;

/** The body is also capped in bytes, before it is parsed. */
export const MAX_PUSH_BODY_BYTES = 1_000_000;

export function isOversizedBatch(count: number): boolean {
	return count > MAX_PUSH_OPS;
}
