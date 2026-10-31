import { describe, expect, it } from 'vitest';
import { cn } from '#lib/utils.js';

/** Guards the `#lib` alias, hand-wired for shadcn's `$lib` imports in vite.config.ts and tsconfig.json. */
describe('#lib alias', () => {
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
