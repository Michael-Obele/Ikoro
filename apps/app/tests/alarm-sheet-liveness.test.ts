// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import AlarmSheet from '#lib/components/task/AlarmSheet.svelte';
import type { Task } from '#lib/db/schema';

/**
 * The "Remind me" control must read the LIVE row, not the copy it was opened
 * with.
 *
 * This is the regression guard for the reported bug: a sheet opened on a task
 * whose date had since changed kept computing its instant from the stale row,
 * so it answered "Pick a time in the future" for a date that was plainly in the
 * future, and it kept showing the old clock after the due time moved.
 *
 * The store is mocked out because the question here is not persistence — it is
 * whether a new prop value reaches the controls. A real IndexedDB round trip
 * would only add timing noise to that.
 */
vi.mock('#lib/db/repo', () => ({ updateTask: vi.fn(async () => {}) }));
vi.mock('#lib/platform', () => ({ detectPlatform: () => 'android' }));
vi.mock('#lib/alarms/scheduler', () => ({
	getScheduler: () => ({
		platform: 'android',
		cancel: vi.fn(async () => {}),
		schedule: vi.fn(),
		getPending: vi.fn(async () => new Set<string>()),
		ensureReady: vi.fn(),
		onAction: vi.fn()
	}),
	armAlarm: vi.fn(),
	BROWSER_LIMITATION: 'Browser only.'
}));
vi.mock('#lib/alarms/ringtone', () => ({
	pickRingtone: vi.fn(),
	ringtoneFor: () => null,
	ringtoneSupported: () => false,
	ringtoneTitleOf: async () => null
}));

function fixture(overrides: Partial<Task> = {}): Task {
	return {
		id: 'task-1',
		listId: 'list-1',
		title: 'Call the dentist',
		notes: null,
		dueDate: '2026-11-02',
		dueTime: '09:00',
		priority: 0,
		parentId: null,
		repeat: null,
		completedAt: null,
		alarmAt: null,
		alarmId: null,
		alarmFiredAt: null,
		sortOrder: 0,
		createdAt: '2026-10-01T09:00:00.000Z',
		updatedAt: '2026-10-01T09:00:00.000Z',
		deletedAt: null,
		rev: null,
		dirty: 1,
		...overrides
	};
}

const timeInput = () => document.querySelector<HTMLInputElement>('input[type="time"]');

afterEach(cleanup);

describe('AlarmSheet — the row is the truth', () => {
	it('shows the clock from the task, and follows it when the row changes', async () => {
		const armedTask = fixture({
			dueTime: '09:00',
			alarmAt: '2026-11-02T09:00:00.000Z',
			alarmId: '7'
		});

		const { rerender } = render(AlarmSheet, { task: armedTask });
		expect(timeInput()?.value).toBe('09:00');

		// The due time moved elsewhere in the sheet (DuePicker writes straight to
		// the store). The alarm control must show the new clock, not the old one.
		await rerender({ task: fixture({ ...armedTask, dueTime: '14:30' }) });

		expect(timeInput()?.value).toBe('14:30');
	});

	it('reflects the store when the alarm is switched on or off from outside', async () => {
		const off = fixture({ dueTime: '09:00', alarmAt: null, alarmId: null });
		const { rerender } = render(AlarmSheet, { task: off });

		expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
		expect(timeInput()).toBeNull();

		await rerender({
			task: fixture({ dueTime: '09:00', alarmAt: '2026-11-02T09:00:00.000Z', alarmId: '7' })
		});

		expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
		expect(timeInput()?.value).toBe('09:00');
	});
});
