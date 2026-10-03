// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '$lib/db/schema';
import * as repo from '$lib/db/repo';
import { createList, createTask, deleteTask, getTask } from '$lib/db/repo';
import type { Task } from '$lib/db/schema';
import {
	sync,
	push,
	pull,
	enableSync,
	disableSync,
	countPending,
	currentStatus,
	onStatus,
	PUSH_BATCH_SIZE,
	type SyncTransport
} from '$lib/sync/client';
import { getSyncSettings } from '$lib/sync/config';
import type { ChangeOp, ChangeRow } from '@ikoro/sync';

/**
 * A fake transport, so every assertion here is about the client's behaviour and
 * none of it depends on a server, a network or a database.
 *
 * The cases are chosen around the three ways a local-first sync client destroys
 * somebody's data:
 *
 *  1. losing an edit (clearing `dirty` for something the server rejected);
 *  2. creating an echo (writing back rows that did not actually change);
 *  3. resurrecting a deletion (a tombstone losing to a stale live copy).
 */

/**
 * `reject: true` makes the server refuse every op, which leaves the rows dirty —
 * the state a retry happens from, and the state where losing an edit would show
 * up. It is a MODE rather than a method override so that recording still happens.
 */
function fakeTransport(
	options: { reject?: boolean; changes?: ChangeRow[]; hasMore?: boolean } = {}
) {
	const pushed: ChangeOp[][] = [];
	const pulled: number[] = [];

	const transport: SyncTransport = {
		async push(ops) {
			pushed.push(ops);
			return options.reject
				? {
						accepted: [],
						rejected: ops.map((op) => ({ opId: op.id, reason: 'stale' })),
						nextRev: 0
					}
				: {
						accepted: ops.map((op) => ({ opId: op.id, entityId: op.entityId, rev: 1 })),
						rejected: [],
						nextRev: 1
					};
		},
		async pull(since) {
			pulled.push(since);
			return {
				changes: options.changes ?? [],
				nextRev: since + (options.changes?.length ?? 0),
				hasMore: options.hasMore
			};
		}
	};

	return { transport, pushed, pulled };
}

beforeEach(async () => {
	await db.tasks.clear();
	await db.lists.clear();
	await db.meta.clear();
});

describe('enableSync', () => {
	it('marks everything dirty, because the server has never seen it', async () => {
		const list = await createList('Errands');
		await createTask({ listId: list.id, title: 'existing' });

		await enableSync('https://sync.example.com');

		// Without this, the user turns sync on and their existing tasks silently
		// never appear on their other phone — with no error anywhere.
		expect(await countPending()).toBe(2);
	});

	it('normalises the base URL', async () => {
		await enableSync('https://sync.example.com/');
		expect((await getSyncSettings()).baseUrl).toBe('https://sync.example.com');
	});

	it('is a no-op while disabled — sync does nothing until asked', async () => {
		const list = await createList('Errands');
		await createTask({ listId: list.id, title: 'x' });

		const { transport, pushed } = fakeTransport();
		await sync(transport);

		expect(pushed).toHaveLength(0);
		expect(currentStatus().state).toBe('off');
	});
});

