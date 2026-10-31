// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import AlarmSheet from '#lib/components/task/AlarmSheet.svelte';
import type { Task } from '#lib/db/schema';

/** Guards that the "Remind me" control reads the live row, not the copy it was opened with. */
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
