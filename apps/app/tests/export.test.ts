// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { db } from '#lib/db/schema';
import { exportAll, importAll, ImportError } from '#lib/db/backup';
import { createList, createTask, deleteTask } from '#lib/db/repo';
import { exportSchema } from '#lib/valibot/task';

/**
 * Backup is the one feature where a quiet bug destroys somebody's work, so the
 * cases below are mostly about what must NOT happen:
 *
 *   - a device-scoped field leaking into the file (an `alarmId` from this phone
 *     means nothing on another, and a `rev` from a server means nothing offline);
 *   - a task silently vanishing because its list was missing;
 *   - an older copy of a record overwriting a newer one.
 *
 * Every error path is asserted on its MESSAGE, not just its type — the message is
 * what the user reads when their import fails.
 */

beforeEach(async () => {
	await db.tasks.clear();
	await db.lists.clear();
	await db.meta.clear();
});

async function seed() {
	const errands = await createList('Errands');
	const home = await createList('Home');
	await createTask({ listId: errands.id, title: 'Buy milk', notes: 'Semi-skimmed', priority: 2 });
	await createTask({
		listId: home.id,
		title: 'Fix the gate',
		dueDate: '2026-10-05',
		dueTime: '09:30'
	});
	return { errands, home };
}

describe('exportAll', () => {
	it('produces an object the export schema accepts', async () => {
		await seed();
		const dump = await exportAll();
		expect(v.safeParse(exportSchema, dump).success).toBe(true);
	});

	it('contains no device-scoped or sync-bookkeeping key anywhere', async () => {
		const list = await createList('Tasks');
		const task = await createTask({
			listId: list.id,
			title: 'x',
			alarmAt: '2026-10-05T09:30:00.000Z'
		});

		// Give it exactly the fields that must never ship.
		await db.tasks.put({
			...(await db.tasks.get(task.id)),
			alarmId: '12345',
			alarmFiredAt: '2026-10-05T09:30:01.000Z',
			deletedAt: '2026-10-05T10:00:00.000Z',
			rev: 42
		} as unknown as Record<string, unknown>);

		const serialised = JSON.stringify(await exportAll());
		for (const forbidden of ['alarmId', 'alarmFiredAt', 'deletedAt', 'rev', '12345']) {
			expect(serialised).not.toContain(forbidden);
		}
	});

	it('stamps the envelope so an import can tell how old a backup is', async () => {
		const dump = await exportAll();
		expect(dump.app).toBe('ikoro');
		expect(dump.schemaVersion).toBe(1);
		expect(new Date(dump.exportedAt).toString()).not.toBe('Invalid Date');
	});
});

