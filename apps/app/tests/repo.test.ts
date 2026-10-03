// @vitest-environment jsdom
//
// `fake-indexeddb/auto` MUST be imported before the module under test: schema.ts
// calls `createReactiveDB()` at module scope, so IndexedDB has to already exist
// by the time that runs or the import throws.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '#lib/db/schema';
import { ensureSeeded } from '#lib/db/seed';
import * as repo from '#lib/db/repo';

/**
 * These cases are the contract for the data layer. Three of them encode the
 * design decisions that follow from svelte-idb having no transaction API:
 *
 *   - `createTask` with a duplicate id must THROW (it uses `add()`, not `put()`),
 *     otherwise a colliding id would silently overwrite somebody's task.
 *   - `deleteTask` must leave the row readable by `getTask` — soft delete, so an
 *     interrupted sync can still see the tombstone.
 *   - `deleteList` must be a sequential, idempotent cascade rather than one
 *     atomic operation, so running it twice is safe.
 */

/** Local-time YYYY-MM-DD, which is how `dueDate` is stored (never an instant). */
function day(offsetDays = 0): string {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function freshList(): Promise<string> {
        const list = await repo.createList('Test');
        return list.id;
}

beforeEach(async () => {
        await db.tasks.clear();
        await db.lists.clear();
});

describe('seed', () => {
        it('creates exactly one list named "Tasks" on an empty database', async () => {
                await ensureSeeded();
                const lists = await repo.getLists();
                expect(lists).toHaveLength(1);
                expect(lists[0].name).toBe('Tasks');
        });

        it('is idempotent — a second call does not create a second list', async () => {
                await ensureSeeded();
                await ensureSeeded();
                expect(await repo.getLists()).toHaveLength(1);
        });
});

describe('createTask', () => {
        it('applies every default', async () => {
                const listId = await freshList();
                const task = await repo.createTask({ listId, title: 'x' });

                expect(task.priority).toBe(0);
                expect(task.completedAt).toBeNull();
                expect(task.alarmAt).toBeNull();
                expect(task.alarmId).toBeNull();
                expect(task.alarmFiredAt).toBeNull();
                expect(task.dirty).toBe(1);
                expect(task.deletedAt).toBeNull();
                expect(task.rev).toBeNull();
                expect(task.createdAt).toBe(task.updatedAt);
        });

        it('throws on a duplicate id — proves add() is used, not put()', async () => {
                const listId = await freshList();
               	await repo.createTask({ id: 'dupe', listId, title: 'first' });
               	await expect(repo.createTask({ id: 'dupe', listId, title: 'second' })).rejects.toThrow();
        });
});

describe('toggleTask', () => {
        it('sets completedAt, and toggling back clears it', async () => {
                const listId = await freshList();
               	const { id } = await repo.createTask({ listId, title: 'x' });

               	await repo.toggleTask(id);
               	const done = await repo.getTask(id);
               	expect(done?.completedAt).not.toBeNull();

               	await repo.toggleTask(id);
               	const open = await repo.getTask(id);
               	expect(open?.completedAt).toBeNull();
        });

        it('never touches alarmAt — cancelling the platform alarm is M4’s job', async () => {
                const listId = await freshList();
               	const { id } = await repo.createTask({ listId, title: 'x', alarmAt: '2030-01-01T09:00:00.000Z' });

               	await repo.toggleTask(id);
				await repo.toggleTask(id);

				const task = await repo.getTask(id);
				expect(task?.alarmAt).toBe('2030-01-01T09:00:00.000Z');
        });
});

describe('deleteTask', () => {
        it('is soft: the row survives getTask but leaves every view', async () => {
				const listId = await freshList();
				const { id } = await repo.createTask({ listId, title: 'x', dueDate: day() });

				await repo.deleteTask(id);

				expect(await repo.getTask(id)).toBeDefined();
				expect(await repo.tasksByList(listId)).toHaveLength(0);
				expect(await repo.todayOpenTasks()).toHaveLength(0);
		});
});

describe('deleteList', () => {
        it('cascades to every task that referenced it', async () => {
                const listId = await freshList();
                await repo.createTask({ listId, title: 'a' });
               	await repo.createTask({ listId, title: 'b' });

                await repo.deleteList(listId);

                expect(await repo.getLists()).toHaveLength(0);
                expect(await repo.tasksByList(listId)).toHaveLength(0);
        });

        it('is idempotent', async () => {
                const listId = await freshList();
                await repo.createTask({ listId, title: 'a' });
                await repo.deleteList(listId);
               	await expect(repo.deleteList(listId)).resolves.toBeUndefined();
        });
});

describe('todayOpenTasks', () => {
        it('includes overdue and today, excludes completed and older than the window', async () => {
                const listId = await freshList();
                const overdue = await repo.createTask({ listId, title: 'overdue', dueDate: day(-3) });
                const today = await repo.createTask({ listId, title: 'today', dueDate: day(0) });
                const done = await repo.createTask({ listId, title: 'done', dueDate: day(0) });
                const ancient = await repo.createTask({ listId, title: 'ancient', dueDate: day(-400) });
                await repo.toggleTask(done.id);

                const rows = await repo.todayOpenTasks();
                const ids = rows.map((t) => t.id);

                expect(ids).toContain(overdue.id);
                expect(ids).toContain(today.id);
                expect(ids).not.toContain(done.id);
                expect(ids).not.toContain(ancient.id);
        });

        it('puts the most overdue first', async () => {
                const listId = await freshList();
                const older = await repo.createTask({ listId, title: 'older', dueDate: day(-9) });
                const newer = await repo.createTask({ listId, title: 'newer', dueDate: day(-1) });

                const rows = await repo.todayOpenTasks();
                expect(rows.map((t) => t.id).indexOf(older.id)).toBeLessThan(rows.map((t) => t.id).indexOf(newer.id));
        });

        it('never returns an undated task — null keys are absent from the index', async () => {
                const listId = await freshList();
                await repo.createTask({ listId, title: 'someday' });

                expect(await repo.todayOpenTasks()).toHaveLength(0);
                expect(await repo.upcomingTasks(new Date(Date.now() - 864e5), new Date(Date.now() + 864e5))).toHaveLength(0);
        });
});

describe('updateTask', () => {
        it('changes the field, bumps updatedAt, and leaves the row dirty', async () => {
                const listId = await freshList();
                const { id } = await repo.createTask({ listId, title: 'x' });
                const before = await repo.getTask(id);

               	await new Promise((r) => setTimeout(r, 2));
				await repo.updateTask(id, { title: 'y' });

				const after = await repo.getTask(id);
				expect(after?.title).toBe('y');
				expect((after?.updatedAt ?? '') > (before?.updatedAt ?? '')).toBe(true);
				expect(after?.dirty).toBe(1);
		});
});

describe('reorderLists', () => {
        it('makes the array index the new sortOrder', async () => {
                const a = await repo.createList('a');
                const b = await repo.createList('b');

                await repo.reorderLists([b.id, a.id]);

                expect((await repo.getTaskListById(b.id))?.sortOrder).toBe(0);
                expect((await repo.getTaskListById(a.id))?.sortOrder).toBe(1);
        });
});

describe('purgeDeleted', () => {
        it('hard-removes tombstones, leaves live rows, and returns the count', async () => {
                const listId = await freshList();
                await repo.createTask({ listId, title: 'gone' });
                await repo.createTask({ listId, title: 'kept' });
                const rows = await repo.tasksByList(listId);
                await repo.deleteTask(rows[0].id);

                const removed = await repo.purgeDeleted();

                expect(removed).toBe(1);
				expect(await db.tasks.count()).toBe(1);
        });
});

describe('markAllDirty', () => {
        it('flags every live row for the first sync push', async () => {
                const listId = await freshList();
                const { id } = await repo.createTask({ listId, title: 'x' });
                await db.tasks.put({ ...(await repo.getTask(id)), dirty: 0 } as never);

                await repo.markAllDirty();

                expect((await repo.getTask(id))?.dirty).toBe(1);
        });
});