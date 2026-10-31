/**
 * Root formatting conventions — the root sits outside every app's prettier config.
 * Mirrors `apps/app/prettier.config.js`, minus the Svelte/Tailwind plugins.
 * @type {import("prettier").Config}
 */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100
};

export default config;
