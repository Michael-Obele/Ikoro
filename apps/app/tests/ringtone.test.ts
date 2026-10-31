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

/** Guards ringtone precedence (task > global > system) and that the picker answers "cancelled" off-platform. */

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
		expect(ringtoneSupported()).toBe(false);
		expect(await pickRingtone()).toEqual({ cancelled: true, uri: null });
	});
});
