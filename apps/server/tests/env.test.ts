import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { envList, envInt, optionalEnv, requireEnv } from '#lib/server/env';

/**
 * The lazy environment reader.
 *
 * The rule this file exists to enforce: an UNCONFIGURED machine must still be
 * able to build. `vite build` walks the module graph, so a top-level
 * `process.env.DATABASE_URL` fed straight into `neon()` fails the build of code
 * that has nothing wrong with it.
 *
 * A placeholder is treated as absent on purpose. `.env.example` ships
 * `<user>/<host>` placeholders, and a developer who copies it and forgets to
 * fill it in should get "DATABASE_URL is not set", not a DNS failure against a
 * host named `<host>`.
 */

const KEYS = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'TRUSTED_ORIGINS', 'SOME_INT'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('requireEnv', () => {
	it('returns a real value', () => {
		process.env.DATABASE_URL = 'postgresql://u:p@h/db';
		expect(requireEnv('DATABASE_URL')).toBe('postgresql://u:p@h/db');
	});

	it('names the variable when it is absent', () => {
		// "DATABASE_URL is not set" is actionable. "undefined is not a string" is not.
		expect(() => requireEnv('DATABASE_URL')).toThrow(/DATABASE_URL/);
	});

	it('includes the hint when one is given', () => {
		expect(() => requireEnv('DATABASE_URL', 'Copy .env.example first.')).toThrow(
			/Copy \.env\.example/
		);
	});

	it('treats an empty string as absent', () => {
		process.env.DATABASE_URL = '';
		expect(() => requireEnv('DATABASE_URL')).toThrow(/DATABASE_URL/);
	});

	it('treats a .env.example placeholder as absent', () => {
		// The placeholder shipped in the file, unfilled.
		process.env.DATABASE_URL = 'postgresql://<user>:<password>@<host>/<db>?sslmode=require';
		expect(() => requireEnv('DATABASE_URL')).toThrow(/DATABASE_URL/);
	});

	it('treats a half-edited connection string as absent', () => {
		// More realistic than the untouched placeholder: someone edited the user
		// and forgot the host. An angle bracket anywhere means "not finished".
		process.env.DATABASE_URL = 'postgresql://me:secret@<host>/ikoro';
		expect(() => requireEnv('DATABASE_URL')).toThrow(/DATABASE_URL/);
	});

	it('trims surrounding whitespace', () => {
		process.env.DATABASE_URL = '  postgresql://u:p@h/db  ';
		expect(requireEnv('DATABASE_URL')).toBe('postgresql://u:p@h/db');
	});
});

describe('optionalEnv', () => {
	it('is undefined rather than throwing', () => {
		expect(optionalEnv('DATABASE_URL')).toBeUndefined();
	});
});

describe('envList', () => {
	it('splits, trims and drops blanks', () => {
		process.env.TRUSTED_ORIGINS = 'capacitor://localhost, https://localhost ,';
		expect(envList('TRUSTED_ORIGINS')).toEqual(['capacitor://localhost', 'https://localhost']);
	});

	it('is empty when unset', () => {
		expect(envList('TRUSTED_ORIGINS')).toEqual([]);
	});
});

describe('envInt', () => {
	it('falls back when unset or unparseable', () => {
		expect(envInt('SOME_INT', 25, 5, 60)).toBe(25);
		process.env.SOME_INT = 'not a number';
		expect(envInt('SOME_INT', 25, 5, 60)).toBe(25);
	});

	it('clamps into range', () => {
		process.env.SOME_INT = '1';
		expect(envInt('SOME_INT', 25, 5, 60)).toBe(5);
		process.env.SOME_INT = '9999';
		expect(envInt('SOME_INT', 25, 5, 60)).toBe(60);
	});

	it('accepts an in-range value', () => {
		process.env.SOME_INT = '30';
		expect(envInt('SOME_INT', 25, 5, 60)).toBe(30);
	});
});
