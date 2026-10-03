// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// See src/app.d.ts.d.ts
declare global {
	/**
	 * The app version, injected from package.json at build time by
	 * `vite.config.ts`. SvelteKit 3 removed `$app/version`, and this is the
	 * single place the number comes from — Settings and the APK's `versionName`
	 * both read the same field, so they cannot disagree.
	 */
	const __IKORO_VERSION__: string;
}

export {};
