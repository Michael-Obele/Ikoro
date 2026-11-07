import type { Task } from '$lib/db/schema';

export type Repeat = NonNullable<Task['repeat']>;

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

function isLeapYear(y: number): boolean {
	return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function daysInMonth(y: number, m: number): number {
	// Feb needs the leap rule; Apr/Jun/Sep/Nov have 30.
	if (m === 2) return isLeapYear(y) ? 29 : 28;
	return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function parseDay(from: string): { y: number; m: number; d: number } | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
	const [y, m, d] = from.split('-').map(Number);
	if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
	return { y, m, d };
}

// Howard Hinnant's civil↔days, pure integer math so DST never shifts a day.
function daysFromCivil(y: number, m: number, d: number): number {
	y -= m <= 2 ? 1 : 0;
	const era = Math.floor((y >= 0 ? y : y - 399) / 400);
	const yoe = y - era * 400;
	const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): { y: number; m: number; d: number } {
	z += 719468;
	const era = Math.floor(z / 146097);
	const doe = z - era * 146097;
	const yoe = Math.floor(
		(doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
	);
	const y = yoe + era * 400;
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const m = mp + (mp < 10 ? 3 : -9);
	return { y: m <= 2 ? y + 1 : y, m, d };
}

// 1970-01-01 was a Thursday (4 when Sunday is 0).
function dayOfWeek(days: number): number {
	return (((days + 4) % 7) + 7) % 7;
}

function iso(y: number, m: number, d: number): string {
	return `${y}-${pad(m)}-${pad(d)}`;
}

/** Next local `YYYY-MM-DD` for `repeat`; malformed `from` returns unchanged, never throws. */
export function nextOccurrence(from: string, repeat: Repeat): string {
	const parsed = parseDay(from);
	if (!parsed) return from;
	const { y, m, d } = parsed;
	const days = daysFromCivil(y, m, d);
	if (repeat === 'daily') {
		const n = civilFromDays(days + 1);
		return iso(n.y, n.m, n.d);
	}
	if (repeat === 'weekly') {
		const n = civilFromDays(days + 7);
		return iso(n.y, n.m, n.d);
	}
	if (repeat === 'weekdays') {
		// Step past Sat/Sun; Fri/Sat/Sun all land on Monday.
		let n = days + 1;
		while (dayOfWeek(n) === 0 || dayOfWeek(n) === 6) n++;
		const c = civilFromDays(n);
		return iso(c.y, c.m, c.d);
	}
	// Monthly: same day next month, clamped to that month's last day.
	const nm = m === 12 ? 1 : m + 1;
	const ny = m === 12 ? y + 1 : y;
	return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
