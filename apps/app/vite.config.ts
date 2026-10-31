import tailwindcss from '@tailwindcss/vite';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
	// shadcn-svelte emits `$lib/...`, so Vite resolves it here; tsconfig `paths`
	// covers the CLI preflight and `tsc`. Both are required.
	resolve: {
		alias: { $lib: path.resolve('./src/lib') },
		// Vitest needs svelte's CLIENT build, or `mount()` comes from internal/server
		// and every component test fails. Gated on VITEST so the real build is untouched.
		...(process.env.VITEST ? { conditions: ['browser'] } : {})
	},
	// Kit 3 has no `$app/version`; bake it from package.json so Settings, About and
	// the APK's versionName cannot drift.
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
