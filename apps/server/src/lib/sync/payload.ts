/**
 * Per-kind payload validation.
 *
 * `@ikoro/sync` types `ChangeOp.payload` as `unknown` on purpose: the wire
 * protocol must not need to know every field of every record, or adding a field
 * to a task would be a breaking change to the protocol package. But `unknown`
 * means the SERVER is the last line of defence, and "unknown" is exactly what a
 * corrupted or hostile push looks like.
 *
 * So the kind-specific shape lives here, on the server, in the same spirit as
 * `apps/app/src/lib/valibot` — validated on the way in, and never trusted.
 *
 * FIELD NAMES ARE NOT INVENTED. Every one of these is copied from
 * `docs/build/00-conventions.md` §3.1, which is the canonical record contract
 * that M1 built `apps/app`'s `svelte-idb` schema from. If that document and this
 * file disagree, the document wins and this file is the bug.
 */

import * as v from 'valibot';
import type { EntityKind } from '@ikoro/sync';

/** `0 none · 1 low · 2 medium · 3 high`. Kept as a picklist, not an int. */
export const prioritySchema = v.picklist([0, 1, 2, 3]);

const isoTimestamp = v.pipe(v.string(), v.isoTimestamp());
const nullableText = v.nullable(v.string());
const nullableTimestamp = v.nullable(isoTimestamp);

/**
 * A list payload.
 *
 * `rev` and `dirty` are intentionally absent. `rev` is server-assigned — a
 * client that could set it would let any device rewind the whole feed. `dirty`
 * is transport bookkeeping that means nothing to the server. Both are stripped
 * by `apps/app`'s export and neither belongs on the wire.
 */
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
 * A task payload.
 *
 * `alarmId` and `alarmFiredAt` are absent for the same class of reason as `rev`:
 * they are device-scoped. A platform notification id from one phone is
 * meaningless — and actively wrong — on another. `alarmAt` IS synced, because
 * that is the instant, and the product promise is that the alarm fires then.
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

/**
 * A payload that failed validation, with enough detail to fix it.
 *
 * `issues` is valibot's own, which means every message already carries a FIELD
 * PATH (`listPayload.name: Invalid type`). The AGENTS.md rule about asserting on
 * error MESSAGES rather than types is why this is surfaced at all: "Invalid
 * type: Expected string but received 3" tells a user what is wrong; `code === 400`
 * does not.
 */
export type PayloadError = {
	readonly ok: false;
	readonly kind: EntityKind;
	readonly message: string;
	readonly issues: string[];
};

export type PayloadOk<T> = { readonly ok: true; readonly value: T };
export type PayloadResult<T> = PayloadOk<T> | PayloadError;

/**
 * Validate a payload against its kind's schema.
 *
 * `v.safeParse` rather than `v.parse` because the message is the product here.
 * `mergeRow` is imported from `@ikoro/sync` and used untouched — the server does
 * not get a second, subtly different copy of the conflict rules.
 */
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
 * Reject device-scoped and transport fields on the way in.
 *
 * A schema that silently ignores unknown keys would accept
 * `{ alarmId: '9999' }` and drop it, and the client would then believe its alarm
 * is registered on the server. It is not, and nothing here can arm an alarm.
 *
 * Strict object parsing (`v.strictObject`) is not available on the shared
 * `changeRowSchema`, so this runs as a separate pass and reports which field was
 * refused, by name.
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
