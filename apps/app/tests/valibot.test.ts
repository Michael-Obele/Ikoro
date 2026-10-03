import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { exportSchema, taskInputSchema, taskSchema } from '$lib/valibot/task';

/**
 * Pure logic — no database, no DOM — so it stays on the default `node`
 * environment and runs in milliseconds.
 *
 * The length limits are not arbitrary: 1024/8192 are Google's own task title and
 * notes caps, and Ikoro is meant to be a drop-in for someone whose tasks already
 * live there. Rejecting a 1025th character on import would silently lose data on
 * a round-trip.
 */

/** `taskSchema` is the complete form shape, so the base must be complete too. */
const minimal = { title: 'Buy milk', notes: null, dueDate: null, dueTime: null, priority: 0 as const };

describe('taskSchema.title', () => {
        it('accepts exactly 1024 characters', () => {
                expect(v.safeParse(taskSchema, { ...minimal, title: 'x'.repeat(1024) }).success).toBe(true);
        });

        it('rejects 1025', () => {
                expect(v.safeParse(taskSchema, { ...minimal, title: 'x'.repeat(1025) }).success).toBe(false);
        });

        it('rejects an empty or whitespace-only title', () => {
                expect(v.safeParse(taskSchema, { ...minimal, title: '' }).success).toBe(false);
                expect(v.safeParse(taskSchema, { ...minimal, title: '   ' }).success).toBe(false);
        });
});

describe('taskSchema.notes', () => {
        it('accepts null, and exactly 8192 characters', () => {
                expect(v.safeParse(taskSchema, { ...minimal, notes: null }).success).toBe(true);
                expect(v.safeParse(taskSchema, { ...minimal, notes: 'x'.repeat(8192) }).success).toBe(true);
        });

        it('rejects 8193', () => {
                expect(v.safeParse(taskSchema, { ...minimal, notes: 'x'.repeat(8193) }).success).toBe(false);
        });
});

describe('taskSchema.dueDate', () => {
        it('accepts a zero-padded ISO calendar day', () => {
                expect(v.safeParse(taskSchema, { ...minimal, dueDate: '2026-01-01' }).success).toBe(true);
        });

        it('rejects unpadded and impossible dates', () => {
                expect(v.safeParse(taskSchema, { ...minimal, dueDate: '2026-1-1' }).success).toBe(false);
                expect(v.safeParse(taskSchema, { ...minimal, dueDate: '2026-13-99' }).success).toBe(false);
        });

        it('accepts null — an undated task is legitimate', () => {
                expect(v.safeParse(taskSchema, { ...minimal, dueDate: null }).success).toBe(true);
        });
});

describe('taskSchema.dueTime', () => {
        it('accepts zero-padded 24-hour times', () => {
                expect(v.safeParse(taskSchema, { ...minimal, dueTime: '09:05' }).success).toBe(true);
                expect(v.safeParse(taskSchema, { ...minimal, dueTime: '23:59' }).success).toBe(true);
        });

        it('rejects 24:00 and an unpadded hour', () => {
                expect(v.safeParse(taskSchema, { ...minimal, dueTime: '24:00' }).success).toBe(false);
                expect(v.safeParse(taskSchema, { ...minimal, dueTime: '9:05' }).success).toBe(false);
        });
});

describe('taskSchema.priority', () => {
        it('accepts 0..3 only', () => {
                expect(v.safeParse(taskSchema, { ...minimal, priority: 0 }).success).toBe(true);
                expect(v.safeParse(taskSchema, { ...minimal, priority: 3 }).success).toBe(true);
                expect(v.safeParse(taskSchema, { ...minimal, priority: 4 }).success).toBe(false);
                expect(v.safeParse(taskSchema, { ...minimal, priority: -1 }).success).toBe(false);
        });
});

describe('taskInputSchema', () => {
        it('requires only a title', () => {
                expect(v.safeParse(taskInputSchema, { title: 'only a title' }).success).toBe(true);
        });

        it('still enforces the length limits on optional fields', () => {
                expect(v.safeParse(taskInputSchema, { title: 'x', notes: 'x'.repeat(9000) }).success).toBe(false);
                expect(v.safeParse(taskInputSchema, { title: 'x', dueTime: '9:05' }).success).toBe(false);
        });
});

describe('exportSchema', () => {
        const envelope = {
                app: 'ikoro',
                schemaVersion: 1,
                exportedAt: '2026-10-03T12:00:00.000Z',
                lists: [{ id: 'l1', name: 'Tasks', sortOrder: 0 }],
                tasks: [{ id: 't1', listId: 'l1', title: 'x', notes: null, dueDate: null, dueTime: null, priority: 0, alarmAt: null }]
        };

        it('accepts a minimal valid envelope', () => {
                expect(v.safeParse(exportSchema, envelope).success).toBe(true);
        });

        it('rejects a future schemaVersion', () => {
                expect(v.safeParse(exportSchema, { ...envelope, schemaVersion: 2 }).success).toBe(false);
        });

        it('rejects a foreign app id', () => {
                expect(v.safeParse(exportSchema, { ...envelope, app: 'something-else' }).success).toBe(false);
        });
});