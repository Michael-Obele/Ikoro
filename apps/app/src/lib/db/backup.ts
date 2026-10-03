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
			updatedAt: t.updatedAt
		}))
	};
}

/**
 * Validate, then merge.
 *
 * The order matters: parse → validate → merge → reschedule. Re-arming before
 * the rows land would schedule alarms for tasks that do not exist yet, and
 * skipping validation would import a file that silently corrupts the store.
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
			parentId: existing?.parentId ?? null,
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
	await db.meta.put({ key: 'lastExportAt', value: nowIso(), updatedAt: nowIso() } as unknown as Record<string, unknown>);
}

export async function lastExportAt(): Promise<string | null> {
	const row = await db.meta.get('lastExportAt');
	return row ? (row.value as string) : null;
}

export { newId };