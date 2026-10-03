import { describe, expect, it } from 'vitest';
import {
	findForbiddenFields,
	validatePayload,
	listPayloadSchema,
	taskPayloadSchema,
	FORBIDDEN_PAYLOAD_FIELDS
} from '#lib/sync/payload';

/**
 * Payload validation.
 *
 * The bug class: the server accepts a payload the client cannot read back, or
 * silently drops a field the client believes was stored. The second is worse —
 * `alarmId` in particular, where a client that thinks its alarm is registered
 * and is not means the product's central promise is quietly broken.
 *
 * So the error MESSAGE is asserted, not just the failure. AGENTS.md's rule: the
 * message is what gets read when something fails.
 */

const validTask = {
	id: 'task-1',
	listId: 'list-1',
	title: 'Buy milk',
	notes: null,
	dueDate: '2026-10-05',
	dueTime: '09:30',
	priority: 2,
	parentId: null,
	repeat: null,
	completedAt: null,
	alarmAt: '2026-10-05T09:30:00.000Z',
	sortOrder: 0,
	createdAt: '2026-10-01T12:00:00.000Z',
	updatedAt: '2026-10-01T12:00:00.000Z',
	deletedAt: null
};

const validList = {
	id: 'list-1',
	name: 'Groceries',
	sortOrder: 0,
	createdAt: '2026-10-01T12:00:00.000Z',
	updatedAt: '2026-10-01T12:00:00.000Z',
	deletedAt: null
};

describe('a well-formed payload passes', () => {
	it('accepts a task', () => {
		const result = validatePayload('task', validTask);
		expect(result.ok).toBe(true);
	});

	it('accepts a list', () => {
		expect(validatePayload('list', validList).ok).toBe(true);
	});

	it('accepts the optional googleTaskId', () => {
		expect(validatePayload('task', { ...validTask, googleTaskId: 'g-1' }).ok).toBe(true);
		expect(validatePayload('task', { ...validTask, googleTaskId: null }).ok).toBe(true);
	});
});

describe('failures name the offending FIELD', () => {
	it('reports the path, not a thrown string', () => {
		const result = validatePayload('task', { ...validTask, title: 42 });
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.message).toContain('task');
		expect(result.message).toContain('title');
		expect(result.issues.join(' ')).toMatch(/title/);
	});

	it('rejects a missing required field by name', () => {
		const withoutTitle: Record<string, unknown> = { ...validTask };
		delete withoutTitle.title;
		const result = validatePayload('task', withoutTitle);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.join(' ')).toMatch(/title/);
	});
});

describe('the calendar contract is enforced', () => {
	it('dueDate is YYYY-MM-DD, never a timestamp', () => {
		// The split of date and time is deliberate — Google's API discards the time
		// part — so a combined value here is a client bug worth failing loudly on.
		expect(validatePayload('task', { ...validTask, dueDate: '2026-10-05T09:30:00Z' }).ok).toBe(
			false
		);
		expect(validatePayload('task', { ...validTask, dueDate: '2026-10-05' }).ok).toBe(true);
	});

	it('dueTime is HH:mm and 24-hour', () => {
		expect(validatePayload('task', { ...validTask, dueTime: '9:30' }).ok).toBe(false);
		expect(validatePayload('task', { ...validTask, dueTime: '24:00' }).ok).toBe(false);
		expect(validatePayload('task', { ...validTask, dueTime: '23:59' }).ok).toBe(true);
	});
});

describe('priority is an enum, not an int', () => {
	it('accepts only 0–3', () => {
		for (const p of [0, 1, 2, 3]) {
			expect(validatePayload('task', { ...validTask, priority: p }).ok, `priority=${p}`).toBe(true);
		}
		expect(validatePayload('task', { ...validTask, priority: 4 }).ok).toBe(false);
		expect(validatePayload('task', { ...validTask, priority: -1 }).ok).toBe(false);
	});
});

describe('device-scoped and transport fields are refused', () => {
	it('finds each forbidden field by name', () => {
		for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
			expect(findForbiddenFields({ ...validTask, [field]: 'x' }), field).toEqual([field]);
		}
	});

	it('flags a userId, which is the other way an IDOR gets in', () => {
		// Silently stripping it would hide the attempt. Rejecting the op makes the
		// attempt visible in the client's `rejected` list.
		expect(findForbiddenFields({ ...validTask, userId: 'someone-else' })).toEqual(['userId']);
	});

	it('flags alarmId — a platform id from another device is meaningless', () => {
		expect(findForbiddenFields({ ...validTask, alarmId: '9999' })).toEqual(['alarmId']);
	});

	it('flags alarmFiredAt for the same reason', () => {
		expect(findForbiddenFields({ ...validTask, alarmFiredAt: '2026-10-01T00:00:00Z' })).toEqual([
			'alarmFiredAt'
		]);
	});

	it('flags rev, which the server owns', () => {
		// A client that could set rev could rewind the whole feed.
		expect(findForbiddenFields({ ...validTask, rev: 1 })).toEqual(['rev']);
	});

	it('returns [] for a clean payload and for a non-object', () => {
		expect(findForbiddenFields(validTask)).toEqual([]);
		expect(findForbiddenFields(null)).toEqual([]);
		expect(findForbiddenFields('nope')).toEqual([]);
		expect(findForbiddenFields(7)).toEqual([]);
	});
});

describe('the schemas are the ones the route imports', () => {
	it('both are defined and non-trivial', () => {
		// Guards against the route and the tests drifting onto different schemas.
		expect(listPayloadSchema).toBeDefined();
		expect(taskPayloadSchema).toBeDefined();
	});
});
