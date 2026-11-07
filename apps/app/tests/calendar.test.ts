import { describe, expect, it } from 'vitest';
import { monthGrid, monthLabel } from '#lib/utils/calendar';

/** Guards the month grid against off-by-one and weekday-misalignment bugs. */

function parseDay(value: string): Date {
	const [y, m, d] = value.split('-').map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

describe('monthGrid', () => {
	it('always returns exactly 42 cells', () => {
		for (const [y, m] of [
			[2026, 2],
			[2025, 9],
			[2026, 11],
			[2026, 12],
			[2024, 2]
		] as const) {
			expect(monthGrid(y, m)).toHaveLength(42);
		}
	});

	it('starts on a Monday', () => {
		for (const [y, m] of [
			[2026, 2],
			[2025, 9],
			[2026, 11],
			[2026, 12]
		] as const) {
			expect(parseDay(monthGrid(y, m)[0] as string).getDay()).toBe(1);
		}
	});

	it('contains the 1st and last day of the month', () => {
		expect(monthGrid(2026, 11)).toContain('2026-11-01');
		expect(monthGrid(2026, 11)).toContain('2026-11-30');
		expect(monthGrid(2026, 2)).toContain('2026-02-01');
		expect(monthGrid(2026, 2)).toContain('2026-02-28');
	});

	it('places February 2026 (28 days, starts Sunday) correctly', () => {
		const grid = monthGrid(2026, 2);
		expect(grid[0]).toBe('2026-01-26');
		expect(grid[6]).toBe('2026-02-01');
		expect(grid[33]).toBe('2026-02-28');
		expect(grid[41]).toBe('2026-03-08');
	});

	it('has zero leading days when the 1st is a Monday', () => {
		expect(monthGrid(2025, 9)[0]).toBe('2025-09-01');
		expect(monthGrid(2025, 12)[0]).toBe('2025-12-01');
	});

	it('rolls December into January of the next year', () => {
		const grid = monthGrid(2026, 12);
		expect(grid[0]).toBe('2026-11-30');
		expect(grid).toContain('2026-12-01');
		expect(grid).toContain('2026-12-31');
		expect(grid[41]).toBe('2027-01-10');
	});
});

describe('monthLabel', () => {
	it('renders e.g. November 2026', () => {
		expect(monthLabel(2026, 11)).toBe('November 2026');
		expect(monthLabel(2026, 2)).toBe('February 2026');
	});
});
