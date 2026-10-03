import { describe, expect, it } from 'vitest';
import {
	clampLimit,
	computeHasMore,
	computeNextRev,
	parseSince,
	isOversizedBatch,
	DEFAULT_LIMIT,
	INITIAL_CURSOR,
	MAX_LIMIT,
	MAX_PUSH_OPS
} from '#lib/sync/cursor';
import type { WireChangeRow } from '#lib/sync/merge';

/**
 * The pull cursor is the one number a client STORES and trusts forever.
 *
 * Every bug in this file is silent: a cursor that rewinds re-pulls history
 * forever, and one that advances too far skips changes the user will never see
 * again. Neither throws, neither logs, and neither is recoverable without
 * reinstalling the app. So the edge cases are the tests — not the happy path.
 */

// The payload is irrelevant to every cursor assertion here — `computeNextRev`
// reads only `rev` — so it is cast once rather than spelled out 500 times.
const row = (rev: number): WireChangeRow => ({
	kind: 'task',
	entityId: `t${rev}`,
	payload: {} as WireChangeRow['payload'],
	updatedAt: '2026-10-01T12:00:00.000Z',
	rev,
	deletedAt: null
});

describe('parseSince', () => {
	it('is 0 for a first pull', () => {
		expect(parseSince(null)).toBe(INITIAL_CURSOR);
		expect(parseSince('')).toBe(INITIAL_CURSOR);
	});

	it('passes a real cursor through', () => {
		expect(parseSince('42')).toBe(42);
		expect(parseSince(' 42 ')).toBe(42);
	});

	it('resets rather than 400s on a garbage cursor', () => {
		// The asymmetry is the point. A 400 strands the client until reinstall;
		// resetting to 0 costs a redundant pull that merges to identical rows.
		for (const bad of ['abc', '-1', '1.5', 'NaN', 'Infinity', '1e999', '<script>']) {
			expect(parseSince(bad), `since=${bad}`).toBe(INITIAL_CURSOR);
		}
	});

	it('does not clamp a huge cursor', () => {
		// Some clients park at MAX_SAFE_INTEGER to mean "caught up forever".
		// Clamping that to MAX_LIMIT would replay the entire history.
		expect(parseSince(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
	});
});

describe('clampLimit', () => {
	it('defaults when absent or unparseable', () => {
		expect(clampLimit(null)).toBe(DEFAULT_LIMIT);
		expect(clampLimit('nope')).toBe(DEFAULT_LIMIT);
	});

	it('caps at MAX_LIMIT so one request cannot exhaust memory', () => {
		expect(clampLimit('100000')).toBe(MAX_LIMIT);
	});

	it('never returns less than 1', () => {
		// limit=0 would make the query `LIMIT 1` (the +1 probe) and the client
		// would read an empty page as "no changes" forever.
		expect(clampLimit('0')).toBe(1);
		expect(clampLimit('-5')).toBe(1);
	});
});

describe('computeNextRev', () => {
	it('is the highest rev RETURNED, not since + count', () => {
		// The bug this prevents: a user's feed is sparse. Revs 7 and 900 can
		// belong to the same user with 892 values in between that are nobody's.
		// Advancing by row count would jump the cursor past them permanently.
		expect(computeNextRev([row(7), row(900)], 0)).toBe(900);
		expect(computeNextRev([row(7), row(900)], 5)).toBe(900);
	});

	it('never rewinds when nothing changed', () => {
		expect(computeNextRev([], 1234)).toBe(1234);
	});

	it('ignores a row below the cursor', () => {
		// Defensive: should be unreachable, since the query filters `rev > since`.
		// But if it ever happens, the cursor must not move backwards.
		expect(computeNextRev([row(10), row(4)], 50)).toBe(50);
	});
});

describe('computeHasMore', () => {
	it('is false on a short page, with no second query', () => {
		expect(computeHasMore([row(1), row(2)], 500)).toBe(false);
	});

	it('is true on a full page', () => {
		expect(
			computeHasMore(
				Array.from({ length: 500 }, (_, i) => row(i + 1)),
				500
			)
		).toBe(true);
	});
});

describe('isOversizedBatch', () => {
	it('rejects a runaway batch but not a real offline queue', () => {
		expect(isOversizedBatch(MAX_PUSH_OPS)).toBe(false);
		expect(isOversizedBatch(MAX_PUSH_OPS + 1)).toBe(true);
		expect(isOversizedBatch(0)).toBe(false);
	});
});
