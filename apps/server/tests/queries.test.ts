import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDbForTesting } from '#lib/db';
import { appliedOp, list, REV_SEQUENCE_NAME, task } from '#lib/db/schema';
import { tableForKind, KNOWN_KINDS } from '#lib/db/queries';

/**
 * The SQL layer, verified without a database: `.toSQL()` catches a hand-authored schema naming a
 * column that does not exist. Real concurrency and migrations stay unverified.
 */

// A syntactically valid placeholder that is never connected to. Not a credential.
const NO_CONNECT = 'postgresql://user:pass@127.0.0.1:5432/ikoro_test';

/**
 * The SQL-level flags on a drizzle column. `config` is `protected`, but `withTimezone` lives there
 * and nowhere else.
 */
function sqlFlags(column: unknown): { withTimezone?: boolean } {
	return (column as { config?: { withTimezone?: boolean } }).config ?? {};
}

describe('the schema names the SQL layer depends on', () => {
	it('maps each wire kind to a table', () => {
		expect(tableForKind('list')).toBe(list);
		expect(tableForKind('task')).toBe(task);
		expect(tableForKind('banner' as never)).toBeNull();
	});

	it('knows exactly the kinds @ikoro/sync defines', () => {
		// A kind added to the protocol but not here cannot be pushed at all.
		expect([...KNOWN_KINDS].sort()).toEqual(['list', 'task']);
	});

	it('gives the ledger an op-id primary key, which IS the idempotency guarantee', () => {
		// `ON CONFLICT (id)` resolves against a UNIQUE index; the PK is the only one here.
		expect(appliedOp.id.primary).toBe(true);
		expect(appliedOp.id.name).toBe('id');
	});

	it('shares ONE sequence between list and task, by name', () => {
		// Two sequences would silently skip rows: the cursor is one number for both tables.
		expect(list.rev.generatedIdentity?.sequenceName).toBe(REV_SEQUENCE_NAME);
		expect(task.rev.generatedIdentity?.sequenceName).toBe(REV_SEQUENCE_NAME);
		// `toEqual`, not `toBe`: each column builder makes its own config object.
		expect(list.rev.generatedIdentity).toEqual(task.rev.generatedIdentity);
	});

	it('is an IDENTITY column, so Postgres hands out the number', () => {
		// `byDefault` permits the explicit `nextval()` the update path uses; `always` forbids it.
		expect(list.rev.generatedIdentity?.type).toBe('byDefault');
		expect(task.rev.generatedIdentity?.type).toBe('byDefault');
		expect(list.rev.hasDefault).toBe(true);
	});
});

describe('pull SQL', () => {
	it('reads both entity tables above the cursor, ordered, tombstones included', async () => {
		const db = createDbForTesting(NO_CONNECT);
		const { sql: text, params } = db
			.select()
			.from(list)
			.where(sql`${list.userId} = ${'user-1'} AND ${list.rev} > ${0}`)
			.toSQL();

		expect(text).toContain('rev');
		expect(params).toEqual(['user-1', 0]);

		// The feed is a UNION ALL, so a dropped branch stops delivering that kind.
		expect(text).toContain('list');
		expect(task).toBeDefined();
	});

	it('never filters deletedAt out of the feed', () => {
		// A client that cannot see tombstones re-pushes every deleted row, forever.
		const source = queriesSource();
		const feedBlock = source.slice(source.indexOf('export async function fetchChanges'));
		expect(feedBlock).not.toMatch(/deleted_at\s+IS\s+NULL/i);
		expect(feedBlock).toMatch(/deleted_at/);
	});

	it('asks for limit + 1 so hasMore needs no second query', () => {
		expect(queriesSource()).toMatch(/LIMIT \$\{limit \+ 1\}/);
	});
});

