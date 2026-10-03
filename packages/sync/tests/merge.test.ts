import { describe, expect, it } from 'vitest';
import {
	mergeRow,
	mergeChanges,
	needsPush,
	changeOpSchema,
	pushRequestSchema,
	changesResponseSchema,
	WIRE_VERSION
} from '@ikoro/sync';
import * as v from 'valibot';

/**
 * The merge rules are the only thing in this repo that both the phone and the
 * server must agree on EXACTLY. If these drift, sync bugs stop being
 * reproducible — so the edge cases are the tests, not the happy path.
 */

interface Row {
	id: string;
	updatedAt: string;
	deletedAt?: string | null;
	title?: string;
}

const row = (over: Partial<Row> = {}): Row => ({
	id: 'r1',
	updatedAt: '2026-10-01T12:00:00.000Z',
	deletedAt: null,
	title: 'x',
	...over
});

describe('mergeRow — the two rules that matter', () => {
	it('newer wins', () => {
		const local = row({ updatedAt: '2026-10-01T12:00:00.000Z', title: 'old' });
		const remote = row({ updatedAt: '2026-10-02T12:00:00.000Z', title: 'new' });
		expect(mergeRow(local, remote).title).toBe('new');
	});

	it('a tombstone is never resurrected by a newer live row', () => {
		// The phone's clock is a week fast and it pushes a stale copy of a task the
		// user deleted on the laptop. The delete must win.
		const local = row({
			updatedAt: '2026-10-01T12:00:00.000Z',
			deletedAt: '2026-10-01T12:00:00.000Z'
		});
		const remote = row({
			updatedAt: '2026-10-08T12:00:00.000Z',
			deletedAt: null,
			title: 'resurrected?'
		});

		expect(mergeRow(local, remote).deletedAt).toBe('2026-10-01T12:00:00.000Z');
	});

	it('a newer tombstone beats an older live row', () => {
		const local = row({ updatedAt: '2026-10-01T12:00:00.000Z', deletedAt: null });
		const remote = row({
			updatedAt: '2026-10-02T12:00:00.000Z',
			deletedAt: '2026-10-02T12:00:00.000Z'
		});
		expect(mergeRow(local, remote).deletedAt).toBe('2026-10-02T12:00:00.000Z');
	});

	it('server wins ties, so devices converge instead of diverging', () => {
		const local = row({ title: 'local' });
		const remote = row({ title: 'remote' });
		expect(mergeRow(local, remote).title).toBe('remote');
	});

	it('is SYMMETRIC — the property that makes concurrent edits converge', () => {
		const a = row({ updatedAt: '2026-10-01T12:00:00.000Z', title: 'a' });
		const b = row({ updatedAt: '2026-10-05T12:00:00.000Z', title: 'b' });
		expect(mergeRow(a, b)).toEqual(mergeRow(b, a));
	});

	it('handles a missing side', () => {
		const only = row();
		expect(mergeRow(undefined, only)).toBe(only);
		expect(mergeRow(only, undefined)).toBe(only);
	});

	it('compares ISO instants, not lexicographic luck', () => {
		// Both are valid ISO strings and lexicographic order happens to agree here —
		// the point is that a row with no `deletedAt` key at all behaves as live.
		const local = { id: 'r1', updatedAt: '2026-10-01T12:00:00.000Z' };
		const remote = { id: 'r1', updatedAt: '2026-10-02T12:00:00.000Z' };
		expect(mergeRow(local, remote).updatedAt).toBe('2026-10-02T12:00:00.000Z');
	});
});

describe('mergeChanges', () => {
	it('returns only the rows that actually changed', () => {
		const local = [
			row({ id: 'a', updatedAt: '2026-10-01T00:00:00.000Z' }),
			row({ id: 'b', updatedAt: '2026-10-01T00:00:00.000Z' })
		];
		const remote = [
			row({ id: 'a', updatedAt: '2026-10-01T00:00:00.000Z' }),
			row({ id: 'b', updatedAt: '2026-10-05T00:00:00.000Z', title: 'changed' })
		];

		const changed = mergeChanges(local, remote, (r) => r.id);

		// `a` is unchanged and must NOT be written back: writing it would bump its
		// updatedAt and re-dirty it, and the next pull would push it straight back
		// to the server. An echo loop that never terminates.
		expect(changed).toHaveLength(1);
		expect(changed[0].id).toBe('b');
	});

	it('includes genuinely new rows', () => {
		const changed = mergeChanges([], [row({ id: 'new' })], (r) => r.id);
		expect(changed).toHaveLength(1);
	});

	it('is empty when nothing differs', () => {
		const local = [row({ id: 'a' })];
		expect(mergeChanges(local, [row({ id: 'a' })], (r) => r.id)).toHaveLength(0);
	});
});

describe('needsPush', () => {
	it('is the dirty flag — there is no separate outbox store', () => {
		expect(needsPush({ dirty: 1 })).toBe(true);
		expect(needsPush({ dirty: 0 })).toBe(false);
	});
});

describe('wire schemas', () => {
	it('accepts a well-formed op', () => {
		const op = {
			id: 'op-1',
			kind: 'task',
			entityId: 't1',
			op: 'upsert',
			payload: { title: 'x' },
			updatedAt: '2026-10-01T12:00:00.000Z'
		};
		expect(v.safeParse(changeOpSchema, op).success).toBe(true);
	});

	it('rejects an unknown entity kind rather than guessing', () => {
		expect(
			v.safeParse(changeOpSchema, {
				id: 'op-1',
				kind: 'sprint',
				entityId: 't1',
				op: 'upsert',
				payload: {},
				updatedAt: '2026-10-01T12:00:00.000Z'
			}).success
		).toBe(false);
	});

	it('rejects a non-ISO updatedAt — the merge depends on comparing instants', () => {
		expect(
			v.safeParse(changeOpSchema, {
				id: 'op-1',
				kind: 'task',
				entityId: 't1',
				op: 'upsert',
				payload: {},
				updatedAt: 'yesterday'
			}).success
		).toBe(false);
	});

	it('requires a matching wireVersion, so an old client fails loudly', () => {
		const base = { wireVersion: WIRE_VERSION, ops: [] };
		expect(v.safeParse(pushRequestSchema, base).success).toBe(true);
		expect(v.safeParse(pushRequestSchema, { ...base, wireVersion: 99 }).success).toBe(false);
	});

	it('requires rev to be a positive integer — it is the cursor', () => {
		expect(
			v.safeParse(changesResponseSchema, {
				changes: [
					{
						kind: 'task',
						entityId: 't1',
						payload: {},
						updatedAt: '2026-10-01T12:00:00.000Z',
						rev: 0,
						deletedAt: null
					}
				],
				nextRev: 1
			}).success
		).toBe(false);
	});

	it('accepts a change row carrying a tombstone', () => {
		expect(
			v.safeParse(changesResponseSchema, {
				changes: [
					{
						kind: 'task',
						entityId: 't1',
						payload: {},
						updatedAt: '2026-10-01T12:00:00.000Z',
						rev: 4,
						deletedAt: '2026-10-01T12:00:01.000Z'
					}
				],
				nextRev: 4
			}).success
		).toBe(true);
	});
});
