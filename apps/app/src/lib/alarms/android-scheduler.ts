/**
 * Android alarms, via `@capacitor/local-notifications`.
 *
 * THE ONLY FILE IN THE APP THAT IMPORTS THAT PLUGIN. Everything else goes
 * through `AlarmScheduler`, so a Capacitor API change — or a decision to make
 * the desktop build use a different mechanism entirely — is a one-file edit.
 *
 * The scheduling options are the point of this file, so they are spelled out:
 *
 *   allowWhileIdle        fires through Doze. Android throttles these to once per
 *                         9 minutes per app, which is the platform's price for
 *                         not being allowed to run all night.
 *   isExactNotification  asks for an exact alarm. On API 31+ with no permission,
 *                         Capacitor opens the "Alarms & reminders" screen.
 *   isExactMandatory     true — so if the user declines, `schedule()` REJECTS
 *                         instead of quietly scheduling an inexact alarm.
 *
 * That last flag is the difference between a product that keeps its promise and
 * one that does not. Without it a denied permission produces a notification that
 * arrives whenever Android feels like it, and the user has no way to tell.
 *
 * FINDING (2026-10-03): the build plan put these three options inside the nested
 * `schedule` object. In the shipped 8.3.1 typings `isExactNotification` and
 * `isExactMandatory` are properties of `LocalNotificationSchema` — the
 * notification itself, a SIBLING of `schedule`, not fields of it. Nesting them
 * where the plan showed is a type error, and dropping them to make it compile
 * would have quietly turned every reminder into an inexact one.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { hashId } from '$lib/utils/id';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from './types';

/** The Android notification channel alarms are posted on. Created in M5. */
export const REMINDER_CHANNEL_ID = 'reminders';

/** The notification title. The body is the task — that is what the user needs. */
const NOTIFICATION_TITLE = 'Ikoro';

const KNOWN_PERMISSION_ERRORS = /permission|exact alarm|SCHEDULE_EXACT|not allowed|denied/i;

/**
 * Create the `reminders` notification channel, once.
 *
 * Android channels are NOT declared in the manifest — they are created at
 * runtime, and a reminder posted to a channel that does not exist is silently
 * dropped. That makes this the difference between "the alarm fired" and "the
 * alarm did nothing and reported nothing".
 *
 * Importance is HIGH (5) so a reminder arrives as a heads-up banner while the
 * device is unlocked — a task reminder that waits silently in the shade is a
 * reminder that has already failed at its job. The user can lower it in system
 * settings; we only set the default.
 *
 * Called through the scheduler rather than from a route, so
 * `src/lib/alarms/` stays the only place that touches the plugin.
 */
export async function ensureReminderChannel(): Promise<void> {
	try {
		await LocalNotifications.createChannel({
			id: REMINDER_CHANNEL_ID,
			name: 'Reminders',
			description: 'Task reminders',
			// 5 = IMPORTANCE_HIGH. Verified against the plugin's own enum rather
			// than assumed: a wrong constant here would quietly downgrade every
			// reminder to a silent shade entry.
			importance: 5,
			sound: 'default',
			vibration: true
		});
	} catch (error) {
		console.warn('[ikoro] could not create the reminders channel', error);
	}
}

export class AndroidScheduler implements AlarmScheduler {
	readonly platform = 'android' as const;

	#channelReady = false;

