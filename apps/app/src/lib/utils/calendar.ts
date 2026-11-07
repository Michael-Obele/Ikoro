/** Monday-first month grid + label. Pure math; only the 1st's weekday uses `Date`. */
export function monthGrid(year: number, month: number): string[] {
	const dim = daysInMonth(year, month);
	// getDay: 0=Sun..6=Sat; shift to Mon=0..Sun=6.
	const leading = (new Date(year, month - 1, 1).getDay() + 6) % 7;
	const start = 1 - leading;
	const prevMonth = month === 1 ? 12 : month - 1;
	const prevYear = month === 1 ? year - 1 : year;
	const prevDim = daysInMonth(prevYear, prevMonth);
	const nextMonth = month === 12 ? 1 : month + 1;
	const nextYear = month === 12 ? year + 1 : year;
	const cells: string[] = [];
	for (let i = 0; i < 42; i++) {
		const n = start + i;
		if (n < 1) cells.push(iso(prevYear, prevMonth, prevDim + n));
		else if (n > dim) cells.push(iso(nextYear, nextMonth, n - dim));
		else cells.push(iso(year, month, n));
	}
	return cells;
}

export function monthLabel(year: number, month: number): string {
	return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
		month: 'long',
		year: 'numeric'
	});
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) return isLeap(year) ? 29 : 28;
	if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
	return 31;
}

// Gregorian leap-year rule.
function isLeap(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function iso(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
