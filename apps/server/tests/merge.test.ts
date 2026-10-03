import { describe, expect, it } from 'vitest';
import { mergeRow } from '@ikoro/sync';
import { incomingFromOp, resolveWrite, toChangeRow } from '#lib/sync/merge';
import type { IncomingRow, StoredRow } from '#lib/sync/merge';
import type { ChangeOp } from '@ikoro/sync';

/**
 * The server's merge decision.
 *
 * The class of bug this catches: the server and `apps/app` disagreeing about who
 * wins a conflict. That bug is invisible in a single-device test, appears only
 * when two devices edit the same task, and — because both implementations are
 * "reasonable" — is very hard to reproduce from a report.
 *
 * The load-bearing assertion is the LAST one in `resolveWrite`: that the argument
 * order passed to `mergeRow` still means what the comment says it means.
 */

const payload = { title: 'x' } as IncomingRow['payload'];

const incoming = (over: Partial<IncomingRow> = {}): IncomingRow => ({
	id: 'task-1',
	userId: 'user-1',
	payload,
	updatedAt: '2026-10-02T12:00:00.000Z',
	deletedAt: null,
	...over
});

const stored = (over: Partial<StoredRow> = {}): StoredRow => ({
	id: 'task-1',
	userId: 'user-1',
	payload,
	updatedAt: '2026-10-01T12:00:00.000Z',
	rev: 5,
	deletedAt: null,
	...over
});

describe('resolveWrite — inserts', () => {
	it('inserts when there is no stored row', () => {
		const outcome = resolveWrite(undefined, incoming());
		expect(outcome.decision).toBe('insert');
		expect(outcome.reason).toBe('new');
	});
});

describe('resolveWrite — LWW', () => {
	it('applies a newer incoming row', () => {
		const outcome = resolveWrite(stored(), incoming());
		expect(outcome.decision).toBe('update');
		expect(outcome.reason).toBe('newer');
	});

	it('rejects an older incoming row as stale', () => {
		const outcome = resolveWrite(stored({ updatedAt: '2026-10-05T12:00:00.000Z' }), incoming());
		expect(outcome.decision).toBe('reject');
		if (outcome.decision === 'reject') {
			expect(outcome.reason).toBe('stale');
			// The stored instant is reported so a client can see how far behind it is.
			expect(outcome.storedUpdatedAt).toBe('2026-10-05T12:00:00.000Z');
		}
	});

	it('REJECTS an exact timestamp tie, keeping the stored row', () => {
		// The critical case. `mergeRow` gives ties to its `remote` argument, so the
		// stored row is passed as `remote` precisely so it wins here. If someone
		// swaps the arguments, this test fails — and the failure is a silent,
		// order-dependent loss of committed data, so it is worth failing loudly.
		const outcome = resolveWrite(
			stored({ updatedAt: '2026-10-02T12:00:00.000Z' }),
			incoming({ updatedAt: '2026-10-02T12:00:00.000Z' })
		);
		expect(outcome.decision).toBe('reject');
	});
});

