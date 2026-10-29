// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SNOOZE_MINUTES,
	SNOOZE_CHOICES,
	setSnoozeMinutes,
	snoozeMinutes,
	snoozeSupported
} from '#lib/alarms/snooze';

/**
 * THE SNOOZE SETTING'S WEB-SIDE CONTRACT.
 *
 * The value itself lives in SharedPreferences (the ringing screen reads it with no
 * Bridge), so the web layer must never invent one. Two classes of bug are caught
 * here: the offered set drifting from `AlarmStore.SNOOZE_CHOICES` in Kotlin — the
 * two lists are one contract written twice and nothing but this test keeps them
 * equal — and the platform gate throwing or lying off Android, which would turn
 * the Settings row into a dead control on desktop and in the browser preview.
 */

describe('snooze choices', () => {
	it('matches the set Kotlin offers and stores, and the default is one of them', () => {
		expect([...SNOOZE_CHOICES]).toEqual([2, 5, 10, 15]);
		expect(SNOOZE_CHOICES).toContain(DEFAULT_SNOOZE_MINUTES);
	});
});

describe('snooze off Android', () => {
	it('answers the default instead of touching a plugin that is not there', async () => {
		// jsdom is not a native shell — exactly the case desktop and the browser
		// preview hit. Reads and writes must resolve honestly, never reject.
		expect(snoozeSupported()).toBe(false);
		expect(await snoozeMinutes()).toBe(DEFAULT_SNOOZE_MINUTES);
		expect(await setSnoozeMinutes(10)).toBe(DEFAULT_SNOOZE_MINUTES);
	});
});
