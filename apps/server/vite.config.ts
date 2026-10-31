import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The sync server: `adapter-node`, no UI, everything under `/api/**`, and no `svelte.config.js` (Kit 3 moved it here).
 * `.env` is copied into `process.env` because Vite, Kit's dev server and bun's spawned vite never do.
 */
export default defineConfig(({ mode }) => {
	// Third arg `''` = no prefix filter. `??=` so a real env var always wins.
	for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
		process.env[key] ??= value;
	}

	return {
		resolve: {
			// `#lib` is canonical; `$lib` stays only for tooling that still reaches for it.
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
			// Pure logic plus SQL string-building; no file needs jsdom.
			environment: 'node',

			// `lazy-init.test.ts` calls `vi.resetModules()` per import, so Better Auth's graph
			// is re-imported 11 times — right on vitest's 5 s default. Raising the budget is
			// the fix; those tests guard a lazy getter from being made top-level again.
			testTimeout: 20_000
		}
	};
});
