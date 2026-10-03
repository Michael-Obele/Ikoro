import * as v from 'valibot';

/**
 * Runtime validation for everything crossing a boundary — the task editor, the
 * backup file, the sync wire.
 *
 * The limits are not arbitrary: 1024 / 8192 are Google's own task title and notes
 * caps, and Ikoro exists to be a drop-in for tasks that already live there. A
 * task that fails to survive an export/import round-trip is data loss, so the
 * schemas are the ones the storage layer was designed around.
 */

export const titleSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(1024));
export const notesSchema = v.nullable(v.pipe(v.string(), v.maxLength(8192)));

/**
 * A shape regex alone would happily accept `2026-13-99` — it is the right length
 * and the right punctuation, just not a day that exists. Since `dueDate` is a
 * sort key that M3's overdue ordering reads, a phantom date would land a task in
 * a place the user can never find it again. So the shape is checked first, then
 * the calendar.
 */
const ISO_DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function isRealCalendarDay(value: string): boolean {
	const [y, m, d] = value.split('-').map(Number);
	const probe = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
	return (
		probe.getUTCFullYear() === y && probe.getUTCMonth() === (m ?? 1) - 1 && probe.getUTCDate() === d
	);
}

/** A calendar day, zero-padded and real. `2026-1-1` and `2026-13-99` are rejected. */
export const dueDateSchema = v.nullable(
	v.pipe(
		v.string(),
		v.regex(ISO_DAY_SHAPE, 'Expected a YYYY-MM-DD date'),
		v.check(isRealCalendarDay, 'Not a real calendar date')
	)
);

/** 24-hour clock, zero-padded. `9:05` and `24:00` are rejected; `09:05` is not. */
export const dueTimeSchema = v.nullable(v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/)));

export const prioritySchema = v.picklist([0, 1, 2, 3]);

export const taskSchema = v.object({
	title: titleSchema,
	notes: notesSchema,
	dueDate: dueDateSchema,
	dueTime: dueTimeSchema,
	priority: prioritySchema
});

/** What the editor collects: a title is the only required field. */
export const taskInputSchema = v.object({
	id: v.optional(v.string()),
	listId: v.optional(v.string()),
	title: titleSchema,
	notes: v.optional(notesSchema),
	dueDate: v.optional(dueDateSchema),
	dueTime: v.optional(dueTimeSchema),
	priority: v.optional(prioritySchema)
});

export type TaskFormValues = v.InferInput<typeof taskInputSchema>;

/**
 * The backup envelope (M7).
 *
 * `schemaVersion` is a literal, not a number, so an older Ikoro refuses a newer
 * file loudly at parse time instead of importing the fields it does not
 * understand and dropping the rest.
 */
export const exportSchema = v.object({
	app: v.literal('ikoro'),
	schemaVersion: v.literal(1),
	exportedAt: v.pipe(v.string(), v.isoTimestamp()),
	lists: v.array(
		v.object({
			id: v.string(),
			name: v.pipe(v.string(), v.minLength(1)),
			sortOrder: v.number(),
			// Needed on the wire, not just locally: import merges by id and keeps
			// the NEWER `updatedAt`, so without it in the file a backup could only
			// ever overwrite, never defer to a newer local edit. Added after M1
			// when M7 made that rule explicit; v1 has not shipped, so making it
			// required breaks no real file.
			updatedAt: v.pipe(v.string(), v.isoTimestamp())
		})
	),
	tasks: v.array(
		v.object({
			id: v.string(),
			listId: v.string(),
			title: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
			notes: v.nullable(v.string()),
			dueDate: v.nullable(v.string()),
			dueTime: v.nullable(v.string()),
			priority: v.picklist([0, 1, 2, 3]),
			alarmAt: v.nullable(v.string()),
			updatedAt: v.pipe(v.string(), v.isoTimestamp())
		})
	)
});

export type ExportFile = v.InferOutput<typeof exportSchema>;
export const EXPORT_SCHEMA_VERSION = 1;
