/**
 * Reconciliation: make the platform's alarms match what the store says should be
 * armed, and notice when one was missed.
 *
 * This is the function that runs on every resume, and it exists because the
 * platform is not trustworthy over the lifetime of an alarm. On Android:
 *
 *   - revoking "alarms & reminders" in system settings DELETES every armed
 *     exact alarm, silently;
 *   - an inexact fallback deletes itself after firing;
 *   - the app being force-stopped can drop pending work.
 *
 * So the store is the source of truth and `getPending()` is only evidence about
 * it. Everything is derived by diffing the two — never by trusting either alone.
 */
import { db, type Task } from '$lib/db/schema';
import type { AlarmScheduler } from './types';

/**
 * How far into the past a still-open alarm counts as "missed" and worth
 * reporting.
 *
 * One day, not one minute: reconcile runs on every resume, and a user who has
 * had their phone off overnight should see one clear "you missed this", not a
 * wall of them. Anything older than this is dropped from the report entirely
 * rather than shown — a reminder from last March is history, not news.
 */
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

/** A task that WANTS an alarm: has one, is open, and is not deleted. */
function wantsAlarm(task: Task): boolean {
	return task.alarmAt !== null && task.completedAt === null && task.deletedAt === null;
}

/**
 * `where('byAlarm')` rather than `getAll()`: the index holds only rows that
 * actually carry an alarm, so this is O(alarmed) instead of O(every task) — the
 * difference between a resume that is instant and one that scans a decade of
 * history.
 */
async function loadAlarmableTasks(): Promise<Task[]> {
	const rows = await db.tasks.where('byAlarm').toArray();
	return rows.map(asTask);
}

/**
 * Bring the platform in line with the store, and report what it cost.
 *
 * Three outcomes per task, and they are deliberately not collapsed: armed,
 * degraded (armed but inexact), and failed are different promises to the user
 * and the UI must render them differently. The same goes for `missed`, which is
 * never folded into `armed` — an alarm that did not fire is not a success, and
 * the report is the only place that distinction exists.
 */
export async function reconcile({
	scheduler,
	now = new Date()
}: ReconcileOptions): Promise<ReconcileReport> {
	const tasks = await loadAlarmableTasks();
	const pending = await scheduler.getPending();

	// Every platform id the store believes is armed, so an id that appears in
	// `pending` but in nobody's `alarmId` is an orphan worth cancelling.
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

		// The instant has passed. Either the platform already has it — in which
		// case it is a genuine miss, because the time came and went — or it has
		// gone, in which case it fired and we simply were not awake to hear it.
		if (dueAt.getTime() <= now.getTime()) {
			const stillPending = task.alarmId !== null && pending.has(task.alarmId);
			if (stillPending) {
				await scheduler.cancel(task.alarmId as string);
				report.cancelled.push(task.alarmId as string);
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
			at: alarmAt as string
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
			// Armed, but not exact. Reported separately so the banner can say
			// "reminders may be late" instead of pretending everything is fine.
			report.degraded.push({ taskId: task.id, title: task.title, warning: outcome.warning });
			report.armed.push(task.id);
		}
	}

	// Anything armed on the platform that no live task claims.
	for (const platformId of pending) {
		if (claimed.has(platformId)) continue;
		await scheduler.cancel(platformId);
		report.cancelled.push(platformId);
	}

	return report;
}

/** Persist the platform id. A single-record write — there is no transaction to widen. */
async function setAlarmId(taskId: string, platformId: string): Promise<void> {
	const row = await db.tasks.get(taskId);
	if (!row) return;
	await db.tasks.put({
		...(asTask(row) as unknown as Record<string, unknown>),
		alarmId: platformId,
		updatedAt: new Date().toISOString(),
		dirty: 1
	});
}

async function clearAlarmId(taskId: string): Promise<void> {
	const row = await db.tasks.get(taskId);
	if (!row) return;
	await db.tasks.put({
		...(asTask(row) as unknown as Record<string, unknown>),
		alarmId: null,
		updatedAt: new Date().toISOString(),
		dirty: 1
	});
}

/**
 * Stamp `alarmFiredAt` with the instant the alarm was DUE, not the moment we
 * noticed. The difference matters when the phone was off for eight hours: the
 * user needs to know when it was supposed to ring, not when the app woke up.
 */
async function markFired(taskId: string, at: string): Promise<void> {
	const row = await db.tasks.get(taskId);
	if (!row) return;
	await db.tasks.put({
		...(asTask(row) as unknown as Record<string, unknown>),
		alarmFiredAt: at,
		alarmId: null,
		updatedAt: new Date().toISOString(),
		dirty: 1
	});
}

/** How many alarms the store currently believes are armed — for the health panel. */
export async function armedCount(): Promise<number> {
	const tasks = await loadAlarmableTasks();
	return tasks.filter((t) => wantsAlarm(t) && t.alarmId !== null && new Date(t.alarmAt as string).getTime() > Date.now()).length;
}

/** Everything the user should be told about right now. */
export async function pendingAlarms(): Promise<Task[]> {
	const tasks = await loadAlarmableTasks();
	return tasks
		.filter((t) => wantsAlarm(t) && t.alarmAt !== null && new Date(t.alarmAt).getTime() > Date.now())
		.sort((a, b) => (a.alarmAt ?? '').localeCompare(b.alarmAt ?? ''));
}