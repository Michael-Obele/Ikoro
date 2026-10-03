import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * The lazy-initialisation contract, which exists because of a build.
 *
 * SvelteKit's post-build `analyse` step IMPORTS the built server module to trace
 * its routes. Anything read at module scope therefore runs during `vite build` —
 * on a machine with no `.env`, no database and no secrets. A top-level
 * `neon(process.env.DATABASE_URL)`, or a top-level `betterAuth({ secret })`,
 * fails the build of code that has nothing wrong with it.
 *
 * Both of those happened, in that order, while writing this milestone. These
 * tests assert the property that prevents a third, so the next person to
 * "simplify" a lazy getter back into a top-level read finds a red test rather
 * than a broken pipeline.
 *
 * `vi.resetModules()` before each import is load-bearing: the memoised instance
 * lives in module scope, so without it the first test to touch the Proxy decides
 * the outcome of every test after it — which is a test that passes or fails
 * depending on alphabetical luck.
 *
 * WHAT IS NOT TESTED HERE: that a real query succeeds against a real database.
 * There is no `DATABASE_URL` in this environment, and inventing one would be
 * worse than documenting the gap.
 */

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
		// Reaching this line IS the assertion: a top-level `neon(...)` would have
		// thrown during the import and failed `vite build` on an unconfigured
		// machine.
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
		// `instance ??= create()` leaves `instance` undefined when `create()` throws,
		// so a later call with the variable set still succeeds. If a failed attempt
		// stuck, fixing the env would need a process restart — on a deployed
		// instance, a redeploy.
		const { db } = await import('#lib/db');
		expect(() => db.select).toThrow(/DATABASE_URL/);

		process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/none';
		expect(() => db.select).not.toThrow();
	});

	it('treats an unfilled .env.example as unconfigured', async () => {
		// The realistic first-run failure: someone copies `.env.example`, fills in
		// nothing, and runs. That must say "not set", not attempt DNS for a host
		// literally named `<host>`.
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
		// `secret` is a plain `string` option — there is no lazy form of it — so
		// this is exactly where `requireEnv` fires.
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
		// `.invalid` can never resolve and can never be registered, so a synthetic
		// address can neither reach a real inbox nor collide with a real account.
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
