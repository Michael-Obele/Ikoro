/**
 * The typed bridge to the native `IkoroAlarm` plugin, and the ONLY place in the
 * web layer that names it.
 *
 * Everything else reaches an alarm through `AlarmScheduler` (`./types.ts`), so a
 * Kotlin method rename, a payload reshuffle, or a decision to build the alarm a
 * different way is a one-file edit here — which is exactly the point of the
 * seam. Keeping the wire shapes in one file also means the contract the Kotlin
 * side implements sits next to the only code that can get it wrong.
 *
 * The shapes below are transcribed from `IkoroAlarmPlugin.kt`, which is the
 * source of truth. They are deliberately not "tidied": `getPending` answers with
 * `{ pending }` rather than a bare array, and `schedule` answers with
 * `{ platformId }` rather than echoing the id it was given, because those are
 * the real wire shapes and renaming one here only moves the mismatch to runtime.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** The notification permission, as the native side reports it. */
export type IkoroNotifications = 'granted' | 'denied' | 'prompt';

/** The events the native plugin emits. Each carries only the taskId. */
export type IkoroAlarmEvent = 'alarmRinging' | 'alarmDismissed' | 'alarmSnoozed';

/** The payload every alarm event carries. */
export interface IkoroAlarmEventPayload {
	taskId: string;
}

/** What `checkStatus()` answers — the whole "can this device promise an alarm?" picture. */
export interface IkoroAlarmStatus {
	notifications: IkoroNotifications;
	/**
	 * Whether the OS will let us arm an EXACT alarm. A boolean rather than a
	 * permission string on purpose: below API 31 there is no such permission to
	 * hold, and the native side answers `true` there because those alarms are
	 * exact by default.
	 */
	exact: boolean;
	/**
	 * Whether a ringing alarm may take over the screen (Android 14+ makes this a
	 * user-revocable permission). Reported but not required: an alarm that rings
	 * as a heads-up banner still rings.
	 */
	fullScreenIntent: boolean;
}

/** What `pickRingtone()` answers — a pick, a Silent pick, or a backed-out picker. */
export interface IkoroRingtonePick {
	/** True when the user closed the picker without choosing. Keep what you had. */
	cancelled: boolean;
	/** The picked sound's `content://` uri, or null when Silent was chosen. */
	uri: string | null;
}

/** What `getBatteryStatus()` answers — the two facts that decide alarm trust. */
export interface IkoroBatteryStatus {
	/** The device is in battery saver right now. */
	powerSaveMode: boolean;
	/** Ikoro is on the power allowlist (battery optimisations do not apply). */
	ignoringBatteryOptimizations: boolean;
}

/**
 * The plugin's methods, exactly as the Kotlin side declares them.
 *
 * `addListener` is part of this interface rather than inherited magic:
 * Capacitor's `registerPlugin<T>` returns exactly `T`, so an event name that is
 * not listed here does not type-check at the call site.
 *
 * NOTE: Capacitor also puts its own inherited `checkPermissions()` /
 * `requestPermissions()` on the plugin object. They are NOT this contract's API
 * and must not be used — `checkStatus()` is, because it answers the exact-alarm
 * and full-screen-intent questions too, which the inherited pair cannot.
 */
export interface IkoroAlarmPlugin {
	schedule(options: {
		id: number;
		taskId: string;
		title: string;
		at: string;
		/** The sound to ring with; omit for the device default alarm sound. */
		ringtone?: string | null;
	}): Promise<{ platformId: string }>;
	cancel(options: { platformId: string }): Promise<void>;
	cancelAll(): Promise<void>;
	getPending(): Promise<{ pending: string[] }>;
	checkStatus(): Promise<IkoroAlarmStatus>;
	requestNotifications(): Promise<{ notifications: 'granted' | 'denied' }>;
	openExactAlarmSettings(): Promise<void>;
	requestFullScreenIntentPermission(): Promise<void>;
	/** The system ringtone picker (ACTION_RINGTONE_PICKER), as a promise. */
	pickRingtone(options: { existing?: string }): Promise<IkoroRingtonePick>;
	/** The display name of a picked sound, for showing "Bells" not a uri. */
	ringtoneTitle(options: { uri: string }): Promise<{ title: string | null }>;
	/** Battery saver + allowlist state, for the reliability banner. */
	getBatteryStatus(): Promise<IkoroBatteryStatus>;
	/** Show the system dialog that exempts Ikoro from battery optimisation. */
	requestIgnoreBatteryOptimizations(): Promise<void>;
	/** Open the system battery-saver screen (an app cannot switch saver off). */
	openBatterySaverSettings(): Promise<void>;
	/** The user's chosen snooze length, in minutes. */
	getSnoozeMinutes(): Promise<{ minutes: number }>;
	/**
	 * Set the snooze length. Resolves with the value the device ACTUALLY stored —
	 * anything outside 2/5/10/15 falls back to 5, so the UI reads the echo back
	 * rather than assuming its input was kept.
	 */
	setSnoozeMinutes(options: { minutes: number }): Promise<{ minutes: number }>;
	addListener(
		eventName: IkoroAlarmEvent,
		listener: (payload: IkoroAlarmEventPayload) => void
	): Promise<PluginListenerHandle>;
}

/**
 * The one instance, resolved by Capacitor from the name the Kotlin plugin
 * registers itself under (`@CapacitorPlugin(name = "IkoroAlarm")`). On a
 * non-native shell — the browser, a test with no Android behind it — calling a
 * method rejects instead of doing nothing, which is why every caller treats a
 * rejection as a real outcome rather than assuming success.
 */
export const IkoroAlarm = registerPlugin<IkoroAlarmPlugin>('IkoroAlarm');
