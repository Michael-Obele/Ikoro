/** Reconciles platform alarms against the store and reports what was missed. Android silently drops armed alarms on revoke, so both sides are diffed. */
import { db, type Task } from '$lib/db/schema';
import * as repo from '$lib/db/repo';
import { ringtoneFor } from './ringtone';
import type { AlarmScheduler } from './types';

/** A day, not a minute: a user back after a night off wants one "you missed this", not a wall of them. */
export const MISSED_REPORT_WINDOW_MS = 86_400_000;

/** A missed alarm, as the UI needs to describe it. */
export interface MissedAlarm {
	taskId: string;
	title: string;
	/** The instant the alarm was MEANT to fire — not when we noticed. */
	dueAt: string;
}

/** A schedule that succeeded but cannot honour its instant. */
export interface DegradedAlarm {
	taskId: string;
	title: string;
	warning: string;
}

export interface ReconcileReport {
	/** Alarms now armed exactly. */
	armed: string[];
	/** Alarms armed but inexact — these will fire, possibly late. */
	degraded: DegradedAlarm[];
	/** Schedules that failed outright. */
	failed: { taskId: string; reason: string }[];
	/** Alarms whose time passed without the app seeing them. */
	missed: MissedAlarm[];
	/** Platform alarms cancelled because the store no longer wants them. */
	cancelled: string[];
}

export interface ReconcileOptions {
	scheduler: AlarmScheduler;
	now?: Date;
}

const asTask = (row: Record<string, unknown>) => row as unknown as Task;

/** Bare hash from `systemd:1663646904`; null for anything else, so no other platform reads as a stamp. */
function platformHash(platformId: string | null): string | null {
	if (!platformId) return null;
	const bare = platformId.replace(/^systemd:/, '');
	return /^\d+$/.test(bare) ? bare : null;
}

/** A task that WANTS an alarm: has one, is open, and is not deleted. */
function wantsAlarm(task: Task): boolean {
	return task.alarmAt !== null && task.completedAt === null && task.deletedAt === null;
}

/** The `byAlarm` index, not `getAll()`: O(alarmed) instead of O(every task ever written). */
async function loadAlarmableTasks(): Promise<Task[]> {
	const rows = await db.tasks.where('byAlarm').toArray();
	return rows.map(asTask);
}

/** Bring the platform in line with the store. Armed, degraded and failed stay distinct; `missed` is never folded into `armed`. */
export async function reconcile({
	scheduler,
	now = new Date()
}: ReconcileOptions): Promise<ReconcileReport> {
	const tasks = await loadAlarmableTasks();
	const pending = await scheduler.getPending();

	// Only an out-of-process scheduler can answer; empty elsewhere, and nothing below changes.
	const delivered = (await scheduler.firedStamps?.()) ?? new Set<string>();

	// Ids the store claims, so a pending id nobody claims is an orphan worth cancelling.
	const claimed = new Set<string>();

	const report: ReconcileReport = {
		armed: [],
		degraded: [],
		failed: [],
		missed: [],
		cancelled: []
	};

	for (const task of tasks) {
		if (task.alarmId) claimed.add(task.alarmId);
		const alarmAt = task.alarmAt;

		// Completed or deleted: the alarm must go, and must not come back.
		if (!wantsAlarm(task)) {
			if (task.alarmId && pending.has(task.alarmId)) {
				await scheduler.cancel(task.alarmId);
				report.cancelled.push(task.alarmId);
			}
			if (task.alarmId) await clearAlarmId(task.id);
			continue;
		}

		const dueAt = new Date(alarmAt as string);

		// Past due: still pending means a genuine miss; already gone means it fired while we slept.
		if (dueAt.getTime() <= now.getTime()) {
			// Read the stamp FIRST. Cancelling below deletes it, which would turn a delivered alarm into a miss.
			const stampHash = platformHash(task.alarmId);
			const wasDelivered = stampHash !== null && delivered.has(stampHash);

			const stillPending = task.alarmId !== null && pending.has(task.alarmId);
			if (stillPending) {
				await scheduler.cancel(task.alarmId as string);
				report.cancelled.push(task.alarmId as string);
			}

			// A stamp is the OS saying "I rang before I stopped" -- a delivery, not a miss.
			if (wasDelivered) {
				await markFired(task.id, task.alarmFiredAt ?? (alarmAt as string));
				continue;
			}

			await markFired(task.id, task.alarmFiredAt ?? (alarmAt as string));
			if (now.getTime() - dueAt.getTime() <= MISSED_REPORT_WINDOW_MS) {
				report.missed.push({ taskId: task.id, title: task.title, dueAt: alarmAt as string });
			}
			continue;
		}

		// Still in the future and the platform already has it — nothing to do.
		if (task.alarmId && pending.has(task.alarmId)) continue;

		const outcome = await scheduler.schedule({
			taskId: task.id,
			title: task.title,
			at: alarmAt as string,
			ringtone: ringtoneFor(task),
			// Read at arm time -- the last moment the row is known to be current.
			description: task.notes ?? null
		});

		if (!outcome.ok) {
			report.failed.push({ taskId: task.id, reason: outcome.reason });
			await clearAlarmId(task.id);
			continue;
		}

		await setAlarmId(task.id, outcome.platformId);
		if (outcome.exact) {
			report.armed.push(task.id);
		} else {
			// Armed but inexact: reported apart from clean arms so the banner can warn.
			report.degraded.push({ taskId: task.id, title: task.title, warning: outcome.warning });
			report.armed.push(task.id);
		}
	}

	// Cleared so the same stamp cannot later be read as evidence for another alarm on this task.
	if (delivered.size > 0) await scheduler.clearStamps?.();

	// Anything armed on the platform that no live task claims.
	for (const platformId of pending) {
		if (claimed.has(platformId)) continue;
		await scheduler.cancel(platformId);
		report.cancelled.push(platformId);
	}

	return report;
}

/** Via `repo.updateTask`, not a raw get->put: that queue stops reconcile racing the sheet and wiping `alarmAt`. */
async function setAlarmId(taskId: string, platformId: string): Promise<void> {
	await repo.updateTask(taskId, { alarmId: platformId });
}

async function clearAlarmId(taskId: string): Promise<void> {
	await repo.updateTask(taskId, { alarmId: null });
}

/** Stamps the DUE instant, not when we noticed. Clearing `alarmAt` retires the alarm -- leaving it set re-reported it every resume. */
async function markFired(taskId: string, at: string): Promise<void> {
	await repo.updateTask(taskId, { alarmFiredAt: at, alarmAt: null, alarmId: null });
}

/** How many alarms the store currently believes are armed — for the health panel. */
export async function armedCount(): Promise<number> {
	const tasks = await loadAlarmableTasks();
	return tasks.filter(
		(t) =>
			wantsAlarm(t) && t.alarmId !== null && new Date(t.alarmAt as string).getTime() > Date.now()
	).length;
}

/** Everything the user should be told about right now. */
export async function pendingAlarms(): Promise<Task[]> {
	const tasks = await loadAlarmableTasks();
	return tasks
		.filter(
			(t) => wantsAlarm(t) && t.alarmAt !== null && new Date(t.alarmAt).getTime() > Date.now()
		)
		.sort((a, b) => (a.alarmAt ?? '').localeCompare(b.alarmAt ?? ''));
}
