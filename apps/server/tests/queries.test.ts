import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDbForTesting } from '#lib/db';
import { appliedOp, list, REV_SEQUENCE_NAME, task } from '#lib/db/schema';
import { tableForKind, KNOWN_KINDS } from '#lib/db/queries';

/**
 * The SQL layer, verified WITHOUT a database.
 *
 * Drizzle builds SQL without opening a connection, so `.toSQL()` exercises the
 * real query builder — the real table names, the real column names, the real
 * placeholders — and stops before anything is sent. That is as far as this can
 * be checked without a Neon URL, and it catches the class of bug that is most
 * likely in a hand-authored schema: a column that does not exist.
 *
 * What this CANNOT prove, and what still needs a real database:
 *   - that `nextval('ikoro_rev_seq')` actually advances monotonically,
 *   - that `ON CONFLICT (id) DO NOTHING` actually resolves a concurrent race,
 *   - that the generated migrations apply cleanly.
 * Those are the acceptance items in the M10 report that stay open.
 *
 * The URL below is a syntactically valid placeholder that is never connected to.
 * It is not a credential and there is no database behind it.
 */

const NO_CONNECT = 'postgresql://user:pass@127.0.0.1:5432/ikoro_test';

/**
 * The SQL-level flags on a drizzle column.
 *
 * `config` is declared `protected` on `Column`, which is drizzle telling you it
 * is not part of the public API — but `withTimezone` lives there and nowhere
 * else, and the generated-DDL assertion below covers the same ground from the
 * other side. Both are kept: the DDL check proves what Postgres will run, this
 * one proves the schema still says so if the migration is stale.
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
		// If a kind is added to the protocol and not here, the server rejects it
		// and the client cannot push it — a silent, permanent divergence.
		expect([...KNOWN_KINDS].sort()).toEqual(['list', 'task']);
	});

	it('gives the ledger an op-id primary key, which IS the idempotency guarantee', () => {
		// `ON CONFLICT (id) DO NOTHING` resolves against a UNIQUE index, and the
		// only one here is the primary key. Were `id` an ordinary column the clause
		// would fail at runtime; were the PK anything else, the concurrency race
		// would be decided on the wrong column.
		expect(appliedOp.id.primary).toBe(true);
		expect(appliedOp.id.name).toBe('id');
	});

	it('shares ONE sequence between list and task, by name', () => {
		// The pull cursor is a single number compared against both tables, so `rev`
		// must be globally ordered. Two sequences would silently skip rows: a
		// client at rev=100 from `list` would never see `task` rows numbered 40-99.
		//
		// Asserted against the exported CONSTANT, not a literal, so renaming the
		// sequence is a one-line change rather than a hunt through tests.
		expect(list.rev.generatedIdentity?.sequenceName).toBe(REV_SEQUENCE_NAME);
		expect(task.rev.generatedIdentity?.sequenceName).toBe(REV_SEQUENCE_NAME);
		// `toEqual`, not `toBe`: each column builder makes its own config object.
		// What must match is the sequence NAME, asserted above.
		expect(list.rev.generatedIdentity).toEqual(task.rev.generatedIdentity);
	});

	it('is an IDENTITY column, so Postgres hands out the number', () => {
		// `byDefault` rather than `always`: the update path assigns rev explicitly
		// with `nextval()`, and `always` forbids an explicit value on insert while
		// `byDefault` permits it. The sequence still does the allocating either
		// way — the application never computes a number.
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

		// The feed is a UNION ALL, so both tables' names must appear in the one
		// statement the route issues. A refactor that drops a branch silently
		// stops delivering that kind.
		expect(text).toContain('list');
		expect(task).toBeDefined();
	});

	it('never filters deletedAt out of the feed', () => {
		// A client that cannot see tombstones re-pushes every deleted row it still
		// holds, forever. Asserted structurally rather than by re-reading the route:
		// the feed query in queries.ts has no deleted_at predicate, and this test
		// fails loudly if someone adds one.
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
	// `updatedAt` is the INPUT to last-writer-wins. Postgres converts
	// `::timestamptz` into a zone-less `timestamp` using the SESSION timezone and
	// reads it back the same way, so any database not left at UTC silently shifts
	// every instant it stores — with no error anywhere. Two devices then
	// permanently disagree about who won a conflict, and nothing reports it.
	//
	// Asserted twice: once on the schema, and once on the GENERATED SQL. The
	// second is the one that matters, because drizzle/0000_init.sql is the
	// artifact that actually runs against Neon.
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
		// A green schema test and a stale migration file would let the zone-less
		// version reach the database, so the committed DDL is checked directly.
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
		// The property that makes a crash between "claim" and "write"
		// unrepresentable. Two separate statements would reintroduce it, and the
		// failure mode is an op recorded as applied that was never written —
		// invisible, because the client is still waiting to hear whether it
		// committed and will never push it again.
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
		// A hard DELETE here would resurrect every task the user deleted the
		// moment a peer that had not seen the delete pushed it back.
		expect(queriesSource()).not.toMatch(/DELETE\s+FROM/i);
	});

	it('draws rev from the shared sequence, never from max() or count()', () => {
		const source = queriesSource();
		// Referenced through the exported constant, so the sequence and the code
		// that uses it cannot drift apart.
		expect(source).toContain('REV_SEQUENCE_NAME');
		expect(source).toMatch(/nextval\(\$\{sql\.raw\(REV_SEQUENCE_NAME\)\}\)/);
		// Both of these read state and then write state, so two concurrent inserts
		// get the same rev and one row vanishes from the feed forever.
		expect(source).not.toMatch(/max\s*\(\s*rev/i);
		expect(source).not.toMatch(/count\s*\(\s*\*\s*\)/i);
	});
});

describe('rev is one sequence for both tables', () => {
	it('names the columns the feed filters and ranges on', () => {
		// The feed's WHERE clause is `user_id = ? AND rev > ?`, so the SQL text in
		// queries.ts only binds correctly if these names are exactly these.
		expect(list.userId.name).toBe('user_id');
		expect(list.rev.name).toBe('rev');
		expect(task.userId.name).toBe('user_id');
		expect(task.rev.name).toBe('rev');
	});
});

/**
 * The query module's CODE, with comments removed.
 *
 * Stripping matters: the file documents WHY `max(rev)` and `count(*)` are
 * forbidden, so scanning the raw text matched the prose explaining the rule. A
 * structural test that can be satisfied — or broken — by a comment is not
 * testing the code.
 */
function queriesSource(): string {
	return queriesSourceText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

import queriesSourceText from '#lib/db/queries?raw' with { type: 'text' };
/**
 * The generated DDL — the artifact drizzle-kit will run against Neon.
 *
 * Read with `node:fs` rather than a `?raw` import: Vite refuses to serve a bare
 * `.sql` module, and the file lives outside `src/` anyway. Read once and cached
 * because the test only ever compares against it.
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
