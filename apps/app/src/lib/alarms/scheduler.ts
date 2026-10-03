/**
 * The one module the rest of the app imports to reach an alarm.
 *
 * Nothing else knows which platform it is on, and nothing else knows that
 * Android exists. That is the entire point: M6 can replace the desktop
 * implementation, or a future Capacitor upgrade can change a schedule option,
 * and the blast radius is this file.
 */
import { detectPlatform } from '$lib/platform';
import { AndroidScheduler } from './android-scheduler';
import { BrowserScheduler } from './browser-scheduler';
import { DesktopScheduler } from './desktop-scheduler';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from './types';

export type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome, Platform } from './types';
export { REMINDER_CHANNEL_ID } from './android-scheduler';
export { BROWSER_LIMITATION } from './browser-scheduler';
export { DesktopScheduler, probeDesktop, resetDesktopProbe } from './desktop-scheduler';
export type { DesktopMode, DesktopProbe } from './systemd';

let instance: AlarmScheduler | null = null;

/**
 * One scheduler for the app's lifetime.
 *
 * Cached rather than constructed per call: `AndroidScheduler` registers plugin
 * listeners, and a fresh instance per reconcile would accumulate them until the
 * platform started dropping notifications. The platform cannot change while the
 * app is running, so there is nothing to invalidate.
 *
 * The desktop shell gets `DesktopScheduler`, which probes at its own first call
 * and then picks between systemd and the in-process timer. Construction here is
 * deliberately lazy for that reason — no `systemctl` subprocess at import time.
 */
export function getScheduler(): AlarmScheduler {
	instance ??=
		detectPlatform() === 'android'
			? new AndroidScheduler()
			: detectPlatform() === 'desktop'
				? new DesktopScheduler()
				: new BrowserScheduler();
	return instance;
}

/** Test seam: swap the implementation. Production never calls this. */
export function setScheduler(next: AlarmScheduler | null): void {
	instance = next;
}

export { AndroidScheduler, BrowserScheduler };

/** A shorthand for the common "arm this and tell me honestly what happened" call. */
export async function armAlarm(scheduler: AlarmScheduler, alarm: AlarmRequest): Promise<ScheduleOutcome> {
	const ready = await scheduler.ensureReady();
	if (ready.notifications === 'denied') return { ok: false, reason: 'permission' };
	return scheduler.schedule(alarm);
}

export type { AlarmPermissionStatus as Status };