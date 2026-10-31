import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/** Lazy init: module import must be inert, or `vite build` fails on an unconfigured machine. */

const KEYS = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'APP_ORIGIN'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
	vi.resetModules();
	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('the database client is inert until a query runs', () => {
	it('imports with DATABASE_URL unset', async () => {
		// Reaching this line IS the assertion: a top-level `neon(...)` would throw during import.
		const { db } = await import('#lib/db');
		expect(db).toBeDefined();
	});

	it('throws on first USE, and the message names the variable', async () => {
		const { db } = await import('#lib/db');
		try {
			void db.select;
			expect.unreachable('expected the lazy client to throw on use');
		} catch (cause) {
			const message = (cause as Error).message;
			// "DATABASE_URL is not set" is actionable; a driver type error is not.
			expect(message).toMatch(/DATABASE_URL/);
			expect(message).toMatch(/\.env/);
		}
	});

	it('is not poisoned by a failed attempt', async () => {
		// `instance ??= create()` stays undefined when `create()` throws, so a retry can succeed.
		const { db } = await import('#lib/db');
		expect(() => db.select).toThrow(/DATABASE_URL/);

		process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/none';
		expect(() => db.select).not.toThrow();
	});

	it('treats an unfilled .env.example as unconfigured', async () => {
		// The realistic first-run failure: copied and never filled in.
		process.env.DATABASE_URL = 'postgresql://<user>:<password>@<host>/<db>?sslmode=require';
		const { db } = await import('#lib/db');
		expect(() => db.select).toThrow(/DATABASE_URL/);
	});
});

describe('the auth instance is inert until a property is read', () => {
	it('imports with BETTER_AUTH_SECRET unset, having built nothing', async () => {
		const { auth, isAuthBuilt } = await import('#lib/server/auth');
		expect(auth).toBeDefined();
		expect(isAuthBuilt()).toBe(false);
	});

	it('builds on first property access, and names the missing secret', async () => {
		const { auth } = await import('#lib/server/auth');
		// `secret` is a plain string option — there is no lazy form, so `requireEnv` fires here.
		expect(() => auth.handler).toThrow(/BETTER_AUTH_SECRET/);
	});

	it('builds a real instance once the secret is present', async () => {
		process.env.BETTER_AUTH_SECRET = 'x'.repeat(32);
		process.env.APP_ORIGIN = 'http://localhost:5173';
		const { auth, isAuthBuilt } = await import('#lib/server/auth');

		expect(isAuthBuilt()).toBe(false);
		// `handler` and `api` exist without touching the database.
		expect(auth.handler).toBeDefined();
		expect(auth.api).toBeDefined();
		expect(isAuthBuilt()).toBe(true);
	});

	it('a placeholder secret counts as missing', async () => {
		process.env.BETTER_AUTH_SECRET = '   ';
		const { auth } = await import('#lib/server/auth');
		expect(() => auth.handler).toThrow(/BETTER_AUTH_SECRET/);
	});
});

describe('the synthetic account email is unrouteable and unique', () => {
	it('uses the RFC 2606 .invalid TLD', async () => {
		const { syntheticEmailFor } = await import('#lib/server/auth');
		// `.invalid` can never resolve or be registered, so it cannot reach a real inbox.
		const email = syntheticEmailFor('abc-123');
		expect(email).toBe('passkey-abc-123@ikoro.invalid');
		expect(email.endsWith('.invalid')).toBe(true);
	});

	it('is deterministic, so a retry targets the same row', async () => {
		const { syntheticEmailFor } = await import('#lib/server/auth');
		expect(syntheticEmailFor('abc-123')).toBe(syntheticEmailFor('abc-123'));
	});

	it('differs per user, satisfying the UNIQUE constraint on user.email', async () => {
		const { syntheticEmailFor } = await import('#lib/server/auth');
		expect(syntheticEmailFor('a')).not.toBe(syntheticEmailFor('b'));
	});
});
