// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
	globalRingtone,
	pickRingtone,
	ringtoneFor,
	ringtoneSupported,
	setGlobalRingtone,
	RINGTONE_STORAGE_KEY
} from '#lib/alarms/ringtone';

/**
 * SOUND PRECEDENCE, THE PART THAT DECIDES WHAT AN ALARM RINGS WITH.
 *
 * Two levels — a per-task pick and a device-wide default — meet in exactly one
 * function, `ringtoneFor()`, and both the task sheet and `reconcile()` arm
 * through it. If the precedence ever flips, alarms ring with the wrong sound
 * silently, so it is asserted here rather than read off the code.
 *
 * Also guards the platform gate: outside native Android the picker must report
 * "cancelled" rather than throw, or the sheet's change button becomes a dead
 * end that swallows the tap.
 */

beforeEach(() => {
	localStorage.clear();
});

describe('global ringtone', () => {
	it('round-trips a uri and treats clearing as "the system default"', () => {
		expect(globalRingtone()).toBeNull();
		setGlobalRingtone('content://media/external/audio/media/42');
		expect(localStorage.getItem(RINGTONE_STORAGE_KEY)).toBe(
			'content://media/external/audio/media/42'
		);
		expect(globalRingtone()).toBe('content://media/external/audio/media/42');
		setGlobalRingtone(null);
		expect(globalRingtone()).toBeNull();
		expect(localStorage.getItem(RINGTONE_STORAGE_KEY)).toBeNull();
	});
});

describe('ringtoneFor', () => {
	it('prefers the per-task pick, then the global default, then the system default', () => {
		setGlobalRingtone('content://global');
		expect(ringtoneFor({ ringtone: 'content://task' })).toBe('content://task');
		expect(ringtoneFor({ ringtone: null })).toBe('content://global');
		expect(ringtoneFor({})).toBe('content://global');
		localStorage.clear();
		expect(ringtoneFor({ ringtone: null })).toBeNull();
	});
});

describe('pickRingtone off-platform', () => {
	it('answers "cancelled" on the web instead of throwing', async () => {
		// jsdom is not a native shell, which is exactly the case the sheet must
		// survive: the Change button must resolve to a no-op, not an unhandled
		// rejection from a plugin that does not exist.
		expect(ringtoneSupported()).toBe(false);
		expect(await pickRingtone()).toEqual({ cancelled: true, uri: null });
	});
});