describe('instants are stored as timestamptz, not timestamp', () => {
	// `updatedAt` feeds LWW, and a zone-less `timestamp` silently shifts every instant by the
	// session timezone. Asserted on the schema AND on the generated DDL that actually runs.
	const syncColumns = [
		['list.updatedAt', list.updatedAt],
		['list.deletedAt', list.deletedAt],
		['task.updatedAt', task.updatedAt],
		['task.deletedAt', task.deletedAt],
		['appliedOp.createdAt', appliedOp.createdAt]
	] as const;

	for (const [label, column] of syncColumns) {
		it(`${label} carries a time zone`, () => {
			expect(sqlFlags(column).withTimezone).toBe(true);
		});
	}

	it('the generated migration really emits "timestamp with time zone"', () => {
		// A stale migration would let the zone-less version reach the database.
		expect(migrationSql()).toContain('timestamp with time zone NOT NULL');

		// No sync table may fall back to a zone-less timestamp.
		for (const table of ['list', 'task', 'applied_op']) {
			const block = migrationTable(migrationSql(), table);
			expect(block, table).toBeTruthy();
			const zoneLess = block
				.split('\n')
				.filter((line) => /"timestamp/.test(line) && !/with time zone/.test(line));
			expect(zoneLess, `zone-less timestamps in ${table}`).toEqual([]);
		}
	});
});

describe('push SQL', () => {
	it('claims the op id and writes the row in ONE statement', () => {
		// Two statements would leave a crash window: an op recorded as applied but never written.
		const source = queriesSource();
		const claim = source.indexOf('WITH claim AS');
		const conflict = source.indexOf('ON CONFLICT (id) DO NOTHING');

		expect(claim).toBeGreaterThan(-1);
		expect(conflict).toBeGreaterThan(claim);

		// Exactly one statement: no `;` separating a claim from its write.
		const between = source.slice(claim, source.indexOf('RETURNING rev', claim));
		expect(between).not.toContain(';');
	});

	it('guards the update with the same LWW comparison the TS layer makes', () => {
		const source = queriesSource();
		expect(source).toMatch(/updated_at\s*=\s*EXCLUDED\.updated_at/);
		expect(source).toMatch(/WHERE \$\{target\}\.updated_at < EXCLUDED\.updated_at/);
	});

	it('never deletes a row — deletes are tombstones', () => {
		// A hard DELETE would resurrect the task when a peer that missed it pushes it back.
		expect(queriesSource()).not.toMatch(/DELETE\s+FROM/i);
	});

	it('draws rev from the shared sequence, never from max() or count()', () => {
		const source = queriesSource();
		// Through the exported constant, so the sequence and its users cannot drift apart.
		expect(source).toContain('REV_SEQUENCE_NAME');
		expect(source).toMatch(/nextval\(\$\{sql\.raw\(REV_SEQUENCE_NAME\)\}\)/);
		// Both read state then write it: two concurrent inserts get the same rev.
		expect(source).not.toMatch(/max\s*\(\s*rev/i);
		expect(source).not.toMatch(/count\s*\(\s*\*\s*\)/i);
	});
});

describe('rev is one sequence for both tables', () => {
	it('names the columns the feed filters and ranges on', () => {
		// The feed's WHERE clause is `user_id = ? AND rev > ?`.
		expect(list.userId.name).toBe('user_id');
		expect(list.rev.name).toBe('rev');
		expect(task.userId.name).toBe('user_id');
		expect(task.rev.name).toBe('rev');
	});
});

/**
 * The query module's CODE, with comments removed — otherwise the prose forbidding
 * `max(rev)`/`count(*)` would satisfy the assertions.
 */
function queriesSource(): string {
	return queriesSourceText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

import queriesSourceText from '#lib/db/queries?raw' with { type: 'text' };
/**
 * The generated DDL. Read with `node:fs` because Vite refuses to serve a bare `.sql` module and
 * the file lives outside `src/`. Cached — the test only ever compares against it.
 */
let cachedMigration: string | undefined;
function migrationSql(): string {
	cachedMigration ??= readFileSync(new URL('../drizzle/0000_init.sql', import.meta.url), 'utf8');
	return cachedMigration;
}

/** The `CREATE TABLE "<name>" … ;` block, so assertions cannot leak across tables. */
function migrationTable(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE TABLE "${name}"`);
	if (start === -1) return '';
	const end = sql.indexOf(';--> statement-breakpoint', start);
	return end === -1 ? sql.slice(start) : sql.slice(start, end);
}
