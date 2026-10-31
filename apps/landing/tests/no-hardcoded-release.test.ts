// @vitest-environment node
/**
 * Guards against re-added release-fact literals: a literal version or download URL
 * elsewhere is a second source of truth that rots at the next release-please bump.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '../src');
const RELEASE_TS = join(SRC, 'lib/release.ts');

/** Every `.svelte` / `.ts` / `.html` file under src, except release.ts. */
function sourceFiles(dir: string): Array<[string, string]> {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		if (path === RELEASE_TS) return [];
		if (!/\.(svelte|ts|html)$/.test(entry)) return [];
		return [[path, readFileSync(path, 'utf8')]];
	});
}

/**
 * release.ts holds the derivation patterns (tag URL builder, file extensions) -- their
 * one legitimate home. Every other src file must derive, never declare.
 */
const sources = sourceFiles(SRC);

/** Block comments never ship a claim. */
function withoutBlockComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('no hardcoded release facts', () => {
	it('contains no version literal anywhere in src', () => {
		const versionLiteral = /\d+\.\d+\.\d+/;
		for (const [path, text] of sources) {
			const scanned = withoutBlockComments(text);
			expect(scanned, `${path} must not contain a version literal`).not.toMatch(versionLiteral);
		}
	});

	it('contains no /releases/download/ URL literal outside release.ts', () => {
		for (const [path, text] of sources) {
			expect(text, `${path} must not contain a download URL literal`).not.toContain(
				'/releases/download/'
			);
		}
	});
});
