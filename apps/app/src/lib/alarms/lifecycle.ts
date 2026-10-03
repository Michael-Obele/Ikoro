/**
 * The app's alarm lifecycle, in one place.
 *
 * Three things have to happen, and none of them can be done once at startup:
 *
 *  1. On start, re-arm everything the store believes should be armed.
 *  2. On every resume, re-read permissions AND re-arm. This is not optional:
 *     revoking "alarms & reminders" in Android system settings DELETES every
 *     armed exact alarm, silently. Without this, the user revokes once and their
 *     reminders quietly stop existing with no error anywhere.
 *  3. Route notification taps back to the task they belong to.
 *
 * Everything here is idempotent. `reconcile()` diffs the store against the
 * platform rather than blind-writing, so running it twice costs nothing — which
 * is what makes "on every resume" safe.
 */
import { App as CapApp } from '@capacitor/app';
import * as repo from '$lib/db/repo';
import { getScheduler, AndroidScheduler } from '$lib/alarms/scheduler';
import { reconcile, type ReconcileReport } from './reconcile';
import type { AlarmPermissionStatus } from './types';

/** Svelte-rune-free holders so a `.ts` module can publish state to components. */
type Listener<T> = (value: T) => void;

let status: AlarmPermissionStatus | null = null;
let report: ReconcileReport | null = null;
let missedCount = 0;
let running = false;

const statusListeners = new Set<Listener<AlarmPermissionStatus | null>>();
const reportListeners = new Set<Listener<ReconcileReport | null>>();

export function currentStatus(): AlarmPermissionStatus | null {
	return status;
}

export function currentReport(): ReconcileReport | null {
	return report;
}

export function onStatus(listener: Listener<AlarmPermissionStatus | null>): () => void {
	statusListeners.add(listener);
	listener(status);
	return () => statusListeners.delete(listener);
}

export function onReport(listener: Listener<ReconcileReport | null>): () => void {
	reportListeners.add(listener);
	listener(report);
	return () => reportListeners.delete(listener);
}

function publishStatus(next: AlarmPermissionStatus | null) {
	status = next;
	for (const listener of statusListeners) listener(next);
}

function publishReport(next: ReconcileReport | null) {
	report = next;
	missedCount = next?.missed.length ?? 0;
	for (const listener of reportListeners) listener(next);
}

/**
 * Re-read permissions and re-arm everything.
 *
 * Guarded by `running` because `appStateChange` can fire twice in quick
 * succession (a rotation, a notification shade pull) and two concurrent
 * reconciles would each schedule the same alarm — which is how you end up with
 * two notifications for one reminder.
 */
export async function syncAlarms(): Promise<ReconcileReport | null> {
	if (running) return report;
	running = true;
	try {
		const scheduler = getScheduler();
		publishStatus(await scheduler.ensureReady());
		const next = await reconcile({ scheduler });
		publishReport(next);
		return next;
	} catch (error) {
		// A failed sync must not take the app down with it: the data is still
		// there, the store is still the truth, and the next resume will retry.
		console.error('[ikoro] alarm sync failed', error);
		return report;
	} finally {
		running = false;
	}
}

/** Stamp a delivered alarm, so a later reconcile does not report it as missed. */
export async function markDelivered(taskId: string, firedAt: string): Promise<void> {
	await repo.updateTask(taskId, { alarmFiredAt: firedAt });
}

/** Take the user to the screen that can grant exact alarms. */
export async function openExactAlarmSettings(): Promise<void> {
	const scheduler = getScheduler();
	if (scheduler instanceof AndroidScheduler) {
		await scheduler.openExactAlarmSettings();
		return;
	}
	const browser = scheduler as { requestPermission?: () => Promise<void> };
	await browser.requestPermission?.();
}

/** Ask for notification permission in the browser shell. */
export async function requestNotificationPermission(): Promise<void> {
	const scheduler = getScheduler();
	const browser = scheduler as { requestPermission?: () => Promise<void> };
	await browser.requestPermission?.();
	publishStatus(await scheduler.ensureReady());
}

let wired = false;

/**
 * Wire the native lifecycle. Called once from the layout; safe to call again.
 *
 * `appStateChange` → `active` is the resume hook. It fires when the user comes
 * back from Settings, which is exactly when a revoked permission has to be
 * noticed.
 */
export async function wireAlarmLifecycle(): Promise<() => void> {
	if (wired) return () => {};
	wired = true;

	await syncAlarms();

	const scheduler = getScheduler();
	scheduler.onAction((taskId) => {
		void repo.updateTask(taskId, { alarmFiredAt: new Date().toISOString() });
		void syncAlarms();
	});

	const withDelivery = scheduler as { onDelivery?: (h: (id: string, at: string) => void) => void };
	withDelivery.onDelivery?.((taskId, firedAt) => void markDelivered(taskId, firedAt));

	const handle = await CapApp.addListener('appStateChange', ({ isActive }) => {
		if (isActive) void syncAlarms();
	});

	return () => {
		wired = false;
		void handle.remove();
	};
}

export function currentMissedCount(): number {
	return missedCount;
}
