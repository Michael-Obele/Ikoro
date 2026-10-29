/**
 * Android alarms, via the native `IkoroAlarm` plugin.
 *
 * WHY THE TRANSPORT CHANGED: `@capacitor/local-notifications` can only POST a
 * notification — one channel sound, no looping, no full-screen takeover. That is
 * a reminder, not an alarm, and it is why the promise this product exists for
 * ("you set a time, and it fires at that time") was only ever as strong as the
 * user's next glance at the shade. `IkoroAlarm` arms a real `setAlarmClock()`
 * alarm with its own ringing screen, so the promise survives the screen being
 * off. The `AlarmScheduler` seam is UNCHANGED: everything above this file still
 * asks the same five questions and gets the same five answers.
 *
 * What this file owns is TRANSLATION: the native contract reports a rejection as
 * a plain message, and the seam reports an outcome. So the two things that
 * matter are (1) which rejection is a fixable permission problem and which is a
 * genuine failure, and (2) never reporting a failure as a success.
 *
 * There is deliberately NO degraded branch here. The native plugin refuses to
 * arm an inexact alarm instead of quietly demoting one, so it has no "it will
 * fire, just late" channel to report — a resolved `schedule()` IS the exact
 * alarm the product promises.
 *
 * TODO: `@capacitor/local-notifications` is no longer used by the shipping alarm
 * path — this file was its last consumer. It cannot be removed from
 * `package.json` yet: deletion needs a `cap sync` to regenerate
 * `capacitor.build.gradle` / `capacitor.settings.gradle`, which has not been
 * authorised, AND `src/routes/spike/+page.svelte` (the M4-S1 device-gate
 * instrument, which must not be deleted) still imports it directly for the
 * manual exact-alarm check. Remove the dependency once both are done.
 */
import { IkoroAlarm } from './plugin';
import { hashId } from '$lib/utils/id';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from './types';

/**
 * The literal phrase the native plugin puts in a permission rejection.
 *
 * Case-insensitive because the Kotlin message is prose that may legitimately be
 * reworded — the PHRASE is the contract, the surrounding sentence is not. The
 * plugin emits it both when the permission is missing up front and when arming
 * is refused at the last moment, so one pattern covers both.
 */
const EXACT_ALARM_PERMISSION = /exact alarm permission/i;

export class AndroidScheduler implements AlarmScheduler {
	readonly platform = 'android' as const;

	/**
	 * Read the real state, and prompt for notifications if the user has not been
	 * asked yet.
	 *
	 * Never opens the exact-alarm settings screen on its own: on Android 12+ that
	 * screen is a system settings page, and throwing somebody into Settings
	 * because they opened a task feels like a trap. `openExactAlarmSettings()` is
	 * exposed for the banner, where the user has just tapped "fix this".
	 */
	async ensureReady(): Promise<AlarmPermissionStatus> {
		const status = await IkoroAlarm.checkStatus();

		let notifications = status.notifications;
		if (notifications === 'prompt') {
			// Asking here is honest: POST_NOTIFICATIONS is a normal runtime
			// permission, this runs the first time an alarm is actually armed
			// rather than on launch, and the native side resolves with the state it
			// can actually read instead of hanging if the dialog is gone for good.
			notifications = (await IkoroAlarm.requestNotifications()).notifications;
		}

		return {
			notifications,
			// `checkStatus().exact` is already a BOOLEAN, not a permission string:
			// the native side answers `true` below API 31, where no such permission
			// exists because those alarms are exact by default. So anything that is
			// not `true` means the alarm will not be exact, and the banner only
			// distinguishes granted from not-granted. Collapsing both to 'denied' is
			// honest without inventing a state the OS cannot report; `unsupported`
			// stays reserved for platforms that genuinely cannot schedule (the
			// browser).
			exact: status.exact ? 'granted' : 'denied',
			// Same shape, same reasoning: the native side answers a BOOLEAN, and
			// `false` here is not 'unsupported' -- on Android 14 the permission
			// genuinely exists and the user can turn it back on from Settings,
			// which is exactly what 'denied' tells the banner to offer.
			fullScreenIntent: status.fullScreenIntent ? 'granted' : 'denied'
		};
	}

