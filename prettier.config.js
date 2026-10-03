/**
 * Root formatting conventions.
 *
 * This exists because the repo root sits outside every app's own prettier
 * config, so editors and `prettier` itself fell back to their defaults (double
 * quotes, 2-space indent) and reformatted root files against the convention
 * used everywhere else. These options mirror `apps/app/prettier.config.js`
 * exactly, minus the Svelte/Tailwind plugins — those are resolved per app.
 *
 * Markdown is deliberately not formatted: the plan's tables are hand-aligned
 * and prettier reflows them into noise. See .prettierignore.
 *
 * @type {import("prettier").Config}
 */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100
};

export default config;
