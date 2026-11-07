// @vitest-environment jsdom
// `fake-indexeddb/auto` must load first: schema.ts calls createReactiveDB() at module scope.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '#lib/db/schema';
import { ensureSeeded } from '#lib/db/seed';
import * as repo from '#lib/db/repo';
import { completeTask } from '#lib/tasks/complete';
import { setScheduler } from '#lib/alarms/scheduler';
import type {
	AlarmPermissionStatus,
	AlarmRequest,
	AlarmScheduler,
	ScheduleOutcome
} from '#lib/alarms/types';

/**
 * The advance-on-complete contract. Repeating tasks never complete — they move
 * to the next date and re-arm. A failed or degraded re-arm resolves as an
 * outcome so the UI can surface it, never silent.
 */
class FakeScheduler implements AlarmScheduler {
	readonly platform = 'browser' as const;
	scheduled: AlarmRequest[] = [];
	cancelled: string[] = [];
	pending = new Set<string>();
	nextOutcome: ScheduleOutcome | null = null;

	async ensureReady(): Promise<AlarmPermissionStatus> {
		return { notifications: 'granted', exact: 'granted', fullScreenIntent: 'granted' };
	}

	async schedule(alarm: AlarmRequest): Promise<ScheduleOutcome> {
		this.scheduled.push(alarm);
		const outcome: ScheduleOutcome = this.nextOutcome ?? {
			ok: true,
			platformId: 'platform-1',
			exact: true
		};
		if (outcome.ok) this.pending.add(outcome.platformId);
		return outcome;
	}

	async cancel(platformId: string): Promise<void> {
		this.cancelled.push(platformId);
		this.pending.delete(platformId);
	}

	async getPending(): Promise<Set<string>> {
		return new Set(this.pending);
	}

	onAction(_handler: (taskId: string) => void): void {}
}

let fake: FakeScheduler;

beforeEach(async () => {
	await db.tasks.clear();
	await db.lists.clear();
	fake = new FakeScheduler();
	setScheduler(fake);
	await ensureSeeded();
});

afterEach(() => {
	setScheduler(null);
});

async function seededListId(): Promise<string> {
	const lists = await repo.getLists();
	return lists[0].id;
}

describe('completeTask', () => {
	it('advances a repeating daily task with alarm, cancels the old id and stores the new one', async () => {
		const listId = await seededListId();
		const dueDate = '2026-11-07';
		const created = await repo.createTask({
			listId,
			title: 'daily',
			dueDate,
			dueTime: '09:00',
			repeat: 'daily',
			alarmAt: '2026-11-07T09:00:00.000Z'
		});
		await repo.updateTask(created.id, { alarmId: 'old-platform-1' });
		const before = (await repo.getTask(created.id))!;
		expect(before.alarmId).toBe('old-platform-1');

		fake.nextOutcome = { ok: true, platformId: 'new-platform-1', exact: true };
		const outcome = await completeTask(before);

		const after = (await repo.getTask(created.id))!;
		expect(after.completedAt).toBeNull();
		expect(after.dueDate).toBe('2026-11-08');
		expect(after.alarmId).toBe('new-platform-1');
		expect(fake.cancelled).toContain('old-platform-1');
		expect(fake.scheduled).toHaveLength(1);
		expect(outcome?.ok).toBe(true);
	});

	it('advances a repeating task with no due time without scheduling', async () => {
		const listId = await seededListId();
		const created = await repo.createTask({
			listId,
			title: 'daily no time',
			dueDate: '2026-11-07',
			repeat: 'daily'
		});
		const input = (await repo.getTask(created.id))!;

		const outcome = await completeTask(input);

		const after = (await repo.getTask(created.id))!;
		expect(after.dueDate).toBe('2026-11-08');
		expect(after.alarmAt).toBeNull();
		expect(fake.scheduled).toHaveLength(0);
		expect(outcome).toBeNull();
	});

	it('completes a non-repeating task without changing dueDate', async () => {
		const listId = await seededListId();
		const created = await repo.createTask({ listId, title: 'once', dueDate: '2026-11-07' });

		const outcome = await completeTask(created);

		const after = (await repo.getTask(created.id))!;
		expect(after.completedAt).not.toBeNull();
		expect(after.dueDate).toBe('2026-11-07');
		expect(outcome).toBeNull();
		expect(fake.scheduled).toHaveLength(0);
	});

	it('restores an already-completed non-repeating task', async () => {
		const listId = await seededListId();
		const created = await repo.createTask({ listId, title: 'once', dueDate: '2026-11-07' });
		await repo.toggleTask(created.id);
		const completed = (await repo.getTask(created.id))!;
		expect(completed.completedAt).not.toBeNull();

		const outcome = await completeTask(completed);

		const after = (await repo.getTask(created.id))!;
		expect(after.completedAt).toBeNull();
		expect(outcome).toBeNull();
	});

	it('resolves a degraded outcome but still advances the date', async () => {
		const listId = await seededListId();
		const created = await repo.createTask({
			listId,
			title: 'daily',
			dueDate: '2026-11-07',
			dueTime: '09:00',
			repeat: 'daily'
		});
		fake.nextOutcome = { ok: true, platformId: 'degraded-1', exact: false, warning: 'late' };
		const input = (await repo.getTask(created.id))!;

		const outcome = await completeTask(input);

		expect(outcome?.ok).toBe(true);
		expect(outcome).toMatchObject({ ok: true, exact: false });
		const after = (await repo.getTask(created.id))!;
		expect(after.dueDate).toBe('2026-11-08');
	});

	it('resolves a failed outcome with null alarmId but still advances the date', async () => {
		const listId = await seededListId();
		const created = await repo.createTask({
			listId,
			title: 'daily',
			dueDate: '2026-11-07',
			dueTime: '09:00',
			repeat: 'daily'
		});
		fake.nextOutcome = { ok: false, reason: 'permission' };
		const input = (await repo.getTask(created.id))!;

		const outcome = await completeTask(input);

		expect(outcome?.ok).toBe(false);
		expect(outcome).toMatchObject({ ok: false });
		const after = (await repo.getTask(created.id))!;
		expect(after.alarmId).toBeNull();
		expect(after.dueDate).toBe('2026-11-08');
	});
});