	/** Take the user to the system screen that can grant exact alarms. */
	async openExactAlarmSettings(): Promise<void> {
		await IkoroAlarm.openExactAlarmSettings();
	}

	/**
	 * Take the user to the Android 14+ screen that allows full-screen intents.
	 *
	 * Mirrors `openExactAlarmSettings()`: a hand-off to system Settings rather
	 * than a request, because this permission is granted by the user there and
	 * cannot be asked for with a dialog. It is deliberately NOT on the
	 * `AlarmScheduler` interface, for the same reason the exact-alarm method is
	 * not: only Android has the screen, so the interface stays free of a
	 * capability two of its three implementations cannot have.
	 *
	 * Only reachable from the UI when `ensureReady()` answered
	 * `fullScreenIntent: 'denied'`, which the desktop and browser schedulers
	 * never answer -- so this can never route a non-Android user to an Android
	 * settings page.
	 */
	async openFullScreenIntentSettings(): Promise<void> {
		await IkoroAlarm.requestFullScreenIntentPermission();
	}

	async schedule(alarm: AlarmRequest): Promise<ScheduleOutcome> {
		// Checked here as well as natively: the plugin rejects a past or
		// unparseable instant too, but `invalid` is a distinct, actionable answer
		// the UI shows as "pick a time in the future", and a round trip to Android
		// to be told what we already know is a wasted IPC.
		const at = new Date(alarm.at);
		if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
			return { ok: false, reason: 'invalid' };
		}

		// DERIVED, not allocated: re-arming the same task must land on the same
		// native id, or every reschedule leaves a duplicate alarm behind — which is
		// the "reminder fires twice" failure this product cannot have.
		const platformId = hashId(alarm.taskId);

		try {
			await IkoroAlarm.schedule({
				id: platformId,
				taskId: alarm.taskId,
				title: alarm.title,
				at: alarm.at,
				ringtone: alarm.ringtone ?? null
			});
			return { ok: true, platformId: String(platformId), exact: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (EXACT_ALARM_PERMISSION.test(message)) {
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
			await IkoroAlarm.cancel({ platformId });
		} catch (error) {
			// Cancelling something the platform already dropped is not an error
			// worth surfacing — reconcile treats absence as "not armed" anyway.
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

	/**
	 * Fired when the user DISMISSES a ringing alarm.
	 *
	 * The old implementation fired on a notification TAP, which is the same user
	 * action: the alarm is over and the task they were reminded of is the one to
	 * open. `alarmDismissed` is the native event for that, and it carries the
	 * taskId so the store can be updated without knowing about notification ids.
	 */
	onAction(handler: (taskId: string) => void): void {
		void IkoroAlarm.addListener('alarmDismissed', ({ taskId }) => {
			if (taskId) handler(taskId);
		});
	}

	/**
	 * Fired when the alarm STARTS RINGING — the native equivalent of the old
	 * plugin's "notification delivered".
	 *
	 * Kept even though `AlarmScheduler` does not require it, because the lifecycle
	 * uses it (optionally, via `onDelivery?.`) to stamp `alarmFiredAt`. It only
	 * reaches us while the app is alive — a killed app is woken by the ringing
	 * screen, not by this event — which is exactly why `reconcile()` exists: on the
	 * next resume, anything whose instant passed with no event is a genuine miss.
	 *
	 * `alarmSnoozed` is deliberately NOT wired: snooze re-arms the same native id
	 * inside Kotlin, so there is nothing for JS to schedule. Listening would be a
	 * no-op handler pretending to work.
	 */
	onDelivery(handler: (taskId: string, firedAt: string) => void): void {
		void IkoroAlarm.addListener('alarmRinging', ({ taskId }) => {
			if (taskId) handler(taskId, new Date().toISOString());
		});
	}
}
