import tailwindcss from '@tailwindcss/vite';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// Same reason as apps/app: shadcn-svelte's registry output and its
	// components.json still speak `$lib/...`, so the alias is re-declared here for
	// Vite while tsconfig `paths` covers tsc. Both are required.
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

			// Prerendered HTML is the point of this site, so `ssr` stays on
			// (its default) and every route exports `prerender = true`. There is
			// no `fallback`: this is a set of pages, not an SPA, and a fallback
			// page would hide a 404 behind the homepage.
			adapter: staticAdapter({
				pages: 'build',
				assets: 'build',
				precompress: false,
				strict: true
			}),

			// Svelte inspector — always on, one block, as in apps/app. SvelteKit 3
			// removed `vitePlugin`, so these options sit on the sveltekit() plugin.
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
