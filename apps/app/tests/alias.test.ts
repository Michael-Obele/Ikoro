import { describe, expect, it } from 'vitest';
import { cn } from '$lib/utils.js';

/**
 * Guards the one genuinely fragile part of the scaffold.
 *
 * shadcn-svelte's CLI and its generated components speak `$lib/...`, while
 * SvelteKit 3 dropped `$lib` in favour of `#lib` subpath imports. Support for
 * `$lib` is therefore wired by hand in two places — `resolve.alias` in
 * `vite.config.ts` (for Vite and Vitest) and `compilerOptions.paths` in
 * `tsconfig.json` (for the shadcn CLI and `tsc`). If either regresses, this
 * file is the cheapest place to notice.
 */
describe('$lib alias', () => {
	it('resolves inside vitest', () => {
		expect(typeof cn).toBe('function');
	});

	it('cn merges a class list, dropping falsy entries', () => {
		const out = cn('alpha', false, undefined, 'beta');
		expect(out).toContain('alpha');
		expect(out).toContain('beta');
		expect(out).not.toContain('false');
	});
});
