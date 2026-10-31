import tailwindcss from '@tailwindcss/vite';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// Same as apps/app — shadcn output speaks `$lib/...`.
	resolve: {
		alias: { $lib: path.resolve('./src/lib') }
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be
				// removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Prerendered HTML by design; no `fallback` — one would hide a 404 behind
			// the homepage.
			adapter: staticAdapter({
				pages: 'build',
				assets: 'build',
				precompress: false,
				strict: true
			}),

			// Svelte inspector, always on; Kit 3 dropped `vitePlugin`, so options sit here.
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