	/**
	 * Create the channel before anything can try to post to it. Called from
	 * `ensureReady()`, so every path that arms an alarm has already guaranteed
	 * the channel exists.
	 */
	async ensureChannel(): Promise<void> {
		if (this.#channelReady) return;
		await ensureReminderChannel();
		this.#channelReady = true;
	}

	/**
	 * Read the real state, and prompt for notifications if the user has not been
	 * asked yet.
	 *
	 * Never opens the exact-alarm settings screen on its own: on Android 13+ that
	 * screen is a system settings page, and throwing somebody into Settings
	 * because they opened a task feels like a trap. `openExactAlarmSettings()` is
	 * exposed for the banner, where the user has just tapped "fix this".
	 */
	async ensureReady(): Promise<AlarmPermissionStatus> {
		await this.ensureChannel();

		let notifications = await LocalNotifications.checkPermissions();

		if (notifications.display === 'prompt') {
			notifications = await LocalNotifications.requestPermissions();
		}

		// Pre-Android 12 there is no exact-alarm permission to check, and the
		// plugin reports `prompt`; there, alarms are exact by default.
		const exact = await LocalNotifications.checkExactNotificationSetting();

		return {
			notifications: normalisePermission(notifications.display),
			// FINDING: `PermissionState` is 'granted' | 'denied' | 'prompt' |
			// 'prompt-with-rationale' — there is no 'unsupported'. So on Android,
			// anything that is not 'granted' means the alarm will not be exact, and
			// that includes the pre-Android-12 case where no such permission exists
			// (the plugin answers 'prompt' there, and those alarms ARE exact).
			// The banner only distinguishes granted from not-granted, so mapping
			// both to 'denied' is honest without inventing a state the OS cannot
			// report. `unsupported` stays reserved for platforms that genuinely
			// cannot schedule (the browser).
			exact: exact.exact_alarm === 'granted' ? 'granted' : 'denied'
		};
	}

	/** Take the user to the system screen that can grant exact alarms. */
	async openExactAlarmSettings(): Promise<void> {
		await LocalNotifications.changeExactNotificationSetting();
	}

	async schedule(alarm: AlarmRequest): Promise<ScheduleOutcome> {
		await this.ensureChannel();

		const at = new Date(alarm.at);
		if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
			return { ok: false, reason: 'invalid' };
		}

		const platformId = hashId(alarm.taskId);

		try {
			const result = await LocalNotifications.schedule({
				notifications: [
					{
						id: platformId,
						title: NOTIFICATION_TITLE,
						body: alarm.title,
						channelId: REMINDER_CHANNEL_ID,
						// Carried back on the action event, so tapping the
						// notification opens the right task rather than the app.
						extra: { taskId: alarm.taskId },
						// SIBLINGS of `schedule`, not fields inside it — see the
						// finding at the top of this file.
						isExactNotification: true,
						isExactMandatory: true,
						schedule: { at, allowWhileIdle: true }
					}
				]
			});

			// A top-level `warning` means the exact-alarm permission was not granted
			// and the notification was demoted to inexact — it WILL fire, but not
			// when it was asked to. Surfaced as degraded, never as success.
			if (result.warning) {
				return {
					ok: true,
					platformId: String(platformId),
					exact: false,
					warning: result.warning.message
				};
			}
			return { ok: true, platformId: String(platformId), exact: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (KNOWN_PERMISSION_ERRORS.test(message)) {
				return { ok: false, reason: 'permission' };
			}
			// An unexpected rejection is still a failure to arm; reporting it as
			// success would leave the user believing they have a reminder.
			console.error('[ikoro] schedule() failed', error);
			return { ok: false, reason: 'unsupported' };
		}
	}

	async cancel(platformId: string): Promise<void> {
		try {
			await LocalNotifications.cancel({ notifications: [{ id: Number(platformId) }] });
		} catch (error) {
			// Cancelling something the platform already dropped is not an error
			// worth surfacing — reconcile treats absence as "not armed" anyway.
			console.warn('[ikoro] cancel() failed', error);
		}
	}

	async getPending(): Promise<Set<string>> {
		try {
			const { notifications } = await LocalNotifications.getPending();
			return new Set(notifications.map((n) => String(n.id)));
		} catch (error) {
			console.warn('[ikoro] getPending() failed', error);
			return new Set();
		}
	}

	/** Fired when the user TAPS a notification. */
	onAction(handler: (taskId: string) => void): void {
		void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
			const taskId = (action.notification.extra as { taskId?: string } | undefined)?.taskId;
			if (taskId) handler(taskId);
		});
	}

	/**
	 * Fired when the notification is DELIVERED.
	 *
	 * Only reaches us when the app is alive (a killed app is woken by the tap,
	 * not the delivery), which is exactly why `reconcile()` exists: on the next
	 * resume, anything whose instant passed with no event is a genuine miss.
	 */
	onDelivery(handler: (taskId: string, firedAt: string) => void): void {
		void LocalNotifications.addListener('localNotificationReceived', (notification) => {
			const taskId = (notification.extra as { taskId?: string } | undefined)?.taskId;
			if (taskId) handler(taskId, new Date().toISOString());
		});
	}
}

function normalisePermission(display: string): 'granted' | 'denied' | 'prompt' {
	return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
}
