// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '#lib/db/schema';
import { reconcile } from '#lib/alarms/reconcile';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from '#lib/alarms/types';

/**
 * No Capacitor here, and no device. The tests drive a hand-written fake
 * implementing `AlarmScheduler`, which is the whole reason that interface exists:
 * the reconciliation logic — "the store says this is armed but the platform does
 * not have it" — is the part that actually breaks, and it can be tested anywhere.
 *
 * A real device test (M4-S1) still gates the promise that this logic serves.
 * These tests prove the bookkeeping, not Android's alarm manager.
 */

const NOW = new Date('2026-10-03T12:00:00.000Z');
const FUTURE = '2026-10-03T13:00:00.000Z';
const PAST = '2026-10-03T11:00:00.000Z';

/** A scheduler whose pending set and outcomes the test controls outright. */
class FakeScheduler implements AlarmScheduler {
	readonly platform = 'android' as const;
	pending = new Set<string>();
	outcomes: ScheduleOutcome[] = [];
	scheduled: AlarmRequest[] = [];
	cancelled: string[] = [];
	permission: AlarmPermissionStatus = { notifications: 'granted', exact: 'granted' };

	async ensureReady() {
		return this.permission;
	}
	async schedule(alarm: AlarmRequest): Promise<ScheduleOutcome> {
		this.scheduled.push(alarm);
		const outcome = this.outcomes.shift() ?? {
			ok: true as const,
			platformId: String(this.pending.size + 1),
			exact: true as const
		};
		if (outcome.ok) this.pending.add(outcome.platformId);
		return outcome;
	}
	async cancel(platformId: string) {
		this.cancelled.push(platformId);
		this.pending.delete(platformId);
	}
	async getPending() {
		return new Set(this.pending);
	}
	onAction() {}
}

const scheduler = new FakeScheduler();

async function putTask(row: Record<string, unknown>) {
	await db.tasks.put({
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
		createdAt: '2026-10-01T00:00:00.000Z',
		updatedAt: '2026-10-01T00:00:00.000Z',
		deletedAt: null,
		rev: null,
		dirty: 1,
		...row
	} as unknown as Record<string, unknown>);
}

async function readTask(id: string) {
	return (await db.tasks.get(id)) as unknown as Record<string, unknown> | undefined;
}

beforeEach(async () => {
	await db.tasks.clear();
	await db.lists.clear();
	scheduler.pending = new Set();
	scheduler.outcomes = [];
	scheduler.scheduled = [];
	scheduler.cancelled = [];
	scheduler.permission = { notifications: 'granted', exact: 'granted' };
});

describe('reconcile — drift', () => {
	it('arms a task the store believes is scheduled but the platform has lost', async () => {
		scheduler.outcomes = [{ ok: true, platformId: '42', exact: true }];
		await putTask({ alarmAt: FUTURE });

		const report = await reconcile({ scheduler, now: NOW });

		expect(scheduler.scheduled).toHaveLength(1);
		expect(scheduler.scheduled[0].taskId).toBe('t1');
		expect((await readTask('t1'))?.alarmId).toBe('42');
		expect(report.armed).toEqual(['t1']);
	});
});

describe('reconcile — missed alarms', () => {
	it('reports a past alarm as MISSED when it is still pending — never as a success', async () => {
		scheduler.pending.add('42');
		await putTask({ alarmAt: PAST, alarmId: '42' });

		const report = await reconcile({ scheduler, now: NOW });

		expect(report.missed.map((m) => m.taskId)).toEqual(['t1']);
		expect(report.armed).toEqual([]);
		expect(report.degraded).toEqual([]);
	});

	it('stamps alarmFiredAt with the alarm instant when a past alarm is gone from the platform', async () => {
		await putTask({ alarmAt: PAST, alarmId: '42' });

		const report = await reconcile({ scheduler, now: NOW });

		expect((await readTask('t1'))?.alarmFiredAt).toBe(PAST);
		expect(report.missed.map((m) => m.taskId)).toEqual(['t1']);
	});

	it('does not re-arm a missed alarm into the past', async () => {
		await putTask({ alarmAt: PAST, alarmId: '42' });

		await reconcile({ scheduler, now: NOW });

		expect(scheduler.scheduled).toHaveLength(0);
	});
});

describe('reconcile — things it must leave alone', () => {
	it('cancels the alarm of a completed task and never re-arms it', async () => {
		scheduler.pending.add('42');
		await putTask({ alarmAt: FUTURE, alarmId: '42', completedAt: '2026-10-03T11:30:00.000Z' });

		await reconcile({ scheduler, now: NOW });

		expect(scheduler.cancelled).toEqual(['42']);
		expect(scheduler.scheduled).toHaveLength(0);
	});

	it('leaves a task with no alarm untouched', async () => {
		await putTask({ alarmAt: null });

		const report = await reconcile({ scheduler, now: NOW });

		expect(scheduler.scheduled).toHaveLength(0);
		expect(scheduler.cancelled).toHaveLength(0);
		expect(report.armed).toEqual([]);
		expect(report.missed).toEqual([]);
	});

	it('leaves a soft-deleted task alone', async () => {
		await putTask({ alarmAt: FUTURE, deletedAt: '2026-10-03T11:00:00.000Z' });

		await reconcile({ scheduler, now: NOW });

		expect(scheduler.scheduled).toHaveLength(0);
	});
});

describe('reconcile — degraded outcomes', () => {
	it('records an inexact schedule as degraded, NOT as armed', async () => {
		scheduler.outcomes = [
			{ ok: true, platformId: '42', exact: false, warning: 'Exact alarms not permitted' }
		];
		await putTask({ alarmAt: FUTURE });

		const report = await reconcile({ scheduler, now: NOW });

		expect(report.degraded).toHaveLength(1);
		expect(report.degraded[0].taskId).toBe('t1');
		expect(report.degraded[0].warning).toMatch(/exact/i);
		// It is still armed — the notification WILL fire, just not exactly — but
		// it must not be reported the same way as an exact one.
		expect(report.armed).toEqual(['t1']);
	});

	it('surfaces a permission failure without pretending the alarm exists', async () => {
		scheduler.outcomes = [{ ok: false, reason: 'permission' }];
		await putTask({ alarmAt: FUTURE });

		const report = await reconcile({ scheduler, now: NOW });

		expect(report.failed).toEqual([{ taskId: 't1', reason: 'permission' }]);
		expect(report.armed).toEqual([]);
		expect((await readTask('t1'))?.alarmId).toBeNull();
	});

	it('refuses to arm an alarm whose instant is already past', async () => {
		await putTask({ alarmAt: FUTURE });

		await reconcile({ scheduler, now: new Date('2026-10-04T00:00:00.000Z') });

		expect(scheduler.scheduled).toHaveLength(0);
	});
});

describe('reconcile — orphans', () => {
	it('cancels a pending platform alarm whose task no longer wants one', async () => {
		scheduler.pending.add('99');
		await putTask({ alarmAt: FUTURE, alarmId: '99', completedAt: '2026-10-03T11:30:00.000Z' });

		await reconcile({ scheduler, now: NOW });

		expect(scheduler.cancelled).toContain('99');
	});
});