/**
 * The Drizzle client, built lazily behind a Proxy so importing it is inert — a module-scope
 * `neon()` would fail `vite build`. `neon-http` is HTTP, so no pool to leak.
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

/** Deferred so importing this module never requires `DATABASE_URL` to exist. */
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

/** Build a client against an explicit URL. Tests generate SQL with it; nothing connects. */
export function createDbForTesting(url: string): Database {
	return drizzle(neon(url), { schema });
}

export { schema };
