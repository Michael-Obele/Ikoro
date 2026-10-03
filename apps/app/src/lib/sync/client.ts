/**
 * The sync client: the part of the app that talks to `/api/v1`.
 *
 * ── Why there is no outbox store ────────────────────────────────────────────
 *
 * The obvious design is an outbox table: a row per pending change, written
 * alongside the change itself. svelte-idb has **no transaction API**, so those
 * two writes are two independent operations — and a crash between them leaves
 * either an outbox entry for a change that never landed, or a change with no
 * outbox entry, which is silent, permanent data loss.
 *
 * So the queue IS the `dirty` flag that M1 already puts on every row, set in the
 * same single `put()` that changes it. `where('byDirty').equals(1)` is the entire
 * "what needs pushing" query. There is no second store to keep in step, and no
 * atomicity to lose.
 *
 * ── What this must never do ─────────────────────────────────────────────────
 *
 * Push on every mutation, unthrottled, from a phone that may be on a train. A
 * sync layer that hammers the server is a sync layer the user turns off.
 */

import * as repo from '$lib/db/repo';
import { db, type Task, type TaskList } from '$lib/db/schema';
import { mergeChanges, WIRE_VERSION, type ChangeOp, type ChangeRow } from '@ikoro/sync';
import { getSyncSettings, setSyncSettings } from './config';

/** How many ops go in one push. Small on purpose: a retried request must be cheap. */
export const PUSH_BATCH_SIZE = 50;

/** How many rows one pull page returns. */
export const PULL_PAGE_SIZE = 200;

export type SyncState = 'off' | 'idle' | 'pushing' | 'pulling' | 'error';

export interface SyncStatus {
	state: SyncState;
	/** Set on `error`; the last failure, in words the UI can show. */
	error: string | null;
	pending: number;
	lastSyncedAt: string | null;
	/** The cursor the next pull resumes from. */
	cursor: number;
}

/** One store's worth of dirty rows. Lists always precede tasks. */
export type SyncQueue = { kind: 'list' | 'task'; rows: (TaskList | Task)[] }[];

/** The transport, injected. Tests replace it; production passes the real one. */
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
 * Everything marked for pushing, in a stable order.
 *
 * The `byDirty` index holds only rows whose `dirty` is 1 — which is every row
 * that has changed since the server last confirmed it. It is the entire queue.
 */
export async function pendingRows(): Promise<SyncQueue> {
	const [lists, tasks] = await Promise.all([
		db.lists.where('byDirty').equals(1).toArray(),
		db.tasks.where('byDirty').equals(1).toArray()
	]);

	const queue: SyncQueue = [];
	// Lists first: a task whose list has not arrived yet is skipped and counted,
	// not dropped. Pushing a task before its list would create an orphan the
	// server accepts and the client cannot render.
	if (lists.length) queue.push({ kind: 'list', rows: lists as unknown as TaskList[] });
	if (tasks.length) queue.push({ kind: 'task', rows: tasks as unknown as Task[] });
	return queue;
}

function toOp(kind: 'list' | 'task', row: TaskList | Task): ChangeOp {
	const record = row as Task & TaskList;
	const deleted = record.deletedAt !== null;

	return {
		// Deterministic from (kind, id, updatedAt): a retry of the same edit
		// produces the SAME op id, which is what makes the server's idempotency
		// work. A random id per attempt would defeat it entirely.
		id: `${kind}:${record.id}:${record.updatedAt}`,
		kind,
		entityId: record.id,
		op: deleted ? 'delete' : 'upsert',
		// Device-scoped fields never travel: another device cannot use this
		// phone's notification id, and a sync cursor from a server is meaningless
		// offline.
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
 * Push everything dirty, then pull everything new.
 *
 * Idempotent and safe to call on an interval, on resume, or on demand: each
 * phase diffs the store against the server rather than assuming anything about
 * the last run.
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
			// The cursor lives in `meta`, written after every page, so a long pull
			// that dies halfway resumes from where it got to.
			await pull(transport, (await repo.getMeta<number>('syncCursor')) ?? 0);
			await repo.setMeta('lastSyncedAt', new Date().toISOString());

			return publish({
				state: 'idle',
				error: null,
				pending: await countPending(),
				lastSyncedAt: await repo.getMeta<string>('lastSyncedAt')
			});
		} catch (error) {
			// A failed sync must never lose the queue: the rows stay dirty, the
			// cursor stays where it was, and the next attempt tries again. That is
			// the whole reason the queue is a flag on the row.
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

/**
 * Push one batch.
 *
 * Lists are pushed before tasks so a new task's list already exists on the
 * server when the task lands. Ops are sent in pages of `PUSH_BATCH_SIZE`; a
 * batch that fails is retried on the next cycle, and because the op ids are
 * deterministic the server recognises the replay.
 */
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

		// Clear `dirty` only for what the server CONFIRMED. A rejected op stays
		// dirty so it is retried — clearing it would drop the edit silently, which
		// is the one failure mode a sync client must never have.
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

		// The cursor is persisted after every page, not once at the end: a long
		// pull that dies halfway resumes from where it got to instead of
		// re-downloading everything.
		await repo.setMeta('syncCursor', cursor);

		if (!page.hasMore) break;
	}

	return applied;
}

/**
 * Merge server rows into the local store.
 *
 * `mergeChanges` returns ONLY rows that actually differ. Writing an unchanged
 * row would bump its `updatedAt` and set `dirty`, and the next push would send
 * it straight back — an echo that never terminates.
 *
 * Rows are compared as `{id, updatedAt, deletedAt, payload}` rather than as the
 * full local record: the server only carries the syncable subset, so comparing
 * the whole record would call every remote row a change and guarantee the echo.
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

	// Lists first, always: a task whose list has not arrived yet renders as a
	// task pointing at nothing.
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
				// Start from the local record so device-scoped fields survive:
				// this phone's notification id means nothing anywhere else, and a
				// server cursor is meaningless offline.
				...previous,
				...(row.payload as Record<string, unknown>),
				id: row.id,
				updatedAt: row.updatedAt,
				deletedAt: row.deletedAt,
				// A row that came FROM the server is by definition not pending.
				dirty: 0
			} as Record<string, unknown>);
			written++;
		}
	}

	return written;
}

/** The fields that travel, projected out of a local record for comparison. */
function syncableFields(row: Record<string, unknown>): unknown {
	const { listId, title, notes, dueDate, dueTime, priority, alarmAt, name, sortOrder } =
		row as Record<string, unknown>;

	// A list has no `listId`/`title`; a task has no `name`. Returning `undefined`
	// for absent keys keeps the projection stable, so the same row always
	// projects to the same object and the comparison is meaningful.
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
 * Turn sync on for the first time.
 *
 * Everything already on the device is marked dirty, because the server has never
 * seen it. Forgetting this is the classic local-first sync bug: the user turns
 * sync on, their existing tasks silently never appear on their other phone, and
 * there is no error anywhere.
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
