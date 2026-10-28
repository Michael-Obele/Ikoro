/**
 * Backup export and import.
 *
 * Two rules decide everything here:
 *
 *  1. **Nothing device-scoped ever ships.** `alarmId` is a number this phone
 *     handed out; on another device it means nothing, and leaving it behind
 *     makes a later cancel target the wrong notification. Same for
 *     `alarmFiredAt` (a fact about one device's wake-ups) and `rev` (a server
 *     cursor that is meaningless offline).
 *  2. **Nothing is ever dropped silently.** A task whose list is missing is
 *     skipped AND counted. A silent skip in a backup tool is indistinguishable
 *     from data loss, which is the one thing this feature exists to prevent.
 *
 * Merge is by `id`, keeping the newer `updatedAt` — so importing an old backup
 * onto a device with newer edits cannot roll the user back.
 */
import * as v from 'valibot';
import { db, type Task, type TaskList } from './schema';
import { newId, nowIso } from '$lib/utils/id';
import { exportSchema, EXPORT_SCHEMA_VERSION, type ExportFile } from '$lib/valibot/task';
import { getScheduler } from '$lib/alarms/scheduler';
import { reconcile } from '$lib/alarms/reconcile';

/** A validation failure the UI can render field by field. */
export class ImportError extends Error {
	/** Every failing `path.issue`, not just the first — a partial list of errors is its own kind of unhelpful. */
	readonly paths: string[];

	constructor(message: string, paths: string[] = []) {
		super(message);
		this.name = 'ImportError';
		this.paths = paths;
	}
}

export interface ImportResult {
	lists: number;
	tasks: number;
	/** Tasks dropped because their list was not in the merged set. Surfaced, never silent. */
	skipped: number;
}

const asTask = (row: Record<string, unknown>) => row as unknown as Task;
const asList = (row: Record<string, unknown>) => row as unknown as TaskList;

/** Read every live row, shaped exactly as `exportSchema` expects. */
export async function exportAll(): Promise<ExportFile> {
	const lists = (await db.lists.getAll()).map(asList).filter((l) => l.deletedAt === null);
	const tasks = (await db.tasks.getAll()).map(asTask).filter((t) => t.deletedAt === null);

	return {
		app: 'ikoro',
		schemaVersion: EXPORT_SCHEMA_VERSION,
		exportedAt: nowIso(),
		lists: lists.map((l) => ({
			id: l.id,
			name: l.name,
			sortOrder: l.sortOrder,
			updatedAt: l.updatedAt
		})),
		tasks: tasks.map((t) => ({
			id: t.id,
			listId: t.listId,
			title: t.title,
			notes: t.notes,
			dueDate: t.dueDate,
			dueTime: t.dueTime,
			priority: t.priority,
			alarmAt: t.alarmAt,
			// User data, not device state: a restore that drops the subtask tree or
			// the colours has thrown away work the user can see is gone. `?? null`
			// normalises the absent-key `undefined` an old row may carry.
			parentId: t.parentId ?? null,
			color: t.color ?? null,
			updatedAt: t.updatedAt
		}))
	};
}

/**
 * Validate, then merge.
 *
 * The order matters: parse → validate → merge → normalise → reschedule.
 * Re-arming before the rows land would schedule alarms for tasks that do not
 * exist yet, and skipping validation would import a file that silently
 * corrupts the store.
 */
