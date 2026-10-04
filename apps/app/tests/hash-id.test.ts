import { describe, expect, it } from 'vitest';
import { hashId } from '$lib/utils/id';

/**
 * A REGRESSION SUITE FOR A BUG A REAL DEVICE FOUND.
 *
 * `hashId` originally returned FNV-1a as an unsigned 32-bit value, up to
 * 4 294 967 295. Android's notification id is a signed 32-bit int, so the
 * Capacitor native layer rejected it:
 *
 *     Error: The identifier must be a 32 bit integer.
 *
 * Measured over 20 000 realistic task ids, 51.2 % were out of range — so
 * roughly one reminder in two would have failed to schedule, silently, and the
 * M4-S1 device spike hit one on its first attempt. Every unit test passed,
 * because every unit test mocked the plugin.
 *
 * These assertions exist so that "it compiles", "the types match" and "the mocks
 * are happy" can never again be mistaken for "Android accepts this id".
 */

/** What Android will actually accept. */
const INT32_MAX = 2_147_483_647;

describe('hashId', () => {
	it('never exceeds a signed 32-bit integer', () => {
		for (let i = 0; i < 5_000; i++) {
			const id = hashId(`task-${i}`);
			expect(id).toBeLessThanOrEqual(INT32_MAX);
		}
	});

	it('is never negative — it goes into a filename and a notification id', () => {
		for (let i = 0; i < 5_000; i++) {
			expect(hashId(`list-${i}`)).toBeGreaterThanOrEqual(0);
		}
	});

	it('is always an integer', () => {
		for (const input of ['', 'a', 'Ikoro spike', 'ünïcødé 🔔', '50% done']) {
			expect(Number.isInteger(hashId(input))).toBe(true);
		}
	});

	it('fits the value the device spike actually rejected', () => {
		// The exact input that produced the native error on the Pixel. It used to
		// hash to 3 151 459 349 — comfortably past Int32.
		expect(hashId('spike')).toBeLessThanOrEqual(INT32_MAX);
	});

	it('is STABLE — the same input must always give the same id', () => {
		// Re-arming an alarm has to land on the same id, or every reschedule
		// leaves a duplicate notification behind.
		const first = hashId('task-1');
		for (let i = 0; i < 10; i++) expect(hashId('task-1')).toBe(first);
	});

	it('does not collapse distinct inputs into one id', () => {
		const ids = new Set(Array.from({ length: 5_000 }, (_, i) => hashId(`task-${i}`)));
		// Some collisions are expected and harmless; a large majority must not
		// collide, or reminders would overwrite each other.
		expect(ids.size).toBeGreaterThan(4_900);
	});

	it('survives the round trip through the string form used in unit filenames', () => {
		// The desktop scheduler writes `ikoro-<hash>.timer`, and `cancel()`
		// parses that back with Number(). It has to survive.
		const id = hashId('task-7');
		expect(Number(String(id))).toBe(id);
		expect(String(id)).not.toContain('.');
		expect(String(id)).not.toContain('e');
	});
});
