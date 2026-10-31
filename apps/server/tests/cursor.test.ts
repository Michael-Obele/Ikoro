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

/** Cursor arithmetic: every bug here is silent — it skips or replays changes forever. */

// `computeNextRev` reads only `rev`, so the payload is cast rather than spelled out.
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
		// A 400 strands the client; a reset costs one redundant pull that merges to identical rows.
		for (const bad of ['abc', '-1', '1.5', 'NaN', 'Infinity', '1e999', '<script>']) {
			expect(parseSince(bad), `since=${bad}`).toBe(INITIAL_CURSOR);
		}
	});

	it('does not clamp a huge cursor', () => {
		// MAX_SAFE_INTEGER is some clients' "caught up forever"; clamping it would replay everything.
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
		// limit=0 would query `LIMIT 1` and read as "no changes" forever.
		expect(clampLimit('0')).toBe(1);
		expect(clampLimit('-5')).toBe(1);
	});
});

describe('computeNextRev', () => {
	it('is the highest rev RETURNED, not since + count', () => {
		// A user's feed is sparse, so advancing by row count skips whole rev ranges.
		expect(computeNextRev([row(7), row(900)], 0)).toBe(900);
		expect(computeNextRev([row(7), row(900)], 5)).toBe(900);
	});

	it('never rewinds when nothing changed', () => {
		expect(computeNextRev([], 1234)).toBe(1234);
	});

	it('ignores a row below the cursor', () => {
		// Should be unreachable, but the cursor must never move backwards.
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
