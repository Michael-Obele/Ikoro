/**
 * Choosing and resolving alarm sounds, in one tiny module.
 *
 * TWO LEVELS, BOTH DELIBERATE. A global default lives in `localStorage` — it is
 * a device preference, not task data, so it never touches the database or the
 * sync wire. A per-task override lives on the task row (`Task.ringtone`) and
 * wins when present. `ringtoneFor()` is the single place that precedence is
 * decided, so the sheet and `reconcile()` can never disagree about what an
 * alarm was armed with.
 *
 * The actual LISTING and PREVIEWING of sounds is the system ringtone picker
 * (Android's `ACTION_RINGTONE_PICKER`, bridged by `IkoroAlarm.pickRingtone`):
 * it already knows every sound the device has and previews each one on tap.
 */
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

/**
 * The sound this task's alarm should be armed with: its own pick, else the
 * device-wide default, else null (the system default alarm sound).
 */
export function ringtoneFor(task: { ringtone?: string | null }): string | null {
	return task.ringtone ?? globalRingtone();
}

/**
 * Open the system picker. Resolves `{ cancelled: true }` on every platform
 * without a picker, so callers need no platform branch of their own.
 */
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