describe('resolveWrite — tombstones', () => {
	it('a delete beats a live row even with an OLDER clock', () => {
		// The phone's clock is a week fast, the user deleted on the laptop. The
		// delete must win, or the task comes back from the dead.
		const outcome = resolveWrite(
			stored({ deletedAt: null, updatedAt: '2026-10-08T12:00:00.000Z' }),
			incoming({ deletedAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' })
		);
		expect(outcome.decision).toBe('update');
		expect(outcome.reason).toBe('tombstone');
	});

	it('a live row never resurrects a tombstone', () => {
		const outcome = resolveWrite(
			stored({ deletedAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' }),
			incoming({ updatedAt: '2026-10-09T12:00:00.000Z' })
		);
		expect(decision(outcome)).toBe('reject');
	});

	it('an older tombstone does not overwrite a newer tombstone', () => {
		const outcome = resolveWrite(
			stored({ deletedAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z' }),
			incoming({ deletedAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' })
		);
		expect(decision(outcome)).toBe('reject');
	});
});

describe('incomingFromOp — deletes are soft', () => {
	it('turns a delete op into a tombstone, never an absence', () => {
		const op = {
			id: 'op-1',
			kind: 'task',
			entityId: 'task-1',
			op: 'delete',
			payload: {},
			updatedAt: '2026-10-03T09:00:00.000Z'
		} as ChangeOp;

		const row = incomingFromOp(op, 'user-1');
		// The tombstone carries the DELETING DEVICE's instant, not a server "now".
		// Inventing server time here would hand the server clock authority the
		// protocol explicitly refuses it.
		expect(row.deletedAt).toBe('2026-10-03T09:00:00.000Z');
		expect(row.updatedAt).toBe('2026-10-03T09:00:00.000Z');
		expect(row.userId).toBe('user-1');
	});

	it('takes userId from the session argument, never from the op', () => {
		const op = {
			id: 'op-2',
			kind: 'task',
			entityId: 'task-1',
			op: 'upsert',
			payload: {},
			updatedAt: '2026-10-03T09:00:00.000Z',
			userId: 'attacker'
		} as unknown as ChangeOp;

		expect(incomingFromOp(op, 'real-user').userId).toBe('real-user');
	});

	it('an upsert is not a tombstone', () => {
		const op = {
			id: 'op-3',
			kind: 'task',
			entityId: 'task-1',
			op: 'upsert',
			payload: {},
			updatedAt: '2026-10-03T09:00:00.000Z'
		} as ChangeOp;

		expect(incomingFromOp(op, 'user-1').deletedAt).toBeNull();
	});
});

describe('the server delegates to mergeRow', () => {
	it('produces the same verdict mergeRow does, for the same pair', () => {
		// This is the anti-drift test. `resolveWrite` must not have grown a rule
		// of its own: for every timestamp ordering, its answer must match what the
		// shared library says when the stored row is the `remote` side.
		const stamps = [
			'2026-10-01T00:00:00.000Z',
			'2026-10-02T00:00:00.000Z',
			'2026-10-03T00:00:00.000Z'
		];

		for (const storedAt of stamps) {
			for (const incomingAt of stamps) {
				for (const deleted of [null, '2026-10-01T06:00:00.000Z']) {
					const s = stored({ updatedAt: storedAt, deletedAt: deleted });
					const i = incoming({ updatedAt: incomingAt, deletedAt: deleted });
					const outcome = resolveWrite(s, i);

					// By reference, exactly as resolveWrite does — a fresh
					// literal here would make this comparison always false and the
					// test would silently assert nothing.
					const local: IncomingRow = i;
					const remote: StoredRow = s;
					const expected = mergeRow(local, remote);
					const storedWon = expected === remote;

					expect(
						outcome.decision === 'reject',
						`stored=${storedAt}/${deleted} incoming=${incomingAt}/${deleted}`
					).toBe(storedWon);
				}
			}
		}
	});
});

describe('toChangeRow — what the client is told', () => {
	it('passes updatedAt and deletedAt through verbatim', () => {
		// The client merges locally with `mergeChanges`. If the server paraphrased
		// either field, the client's merge would decide differently than the
		// server's did, and the two would diverge silently.
		const wire = toChangeRow('task', stored({ rev: 99, deletedAt: null }));
		expect(wire).toMatchObject({
			kind: 'task',
			entityId: 'task-1',
			updatedAt: '2026-10-01T12:00:00.000Z',
			rev: 99,
			deletedAt: null
		});
	});

	it('keeps a tombstone visible on the wire', () => {
		const wire = toChangeRow('task', stored({ deletedAt: '2026-10-04T00:00:00.000Z' }));
		expect(wire.deletedAt).toBe('2026-10-04T00:00:00.000Z');
	});
});

/** Narrowing helper so the assertions above read as sentences. */
function decision(outcome: ReturnType<typeof resolveWrite>): string {
	return outcome.decision;
}
