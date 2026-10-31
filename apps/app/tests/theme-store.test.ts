import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the anti-flash contract: the storage key, dark class and media query are written twice (app.html's inline script and theme.svelte.ts) because an imported module paints too late. This file fails if the two sides disagree.
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
 * The REAL placeholder, alone on its own line: a bare `indexOf` would find the copy named in the script's own comment.
 */
const headPlaceholder = appHtml.search(/^\s*%sveltekit\.head%\s*$/m);
expect(headPlaceholder, 'app.html must contain %sveltekit.head%').toBeGreaterThan(-1);

/**
 * SvelteKit substitutes only the FIRST occurrence, so a second mention earlier (e.g. in a comment) absorbs it and the literal "%sveltekit.head%" paints across every screen.
 */
it('names the head placeholder exactly once, so nothing earlier can absorb it', () => {
	expect(appHtml.match(/%sveltekit\.head%/g) ?? []).toHaveLength(1);
});

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
		// PersistedState JSON-serialises, so storage holds '"dark"' with quotes.
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
		// Otherwise the UA keeps scrollbar, form controls and caret light — a flash of its own.
		expect(script).toContain('colorScheme');
	});
});
