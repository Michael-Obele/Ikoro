import { defineConfig } from 'vitest/config';

/** Pure logic — no Svelte, no DOM, no database; both sides must agree on it exactly. */
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node'
	}
});
