import { describe, expect, it } from 'vitest';
import {
	atLocal,
	formatDue,
	groupByDay,
	isoDaysAgo,
	isPastDue,
	todayISO,
	todayWindowStart
} from '$lib/utils/time';
import type { Task } from '$lib/db/schema';

/**
 * Pure logic — no database, no DOM — so this stays on the default `node`
 * environment.
 *
 * The whole file exists to stop one specific class of bug: a task that is due
 * "today" being treated as due tomorrow because something compared a local
 * calendar day against a UTC instant. Every case below is chosen to break that.
 */

const DAY = 86_400_000;

function task(overrides: Partial<Task> = {}): Task {
	return {
		id: 't1',
		listId: 'l1',
		title: 'x',
		notes: null,
		dueDate: null,
		dueTime: null,
		priority: 0,
		parentId: null,
		repeat: null,
		completedAt: null,
		alarmAt: null,
		alarmId: null,
		alarmFiredAt: null,
		sortOrder: 0,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		deletedAt: null,
		rev: null,
		dirty: 1,
		...overrides
	};
}

describe('todayISO', () => {
	it('is a zero-padded YYYY-MM-DD', () => {
		expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('reads the LOCAL day even when the UTC day is different', () => {
		// 23:30 local on the 1st is already the 2nd in UTC for any positive
		// offset. `new Date().toISOString()` would answer "the 2nd" here.
		const d = new Date(2026, 2, 1, 23, 30);
		expect(todayISO(d)).toBe('2026-03-01');
	});

	it('rolls back correctly across midnight', () => {
		expect(todayISO(new Date(2026, 2, 2, 0, 30))).toBe('2026-03-02');
	});
});

describe('isoDaysAgo', () => {
	it('subtracts whole days', () => {
		expect(isoDaysAgo(new Date(2026, 2, 1, 12), 1)).toBe('2026-02-28');
	});

	it('is exactly todayWindowStart at 365 days', () => {
		const now = new Date(2026, 2, 1, 12);
		expect(isoDaysAgo(now, 365)).toBe(todayWindowStart(now));
	});

	it('crosses a DST boundary without drifting', () => {
		// Late March is when most of Europe changes offset. Counting in
		// milliseconds here would land on the 23rd; counting in calendar days
		// lands on the 22nd, which is the day the user meant.
		const now = new Date(2026, 2, 30, 12);
		const result = isoDaysAgo(now, 7);
		const expected = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
		expect(result).toBe(todayISO(expected));
	});
});

describe('todayWindowStart', () => {
	it('is exactly 365 days before today', () => {
		const now = new Date(2026, 9, 3, 9);
		const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 365);
		expect(todayWindowStart(now)).toBe(todayISO(start));
	});
});

describe('atLocal', () => {
	it('produces an instant that reads back as the same local time', () => {
		const iso = atLocal('2026-03-01', '09:30');
		expect(iso).not.toBeNull();
		const back = new Date(iso as string);
		expect(back.getHours()).toBe(9);
		expect(back.getMinutes()).toBe(30);
		expect(todayISO(back)).toBe('2026-03-01');
	});

	it('returns null when either half is missing', () => {
		expect(atLocal('2026-03-01', null as unknown as string)).toBeNull();
		expect(atLocal(null as unknown as string, '09:30')).toBeNull();
	});
});

describe('isPastDue', () => {
	it('is true for yesterday and still open', () => {
		expect(isPastDue(task({ dueDate: isoDaysAgo(new Date(), 1) }))).toBe(true);
	});

	it('is false for today', () => {
		expect(isPastDue(task({ dueDate: todayISO() }))).toBe(false);
	});

	it('is false for a completed task, however late', () => {
		expect(
			isPastDue(task({ dueDate: isoDaysAgo(new Date(), 40), completedAt: '2026-01-01T00:00:00.000Z' }))
		).toBe(false);
	});

	it('is false for an undated task', () => {
		expect(isPastDue(task({ dueDate: null }))).toBe(false);
	});
});

describe('groupByDay', () => {
	it('keeps tasks within a group in input order', () => {
		const rows = [
			task({ id: 'a', dueDate: '2026-03-01' }),
			task({ id: 'b', dueDate: '2026-03-02' }),
			task({ id: 'c', dueDate: '2026-03-01' })
		];
		const groups = groupByDay(rows);

		expect(groups.map((g) => g.day)).toEqual(['2026-03-01', '2026-03-02']);
		expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'c']);
	});

	it('groups in first-seen order, not sorted order', () => {
		const rows = [
			task({ id: 'a', dueDate: '2026-03-05' }),
			task({ id: 'b', dueDate: '2026-03-01' })
		];
		expect(groupByDay(rows).map((g) => g.day)).toEqual(['2026-03-05', '2026-03-01']);
	});

	it('drops undated tasks — they have no day to group under', () => {
		expect(groupByDay([task({ id: 'a', dueDate: null })])).toEqual([]);
	});
});

describe('formatDue', () => {
	it('says Today rather than printing a date the user already knows', () => {
		expect(formatDue(task({ dueDate: todayISO() }))?.label).toBe('Today');
	});

	it('labels an overdue task and gives it the overdue tone', () => {
		const due = formatDue(task({ dueDate: isoDaysAgo(new Date(), 3) }));
		expect(due?.tone).toBe('overdue');
		expect(due?.label).toBe('3 days ago');
	});

	it('is null for an undated task', () => {
		expect(formatDue(task({ dueDate: null }))).toBeNull();
	});

	it('appends the time when there is one', () => {
		expect(formatDue(task({ dueDate: todayISO(), dueTime: '09:05' }))?.label).toBe('Today 09:05');
	});
});