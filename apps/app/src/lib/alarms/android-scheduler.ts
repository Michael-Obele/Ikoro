/**
 * Android alarms, via the native `IkoroAlarm` plugin. No degraded branch: the plugin refuses
 * an inexact alarm rather than demoting one silently.
 *
 * TODO: `@capacitor/local-notifications` is unused here but cannot go yet — the M4-S1 spike
 * route still imports it, and removal needs an unauthorised `cap sync`.
 */
import { IkoroAlarm } from './plugin';
import { hashId } from '$lib/utils/id';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from './types';

/** The phrase the plugin puts in a permission rejection; case-insensitive because the Kotlin prose may change. */
const EXACT_ALARM_PERMISSION = /exact alarm permission/i;

export class AndroidScheduler implements AlarmScheduler {
	readonly platform = 'android' as const;

	/** Reads real state, prompting for notifications if never asked. Never opens Settings itself -- the banner does, after a tap. */
	async ensureReady(): Promise<AlarmPermissionStatus> {
		const status = await IkoroAlarm.checkStatus();

		let notifications = status.notifications;
		if (notifications === 'prompt') {
			// Normal runtime permission, asked when an alarm is first armed rather than on launch.
			notifications = (await IkoroAlarm.requestNotifications()).notifications;
		}

		return {
			notifications,
			// Native answers a boolean: `true` below API 31, where every alarm is exact by default.
			exact: status.exact ? 'granted' : 'denied',
			// `false` on 14+ is a real revocable permission, so 'denied' is honest, not 'unsupported'.
			fullScreenIntent: status.fullScreenIntent ? 'granted' : 'denied'
		};
	}

	/** Take the user to the system screen that can grant exact alarms. */
	async openExactAlarmSettings(): Promise<void> {
		await IkoroAlarm.openExactAlarmSettings();
	}

	/** Android 14+ screen for full-screen intents. Kept off `AlarmScheduler`: only Android has that screen. */
	async openFullScreenIntentSettings(): Promise<void> {
		await IkoroAlarm.requestFullScreenIntentPermission();
	}

	async schedule(alarm: AlarmRequest): Promise<ScheduleOutcome> {
		// Also checked natively, but `invalid` is an actionable answer the UI shows -- not worth the IPC.
		const at = new Date(alarm.at);
		if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
			return { ok: false, reason: 'invalid' };
		}

		// Derived, not allocated: a reschedule must reuse the native id or leave a duplicate alarm behind.
		const platformId = hashId(alarm.taskId);

		try {
			await IkoroAlarm.schedule({
				id: platformId,
				taskId: alarm.taskId,
				title: alarm.title,
				at: alarm.at,
				ringtone: alarm.ringtone ?? null,
				description: alarm.description ?? null
			});
			return { ok: true, platformId: String(platformId), exact: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (EXACT_ALARM_PERMISSION.test(message)) {
				return { ok: false, reason: 'permission' };
			}
			// An unexpected rejection is still a failure to arm; reporting success would lie.
			console.error('[ikoro] schedule() failed', error);
			return { ok: false, reason: 'unsupported' };
		}
	}

	async cancel(platformId: string): Promise<void> {
		try {
			await IkoroAlarm.cancel({ platformId });
		} catch (error) {
			// Absence is not worth surfacing -- reconcile treats it as "not armed" anyway.
			console.warn('[ikoro] cancel() failed', error);
		}
	}

	async getPending(): Promise<Set<string>> {
		try {
			const { pending } = await IkoroAlarm.getPending();
			return new Set(pending);
		} catch (error) {
			console.warn('[ikoro] getPending() failed', error);
			return new Set();
		}
	}

	/** Fires when the user DISMISSES a ringing alarm -- the old "notification tap". */
	onAction(handler: (taskId: string) => void): void {
		void IkoroAlarm.addListener('alarmDismissed', ({ taskId }) => {
			if (taskId) handler(taskId);
		});
	}

	/** Fires when the alarm STARTS RINGING; stamps `alarmFiredAt`. Only reaches a live app, which is why `reconcile()` exists. */
	onDelivery(handler: (taskId: string, firedAt: string) => void): void {
		void IkoroAlarm.addListener('alarmRinging', ({ taskId }) => {
			if (taskId) handler(taskId, new Date().toISOString());
		});
	}
}
