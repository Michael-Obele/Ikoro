import { defineConfig } from 'vitest/config';

/**
 * No Svelte, no DOM, no database. The wire protocol is pure logic by design —
 * it is the one thing both the app and the server must agree on exactly, so it
 * has to be testable without either.
 */
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node'
	}
});
