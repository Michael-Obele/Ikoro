/** Browser alarms -- a DEVELOPMENT PREVIEW ONLY. A closed page cannot fire a notification, so every schedule answers `exact: false`. */
import { hashId } from '$lib/utils/id';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from './types';

export const BROWSER_LIMITATION =
	'Reminders need Ikoro open in the browser — install the Android or desktop app for alarms that fire when closed.';

/** `setTimeout` overflows past 2^31-1 ms and fires IMMEDIATELY, so far-off alarms are armed in stages. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const STAGE_MS = MAX_TIMEOUT_MS - 60_000;

export class BrowserScheduler implements AlarmScheduler {
	/** `browser`, deliberately: Tauri's notification plugin cannot schedule on desktop, so an honest label beats a lying one. */
	readonly platform = 'browser' as const;

	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	#handlers: ((taskId: string) => void)[] = [];

	async ensureReady(): Promise<AlarmPermissionStatus> {
		if (typeof Notification === 'undefined') {
			return {
				notifications: 'denied',
				exact: 'unsupported',
				// A page cannot take over the screen, so this is not a revocation the user could undo.
				fullScreenIntent: 'unsupported'
			};
		}
		const permission = Notification.permission;
		return {
			notifications:
				permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'prompt',
			// No browser can promise an exact minute, so this is never 'granted'.
			exact: 'unsupported',
			// And never 'denied': there is no equivalent to grant or revoke, so nothing for the user to fix.
			fullScreenIntent: 'unsupported'
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
