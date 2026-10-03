import type { Task } from '$lib/db/schema';

/**
 * Every human-readable date in the app is produced here.
 *
 * Two rules the rest of the codebase relies on:
 *
 *  - `dueDate` is a LOCAL calendar day (`YYYY-MM-DD`), never an instant. Comparing
 *    it with a UTC `Date` is how an alarm ends up a day out; so all comparison
 *    below goes through `localDay()`, which reads the date in the viewer's own
 *    timezone — the same string the user typed.
 *  - the result carries a `tone`, not just text. "Overdue" and "Due today" look
 *    the same in a string but must not look the same on screen, and deciding that
 *    with a substring test at the call site is how it silently drifts.
 */

export type DueTone = 'overdue' | 'today' | 'soon' | 'future';

export interface DueDisplay {
	label: string;
	tone: DueTone;
}

/** The local-time `YYYY-MM-DD` for an instant — the storage format of `dueDate`. */
export function localDay(d: Date = new Date()): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` into a local Date. `new Date('2026-01-01')` is UTC, which is the bug this avoids. */
export function parseLocalDay(value: string): Date {
	const [y, m, d] = value.split('-').map(Number);
	return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

export function shiftDays(d: Date, days: number): Date {
	const copy = new Date(d);
	copy.setDate(copy.getDate() + days);
	return copy;
}

/** Whole days from today to `day` — negative is in the past. */
export function daysUntil(day: string, now: Date = new Date()): number {
	const a = parseLocalDay(localDay(now));
	const b = parseLocalDay(day);
	return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(day: string, now: Date = new Date()): string {
	const d = parseLocalDay(day);
	const sameYear = d.getFullYear() === now.getFullYear();
	return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/**
 * `null` in, `null` out: an undated task has nothing to say about its due date,
 * and every caller would otherwise have to re-check.
 */
export function formatDue(task: Pick<Task, 'dueDate' | 'dueTime' | 'completedAt'>, now: Date = new Date()): DueDisplay | null {
	if (!task.dueDate) return null;

	const delta = daysUntil(task.dueDate, now);
	const at = task.dueTime ?? '';
	const done = task.completedAt !== null;

	let tone: DueTone;
	let label: string;

	if (delta < 0) {
		// A completed task is never "overdue" — it was handled.
		tone = done ? 'future' : 'overdue';
		label = delta === -1 ? 'Yesterday' : `${Math.abs(delta)} days ago`;
	} else if (delta === 0) {
		tone = 'today';
		label = at ? `Today ${at}` : 'Today';
	} else if (delta === 1) {
		tone = 'soon';
		label = at ? `Tomorrow ${at}` : 'Tomorrow';
	} else if (delta <= 7) {
		tone = 'soon';
		label = `${WEEKDAYS[parseLocalDay(task.dueDate).getDay()]}${at ? ` ${at}` : ''}`;
	} else {
		tone = 'future';
		label = shortDate(task.dueDate, now);
	}

	return { label, tone };
}

/** `Today`, used as a section heading. */
export function formatDayHeading(day: string, now: Date = new Date()): string {
	const delta = daysUntil(day, now);
	if (delta === 0) return 'Today';
	if (delta === 1) return 'Tomorrow';
	if (delta === -1) return 'Yesterday';
	return `${WEEKDAYS[parseLocalDay(day).getDay()]} ${shortDate(day, now)}`;
}

/**
 * The instant an alarm should fire, or `null` when the task cannot have one.
 *
 * `alarmAt` is the single source of truth for arming — it is stored, never
 * re-derived at fire time, so that changing a device's timezone cannot silently
 * move an alarm the user already set. This helper only exists to turn the two
 * calendar fields into that instant at the moment the user sets them.
 */
export function deriveAlarmAt(dueDate: string | null, dueTime: string | null): string | null {
	if (!dueDate || !dueTime) return null;
	const d = parseLocalDay(dueDate);
	const [h, m] = dueTime.split(':').map(Number);
	d.setHours(h ?? 0, m ?? 0, 0, 0);
	return d.toISOString();
}