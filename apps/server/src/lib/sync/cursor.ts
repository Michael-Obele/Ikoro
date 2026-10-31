/**
 * Pull-cursor arithmetic. A wrong cursor never throws — it silently skips or replays changes, so
 * every branch here is a pure function of its inputs and testable without a database.
 */

import type { WireChangeRow } from './merge';

/** The plan's pull page size. Also the hard ceiling — see `clampLimit`. */
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 500;

/** A client's first ever pull. */
export const INITIAL_CURSOR = 0;

/**
 * Parse `?since=`. Anything unparseable, negative or fractional becomes `INITIAL_CURSOR` — a 400
 * would strand the client, while a reset re-pulls history that merges to identical rows.
 */
export function parseSince(raw: string | null): number {
	if (raw === null || raw.trim() === '') return INITIAL_CURSOR;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return INITIAL_CURSOR;
	if (parsed < 0) return INITIAL_CURSOR;
	if (!Number.isInteger(parsed)) return INITIAL_CURSOR;
	return parsed;
}

/** Clamp `?limit=` into `[1, MAX_LIMIT]`. The ceiling is not advisory: one huge response is an OOM. */
export function clampLimit(raw: string | null): number {
	if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

/**
 * The cursor to store after this response: the highest `rev` actually returned, NOT `since +
 * rows.length`. A user's feed is sparse, so row count would skip whole rev ranges.
 */
export function computeNextRev(rows: readonly WireChangeRow[], since: number): number {
	let highest = since;
	for (const row of rows) {
		if (row.rev > highest) highest = row.rev;
	}
	return highest;
}

/**
 * Is there more after this page? True only when the page came back full, so it costs no extra
 * query. The element type is `unknown` because only `length` is read.
 */
export function computeHasMore(rows: readonly unknown[], limit: number): boolean {
	return rows.length >= limit;
}

/** A cap on ops per push, for the same memory reason as `MAX_LIMIT`. Well above a real offline batch. */
export const MAX_PUSH_OPS = 500;

/** The body is also capped in bytes, before it is parsed. */
export const MAX_PUSH_BODY_BYTES = 1_000_000;

export function isOversizedBatch(count: number): boolean {
	return count > MAX_PUSH_OPS;
}
