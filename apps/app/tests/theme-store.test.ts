import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE ANTI-FLASH CONTRACT.
 *
 * Resolving the theme before first paint requires the storage key, the JSON
 * shape and the media query to be written down twice: once in an inline script
 * in `src/app.html`, and once in `src/lib/theme/theme.svelte.ts`. The script
 * cannot import the module — an imported module arrives after the stylesheet has
 * already painted, which is the flash.
 *
 * So the duplication is permanent, and the only thing keeping it honest is this
 * file. It reads both sources and fails if they disagree. Rename the key on one
 * side only and this goes red, instead of the app quietly reverting to System
 * on every launch for every user — a failure with no error message anywhere.
 */

const read = (relative: string): string =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const appHtml = read('../src/app.html');
const store = read('../src/lib/theme/theme.svelte.ts');

/** The script is inline and TypeScript cannot be imported into plain HTML. */
function inlineScript(): string {
	const open = appHtml.indexOf('<script>');
	const close = appHtml.indexOf('</script>', open);
	expect(open, 'app.html must contain an inline <script>').toBeGreaterThan(-1);
	expect(close, 'the inline <script> must be closed').toBeGreaterThan(open);
	return appHtml.slice(open, close);
}

const script = inlineScript();

/**
 * The REAL SvelteKit placeholder, as a standalone line.
 *
 * A plain `indexOf('%sveltekit.head%')` is a trap: the explanatory comment inside
 * the inline script names the placeholder, so a substring search finds the
 * comment's copy first and concludes the script is in the wrong place. The real
 * one is the token alone on its own line.
 */
const headPlaceholder = appHtml.search(/^\s*%sveltekit\.head%\s*$/m);
expect(headPlaceholder, 'app.html must contain %sveltekit.head%').toBeGreaterThan(-1);

describe('pre-paint theme script', () => {
	it('is inline in <head>, before %sveltekit.head% injects the stylesheet', () => {
		// Placement is the entire feature. After the stylesheet link it is a no-op.
		expect(script.length).toBeGreaterThan(0);
		expect(appHtml.indexOf('<script>')).toBeLessThan(headPlaceholder);
		expect(appHtml.indexOf('</script>')).toBeLessThan(headPlaceholder);
	});

	it('uses the same storage key as the store', () => {
		const fromStore = /THEME_STORAGE_KEY\s*=\s*'([^']+)'/.exec(store)?.[1];
		expect(fromStore).toBeTruthy();
		expect(script).toContain(`'${fromStore}'`);
	});

	it('uses the same dark class as the store', () => {
		const fromStore = /DARK_CLASS\s*=\s*'([^']+)'/.exec(store)?.[1];
		expect(fromStore).toBeTruthy();
		expect(script).toContain(`'${fromStore}'`);
		expect(script).toContain('classList.toggle');
	});

	it('uses the same media query as the store', () => {
		const fromStore = /DARK_MEDIA_QUERY\s*=\s*'([^']+)'/.exec(store)?.[1];
		expect(fromStore).toBeTruthy();
		expect(script).toContain(`'${fromStore}'`);
	});

	it('accepts exactly the three choices the store accepts', () => {
		// PersistedState serialises with JSON.stringify, so storage holds '"dark"'
		// with quotes. Reading the bare string is a bug that only shows up as "the
		// toggle does not stick", so the JSON.parse is asserted explicitly.
		expect(script).toContain('JSON.parse');
		for (const choice of ['system', 'light', 'dark']) {
			expect(script).toContain(`'${choice}'`);
		}
		expect(store).toContain("'system', 'light', 'dark'");
	});

	it('degrades to the OS rather than throwing when storage is unavailable', () => {
		// Private browsing and a corrupt entry must not blank the app.
		expect(script).toContain('try');
		expect(script).toContain('catch');
		expect(script).toMatch(/choice = 'system'/);
	});

	it('sets colorScheme as well as the class', () => {
		// Without it the UA stylesheet keeps the scrollbar, form controls and the
		// caret light, which is its own small flash on a dark page.
		expect(script).toContain('colorScheme');
	});
});
