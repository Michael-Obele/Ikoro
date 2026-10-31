/**
 * Every read and write the app performs -- the only module that imports `svelte-idb`.
 *
 * No transactions: one record per write, cascades sequential and idempotent, deletes soft, `dirty` is the queue.
 */
import {
	db,
	type MetaRow,
	type Priority,
	type Task,
	type TaskInput,
	type TaskList
} from './schema';
import { newId, nowIso } from '$lib/utils/id';

/** How far back `todayOpenTasks` reaches; the overdue group uses the same number. */
export const PAST_WINDOW_DAYS = 365;

// ── internals ────────────────────────────────────────────────────────────────

/** The one place tombstones are filtered -- a forgotten check resurrects deleted tasks. */
function alive<T extends { deletedAt: string | null }>(rows: T[]): T[] {
	return rows.filter((r) => r.deletedAt === null);
}

const asTask = (r: Record<string, unknown>) => r as unknown as Task;
const asList = (r: Record<string, unknown>) => r as unknown as TaskList;

/** Local-time `YYYY-MM-DD`. `dueDate` is a calendar day, never an instant. */
function localDay(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function shiftDays(d: Date, days: number): Date {
	const copy = new Date(d);
	copy.setDate(copy.getDate() + days);
	return copy;
}

/** Today's open work, most overdue first. Shared with M3's Today view. */
function byUrgency(a: Task, b: Task): number {
	const byDate = (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
	if (byDate !== 0) return byDate;
	// No time sorts after a set time on the same day.
	if (a.dueTime === b.dueTime) return a.sortOrder - b.sortOrder;
	if (a.dueTime === null) return 1;
	if (b.dueTime === null) return -1;
	return a.dueTime.localeCompare(b.dueTime);
}

// ── lists ────────────────────────────────────────────────────────────────────

/** `add()` not `put()`: a colliding id must throw, not overwrite an existing list. */
export async function createList(name: string): Promise<TaskList> {
	const ts = nowIso();
	const list: TaskList = {
		id: newId(),
		name,
		sortOrder: await db.lists.count(),
		createdAt: ts,
		updatedAt: ts,
		deletedAt: null,
		rev: null,
		dirty: 1
	};
	await db.lists.add(list as unknown as Record<string, unknown>);
	return list;
}

export async function renameList(id: string, name: string): Promise<void> {
	const current = asList((await db.lists.get(id)) ?? {});
	if (!current.id) return;
	await db.lists.put({ ...current, name, updatedAt: nowIso(), dirty: 1 } as unknown as Record<
		string,
		unknown
	>);
}

/**
 * Soft-delete the list, then its tasks -- sequential and idempotent, so re-running finishes an interrupted delete.
 */
export async function deleteList(id: string): Promise<void> {
	await db.lists.put({
		...asList((await db.lists.get(id)) ?? { id }),
		deletedAt: nowIso(),
		updatedAt: nowIso(),
		dirty: 1
	} as unknown as Record<string, unknown>);

	const tasks = await db.tasks.where('byList').equals(id).toArray();
	for (const row of tasks) {
		const task = asTask(row);
		if (task.deletedAt) continue; // keep idempotent
		await db.tasks.put({
			...task,
			deletedAt: nowIso(),
			updatedAt: nowIso(),
			dirty: 1
		} as unknown as Record<string, unknown>);
	}
}

export async function getLists(): Promise<TaskList[]> {
	const rows = await db.lists.where('bySortOrder').toArray();
	return alive(rows.map(asList));
}

export async function getTaskListById(id: string): Promise<TaskList | undefined> {
	const row = await db.lists.get(id);
	if (!row) return undefined;
	const list = asList(row);
	return list.deletedAt === null ? list : undefined;
}

/** Array index becomes the new `sortOrder` -- one put per record, idempotent. */
export async function reorderLists(ids: string[]): Promise<void> {
	const ts = nowIso();
	for (const [index, id] of ids.entries()) {
		const current = await db.lists.get(id);
		if (!current) continue;
		await db.lists.put({
			...asList(current),
			sortOrder: index,
			updatedAt: ts,
			dirty: 1
		} as unknown as Record<string, unknown>);
	}
}

// ── tasks ────────────────────────────────────────────────────────────────────

/**
 * `add()` not `put()` -- a duplicate id must throw.
 *
 * Subtasks are one level deep and live in the parent's list, enforced here and not only in the UI.
 */
export async function createTask(input: TaskInput): Promise<Task> {
	let listId = input.listId;
	if (input.parentId) {
		const parent = await getTask(input.parentId);
		if (!parent || parent.deletedAt !== null) {
			throw new Error('The task this subtask belongs to no longer exists');
		}
		if (parent.parentId !== null) {
			throw new Error('Subtasks can only be one level deep');
		}
		listId = parent.listId;
	}
	const ts = nowIso();
	const task: Task = {
		id: input.id ?? newId(),
		listId,
		title: input.title,
		notes: input.notes ?? null,
		dueDate: input.dueDate ?? null,
		dueTime: input.dueTime ?? null,
		priority: input.priority ?? 0,
		parentId: input.parentId ?? null,
		repeat: input.repeat ?? null,
		completedAt: null,
		alarmAt: input.alarmAt ?? null,
		alarmId: null,
		alarmFiredAt: null,
		color: input.color ?? null,
		ringtone: input.ringtone ?? null,
		sortOrder:
			input.sortOrder ??
			(input.parentId
				? // Siblings compete only with each other: dense 0,1,2… from the parent's child count.
					await db.tasks.where('byParent').equals(input.parentId).count()
				: await db.tasks.where('byList').equals(listId).count()),
		createdAt: ts,
		updatedAt: ts,
		deletedAt: null,
		rev: null,
		dirty: 1
	};
	await db.tasks.add(task as unknown as Record<string, unknown>);
	return task;
}

export async function getTask(id: string): Promise<Task | undefined> {
	const row = await db.tasks.get(id);
	return row ? asTask(row) : undefined;
}

/**
 * Every `updateTask` runs through one queue -- with no transactions, overlapping read→merge→write pairs reinstate stale fields.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function updateTask(id: string, patch: Partial<Task>): Promise<void> {
	const run = writeQueue.then(
		() => writeTask(id, patch),
		() => writeTask(id, patch)
	);
	// Keep the chain alive after a failed write.
	writeQueue = run.catch(() => {});
	return run;
}

async function writeTask(id: string, patch: Partial<Task>): Promise<void> {
	const current = await db.tasks.get(id);
	if (!current) return;
	await db.tasks.put({
		...asTask(current),
		...patch,
		id,
		updatedAt: nowIso(),
		dirty: 1
	} as unknown as Record<string, unknown>);
}

/**
 * Flip completion -- never touches `alarmAt`; disarming is the scheduler's job.
 *
 * A parent with open subtasks cannot be completed; the message is the UI contract.
 */
export async function toggleTask(id: string): Promise<void> {
	const current = await db.tasks.get(id);
	if (!current) return;
	const task = asTask(current);
	if (task.completedAt === null && task.parentId === null && (await hasOpenSubtasks(id))) {
		throw new Error('Complete its subtasks first');
	}
	await db.tasks.put({
		...task,
		completedAt: task.completedAt ? null : nowIso(),
		updatedAt: nowIso(),
		dirty: 1
	} as unknown as Record<string, unknown>);
}

/** Soft delete. The row survives so a sync can still see (and push) the tombstone. */
export async function deleteTask(id: string): Promise<void> {
	const current = await db.tasks.get(id);
	if (!current) return;
	await db.tasks.put({
		...asTask(current),
		deletedAt: nowIso(),
		updatedAt: nowIso(),
		dirty: 1
	} as unknown as Record<string, unknown>);

	// Cascade like `deleteList`: sequential and idempotent; one level, so one pass is the whole cascade.
	const children = await db.tasks.where('byParent').equals(id).toArray();
	for (const row of children) {
		const child = asTask(row);
		if (child.deletedAt) continue; // keep idempotent
		await db.tasks.put({
			...child,
			deletedAt: nowIso(),
			updatedAt: nowIso(),
			dirty: 1
		} as unknown as Record<string, unknown>);
	}
}

// ── subtasks ─────────────────────────────────────────────────────────────────

/** A parent's living subtasks, oldest first -- read via the `byParent` index. */
export async function subtasksOf(parentId: string): Promise<Task[]> {
	const rows = await db.tasks.where('byParent').equals(parentId).toArray();
	return alive(rows.map(asTask)).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Whether any subtask of `id` is still open -- the gate behind `toggleTask`'s parent rule. */
export async function hasOpenSubtasks(id: string): Promise<boolean> {
	const children = await db.tasks.where('byParent').equals(id).toArray();
	return alive(children.map(asTask)).some((t) => t.completedAt === null);
}

export async function tasksByList(listId: string): Promise<Task[]> {
	const rows = await db.tasks.where('byList').equals(listId).toArray();
	return alive(rows.map(asTask)).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Open work dated today or earlier, most overdue first.
 *
 * `byDue` omits null keys, so undated tasks are never in this index to begin with.
 */
export async function todayOpenTasks(now: Date = new Date()): Promise<Task[]> {
	const today = localDay(now);
	const rows = await db.tasks.where('byDue').belowOrEqual(today).toArray();
	const floor = localDay(shiftDays(now, -PAST_WINDOW_DAYS));
	return alive(rows.map(asTask))
		.filter((t) => t.completedAt === null && (t.dueDate ?? '') >= floor)
		.sort(byUrgency);
}

export async function upcomingTasks(from: Date, to: Date): Promise<Task[]> {
	const rows = await db.tasks.where('byDue').between(localDay(from), localDay(to)).toArray();
	return alive(rows.map(asTask))
		.filter((t) => t.completedAt === null)
		.sort(byUrgency);
}

export async function doneTasks(): Promise<Task[]> {
	// `byCompleted` holds completed rows only, so there is nothing to filter out.
	const rows = await db.tasks.getAllFromIndex('byCompleted');
	return alive(rows.map(asTask)).sort((a, b) =>
		(b.completedAt ?? '').localeCompare(a.completedAt ?? '')
	);
}

export async function getAllTasks(): Promise<Task[]> {
	return alive((await db.tasks.getAll()).map(asTask));
}

// ── sync plumbing (M11 consumes these) ──

/** The whole database is about to become "needs pushing". Called when sync is first enabled. */
export async function markAllDirty(): Promise<void> {
	const ts = nowIso();
	for (const store of [db.lists, db.tasks]) {
		for (const row of await store.getAll()) {
			await store.put({ ...row, updatedAt: row.updatedAt ?? ts, dirty: 1 } as unknown as Record<
				string,
				unknown
			>);
		}
	}
}

/**
 * The ONLY hard delete in the app -- drop a tombstone too early and an unsynced peer resurrects the row.
 */
export async function purgeDeleted(): Promise<number> {
	let removed = 0;
	for (const store of [db.lists, db.tasks]) {
		for (const row of await store.getAll()) {
			if ((row.deletedAt as string | null) === null) continue;
			await store.delete(row.id as string);
			removed++;
		}
	}
	return removed;
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
	const row = await db.meta.get(key);
	return row ? (row.value as T) : undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
	const row: MetaRow = { key, value, updatedAt: nowIso() };
	await db.meta.put(row as unknown as Record<string, unknown>);
}

export async function deleteMeta(key: string): Promise<void> {
	await db.meta.delete(key);
}

export type { Task, TaskList, TaskInput, Priority, MetaRow };
