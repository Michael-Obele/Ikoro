import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// shadcn-svelte's CLI and its generated components still speak `$lib/...`.
	// SvelteKit 3 deprecated the `sveltekit({ alias })` option in favour of `#lib`
	// subpath imports, so `$lib` is resolved here by Vite, while tsconfig `paths`
	// covers the CLI's preflight check and `tsc`. Both are required.
	resolve: {
		alias: { $lib: path.resolve('./src/lib') }
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
			adapter: adapter({
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