export async function importAll(input: unknown): Promise<ImportResult> {
	const parsed = parseEnvelope(input);

	const ts = nowIso();
	const mergedLists = new Map<string, TaskList>();
	const mergedTasks = new Map<string, Task>();

	for (const row of await db.lists.getAll()) mergedLists.set(row.id as string, asList(row));
	for (const row of await db.tasks.getAll()) mergedTasks.set(row.id as string, asTask(row));

	let listWrites = 0;
	for (const incoming of parsed.lists) {
		const existing = mergedLists.get(incoming.id);
		// Newer wins. Ties keep the local copy, so re-importing the file you just
		// exported changes nothing.
		if (existing && existing.updatedAt >= incoming.updatedAt) continue;
		const list: TaskList = {
			id: incoming.id,
			name: incoming.name,
			sortOrder: incoming.sortOrder,
			createdAt: existing?.createdAt ?? incoming.updatedAt,
			updatedAt: incoming.updatedAt,
			deletedAt: null,
			rev: null,
			dirty: 1
		};
		await db.lists.put(list as unknown as Record<string, unknown>);
		mergedLists.set(list.id, list);
		listWrites++;
	}

	let taskWrites = 0;
	let skipped = 0;
	for (const incoming of parsed.tasks) {
		// A task whose list is not in the merged set has nowhere to live. Drop
		// it, count it, and let the caller tell the user — never silently.
		if (!mergedLists.has(incoming.listId)) {
			skipped++;
			continue;
		}
		const existing = mergedTasks.get(incoming.id);
		if (existing && existing.updatedAt >= incoming.updatedAt) continue;

		const task: Task = {
			id: incoming.id,
			listId: incoming.listId,
			title: incoming.title,
			notes: incoming.notes,
			dueDate: incoming.dueDate,
			dueTime: incoming.dueTime,
			priority: incoming.priority,
			// Newer-wins like every other user field. The old `existing?.parentId
			// ?? null` never updated the pointer, so a subtask restored from a
			// backup stayed detached from its parent forever.
			parentId: incoming.parentId ?? null,
			color: incoming.color ?? null,
			repeat: existing?.repeat ?? null,
			completedAt: existing?.completedAt ?? null,
			alarmAt: incoming.alarmAt,
			// Always cleared on the way in: an alarm armed here has to be armed
			// by THIS device, which means going through THIS device's scheduler.
			alarmId: null,
			alarmFiredAt: null,
			sortOrder: existing?.sortOrder ?? taskWrites,
			createdAt: existing?.createdAt ?? incoming.updatedAt,
			updatedAt: incoming.updatedAt,
			deletedAt: null,
			rev: null,
			dirty: 1
		};
		await db.tasks.put(task as unknown as Record<string, unknown>);
		mergedTasks.set(task.id, task);
		taskWrites++;
	}

	// Normalise subtask structure over the MERGED set — the file's pointers are
	// only trustworthy once every row (imported and local alike) is in the map:
	//
	//  - an `parentId` naming a task that is not in the merged set is a dangling
	//    reference (a partial backup, or a parent the receiving device deleted);
	//    the child is demoted to a top-level task rather than vanish;
	//  - a child pointing at itself, or at a task that is itself a child, is a
	//    malformed chain — subtasks are exactly one level deep, so the child is
	//    demoted too;
	//  - a child inherits its parent's list, mirroring `repo.createTask`, so a
	//    nested view never shows a child in a list its parent is not in.
	//
	// Demotion is a repair, not a rejection: the task itself is user data and
	// must survive even when the structure around it cannot.
	for (const task of mergedTasks.values()) {
		if (task.parentId === null) continue;
		const parent = mergedTasks.get(task.parentId);
		const broken =
			!parent ||
			parent.deletedAt !== null ||
			parent.id === task.id ||
			parent.parentId !== null ||
			parent.listId !== task.listId;
		if (!broken) continue;
		await db.tasks.put({ ...task, parentId: null } as unknown as Record<string, unknown>);
		mergedTasks.set(task.id, { ...task, parentId: null });
	}

	// Imported alarms are not armed yet — the user was promised a reminder, so
	// arm it now. A scheduler failure must not fail the import: the data is
	// already safely in the store, and Settings → Notifications can re-arm.
	try {
		await reconcile({ scheduler: getScheduler() });
	} catch (error) {
		console.warn('[ikoro] could not re-arm imported alarms', error);
	}

	void ts;
	return { lists: listWrites, tasks: taskWrites, skipped };
}

/** Parse and validate, turning both failures into an `ImportError` the UI can show. */
function parseEnvelope(input: unknown): ExportFile {
	if (typeof input === 'string') {
		let candidate: unknown;
		try {
			candidate = JSON.parse(input);
		} catch {
			throw new ImportError('That file is not valid JSON, so it could not be read.');
		}
		return parseEnvelope(candidate);
	}

	const result = v.safeParse(exportSchema, input);
	if (result.success) return result.output;

	// Report every failing path. `issue.path` is the path to the offending field,
	// which is exactly what a user needs to see to fix their file.
	const paths = result.issues.map((issue) => {
		const path = issue.path?.map((segment) => String(segment.key)).join('.') ?? '(root)';
		return `${path}: ${issue.message}`;
	});

	const summary =
		paths.length === 1
			? 'This file is not a valid Ikoro backup.'
			: `This file is not a valid Ikoro backup — ${paths.length} problems found.`;
	throw new ImportError(summary, paths);
}

/** Recorded so Settings can nudge when the last backup is stale. */
export async function markExported(): Promise<void> {
	await db.meta.put({
		key: 'lastExportAt',
		value: nowIso(),
		updatedAt: nowIso()
	} as unknown as Record<string, unknown>);
}

export async function lastExportAt(): Promise<string | null> {
	const row = await db.meta.get('lastExportAt');
	return row ? (row.value as string) : null;
}

export { newId };
