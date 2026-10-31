// @vitest-environment node
/**
 * Guards against re-added release-fact literals.
 *
 * Class of bug caught: a re-added release-fact literal would let the site ship
 * a stale version while claiming it is current. The site derives its release
 * from GitHub at build time with an offline derivation from
 * apps/app/package.json; a literal version or download URL anywhere else is a
 * second source of truth that rots on the next release-please bump.
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
 * release.ts is exempt: it holds the derivation patterns (the tag URL builder,
 * the published-file extensions), and that is their one legitimate home. Every
 * other src file must derive, never declare.
 */
const sources = sourceFiles(SRC);

/**
 * The curated `releases: Release[]` history used to be exempt, because its
 * `version: '0.3.2'` lines were past fact rather than a live claim. It is gone:
 * /changelog prints GitHub's own releases, so every version-shaped string left
 * in src is a live claim and must fail this guard.
 */

/** Block comments never ship a claim; the isNewer doc comment names 0.3.10. */
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
