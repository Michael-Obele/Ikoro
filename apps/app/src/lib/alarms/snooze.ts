/**
 * The snooze-length setting, in one tiny module.
 *
 * SharedPreferences on the device is the SINGLE source of truth — the ringing
 * screen and the alarm service read it with no Bridge, and this module is a thin
 * client of it. There is deliberately no localStorage or IndexedDB mirror: two
 * copies of a device setting is two chances to disagree, and the value means
 * nothing on a platform that has no ring screen to snooze.
 *
 * Android is the only such platform: desktop fires notifications, not ringing
 * alarms, so every function answers the honest default off-device rather than
 * throwing at a plugin that is not there.
 */
import { Capacitor } from '@capacitor/core';
import { IkoroAlarm } from './plugin';

/** The offered lengths, in minutes. Mirrors `AlarmStore.SNOOZE_CHOICES` in Kotlin. */
export const SNOOZE_CHOICES = [2, 5, 10, 15] as const;

export type SnoozeMinutes = (typeof SNOOZE_CHOICES)[number];

/** The length for a device that has never been asked. Mirrors the Kotlin default. */
export const DEFAULT_SNOOZE_MINUTES: SnoozeMinutes = 5;

/** Android is the only platform with a ringing screen to snooze. */
export function snoozeSupported(): boolean {
	return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** A number is only one of ours if it is on the list; anything else is the default. */
function coerce(value: number): SnoozeMinutes {
	return (SNOOZE_CHOICES as readonly number[]).includes(value)
		? (value as SnoozeMinutes)
		: DEFAULT_SNOOZE_MINUTES;
}

/** The stored length, or the default on any platform without the setting. */
export async function snoozeMinutes(): Promise<SnoozeMinutes> {
	if (!snoozeSupported()) return DEFAULT_SNOOZE_MINUTES;
	try {
		return coerce((await IkoroAlarm.getSnoozeMinutes()).minutes);
	} catch (error) {
		console.warn('[ikoro] could not read snooze minutes', error);
		return DEFAULT_SNOOZE_MINUTES;
	}
}

/**
 * Write a length and return what the device actually stored.
 *
 * The echo is the point: the caller sets its state from the answer, never from
 * its input, so the UI cannot show a length the alarm will not honour.
 */
export async function setSnoozeMinutes(minutes: number): Promise<SnoozeMinutes> {
	if (!snoozeSupported()) return DEFAULT_SNOOZE_MINUTES;
	try {
		return coerce((await IkoroAlarm.setSnoozeMinutes({ minutes })).minutes);
	} catch (error) {
		console.warn('[ikoro] could not store snooze minutes', error);
		return coerce(minutes);
	}
}
