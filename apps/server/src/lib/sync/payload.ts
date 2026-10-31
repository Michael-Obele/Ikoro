/**
 * Per-kind payload validation. `@ikoro/sync` types `payload` as `unknown`, so the server is the
 * last line of defence. Field names come from `docs/build/00-conventions.md` §3.1.
 */

import * as v from 'valibot';
import type { EntityKind } from '@ikoro/sync';

/** `0 none · 1 low · 2 medium · 3 high`. Kept as a picklist, not an int. */
export const prioritySchema = v.picklist([0, 1, 2, 3]);

const isoTimestamp = v.pipe(v.string(), v.isoTimestamp());
const nullableText = v.nullable(v.string());
const nullableTimestamp = v.nullable(isoTimestamp);

/** A list payload. `rev` (server-owned) and `dirty` (transport-only) never reach the wire. */
export const listPayloadSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	name: v.pipe(v.string(), v.maxLength(512)),
	sortOrder: v.pipe(v.number(), v.integer()),
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	deletedAt: nullableTimestamp,
	googleTaskId: v.optional(v.nullable(v.string()))
});

/**
 * A task payload. `alarmId` and `alarmFiredAt` are device-scoped and never synced; `alarmAt` is,
 * because that is the instant the alarm fires.
 */
export const taskPayloadSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	listId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	title: v.pipe(v.string(), v.maxLength(1024)), // 1024 is the Google parity limit
	notes: v.nullable(v.pipe(v.string(), v.maxLength(8192))),
	dueDate: v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
	dueTime: v.nullable(
		v.pipe(
			v.string(),
			v.regex(/^([01]\d|2[0-3]):[0-5]\d$/),
			v.description('HH:mm, local to the device that set it')
		)
	),
	priority: prioritySchema,
	parentId: nullableText,
	repeat: v.nullable(v.picklist(['daily', 'weekdays', 'weekly', 'monthly'])),
	completedAt: nullableTimestamp,
	alarmAt: nullableTimestamp,
	sortOrder: v.pipe(v.number(), v.integer()),
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	deletedAt: nullableTimestamp,
	googleTaskId: v.optional(v.nullable(v.string()))
});

export const PAYLOAD_SCHEMAS = {
	list: listPayloadSchema,
	task: taskPayloadSchema
} as const satisfies Record<EntityKind, v.GenericSchema>;

export type ListPayload = v.InferOutput<typeof listPayloadSchema>;
export type TaskPayload = v.InferOutput<typeof taskPayloadSchema>;
export type AnyPayload = ListPayload | TaskPayload;

/** A payload that failed validation, carrying Valibot's field paths so the caller can fix it. */
export type PayloadError = {
	readonly ok: false;
	readonly kind: EntityKind;
	readonly message: string;
	readonly issues: string[];
};

export type PayloadOk<T> = { readonly ok: true; readonly value: T };
export type PayloadResult<T> = PayloadOk<T> | PayloadError;

/** Validate a payload against its kind's schema. `safeParse` because the message is the product. */
export function validatePayload(kind: EntityKind, payload: unknown): PayloadResult<AnyPayload> {
	const schema = PAYLOAD_SCHEMAS[kind] as v.GenericSchema;
	const result = v.safeParse(schema, payload);

	if (result.success) {
		return { ok: true, value: result.output as AnyPayload };
	}

	// `getDotPath` gives "notes" / "dueDate" — the path the caller has to look at.
	const issues = result.issues.map((issue) => {
		const path = v.getDotPath(issue) ?? '(root)';
		return `${path}: ${issue.message}`;
	});

	return {
		ok: false,
		kind,
		message: `Invalid ${kind} payload — ${issues.join('; ')}`,
		issues
	};
}

/**
 * Reject device-scoped and transport fields on the way in. Reported by name rather than silently
 * stripped, so a client that sends one learns its alarm is NOT registered.
 */
export const FORBIDDEN_PAYLOAD_FIELDS = [
	'rev',
	'dirty',
	'alarmId',
	'alarmFiredAt',
	'userId'
] as const;

/** `userId` is in the list because a client-supplied userId is an IDOR. */
export function findForbiddenFields(payload: unknown): string[] {
	if (typeof payload !== 'object' || payload === null) return [];
	const keys = Object.keys(payload as Record<string, unknown>);
	return keys.filter((key) => (FORBIDDEN_PAYLOAD_FIELDS as readonly string[]).includes(key));
}
