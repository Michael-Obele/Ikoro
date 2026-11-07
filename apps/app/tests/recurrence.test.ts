import { describe, expect, it } from 'vitest';
import { nextOccurrence } from '#lib/utils/recurrence';

/**
 * Guards calendar-day recurrence: Date-object arithmetic drifts across DST and
 * month ends, so a daily task must still land on the 1st and a Jan-31 monthly
 * must clamp to Feb-28/29 instead of rolling into March.
 */

describe('nextOccurrence', () => {
	it('advances daily across month end', () => {
		expect(nextOccurrence('2026-01-31', 'daily')).toBe('2026-02-01');
	});

	it('advances daily across year end', () => {
		expect(nextOccurrence('2026-12-31', 'daily')).toBe('2027-01-01');
	});

	it('maps weekdays Fri/Sat/Sun all to Monday', () => {
		expect(nextOccurrence('2026-01-02', 'weekdays')).toBe('2026-01-05');
		expect(nextOccurrence('2026-01-03', 'weekdays')).toBe('2026-01-05');
		expect(nextOccurrence('2026-01-04', 'weekdays')).toBe('2026-01-05');
	});

	it('advances weekdays mid-week by one day', () => {
		expect(nextOccurrence('2026-01-05', 'weekdays')).toBe('2026-01-06');
	});

	it('advances weekly by 7 days', () => {
		expect(nextOccurrence('2026-01-15', 'weekly')).toBe('2026-01-22');
	});

	it('clamps monthly to Feb-28 in a non-leap year', () => {
		expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
	});

	it('clamps monthly to Feb-29 in a leap year', () => {
		expect(nextOccurrence('2028-01-31', 'monthly')).toBe('2028-02-29');
	});

	it('rolls monthly across December to January', () => {
		expect(nextOccurrence('2026-12-15', 'monthly')).toBe('2027-01-15');
	});

	it('returns malformed input unchanged instead of throwing', () => {
		expect(nextOccurrence('not-a-date', 'daily')).toBe('not-a-date');
		expect(nextOccurrence('2026-13-40', 'weekly')).toBe('2026-13-40');
		expect(nextOccurrence('', 'monthly')).toBe('');
	});
});
