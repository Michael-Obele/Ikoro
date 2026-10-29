/**
 * Guards on the claims this site makes.
 *
 * A marketing page is the one file in the repo with no failing test to stop it:
 * nothing crashes if the download page promises an alarm the app cannot schedule.
 * These are the checks that would notice.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	isNewer,
	limits,
	platformRows,
	privacy,
	releaseNoticeFor,
	releases,
	routes,
	views
} from '#lib/content';
import { deriveRelease } from '#lib/release';

const SRC = resolve(import.meta.dirname, '../src');

/** The app version: the single source the derived release comes from. */
const appPkg = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../app/package.json'), 'utf8')
) as { version: string };

/** Every `.svelte` / `.ts` file under src, as [path, contents]. */
function sourceFiles(dir: string): Array<[string, string]> {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		if (!/\.(svelte|ts|html)$/.test(entry)) return [];
		return [[path, readFileSync(path, 'utf8')]];
	});
}

const sources = sourceFiles(SRC);

describe('the platform table', () => {
	it('gives every platform a status and an explanation', () => {
		for (const platform of platformRows(deriveRelease(appPkg.version))) {
			expect(platform.status, platform.id).toMatch(
				/^(released|unreleased|building|preview|unsupported)$/
			);
			// A row whose detail is a shrug is a row nobody decided about.
			expect(platform.detail.length, platform.id).toBeGreaterThan(60);
		}
	});

	it('uses every status at most once, so a table cannot quietly say "everything works"', () => {
		const released = platformRows(deriveRelease(appPkg.version)).filter(
			(p) => p.status === 'released'
		);
		expect(released.length, 'more than one platform claims a published build').toBeLessThanOrEqual(
			1
		);
	});

	// The derived release names the published build; the notice says what is
	// published instead of saying nothing is.
	it('claims a download only where a release exists', () => {
		const rows = platformRows(deriveRelease(appPkg.version));
		const released = rows.filter((p) => p.status === 'released');
		expect(
			released.map((p) => p.id),
			'only Android has a published build'
		).toEqual(['android']);
		const derivedNotice = releaseNoticeFor(deriveRelease(appPkg.version));
		expect(derivedNotice, 'the notice must name the published version').toContain(
			`v${appPkg.version}`
		);
		expect(derivedNotice.toLowerCase(), 'the notice must admit the Play Store gap').toContain(
			'play store'
		);
		// A newer derivation names the newer version.
		expect(releaseNoticeFor(deriveRelease('9.9.9'))).toContain('9.9.9');
	});

	it('links the real published files, and nothing that does not exist', () => {
		const derived = deriveRelease(appPkg.version);
		for (const url of [derived.apkUrl, derived.aabUrl, derived.tagUrl]) {
			expect(url).toContain(`v${appPkg.version}`);
		}
		const android = platformRows(derived).find((p) => p.id === 'android');
		expect(android?.href).toBe(derived.tagUrl);
		expect(android?.action).toBe(`v${appPkg.version} release`);
		expect(derived.apkUrl.endsWith('.apk')).toBe(true);
		expect(derived.aabUrl.endsWith('.aab')).toBe(true);
		for (const [, text] of sources) {
			expect(text, 'no dead desktop download').not.toMatch(/href="[^"]*\.(deb|appimage)/i);
		}
	});

	it('states the Linux / Windows-macOS alarm split', () => {
		const rows = platformRows(deriveRelease(appPkg.version));
		const linux = rows.find((p) => p.id === 'linux-desktop');
		const other = rows.find((p) => p.id === 'windows-macos');
		expect(linux?.detail.toLowerCase()).toContain('systemd');
		expect(linux?.detail.toLowerCase()).toContain('closed');
		expect(other?.detail.toLowerCase()).toContain('windows and macos');
		expect(
			limits.some(
				(limit) => limit.toLowerCase().includes('linux') && limit.toLowerCase().includes('closed')
			),
			'the home-page limits must admit the Linux split'
		).toBe(true);
	});

	it('never offers an action it has no target for', () => {
		for (const platform of platformRows(deriveRelease(appPkg.version))) {
			expect(Boolean(platform.href), platform.id).toBe(Boolean(platform.action));
		}
	});
});