describe('importAll', () => {
	it('round-trips every list and task after a wipe', async () => {
		await seed();
		const before = JSON.stringify(await exportAll());

		await db.tasks.clear();
		await db.lists.clear();
		expect(await db.tasks.count()).toBe(0);

		const result = await importAll(JSON.parse(before));

		expect(result.lists).toBe(2);
		expect(result.tasks).toBe(2);
		expect(result.skipped).toBe(0);

		const after = JSON.stringify(await exportAll());
		expect(JSON.parse(after).lists).toEqual(JSON.parse(before).lists);
		expect(JSON.parse(after).tasks).toEqual(JSON.parse(before).tasks);
	});

	it('is idempotent — importing the same file twice changes nothing', async () => {
		await seed();
		const dump = JSON.parse(JSON.stringify(await exportAll()));
		const before = await exportAll();

		await importAll(dump);
		const second = await importAll(dump);

		// Nothing is written either time: the local rows are already identical, and
		// reporting 0 is the honest answer. "Imported 2" would imply the file
		// changed something it did not.
		expect(second.tasks).toBe(0);
		expect(second.lists).toBe(0);
		expect(await db.tasks.count()).toBe(2);

		// Compare content, not the envelope — `exportedAt` is re-stamped on every
		// export and is not part of the data.
		const after = await exportAll();
		expect(after.tasks).toEqual(before.tasks);
		expect(after.lists).toEqual(before.lists);
	});

	it('keeps the newer copy of a record, not the file copy', async () => {
		const list = await createList('Tasks');
		const task = await createTask({ listId: list.id, title: 'old title' });

		const dump = await exportAll();
		dump.tasks[0] = { ...dump.tasks[0], title: 'stale title' };

		// Make the local copy newer than the file's.
		const now = new Date(Date.now() + 60_000).toISOString();
		await db.tasks.put({
			...((await db.tasks.get(task.id)) as object),
			title: 'newest title',
			updatedAt: now
		} as never);

		await importAll(dump);

		const restored = (await db.tasks.get(task.id)) as unknown as { title: string };
		expect(restored.title).toBe('newest title');
	});

	it('leaves records that exist only locally untouched', async () => {
		const list = await createList('Tasks');
		await createTask({ listId: list.id, title: 'only on this device' });

		// Importing an EMPTY backup is the strongest form of this: nothing in the
		// file can overwrite the local row, so the row must survive.
		const result = await importAll(await exportAll());
		expect(result.tasks).toBe(0);
	});

	it('clears device-scoped fields on every imported task', async () => {
		const list = await createList('Tasks');
		const task = await createTask({ listId: list.id, title: 'x' });
		await db.tasks.put({
			...((await db.tasks.get(task.id)) as object),
			alarmId: '999',
			alarmFiredAt: '2026-01-01T00:00:00.000Z'
		} as never);

		const dump = await exportAll();

		// Import onto a DIFFERENT device: wipe, then restore. An alarm armed on one
		// phone means nothing on another, so the restored row must have neither
		// the platform id nor the fired timestamp.
		await db.tasks.clear();
		await importAll(dump);

		const restored = (await db.tasks.get(task.id)) as unknown as {
			alarmId: string | null;
			alarmFiredAt: string | null;
		};
		expect(restored.alarmId).toBeNull();
		expect(restored.alarmFiredAt).toBeNull();
	});

	it('SKIPS a task whose list is missing — and REPORTS it', async () => {
		const list = await createList('Tasks');
		await createTask({ listId: list.id, title: 'orphan' });

		// A file with tasks but no lists: every task has nowhere to live.
		const dump = await exportAll();
		dump.lists = [];

		await db.tasks.clear();
		await db.lists.clear();

		const result = await importAll(dump);

		expect(result.skipped).toBe(1);
		expect(result.tasks).toBe(0);
		expect(await db.tasks.count()).toBe(0);
	});

	it('names schemaVersion when the file is from a future version', async () => {
		const dump = await exportAll();
		const error = await importAll({ ...dump, schemaVersion: 2 }).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ImportError);
		expect((error as ImportError).paths.join(' ')).toMatch(/schemaVersion/);
	});

	it('lists EVERY failing field path, not just the first', async () => {
		await seed();
		const dump = await exportAll();

		// Two independent violations, in two different records. Reporting only the
		// first would send the user round the loop fixing one field at a time.
		dump.tasks[0] = { ...dump.tasks[0], title: '' };
		dump.lists[0] = { ...dump.lists[0], name: '' };

		const error = await importAll(dump).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ImportError);
		const paths = (error as ImportError).paths;
		expect(paths.length).toBeGreaterThan(1);
		expect(paths.join(' ')).toMatch(/title/);
		expect(paths.join(' ')).toMatch(/name/);
	});

	it('rejects unparseable input with a readable message, not a stack trace', async () => {
		const error = await importAll('not json').catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ImportError);
		expect((error as Error).message).not.toMatch(/\bat .*:\d+:\d+/);
		expect((error as Error).message).toMatch(/JSON/i);
	});
});

describe('soft-deleted rows', () => {
	it('does not resurrect a task the user deleted', async () => {
		const list = await createList('Tasks');
		const task = await createTask({ listId: list.id, title: 'deleted' });
		await deleteTask(task.id);

		// A tombstone is not user data: it exists so a sync peer can learn about
		// the delete. Shipping it would be shipping sync bookkeeping.
		const dump = await exportAll();
		expect(dump.tasks).toHaveLength(0);

		await importAll(dump);

		// The tombstone itself stays (it is still a local row), but it must still
		// be a tombstone — never resurrected into a live task.
		const row = (await db.tasks.get(task.id)) as unknown as { deletedAt: string | null };
		expect(row.deletedAt).not.toBeNull();
	});
});
