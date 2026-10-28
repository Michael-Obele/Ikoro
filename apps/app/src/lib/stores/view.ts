/**
 * The app's reactive read models — the ONLY place `liveAll()` is called.
 *
 * svelte-idb's reactivity covers `liveAll()`, `liveGet(key)` and `liveCount()`;
 * indexed queries (`where(...)`) are core-only and not reactive upstream. So a
 * filtered screen subscribes to the whole store and narrows in plain code with
 * `$derived`. That is O(n) per mutation — fine into the low thousands of tasks,
 * and it is the honest ceiling of this approach.
 *
 * Both subscriptions live at module scope, for the app's lifetime. A `liveAll()`
 * created inside a component would open a new IndexedDB cursor on every mount and
 * leak it on unmount; hoisting them here means one subscription per store no
 * matter how the routes change.
 */
import { db, type Task, type TaskList } from '$lib/db/schema';

export const listsQuery = db.lists.liveAll();
export const tasksQuery = db.tasks.liveAll();

const OPEN = (t: Task) => t.deletedAt === null && t.completedAt === null;

/** Live lists, tombstones removed, in the user's own order. */
export function liveLists(): TaskList[] {
	return (listsQuery.current as unknown as TaskList[])
		.filter((l) => l.deletedAt === null)
		.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Live open tasks in one list, in manual order. */
export function liveTasksByList(listId: string): Task[] {
	return (tasksQuery.current as unknown as Task[])
		.filter((t) => OPEN(t) && t.listId === listId)
		.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Every live task, tombstones removed. The substrate M3's views narrow over. */
export function liveTasks(): Task[] {
	return (tasksQuery.current as unknown as Task[]).filter((t) => t.deletedAt === null);
}

/**
 * Subtasks grouped by parent id, alive only, in creation order.
 *
 * DATE-VIEW POLICY (deliberate): a subtask with its own `dueDate` never
 * surfaces as a top-level row in Today/Upcoming — it appears only nested under
 * its parent, wherever the parent is shown. That matches Things/Todoist and
 * keeps the date buckets honest: `todayOpenTasks()`/`upcomingTasks()` return
 * parents, and the UI attaches children beneath them. Callers that build date
 * views therefore filter OUT rows with a `parentId` before grouping, and read
 * children from this map.
 *
 * One map per render pass, rebuilt from the single `liveAll()` subscription —
 * the same O(n) narrowing every other helper here does.
 */
export function liveSubtasksByParent(): Map<string, Task[]> {
	const map = new Map<string, Task[]>();
	for (const t of tasksQuery.current as unknown as Task[]) {
		if (t.deletedAt !== null || t.parentId === null) continue;
		const bucket = map.get(t.parentId);
		if (bucket) bucket.push(t);
		else map.set(t.parentId, [t]);
	}
	for (const bucket of map.values()) bucket.sort((a, b) => a.sortOrder - b.sortOrder);
	return map;
}

export function liveListById(id: string): TaskList | undefined {
	return (listsQuery.current as unknown as TaskList[]).find(
		(l) => l.id === id && l.deletedAt === null
	);
}
