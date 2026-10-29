/**
 * Guards the icon-placeholder REGISTRY against silent fallback.
 *
 * Class of bug caught: the shim falls back to XIcon for any unknown
 * `lucide="..."` name, so a future component fetched via
 * scripts/fetch-shadcn.ts referencing a new icon would render the WRONG
 * icon while `check` stays green. The shim itself is untouched (parity
 * with apps/app); it does not export REGISTRY, so this test reads
 * icon-placeholder.svelte as text and asserts each used name appears as
 * a registry key. If zero `lucide=` names exist, the scan passes vacuously.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = resolve(import.meta.dirname, '../src/lib/components/ui');
const SHIM = resolve(
	import.meta.dirname,
	'../src/lib/components/icon-placeholder/icon-placeholder.svelte'
);

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return svelteFiles(path);
		return entry.endsWith('.svelte') ? [path] : [];
	});
}

describe('icon-placeholder registry', () => {
	it('covers every lucide name used by ui components', () => {
		const shim = readFileSync(SHIM, 'utf8');
		const names = svelteFiles(UI).flatMap((path) =>
			[...readFileSync(path, 'utf8').matchAll(/lucide="([^"]+)"/g)].map((m) => m[1])
		);
		for (const name of new Set(names)) {
			expect(shim, `icon-placeholder has no registry entry for lucide="${name}"`).toMatch(
				new RegExp(`\\b${name}\\b`)
			);
		}
	});
});
