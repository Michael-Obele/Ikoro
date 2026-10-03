/**
 * Every read and write the app performs.
 *
 * This is the ONLY module that imports `svelte-idb`. That is not tidiness — it is
 * the seam that makes the storage layer replaceable. Two facts about the library
 * force the shape of everything below:
 *
 *   1. **There is no transaction API.** So every mutation writes exactly one
 *      record, cascading deletes run sequentially and idempotently, and deletes
 *      are SOFT. Two writes are two operations; designing as if they were one is
 *      how a local-first app loses data.
 *   2. **`dirty` IS the sync queue.** Setting it in the same `put()` that changes
 *      a row costs no second write and no atomicity — see `docs/design/decisions.md`.
 *
 * Nothing here decides what a screen should show, and nothing here touches a
 * notification API: `toggleTask` deliberately leaves `alarmAt` alone, because
 * cancelling the platform alarm belongs to M4's scheduler, not to storage.
 */
import { db, type MetaRow, type Priority, type Task, type TaskInput, type TaskList } from './schema';
import { newId, nowIso } from '$lib/utils/id';

/**
 * How far back `todayOpenTasks` will reach.
 *
 * A year is long enough that "I wrote this down last year and it is still open"
 * never silently vanishes from the only screen meant to catch you up, and short
 * enough that the list stays readable. Named because M3's overdue group needs to
 * reference the exact same number.
 */
export const PAST_WINDOW_DAYS = 365;

// ── internals ────────────────────────────────────────────────────────────────

/**
 * The single place tombstones are filtered.
 *
 * A forgotten `deletedAt === null` at one call site means a deleted task
 * reappears, so reads funnel through here instead of repeating the predicate.
 */
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
        // A dated task with no time sorts after one that has a time on the same
        // day — "sometime on the 4th" is less urgent than "at 09:00 on the 4th".
        if (a.dueTime === b.dueTime) return a.sortOrder - b.sortOrder;
        if (a.dueTime === null) return 1;
        if (b.dueTime === null) return -1;
        return a.dueTime.localeCompare(b.dueTime);
}

// ── lists ────────────────────────────────────────────────────────────────────

/**
 * `add()`, not `put()`: a colliding id becomes a loud constraint error instead of
 * silently overwriting a list the user already has.
 */
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
        await db.lists.put({ ...current, name, updatedAt: nowIso(), dirty: 1 } as unknown as Record<string, unknown>);
}

/**
 * Soft-delete the list, then each of its tasks — sequentially and idempotently,
 * NOT transactionally, because svelte-idb has no transaction API.
 *
 * If this is interrupted the worst case is a list whose tasks are already gone:
 * visible, and re-running finishes it. The alternative — pretending two writes
 * are atomic — is a half-applied delete that looks like data loss.
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
                if (task.deletedAt) continue; // already tombstoned — keep it idempotent
                await db.tasks.put({ ...task, deletedAt: nowIso(), updatedAt: nowIso(), dirty: 1 } as unknown as Record<string, unknown>);
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

/**
 * The array index becomes the new `sortOrder`.
 *
 * One `put()` per record, in order — not atomic, but idempotent: re-running
 * writes the same orders, so a drag that lands twice costs nothing.
 */
export async function reorderLists(ids: string[]): Promise<void> {
        const ts = nowIso();
        for (const [index, id] of ids.entries()) {
                const current = await db.lists.get(id);
                if (!current) continue;
                await db.lists.put({ ...asList(current), sortOrder: index, updatedAt: ts, dirty: 1 } as unknown as Record<string, unknown>);
        }
}

// ── tasks ────────────────────────────────────────────────────────────────────

/** `add()`, not `put()` — see `createList`. A duplicate id must throw. */
export async function createTask(input: TaskInput): Promise<Task> {
        const ts = nowIso();
        const task: Task = {
                id: input.id ?? newId(),
                listId: input.listId,
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
                sortOrder: input.sortOrder ?? (await db.tasks.where('byList').equals(input.listId).count()),
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

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
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
 * Flip completion.
 *
 * Deliberately does NOT touch `alarmAt`: cancelling the platform notification is
 * M4's scheduler's job. Keeping the two apart means a storage-level toggle in a
 * test never silently disarms an alarm on a real device, and vice versa.
 */
export async function toggleTask(id: string): Promise<void> {
        const current = await db.tasks.get(id);
        if (!current) return;
        const task = asTask(current);
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
}

export async function tasksByList(listId: string): Promise<Task[]> {
        const rows = await db.tasks.where('byList').equals(listId).toArray();
        return alive(rows.map(asTask)).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Open work dated today or earlier, most overdue first.
 *
 * The `byDue` index only contains rows whose `dueDate` is non-null — IndexedDB
 * omits records from an index when the key path resolves to `null`. That is why
 * undated tasks can never leak in here: they are not in the index to begin with,
 * which is cheaper and more correct than filtering for them afterwards.
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
        return alive(rows.map(asTask)).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

export async function getAllTasks(): Promise<Task[]> {
        return alive((await db.tasks.getAll()).map(asTask));
}

// ── sync plumbing (consumed from M11; defined now so nothing migrates later) ──

/** The whole database is about to become "needs pushing". Called when sync is first enabled. */
export async function markAllDirty(): Promise<void> {
        const ts = nowIso();
        for (const store of [db.lists, db.tasks]) {
                for (const row of await store.getAll()) {
                        await store.put({ ...row, updatedAt: row.updatedAt ?? ts, dirty: 1 } as unknown as Record<string, unknown>);
                }
        }
}

/**
 * The ONLY hard delete in the app.
 *
 * Tombstones cannot be discarded casually: an M11 peer that has not yet pulled the
 * delete would resurrect the row on the next sync. So purging is an explicit
 * maintenance action — M7's "forget deleted tasks" and M11's post-ack cleanup.
 * Returns how many rows went away.
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