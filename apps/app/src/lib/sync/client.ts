/**
 * The sync client -- the only part of the app that talks to `/api/v1`.
 *
 * The queue IS the `dirty` flag: svelte-idb has no transactions, so an outbox row written beside a change can be lost. Never push unthrottled.
 */

import * as repo from '$lib/db/repo';
import { db, type Task, type TaskList } from '$lib/db/schema';
import { mergeChanges, WIRE_VERSION, type ChangeOp, type ChangeRow } from '@ikoro/sync';
import { getSyncSettings, setSyncSettings } from './config';

/** Ops per push -- small so a retry stays cheap. */
export const PUSH_BATCH_SIZE = 50;

/** How many rows one pull page returns. */
export const PULL_PAGE_SIZE = 200;

export type SyncState = 'off' | 'idle' | 'pushing' | 'pulling' | 'error';

export interface SyncStatus {
	state: SyncState;
	/** Set on `error` -- showable to the user. */
	error: string | null;
	pending: number;
	lastSyncedAt: string | null;
	/** The cursor the next pull resumes from. */
	cursor: number;
}

/** One store's worth of dirty rows. Lists always precede tasks. */
export type SyncQueue = { kind: 'list' | 'task'; rows: (TaskList | Task)[] }[];

/** Injected so tests can fake it. */
export interface SyncTransport {
	push(ops: ChangeOp[]): Promise<{
		accepted: { opId: string; entityId: string; rev: number }[];
		rejected: { opId: string; reason: string }[];
		nextRev: number;
	}>;
	pull(since: number): Promise<{ changes: ChangeRow[]; nextRev: number; hasMore?: boolean }>;
	/** Subscribe to live updates. Returns an unsubscribe function. */
	subscribe?(onEvent: () => void): () => void;
}

type Listener = (status: SyncStatus) => void;

const listeners = new Set<Listener>();
let status: SyncStatus = {
	state: 'off',
	error: null,
	pending: 0,
	lastSyncedAt: null,
	cursor: 0
};

/** Guards against concurrent cycles — two pushes racing is how duplicates happen. */
let inFlight: Promise<SyncStatus> | null = null;

function publish(next: Partial<SyncStatus>): SyncStatus {
	status = { ...status, ...next };
	for (const listener of listeners) listener(status);
	return status;
}

export function onStatus(listener: Listener): () => void {
	listeners.add(listener);
	listener(status);
	return () => listeners.delete(listener);
}

export function currentStatus(): SyncStatus {
	return status;
}

/**
 * Everything marked for pushing, in a stable order -- the `byDirty` index IS the queue.
 */
export async function pendingRows(): Promise<SyncQueue> {
	const [lists, tasks] = await Promise.all([
		db.lists.where('byDirty').equals(1).toArray(),
		db.tasks.where('byDirty').equals(1).toArray()
	]);

	const queue: SyncQueue = [];
	// Lists first: before its list lands, a task is an orphan the server accepts and the client cannot render.
	if (lists.length) queue.push({ kind: 'list', rows: lists as unknown as TaskList[] });
	if (tasks.length) queue.push({ kind: 'task', rows: tasks as unknown as Task[] });
	return queue;
}

function toOp(kind: 'list' | 'task', row: TaskList | Task): ChangeOp {
	const record = row as Task & TaskList;
	const deleted = record.deletedAt !== null;

	return {
		// Deterministic so a retry reuses the same op id -- that is what makes the server idempotent.
		id: `${kind}:${record.id}:${record.updatedAt}`,
		kind,
		entityId: record.id,
		op: deleted ? 'delete' : 'upsert',
		// Device-scoped fields never travel.
		payload: deleted
			? {}
			: kind === 'list'
				? { name: record.name, sortOrder: record.sortOrder }
				: {
						listId: record.listId,
						title: record.title,
						notes: record.notes,
						dueDate: record.dueDate,
						dueTime: record.dueTime,
						priority: record.priority,
						alarmAt: record.alarmAt
					},
		updatedAt: record.updatedAt
	};
}

/**
 * Push everything dirty, then pull everything new -- idempotent, safe on an interval, on resume or on demand.
 */
export function sync(transport: SyncTransport): Promise<SyncStatus> {
	if (inFlight) return inFlight;

	inFlight = (async (): Promise<SyncStatus> => {
		const settings = await getSyncSettings();
		if (!settings.enabled || !settings.baseUrl) {
			return publish({ state: 'off', pending: 0 });
		}

		try {
			await push(transport);
			// Cursor is written after every page, so a half-dead pull resumes.
			await pull(transport, (await repo.getMeta<number>('syncCursor')) ?? 0);
			await repo.setMeta('lastSyncedAt', new Date().toISOString());

			return publish({
				state: 'idle',
				error: null,
				pending: await countPending(),
				lastSyncedAt: await repo.getMeta<string>('lastSyncedAt')
			});
		} catch (error) {
			// Nothing is lost: rows stay dirty and the cursor stays put for the next attempt.
			return publish({
				state: 'error',
				error: error instanceof Error ? error.message : 'Sync failed.',
				pending: await countPending()
			});
		}
	})().finally(() => {
		inFlight = null;
	});

	return inFlight;
}

