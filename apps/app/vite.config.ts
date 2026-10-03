import tailwindcss from '@tailwindcss/vite';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
	// shadcn-svelte's CLI and its generated components still speak `$lib/...`.
	// SvelteKit 3 deprecated the `sveltekit({ alias })` option in favour of `#lib`
	// subpath imports, so `$lib` is resolved here by Vite, while tsconfig `paths`
	// covers the CLI's preflight check and `tsc`. Both are required.
	resolve: {
		alias: { $lib: path.resolve('./src/lib') },
		// Under Vitest, `svelte` must resolve its CLIENT build. Without this,
		// `mount()` comes from `svelte/internal/server` and every component test
		// fails with `lifecycle_function_unavailable` — a green-looking suite that
		// silently tests nothing. Gated on VITEST so the real build is untouched.
		...(process.env.VITEST ? { conditions: ['browser'] } : {})
	},
	// Kit 3 has no `$app/version`, so the app version is baked in from
	// package.json at build time. One source of truth: Settings, the About box,
	// and the APK's `versionName` all read the same field, so they cannot drift
	// into reporting different numbers for the same build.
	define: {
		__IKORO_VERSION__: JSON.stringify(pkg.version)
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Static SPA: one build feeds both native shells (Capacitor webDir, Tauri frontendDist).
			adapter: staticAdapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: false,
				strict: true
			}),

			// Svelte inspector — always on. SvelteKit 3 removed `vitePlugin`, so
			// vite-plugin-svelte options sit directly on the sveltekit() plugin.
			inspector: {
				toggleKeyCombo: 'alt-x',
				showToggleButton: 'active',
				toggleButtonPos: 'bottom-left'
			}
		})
	],
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node'
	}
});
