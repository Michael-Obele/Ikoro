/**
 * Backup export and import -- device-scoped fields never ship, and nothing is dropped silently.
 *
 * Merge is by `id`, newer `updatedAt` wins, so an old backup cannot roll the user back.
 */
import * as v from 'valibot';
import { db, type Task, type TaskList } from './schema';
import { newId, nowIso } from '$lib/utils/id';
import { exportSchema, EXPORT_SCHEMA_VERSION, type ExportFile } from '$lib/valibot/task';
import { getScheduler } from '$lib/alarms/scheduler';
import { reconcile } from '$lib/alarms/reconcile';

/** A validation failure the UI can render field by field. */
export class ImportError extends Error {
	/** Every failing path, not just the first. */
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
	/** Tasks dropped because their list was not in the merged set. */
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
			// User data, not device state -- export it or a restore loses it.
			parentId: t.parentId ?? null,
			color: t.color ?? null,
			updatedAt: t.updatedAt
		}))
	};
}

/**
 * Validate, then merge -- parse → validate → merge → normalise → reschedule; re-arming early schedules alarms for rows that do not exist yet.
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
		// Newer wins; ties keep the local copy.
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
		// No list to live in: drop and count, never silently.
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
			// Newer-wins like every other user field.
			parentId: incoming.parentId ?? null,
			color: incoming.color ?? null,
			repeat: existing?.repeat ?? null,
			completedAt: existing?.completedAt ?? null,
			alarmAt: incoming.alarmAt,
			// Cleared on the way in: this device's scheduler does the arming.
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

	// Normalise subtask structure over the MERGED set: a dangling, self- or two-level parent demotes the child to top-level (a repair, never a rejection), and a child inherits its parent's list.
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

	// Arm imported alarms now; a scheduler failure must not fail an import whose data already landed.
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

	// Report every failing path, not just the first.
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
