/**
 * Browser alarms — a DEVELOPMENT PREVIEW ONLY.
 *
 * A web page cannot fire a notification while it is closed. There is no API for
 * it, and there will not be: that is the browser's sandbox working as designed.
 * So this implementation schedules an in-page timer and says, truthfully and
 * every single time, that the reminder needs the app open.
 *
 * The honesty is the feature. Returning `{ ok: true, exact: true }` here would
 * make the demo look like the product; returning `exact: false` with a warning
 * means the browser preview shows the exact banner the real degraded state
 * produces, and a user who tries the web build is told the truth instead of
 * discovering at 9am that their reminder never arrived.
 */
import { hashId } from '$lib/utils/id';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from './types';

export const BROWSER_LIMITATION =
	'Reminders need Ikoro open in the browser — install the Android or desktop app for alarms that fire when closed.';

/**
 * `setTimeout` is capped at a signed 32-bit int, which overflows past ~24.8
 * days and fires IMMEDIATELY. Anything further out is armed in stages instead,
 * so a reminder set for next month does not ring the instant it is created.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;
const STAGE_MS = MAX_TIMEOUT_MS - 60_000;

export class BrowserScheduler implements AlarmScheduler {
	/**
	 * `browser`, deliberately — including when this backs the desktop shell.
	 *
	 * Tauri v2's official notification plugin cannot schedule on desktop: the
	 * docs say so outright, `pending()` is mobile-only, and there is no cancel
	 * API. So the desktop shell gets the in-page timer and this exact warning,
	 * and says plainly that Ikoro must be running. Shipping that honestly beats
	 * shipping a `desktop` label on a timer that only works while a window is
	 * open. OS-native desktop scheduling is M12.
	 */
	readonly platform = 'browser' as const;

	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	#handlers: ((taskId: string) => void)[] = [];

	async ensureReady(): Promise<AlarmPermissionStatus> {
		if (typeof Notification === 'undefined') {
			return { notifications: 'denied', exact: 'unsupported' };
		}
		const permission = Notification.permission;
		return {
			notifications:
				permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'prompt',
			// No browser can promise an exact minute, so this is never 'granted'.
			exact: 'unsupported'
		};
	}

	async schedule(alarm: AlarmRequest): Promise<ScheduleOutcome> {
		const platformId = String(hashId(alarm.taskId));
		await this.arm(platformId, alarm);
		return { ok: true, platformId, exact: false, warning: BROWSER_LIMITATION };
	}

	private async arm(platformId: string, alarm: AlarmRequest) {
		this.cancelTimer(platformId);
		const delay = new Date(alarm.at).getTime() - Date.now();
		if (delay <= 0) return;

		const timer = setTimeout(
			() => {
				this.#timers.delete(platformId);
				if (Notification.permission === 'granted') {
					new Notification('Ikoro', { body: alarm.title, tag: platformId });
				}
				for (const handler of this.#handlers) handler(alarm.taskId);
			},
			Math.min(delay, STAGE_MS)
		);

		this.#timers.set(platformId, timer);
	}

	async cancel(platformId: string): Promise<void> {
		this.cancelTimer(platformId);
	}

	private cancelTimer(platformId: string) {
		const existing = this.#timers.get(platformId);
		if (existing !== undefined) {
			clearTimeout(existing);
			this.#timers.delete(platformId);
		}
	}

	async getPending(): Promise<Set<string>> {
		return new Set(this.#timers.keys());
	}

	onAction(handler: (taskId: string) => void): void {
		this.#handlers.push(handler);
	}

	/** Browser-only: ask for notification permission. */
	async requestPermission(): Promise<void> {
		if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
			await Notification.requestPermission();
		}
	}
}
