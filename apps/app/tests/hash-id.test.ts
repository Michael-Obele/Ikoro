import { describe, expect, it } from 'vitest';
import { hashId } from '$lib/utils/id';

/** Guards that `hashId` stays a signed 32-bit int -- Android rejects a wider notification id at schedule time. */

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
		expect(hashId('spike')).toBeLessThanOrEqual(INT32_MAX);
	});

	it('is STABLE — the same input must always give the same id', () => {
		// Re-arming must land on the same id, or every reschedule leaks a duplicate notification.
		const first = hashId('task-1');
		for (let i = 0; i < 10; i++) expect(hashId('task-1')).toBe(first);
	});

	it('does not collapse distinct inputs into one id', () => {
		const ids = new Set(Array.from({ length: 5_000 }, (_, i) => hashId(`task-${i}`)));
		// A few collisions are harmless; too many and reminders overwrite each other.
		expect(ids.size).toBeGreaterThan(4_900);
	});

	it('survives the round trip through the string form used in unit filenames', () => {
		const id = hashId('task-7');
		expect(Number(String(id))).toBe(id);
		expect(String(id)).not.toContain('.');
		expect(String(id)).not.toContain('e');
	});
});
