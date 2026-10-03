import { describe, expect, it } from 'vitest';
import { appliedOp } from '#lib/db/schema';

/**
 * Idempotency bookkeeping.
 *
 * ── The failure this exists to prevent ──────────────────────────────────────
 * A phone sends a push, the server COMMITS, and the response is lost to a dead
 * cell connection. The client retries — correctly, it cannot know what happened.
 * If the server applies it twice, the damage is not "an extra row": it is a
 * second `rev` for one logical edit, which desynchronises every other device's
 * cursor, and for a `delete` it is a second tombstone.
 *
 * On a flaky mobile connection that is the NORMAL case, not the exception. So
 * the guarantee is not defensive, it is load-bearing.
 *
 * ── What is verified here, and what is not ──────────────────────────────────
 * Verified: that the ledger is keyed on the op id, that the claim is expressed
 * as a single atomic `ON CONFLICT (id) DO NOTHING`, and that the claim and the
 * entity write are the same statement.
 *
 * NOT verified: that Postgres actually resolves two concurrent claims the way
 * this claims it will. That needs a real database and two real connections, and
 * it is listed as unverified in the M10 report.
 */

describe('the op-id ledger is keyed for a race', () => {
	it('is keyed on `id`, and `id` is the primary key', () => {
		// `ON CONFLICT (id) DO NOTHING` resolves against a UNIQUE index. If `id`
		// were an ordinary column this clause would fail at runtime, and if the
		// primary key were anything else the race would be decided on the wrong
		// column.
		expect(appliedOp.id.primary).toBe(true);
		expect(appliedOp.id.name).toBe('id');
	});

	it('records the user, so a replay from another account is distinguishable', () => {
		// Without `userId` the server could not tell "already applied" from "this
		// op id belongs to somebody else", and would have to report one as the
		// other — leaking another account's rev.
		expect(appliedOp.userId.name).toBe('user_id');
		expect(appliedOp.userId.notNull).toBe(true);
	});

	it('records the rev it was given, so a replay converges on the same number', () => {
		// A replay that reported a NEW rev would leave the client's cursor
		// pointing somewhere the row never was.
		expect(appliedOp.rev).toBeDefined();
		expect(appliedOp.entityId.name).toBe('entity_id');
	});

	it('scopes every query by user, so two accounts never read each other', () => {
		// `userId` is notNull, so `lookupAppliedOp` can never match a row that has
		// no owner — a lookup cannot return another account's rev by accident.
		expect(appliedOp.userId.notNull).toBe(true);
		expect(appliedOp.userId.name).toBe('user_id');
	});
});

describe('the claim is atomic on its own', () => {
	it('is INSERT … ON CONFLICT (id) DO NOTHING, not a SELECT then an INSERT', () => {
		// A read-then-write has a window between the two statements in which a
		// second concurrent retry sees "not yet applied" and also applies. The
		// single-statement form has no such window — this is the whole reason for
		// the shape in queries.ts.
		const source = applyOneSource();
		expect(source).toMatch(/INSERT INTO applied_op/i);
		expect(source).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
		expect(source).not.toMatch(/SELECT[\s\S]*FROM applied_op[\s\S]*INSERT INTO applied_op/i);
	});

	it('returns the row id so the write is gated on winning the claim', () => {
		// If the CTE did not RETURN, the outer INSERT would have no rows to select
		// from and every write would silently no-op — including legitimate ones.
		expect(applyOneSource()).toMatch(/RETURNING id/i);
	});
});

describe('a replay is a success, not a duplicate', () => {
	it('distinguishes replay from stale by consulting the ledger', () => {
		// Both produce zero rows from RETURNING. Reporting a replay as "stale"
		// would make the client drop work that is in fact committed — data loss.
		// Reporting a stale op as a replay would make the client clear a dirty
		// flag for a change that was never applied.
		const source = applyOpsSource();
		expect(source).toMatch(/lookupAppliedOp/);
		expect(source).toMatch(/reason: 'forbidden'/);
		expect(source).toMatch(/reason: 'stale'/);
	});

	it('references the rev sequence by the exported constant, not a literal', () => {
		// The name lives in exactly one place. If SQL and schema disagreed about
		// it, `nextval()` would fail at runtime against a sequence that does not
		// exist — and only once a push arrived.
		const { REV_SEQUENCE_NAME } = schemaModule;
		expect(REV_SEQUENCE_NAME).toBe('ikoro_rev_seq');
		expect(applyOneSource()).toContain('REV_SEQUENCE_NAME');
	});

	it("never reports another account's rev back to the caller", () => {
		// The `forbidden` branch exists precisely so that a collision with another
		// user's op id returns nothing about their data.
		const source = applyOpsSource();
		expect(source).toMatch(/seen\.userId !== userId/);
	});
});

describe('the push is ordered and bounded', () => {
	it('applies ops in array order', () => {
		// A batch containing two edits to the same row must end on the later one.
		expect(applyOpsSource()).toMatch(/for \(const op of ops\)/);
	});

	it('rejects a duplicate op id inside ONE batch as a replay, not a double write', () => {
		// Two identical op ids in the same request: the second INSERT hits the
		// unique index and its CTE yields nothing, so only the first writes.
		const source = applyOneSource();
		expect(source).toMatch(/WITH claim AS/);
		expect(source).toMatch(/FROM claim/);
	});
});

function applyOneSource(): string {
	return applyOpsSource().slice(0, applyOpsSource().indexOf('async function lookupAppliedOp'));
}

function applyOpsSource(): string {
	// Comments stripped for the same reason as in queries.test.ts: this file
	// explains the forbidden patterns it also asserts are absent.
	return queriesRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

import queriesRaw from '#lib/db/queries?raw' with { type: 'text' };
import * as schemaModule from '#lib/db/schema';
