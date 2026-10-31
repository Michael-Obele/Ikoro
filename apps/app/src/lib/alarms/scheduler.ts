/** The only module the rest of the app imports to reach an alarm; swapping an implementation has this file as its blast radius. */
import { detectPlatform } from '$lib/platform';
import { AndroidScheduler } from './android-scheduler';
import { BrowserScheduler } from './browser-scheduler';
import { DesktopScheduler } from './desktop-scheduler';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from './types';

export type {
	AlarmPermissionStatus,
	AlarmRequest,
	AlarmScheduler,
	ScheduleOutcome,
	Platform
} from './types';
export { BROWSER_LIMITATION } from './browser-scheduler';
export { DesktopScheduler, probeDesktop, resetDesktopProbe } from './desktop-scheduler';
export type { DesktopMode, DesktopProbe } from './systemd';

let instance: AlarmScheduler | null = null;

/** Cached, not per call: `AndroidScheduler` registers plugin listeners that would accumulate. Lazy so no `systemctl` runs at import. */
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
export async function armAlarm(
	scheduler: AlarmScheduler,
	alarm: AlarmRequest
): Promise<ScheduleOutcome> {
	const ready = await scheduler.ensureReady();
	if (ready.notifications === 'denied') return { ok: false, reason: 'permission' };
	return scheduler.schedule(alarm);
}

export type { AlarmPermissionStatus as Status };
