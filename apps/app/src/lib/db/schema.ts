/**
 * The ONE database instance -- change events do not cross connections, so never a second one.
 *
 * Schema is complete at v1, sync fields included, so no `onUpgrade` is ever needed.
 */
import { createReactiveDB } from 'svelte-idb/svelte';

export type Priority = 0 | 1 | 2 | 3; // 0 none · 1 low · 2 medium · 3 high

export interface TaskList {
	id: string; // crypto.randomUUID()
	name: string;
	sortOrder: number; // "My order"
	createdAt: string; // ISO 8601
	updatedAt: string;
	deletedAt: string | null; // tombstone — deletes are ALWAYS soft
	rev: number | null; // server revision of last sync (null = never synced)
	dirty: 0 | 1; // 1 = needs pushing (M11)
	googleTaskId?: string; // reserved for the v2 import path
}

export interface Task {
	id: string;
	listId: string;
	title: string; // ≤ 1024 (Google parity)
	notes: string | null; // ≤ 8192
	dueDate: string | null; // YYYY-MM-DD (the Google-syncable part)
	dueTime: string | null; // HH:mm — LOCAL ONLY (Google's API discards time)
	priority: Priority;
	parentId: string | null; // subtasks reserved (v1.1)
	repeat: null | 'daily' | 'weekdays' | 'weekly' | 'monthly'; // reserved (v1.1)
	completedAt: string | null;
	alarmAt: string | null; // ISO — the instant the alarm should fire
	alarmId: string | null; // platform id returned by the scheduler
	alarmFiredAt: string | null;
	/** Key into `lib/task-colors.ts`, never raw hex. Optional, so no version bump or index is needed. */
	color?: string | null;
	/** Device-scoped `content://` ringtone uri, copied into the Kotlin store at arm time; never exported. */
	ringtone?: string | null;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null; // tombstone (M11)
	rev: number | null; // server cursor for this row (M11)
	dirty: 0 | 1; // sync queue marker (M11)
	googleTaskId?: string;
}

/** The shape `repo.createTask()` accepts — everything optional except the title. */
export interface TaskInput {
	id?: string; // supplied only by import/restore, where a collision must throw
	listId: string;
	title: string;
	notes?: string | null;
	dueDate?: string | null;
	dueTime?: string | null;
	priority?: Priority;
	parentId?: string | null;
	repeat?: null | 'daily' | 'weekdays' | 'weekly' | 'monthly';
	alarmAt?: string | null;
	/** Optional task colour -- see `Task.color`. */
	color?: string | null;
	/** Optional per-task alarm sound -- see `Task.ringtone`. */
	ringtone?: string | null;
	sortOrder?: number;
}

export interface MetaRow {
	key: string; // 'syncEnabled' | 'syncCursor' | 'lastSyncedAt'
	value: unknown;
	updatedAt: string;
}

export const db = createReactiveDB({
	name: 'ikoro',
	version: 1,
	stores: {
		lists: {
			keyPath: 'id',
			indexes: {
				bySortOrder: { keyPath: 'sortOrder' },
				byUpdatedAt: { keyPath: 'updatedAt' },
				byDirty: { keyPath: 'dirty' }
			}
		},
		tasks: {
			keyPath: 'id',
			indexes: {
				byList: { keyPath: 'listId' },
				byDue: { keyPath: 'dueDate' },
				byAlarm: { keyPath: 'alarmAt' },
				byCompleted: { keyPath: 'completedAt' },
				byUpdatedAt: { keyPath: 'updatedAt' },
				byParent: { keyPath: 'parentId' },
				byDirty: { keyPath: 'dirty' }
			}
		},
		// App-level scalars (sync cursor, enabled flag) -- declared at v1 so M11 needs no change.
		meta: { keyPath: 'key' }
	}
});
