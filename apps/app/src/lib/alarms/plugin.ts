/** Typed bridge to the native `IkoroAlarm` plugin. Shapes are transcribed from `IkoroAlarmPlugin.kt`, untidied, so a mismatch stays a compile error. */
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
	/** Boolean, not a permission string: below API 31 no such permission exists and the native side answers `true`. */
	exact: boolean;
	/** Android 14+ makes this user-revocable. Reported, not required: a heads-up banner still rings. */
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

/** The plugin's methods as Kotlin declares them. Capacitor's inherited `checkPermissions()`/`requestPermissions()` must not be used. */
export interface IkoroAlarmPlugin {
	schedule(options: {
		id: number;
		taskId: string;
		title: string;
		at: string;
		/** The sound to ring with; omit for the device default alarm sound. */
		ringtone?: string | null;
		/** The task's notes, shown on the ringing screen. */
		description?: string | null;
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
	/** Resolves with the stored value -- anything outside 2/5/10/15 falls back to 5, so read the echo, not the input. */
	setSnoozeMinutes(options: { minutes: number }): Promise<{ minutes: number }>;
	/** Answer a ringing alarm from the web UI: in the foreground Android refuses the full-screen takeover, leaving the overlay as the only control. */
	snooze(options: { id: number; taskId: string; title?: string }): Promise<void>;
	dismiss(options: { id: number; taskId: string; title?: string }): Promise<void>;
	addListener(
		eventName: IkoroAlarmEvent,
		listener: (payload: IkoroAlarmEventPayload) => void
	): Promise<PluginListenerHandle>;
}

/** Resolved by name from the Kotlin `@CapacitorPlugin(name = "IkoroAlarm")`. Off-device every call rejects. */
export const IkoroAlarm = registerPlugin<IkoroAlarmPlugin>('IkoroAlarm');
