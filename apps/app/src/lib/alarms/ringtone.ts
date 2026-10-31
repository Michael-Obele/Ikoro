/** Choosing and resolving alarm sounds: device-wide default in `localStorage`, per-task override on the row, precedence decided only in `ringtoneFor()`. */
import { Capacitor } from '@capacitor/core';
import { IkoroAlarm, type IkoroRingtonePick } from './plugin';

export const RINGTONE_STORAGE_KEY = 'ikoro:ringtone';

/** Android is the only platform with a ringtone picker or a ringtone to pick. */
export function ringtoneSupported(): boolean {
	return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** The device-wide default sound, or null for "the system default alarm sound". */
export function globalRingtone(): string | null {
	return storage()?.getItem(RINGTONE_STORAGE_KEY) || null;
}

export function setGlobalRingtone(uri: string | null): void {
	const store = storage();
	if (!store) return;
	if (uri) store.setItem(RINGTONE_STORAGE_KEY, uri);
	else store.removeItem(RINGTONE_STORAGE_KEY);
}

/** Per-task pick, else the device-wide default, else null (the system default alarm sound). */
export function ringtoneFor(task: { ringtone?: string | null }): string | null {
	return task.ringtone ?? globalRingtone();
}

/** Open the system picker. Answers `{ cancelled: true }` on platforms without one, so callers need no branch. */
export async function pickRingtone(existing?: string | null): Promise<IkoroRingtonePick> {
	if (!ringtoneSupported()) return { cancelled: true, uri: null };
	try {
		return await IkoroAlarm.pickRingtone(existing ? { existing } : {});
	} catch (error) {
		console.warn('[ikoro] ringtone picker failed', error);
		return { cancelled: true, uri: null };
	}
}

/** The display name of a picked sound, or null when it cannot be resolved. */
export async function ringtoneTitleOf(uri: string | null): Promise<string | null> {
	if (!uri || !ringtoneSupported()) return null;
	try {
		return (await IkoroAlarm.ringtoneTitle({ uri })).title;
	} catch {
		return null;
	}
}
