import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The sync server. No UI, no CSS, no Tailwind — `adapter-node` builds a plain
 * Node/Bun HTTP server and the whole surface is `/api/**`.
 *
 * There is deliberately NO `svelte.config.js` in this workspace: SvelteKit 3
 * moved the entire config into this `sveltekit()` call. Creating the old file as
 * well is the documented trap in VERSIONS.md §2.1.
 *
 * ── Why `.env` is copied into `process.env` below ───────────────────────────
 * Three true facts together leave the dev server with an EMPTY `process.env`:
 *
 *   1. Vite reads `.env` and hands the values to `$app/env/*`. It never writes
 *      them to `process.env`; that is by design, not a bug.
 *   2. SvelteKit 3's dev server does the same. Nothing under
 *      `node_modules/@sveltejs/kit/src/exports/vite/dev/` assigns to
 *      `process.env` at all.
 *   3. `bun run dev` runs the `vite` bin as a CHILD process. Bun's automatic
 *      `.env` loading applies to Bun's own runtime, not to binaries it spawns,
 *      so the child starts without them. (`bun run env` shows none of `.env`;
 *      `bun -e 'process.env.X'` does.)
 *
 * The result was a 500 on every request: `BETTER_AUTH_SECRET is not set`, thrown
 * from `requireEnv` even though `.env` was filled in. `src/lib/server/env.ts`
 * reads `process.env` on purpose — `tests/env.test.ts` drives it by setting
 * `process.env` directly — so the values have to be there. Copying them once at
 * config time is the smallest fix that keeps one source of truth.
 *
 * Not a build hazard: the DB and auth clients stay behind lazy proxies, so
 * nothing connects here. `bun run start` needs none of this (Bun loads `.env`
 * itself when it runs `build/index.js`), and on Fly the values arrive as real
 * environment variables, which `??=` never overwrites.
 */
export default defineConfig(({ mode }) => {
	// Third arg `''` = no prefix filter. `??=` so a real env var always wins.
	for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
		process.env[key] ??= value;
	}

	return {
		resolve: {
			// `#lib` is the canonical subpath (see `imports` in package.json). `$lib` is
			// kept as an alias purely so tooling that still reaches for it resolves.
			alias: { $lib: path.resolve('./src/lib') }
		},
		plugins: [
			sveltekit({
				adapter: adapter(),

				// Runes everywhere, same rule as apps/app and apps/landing.
				compilerOptions: {
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// Svelte inspector — always on, one block, as in the other apps.
				inspector: {
					toggleKeyCombo: 'alt-x',
					showToggleButton: 'active',
					toggleButtonPos: 'bottom-left'
				}
			})
		],
		test: {
			include: ['tests/**/*.test.ts'],
			// The whole server is pure logic plus SQL string-building. No jsdom file in
			// this workspace needs it, and opting in per file costs a whole extra
			// environment for nothing.
			environment: 'node',

			// `tests/lazy-init.test.ts` deliberately calls `vi.resetModules()` before
			// every import, because the memoised DB/auth instances live in module scope
			// and a stale one would make every later test depend on alphabetical order.
			// The cost is that Better Auth's module graph is re-imported from scratch
			// for each of those tests — which sits right on vitest's 5000 ms default,
			// so the suite passed on an idle machine and failed under load.
			//
			// 20 s is an honest budget for "transitively import a large auth library
			// eleven times". Raising it is the fix; deleting or skipping the tests
			// would remove the only guard against a lazy getter being "simplified"
			// back into a top-level read that breaks `vite build` on an unconfigured
			// machine.
			testTimeout: 20_000
		}
	};
});
