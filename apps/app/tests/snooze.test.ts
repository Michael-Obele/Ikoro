// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SNOOZE_MINUTES,
	SNOOZE_CHOICES,
	setSnoozeMinutes,
	snoozeMinutes,
	snoozeSupported
} from '#lib/alarms/snooze';

/** Guards the web-side snooze contract: choice list matches Kotlin's, and the gate degrades honestly off Android. */

describe('snooze choices', () => {
	it('matches the set Kotlin offers and stores, and the default is one of them', () => {
		expect([...SNOOZE_CHOICES]).toEqual([2, 5, 10, 15]);
		expect(SNOOZE_CHOICES).toContain(DEFAULT_SNOOZE_MINUTES);
	});
});

describe('snooze off Android', () => {
	it('answers the default instead of touching a plugin that is not there', async () => {
		expect(snoozeSupported()).toBe(false);
		expect(await snoozeMinutes()).toBe(DEFAULT_SNOOZE_MINUTES);
		expect(await setSnoozeMinutes(10)).toBe(DEFAULT_SNOOZE_MINUTES);
	});
});