describe('the pages', () => {
	it('has a page for every route the navigation links to', () => {
		for (const route of routes) {
			const path =
				route === '/' ? join(SRC, 'routes/+page.svelte') : join(SRC, `routes${route}/+page.svelte`);
			expect(statSync(path).isFile(), route).toBe(true);
		}
	});

	it('only links to routes that exist', () => {
		const internal = sources.flatMap(([path, text]) =>
			[...text.matchAll(/href="(\/[^"]*)"/g)].map((match) => ({ path, href: match[1] }))
		);

		expect(internal.length).toBeGreaterThan(5);
		for (const { path, href } of internal) {
			if (href.startsWith('/#') || href.startsWith('/icons/')) continue;
			expect(routes as readonly string[], `${path} → ${href}`).toContain(href);
		}
	});

	it('only links to anchors that exist on the page they point at', () => {
		const home = readFileSync(join(SRC, 'routes/+page.svelte'), 'utf8');
		for (const [, href] of [...home.matchAll(/href="(\/#[^"]*)"/g)]) {
			const anchor = href.slice(2);
			// Either a Section id, or the skip link's #main target in the layout.
			const target = anchor === 'main' ? 'routes/+layout.svelte' : 'routes/+page.svelte';
			expect(readFileSync(join(SRC, target), 'utf8'), href).toContain(`id="${anchor}"`);
		}
	});

	it('has exactly one h1 per page', () => {
		for (const route of routes) {
			const path =
				route === '/' ? join(SRC, 'routes/+page.svelte') : join(SRC, `routes${route}/+page.svelte`);
			const headings = readFileSync(path, 'utf8').match(/<h1[\s>]/g) ?? [];
			expect(headings.length, route).toBe(1);
		}
	});
});

describe('what the site says about itself', () => {
	it('ships no tracker, by any of the names they use', () => {
		const banned =
			/gtag|googletagmanager|plausible|hotjar|segment|mixpanel|sentry|_vercel|matomo|posthog|cookie-banner/;
		for (const [path, text] of sources) {
			expect(text, path).not.toMatch(banned);
		}
	});

	it('makes no network calls from markup', () => {
		for (const [path, text] of sources) {
			// A script tag with a src, or an import from a URL, is the app asking
			// somebody else's server for something.
			expect(text, path).not.toMatch(/<script[^>]+src=/);
			expect(text, path).not.toMatch(/https?:\/\/[^"'\s]+<\/script>/);
		}
	});

	it('serves its font from itself', () => {
		const css = readFileSync(join(SRC, 'routes/layout.css'), 'utf8');
		expect(css).toContain('@fontsource-variable/jetbrains-mono');
		expect(css).not.toMatch(/fonts\.(googleapis|gstatic)/);
	});
});

describe('the content itself', () => {
	it('describes every screen and every privacy claim', () => {
		expect(views.length).toBeGreaterThanOrEqual(3);
		expect(privacy.length).toBeGreaterThanOrEqual(4);
		expect(limits.length).toBeGreaterThanOrEqual(4);
	});

	it('does not mention a feature that no release contains', () => {
		const shipped = releases
			.flatMap((release) => [...release.included])
			.join(' ')
			.toLowerCase();
		// If a feature is named in the marketing copy, some release entry has to
		// account for it. Repeating tasks are the recurring trap: the schema reserves
		// the field, and that is not the same as shipping it.
		expect(shipped).not.toMatch(/repeating tasks/);
	});

	it('derives the release from the app version, structurally in step', () => {
		// No site.version anymore: both sides derive from the same place, so
		// the test asserts the derivation, not equality of two hand-kept numbers.
		const derived = deriveRelease(appPkg.version);
		expect(derived.version).toBe(appPkg.version);
		const android = platformRows(derived).find((p) => p.id === 'android');
		expect(android?.href).toContain(`v${appPkg.version}`);
		expect(android?.action).toContain(`v${appPkg.version}`);
		expect(releaseNoticeFor(derived)).toContain(`v${appPkg.version}`);
	});

	it('keeps releases newest-first: the changelog lag-row logic reads releases[0]', () => {
		for (let i = 0; i < releases.length - 1; i++) {
			expect(isNewer(releases[i].version, releases[i + 1].version)).toBe(true);
		}
	});
});
