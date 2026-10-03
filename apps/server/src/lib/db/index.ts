/**
 * The Drizzle client — constructed LAZILY, on purpose.
 *
 * `neon(process.env.DATABASE_URL!)` at module scope would run during `vite
 * build`, on a machine with no database and no `.env`, and fail the build for a
 * reason that has nothing to do with the code. So the client is built on first
 * *use*, behind a Proxy: importing this module is inert, and the connection
 * string is read at the moment a query is issued.
 *
 * The Proxy forwards every property to the real instance and memoises it, so
 * `db.select()`, `db.insert()` and `db.query.task` all reach the same client and
 * the same Neon HTTP connection. Nothing is opened until something asks.
 *
 * `neon-http` is HTTP, so there is no pool to leak and no socket to hold open —
 * the right trade for a serverless-shaped deploy.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { requireEnv } from '#lib/server/env';
import { schema } from './schema';

function create() {
	const url = requireEnv(
		'DATABASE_URL',
		'Copy apps/server/.env.example to apps/server/.env and fill it in — a Neon connection string, e.g. postgresql://user:password@host/db?sslmode=require'
	);
	return drizzle(neon(url), { schema });
}

export type Database = ReturnType<typeof create>;

let instance: Database | undefined;

/**
 * Deferred so importing this module never requires `DATABASE_URL` to exist.
 *
 * The cast is safe by construction: `create()` returns a Drizzle database, and
 * the Proxy hands back exactly that object's properties.
 */
export const db = new Proxy({} as Database, {
	get(_target, prop, receiver) {
		instance ??= create();
		return Reflect.get(instance, prop, receiver);
	},
	has(_target, prop) {
		instance ??= create();
		return Reflect.has(instance, prop);
	}
});

/**
 * Build a client against an explicit URL.
 *
 * Used by tests that need a real Drizzle instance to generate SQL from without
 * connecting to anything — `db.select()...toSQL()` never opens a socket, so the
 * query layer can be verified offline.
 */
export function createDbForTesting(url: string): Database {
	return drizzle(neon(url), { schema });
}

export { schema };
