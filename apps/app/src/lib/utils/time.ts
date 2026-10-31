/**
 * Every date the app shows and every instant it arms. Deliberately PURE: no db, no Svelte, no DOM.
 * `dueDate` is a LOCAL day — `new Date('2026-01-01')` parses as UTC and lands a day early.
 * Days are counted in calendar days; dividing ms by 86_400_000 is an hour out across DST.
 */

/** Mirrors `repo.PAST_WINDOW_DAYS`; a literal so this file imports nothing. */
export const PAST_WINDOW_DAYS = 365;

export type DueTone = 'overdue' | 'today' | 'soon' | 'future';

export interface DueDisplay {
	label: string;
	tone: DueTone;
}

/** The local calendar day of `from`, as `YYYY-MM-DD`. */
export function todayISO(from: Date = new Date()): string {
	const y = from.getFullYear();
	const m = String(from.getMonth() + 1).padStart(2, '0');
	const d = String(from.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** Parse `YYYY-MM-DD` into a Date at LOCAL midnight. */
export function parseLocalDay(value: string): Date {
	const [y, m, d] = value.split('-').map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** The local calendar day `days` before `from`. Negative values look forward. */
export function isoDaysAgo(from: Date, days: number): string {
	const copy = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	copy.setDate(copy.getDate() - days);
	return todayISO(copy);
}

/** The oldest date Today will show: today minus the window. */
export function todayWindowStart(now: Date = new Date()): string {
	return isoDaysAgo(now, PAST_WINDOW_DAYS);
}

/** Whole calendar days from today to `day`. Negative is in the past. */
export function daysUntil(day: string, now: Date = new Date()): number {
	const a = parseLocalDay(todayISO(now));
	const b = parseLocalDay(day);
	// Two local midnights are not always 86_400_000 ms apart across a DST boundary.
	const tzDrift =
		a.getTimezoneOffset() === b.getTimezoneOffset()
			? 0
			: Math.round((new Date(b.getTime() + 86_400_000).getTime() - b.getTime()) / 86_400_000) - 1;
	return Math.round((b.getTime() - a.getTime()) / 86_400_000 + tzDrift);
}

/**
 * The ISO instant for a local date + time pair, or `null`. The ONLY place a pair becomes an
 * instant — the result is stored in `alarmAt` and never recomputed.
 */
export function atLocal(dateISO: string | null, timeHHmm: string | null): string | null {
	if (!dateISO || !timeHHmm) return null;
	const [h, m] = timeHHmm.split(':').map(Number);
	const d = parseLocalDay(dateISO);
	d.setHours(h ?? 0, m ?? 0, 0, 0);
	return d.toISOString();
}

/** The name M4's scheduler uses. Same function, named for what it is doing. */
export function deriveAlarmAt(dueDate: string | null, dueTime: string | null): string | null {
	return atLocal(dueDate, dueTime);
}

/** True when a task was due before today and is still open. */
export function isPastDue(
	task: { dueDate: string | null; completedAt: string | null },
	now: Date = new Date()
): boolean {
	if (!task.dueDate) return false;
	if (task.completedAt !== null) return false;
	return task.dueDate < todayISO(now);
}

/**
 * Group tasks by dueDate. Order is first-seen and input order is kept — callers have
 * already decided the ordering. Undated tasks are dropped.
 */
export function groupByDay<T extends { dueDate: string | null }>(
	tasks: T[]
): { day: string; tasks: T[] }[] {
	const groups: { day: string; tasks: T[] }[] = [];
	const index = new Map<string, { day: string; tasks: T[] }>();

	for (const task of tasks) {
		if (!task.dueDate) continue;
		let group = index.get(task.dueDate);
		if (!group) {
			group = { day: task.dueDate, tasks: [] };
			index.set(task.dueDate, group);
			groups.push(group);
		}
		group.tasks.push(task);
	}

	return groups;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `12 Mar` — or `12 Mar 2027` when it is not this year. */
export function shortDate(day: string, now: Date = new Date()): string {
	const d = parseLocalDay(day);
	const sameYear = d.getFullYear() === now.getFullYear();
	return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** A human heading for a day: `Today`, `Tomorrow`, `Wednesday`, `12 Mar`. */
export function formatDayHeading(day: string, now: Date = new Date()): string {
	const delta = daysUntil(day, now);
	if (delta === 0) return 'Today';
	if (delta === 1) return 'Tomorrow';
	if (delta === -1) return 'Yesterday';
	if (delta > 1 && delta <= 7) return WEEKDAYS[parseLocalDay(day).getDay()];
	return `${WEEKDAYS[parseLocalDay(day).getDay()]} ${shortDate(day, now)}`;
}

/**
 * `null` in, `null` out. The result carries a `tone` as well as text, so "Overdue" and
 * "Due today" cannot drift into looking the same.
 */
export function formatDue(
	task: { dueDate: string | null; dueTime: string | null; completedAt: string | null },
	now: Date = new Date()
): DueDisplay | null {
	if (!task.dueDate) return null;

	const delta = daysUntil(task.dueDate, now);
	const at = task.dueTime ? ` ${task.dueTime}` : '';
	const done = task.completedAt !== null;

	if (delta < 0) {
		// A completed task is never "overdue" — it was handled.
		if (done) return { label: `${shortDate(task.dueDate, now)} · done`, tone: 'future' };
		return {
			label: delta === -1 ? `Yesterday${at}` : `${Math.abs(delta)} days ago`,
			tone: 'overdue'
		};
	}

	if (delta === 0) return { label: `Today${at}`, tone: 'today' };
	if (delta === 1) return { label: `Tomorrow${at}`, tone: 'soon' };
	if (delta <= 7)
		return { label: `${WEEKDAYS[parseLocalDay(task.dueDate).getDay()]}${at}`, tone: 'soon' };
	return { label: shortDate(task.dueDate, now), tone: 'future' };
}
