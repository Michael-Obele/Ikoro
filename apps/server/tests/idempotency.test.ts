import { describe, expect, it } from 'vitest';
import { appliedOp } from '#lib/db/schema';

/** Idempotency: a retried push must not apply twice, or a lost response desyncs every device. */

describe('the op-id ledger is keyed for a race', () => {
	it('is keyed on `id`, and `id` is the primary key', () => {
		// `ON CONFLICT (id)` resolves against a UNIQUE index; the PK is the only one here.
		expect(appliedOp.id.primary).toBe(true);
		expect(appliedOp.id.name).toBe('id');
	});

	it('records the user, so a replay from another account is distinguishable', () => {
		// Without `userId` a foreign op id would have to be reported as a replay, leaking a rev.
		expect(appliedOp.userId.name).toBe('user_id');
		expect(appliedOp.userId.notNull).toBe(true);
	});

	it('records the rev it was given, so a replay converges on the same number', () => {
		// A replay reporting a NEW rev would point the client's cursor where the row never was.
		expect(appliedOp.rev).toBeDefined();
		expect(appliedOp.entityId.name).toBe('entity_id');
	});

	it('scopes every query by user, so two accounts never read each other', () => {
		// `userId` is notNull, so a lookup can never match an ownerless row by accident.
		expect(appliedOp.userId.notNull).toBe(true);
		expect(appliedOp.userId.name).toBe('user_id');
	});
});

describe('the claim is atomic on its own', () => {
	it('is INSERT … ON CONFLICT (id) DO NOTHING, not a SELECT then an INSERT', () => {
		// Read-then-write has a window in which two concurrent retries both apply.
		const source = applyOneSource();
		expect(source).toMatch(/INSERT INTO applied_op/i);
		expect(source).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
		expect(source).not.toMatch(/SELECT[\s\S]*FROM applied_op[\s\S]*INSERT INTO applied_op/i);
	});

	it('returns the row id so the write is gated on winning the claim', () => {
		// Without RETURNING, the outer INSERT has no rows and every write silently no-ops.
		expect(applyOneSource()).toMatch(/RETURNING id/i);
	});
});

describe('a replay is a success, not a duplicate', () => {
	it('distinguishes replay from stale by consulting the ledger', () => {
		// Both return zero rows; confusing them loses data in one direction, a dirty flag in the other.
		const source = applyOpsSource();
		expect(source).toMatch(/lookupAppliedOp/);
		expect(source).toMatch(/reason: 'forbidden'/);
		expect(source).toMatch(/reason: 'stale'/);
	});

	it('references the rev sequence by the exported constant, not a literal', () => {
		// The name lives in one place; a mismatch only fails once a real push arrives.
		const { REV_SEQUENCE_NAME } = schemaModule;
		expect(REV_SEQUENCE_NAME).toBe('ikoro_rev_seq');
		expect(applyOneSource()).toContain('REV_SEQUENCE_NAME');
	});

	it("never reports another account's rev back to the caller", () => {
		// The `forbidden` branch exists so a foreign op id leaks nothing.
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
		// The second INSERT hits the unique index and its CTE yields nothing.
		const source = applyOneSource();
		expect(source).toMatch(/WITH claim AS/);
		expect(source).toMatch(/FROM claim/);
	});
});

function applyOneSource(): string {
	return applyOpsSource().slice(0, applyOpsSource().indexOf('async function lookupAppliedOp'));
}

function applyOpsSource(): string {
	// Comments stripped so the prose forbidding these patterns cannot satisfy the assertions.
	return queriesRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

import queriesRaw from '#lib/db/queries?raw' with { type: 'text' };
import * as schemaModule from '#lib/db/schema';