export async function countPending(): Promise<number> {
	const groups = await pendingRows();
	return groups.reduce((total, group) => total + group.rows.length, 0);
}

/** Push one batch -- lists before tasks, in pages of `PUSH_BATCH_SIZE`; replays are recognised by op id. */
export async function push(transport: SyncTransport): Promise<number> {
	const groups = await pendingRows();
	const ops = groups.flatMap((group) => group.rows.map((row) => toOp(group.kind, row)));
	if (ops.length === 0) return 0;

	let accepted = 0;

	for (let i = 0; i < ops.length; i += PUSH_BATCH_SIZE) {
		const batch = ops.slice(i, i + PUSH_BATCH_SIZE);
		publish({ state: 'pushing', pending: ops.length - i });

		const result = await transport.push(batch);
		accepted += result.accepted.length;

		// Only confirmed ops are cleared; a rejected op stays dirty and is retried.
		for (const row of result.accepted) {
			await clearDirty(row.entityId, row.rev);
		}
	}

	return accepted;
}

async function clearDirty(entityId: string, rev: number): Promise<void> {
	for (const store of [db.lists, db.tasks]) {
		const row = await store.get(entityId);
		if (!row) continue;
		await store.put({
			...(row as Record<string, unknown>),
			dirty: 0,
			rev
		} as Record<string, unknown>);
	}
}

/** Pull everything after `cursor` and merge it into the store. */
export async function pull(transport: SyncTransport, since: number): Promise<number> {
	let cursor = since;
	let applied = 0;

	for (;;) {
		publish({ state: 'pulling' });
		const page = await transport.pull(cursor);

		applied += await applyChanges(page.changes);
		cursor = page.nextRev;

		// Persist per page so a half-dead pull resumes instead of re-downloading.
		await repo.setMeta('syncCursor', cursor);

		if (!page.hasMore) break;
	}

	return applied;
}

/**
 * Merge server rows into the local store -- only rows that actually differ, compared as {id, updatedAt, deletedAt, payload}, or the echo never ends.
 */
interface SyncRow {
	id: string;
	updatedAt: string;
	deletedAt: string | null;
	payload: unknown;
}

export async function applyChanges(changes: ChangeRow[]): Promise<number> {
	if (changes.length === 0) return 0;

	let written = 0;

	// Lists first: a task pointing at a missing list renders as nothing.
	for (const kind of ['list', 'task'] as const) {
		const incoming = changes.filter((change) => change.kind === kind);
		if (incoming.length === 0) continue;

		const store = kind === 'list' ? db.lists : db.tasks;
		const localRows = (await store.getAll()) as unknown as Record<string, unknown>[];

		const remote: SyncRow[] = incoming.map((change) => ({
			id: change.entityId,
			updatedAt: change.updatedAt,
			deletedAt: change.deletedAt,
			payload: change.payload
		}));

		const local = localRows.map((row) => ({
			id: String(row.id),
			updatedAt: String(row.updatedAt),
			deletedAt: (row.deletedAt as string | null) ?? null,
			payload: syncableFields(row)
		}));

		for (const row of mergeChanges(local, remote, (r) => r.id)) {
			const previous = localRows.find((candidate) => candidate.id === row.id) ?? {};

			await store.put({
				// Start from the local record so device-scoped fields survive.
				...previous,
				...(row.payload as Record<string, unknown>),
				id: row.id,
				updatedAt: row.updatedAt,
				deletedAt: row.deletedAt,
				// Came from the server, so not pending.
				dirty: 0
			} as Record<string, unknown>);
			written++;
		}
	}

	return written;
}

/** The fields that travel, projected for comparison. */
function syncableFields(row: Record<string, unknown>): unknown {
	const { listId, title, notes, dueDate, dueTime, priority, alarmAt, name, sortOrder } =
		row as Record<string, unknown>;

	// `undefined` for absent keys keeps the projection stable, so comparison means something.
	return {
		listId: listId ?? undefined,
		title: title ?? undefined,
		notes: notes ?? null,
		dueDate: dueDate ?? null,
		dueTime: dueTime ?? null,
		priority: priority ?? 0,
		alarmAt: alarmAt ?? null,
		name: name ?? undefined,
		sortOrder: sortOrder ?? 0
	};
}

/**
 * Turn sync on for the first time -- mark everything dirty, or existing tasks never reach the server and nothing reports an error.
 */
export async function enableSync(baseUrl: string): Promise<void> {
	await repo.markAllDirty();
	await setSyncSettings({ enabled: true, baseUrl: baseUrl.replace(/\/+$/, '') });
	await repo.setMeta('syncCursor', 0);
}

export async function disableSync(): Promise<void> {
	await setSyncSettings({ enabled: false, baseUrl: '' });
	publish({ state: 'off', pending: 0, error: null });
}

export { WIRE_VERSION };