describe('push', () => {
	beforeEach(async () => {
		await enableSync('https://sync.example.com');
	});

	it('sends lists BEFORE tasks, so a task never arrives without its list', async () => {
		const list = await createList('Errands');
		await createTask({ listId: list.id, title: 'orphan risk' });

		const { transport, pushed } = fakeTransport();
		await push(transport);

		const kinds = pushed[0].map((op) => op.kind);
		expect(kinds.indexOf('list')).toBeLessThan(kinds.indexOf('task'));
	});

	it('clears dirty only for what the server CONFIRMED', async () => {
		const list = await createList('Errands');
		await createTask({ listId: list.id, title: 'keep' });

		// The server rejects one op — a stale edit, or a validation failure.
		// The server confirms the first op and rejects the rest.
		const { transport } = fakeTransport();
		transport.push = async (ops) => ({
			accepted: ops.slice(0, 1).map((op) => ({ opId: op.id, entityId: op.entityId, rev: 7 })),
			rejected: ops.slice(1).map((op) => ({ opId: op.id, reason: 'stale' })),
			nextRev: 7
		});

		await push(transport);

		// The rejected task is STILL dirty. Clearing it would drop the user's edit
		// silently — the one failure a sync client must never have.
		const rows = await db.tasks.getAll();
		expect(rows[0].dirty).toBe(1);
	});

	it('never sends a device-scoped field', async () => {
		const list = await createList('Errands');
		const task = await createTask({ listId: list.id, title: 'x' });
		await db.tasks.put({
			...((await db.tasks.get(task.id)) as object),
			alarmId: '999',
			rev: 3
		} as never);

		const { transport, pushed } = fakeTransport();
		await push(transport);

		const serialised = JSON.stringify(pushed[0]);
		expect(serialised).not.toContain('alarmId');
		expect(serialised).not.toContain('999');
	});

	it('produces the SAME op id for the same edit — that is what makes retries safe', async () => {
		const list = await createList('Errands');
		await createTask({ listId: list.id, title: 'same' });

		// Reject everything, so the rows stay dirty and the second push has the
		// same work to do — which is exactly the retry scenario that matters.
		const first = fakeTransport({ reject: true });
		await push(first.transport);
		const second = fakeTransport({ reject: true });
		await push(second.transport);

		// A random id per attempt would make the server's idempotency ledger
		// useless: every retry would look like a new operation.
		expect(second.pushed[0][0].id).toBe(first.pushed[0][0].id);
	});

	it('marks a soft-deleted row as a delete, with no payload', async () => {
		const list = await createList('Errands');
		const task = await createTask({ listId: list.id, title: 'gone' });
		await deleteTask(task.id);

		const { transport, pushed } = fakeTransport();
		await push(transport);

		const op = pushed.flat().find((o) => o.entityId === task.id);
		expect(op?.op).toBe('delete');
		expect(op?.payload).toEqual({});
	});

	it('paginates large queues instead of one enormous request', async () => {
		const list = await createList('Errands');
		for (let i = 0; i < PUSH_BATCH_SIZE + 5; i++) {
			await createTask({ listId: list.id, title: `task ${i}` });
		}

		const { transport, pushed } = fakeTransport();
		await push(transport);

		expect(pushed.length).toBe(2);
		expect(pushed[0].length).toBeLessThanOrEqual(PUSH_BATCH_SIZE);
	});
});

describe('pull', () => {
	beforeEach(async () => {
		await enableSync('https://sync.example.com');
	});

	it('applies a remote task', async () => {
		const remote: ChangeRow = {
			kind: 'task',
			entityId: 'remote-1',
			payload: {
				listId: 'l1',
				title: 'From the server',
				notes: null,
				dueDate: null,
				dueTime: null,
				priority: 0,
				alarmAt: null
			},
			updatedAt: '2026-10-05T12:00:00.000Z',
			rev: 3,
			deletedAt: null
		};

		const { transport } = fakeTransport({ changes: [remote] });
		await pull(transport, 0);

		const row = (await db.tasks.get('remote-1')) as unknown as { title: string; dirty: number };
		expect(row.title).toBe('From the server');
		expect(row.dirty).toBe(0);
	});

	it('does NOT resurrect a local deletion with a stale remote copy', async () => {
		const list = await createList('Errands');
		const task = await createTask({ listId: list.id, title: 'deleted here' });
		await deleteTask(task.id);

		// The server has not seen the delete yet and sends the live row back with
		// a NEWER timestamp — which is exactly the case a naive last-writer-wins
		// gets wrong.
		const remote: ChangeRow = {
			kind: 'task',
			entityId: task.id,
			payload: { listId: list.id, title: 'deleted here' },
			updatedAt: '2099-01-01T00:00:00.000Z',
			rev: 9,
			deletedAt: null
		};

		const { transport } = fakeTransport({ changes: [remote] });
		await pull(transport, 0);

		const row = (await getTask(task.id)) as Task;
		expect(row.deletedAt).not.toBeNull();
	});

	it('does not write back a row that did not change — the echo guard', async () => {
		const list = await createList('Errands');
		const task = await createTask({ listId: list.id, title: 'unchanged' });
		const before = (await getTask(task.id)) as { updatedAt: string };

		const remote: ChangeRow = {
			kind: 'task',
			entityId: task.id,
			payload: { listId: list.id, title: 'unchanged' },
			updatedAt: before.updatedAt,
			rev: 2,
			deletedAt: null
		};

		const { transport } = fakeTransport({ changes: [remote] });
		await pull(transport, 0);

		// Identical data. Writing it would bump updatedAt and set dirty, and the
		// next push would send it straight back — forever.
		const after = (await getTask(task.id)) as { updatedAt: string; dirty: number };
		expect(after.updatedAt).toBe(before.updatedAt);
		expect(after.dirty).toBe(0);
	});

	it('persists the cursor after every page, so a long pull can resume', async () => {
		let call = 0;
		const { transport } = fakeTransport();
		transport.pull = async (_since: number) => {
			call++;
			return call === 1
				? { changes: [], nextRev: 10, hasMore: true }
				: { changes: [], nextRev: 20 };
		};

		await pull(transport, 0);

		expect(await repo.getMeta<number>('syncCursor')).toBe(20);
	});
});

describe('sync', () => {
	it('reports an error in words, and keeps the queue', async () => {
		await enableSync('https://sync.example.com');
		const list = await createList('Errands');
		await createTask({ listId: list.id, title: 'stuck' });

		const { transport } = fakeTransport();
		transport.push = async () => {
			throw new Error('Network unreachable');
		};

		const statuses: string[] = [];
		const stop = onStatus((s) => statuses.push(s.state));

		const result = await sync(transport);
		stop();

		expect(result.state).toBe('error');
		expect(result.error).toBe('Network unreachable');
		// Nothing was lost: the rows are still dirty and will be retried.
		expect(await countPending()).toBe(2);
		expect(statuses).toContain('error');
	});

	it('runs at most one cycle at a time', async () => {
		await enableSync('https://sync.example.com');
		const list = await createList('Errands');
		await createTask({ listId: list.id, title: 'x' });

		let concurrent = 0;
		let maxConcurrent = 0;
		const { transport } = fakeTransport();
		transport.push = async (_ops: ChangeOp[]) => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await new Promise((r) => setTimeout(r, 5));
			concurrent--;
			return { accepted: [], rejected: [], nextRev: 0 };
		};

		await Promise.all([sync(transport), sync(transport), sync(transport)]);

		// Two overlapping cycles push the same ops twice; with deterministic op ids
		// the server dedupes, but there is no reason to make it do the work.
		expect(maxConcurrent).toBe(1);
	});

	it('disabling stops everything immediately', async () => {
		await enableSync('https://sync.example.com');
		await disableSync();

		const { transport, pushed } = fakeTransport();
		await sync(transport);

		expect(pushed).toHaveLength(0);
		expect(currentStatus().state).toBe('off');
	});

	it('notifies subscribers', async () => {
		await enableSync('https://sync.example.com');
		const seen: string[] = [];
		const stop = onStatus((s) => seen.push(s.state));

		await sync(fakeTransport().transport);
		stop();

		expect(seen.length).toBeGreaterThan(1);
	});
});

describe('boundary', () => {
	it('the only module that fetches is transport.ts', async () => {
		const fs = await import('node:fs/promises');
		const files = await fs.readdir('src/lib/sync');
		const offenders: string[] = [];

		for (const file of files) {
			if (!file.endsWith('.ts')) continue;
			const source = await fs.readFile(`src/lib/sync/${file}`, 'utf8');
			if (/\bfetch\(/.test(source) && !file.startsWith('transport')) offenders.push(file);
		}

		// Everything above the transport takes a SyncTransport and does not know
		// the network exists — which is what makes every sync behaviour testable
		// with a fake and no fetch.
		expect(offenders).toEqual([]);
	});
});
