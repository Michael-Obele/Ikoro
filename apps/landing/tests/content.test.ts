/**
 * Guards the claims this site makes: nothing crashes if the download page promises an
 * alarm the app cannot schedule.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	limits,
	platformRows,
	privacy,
	releaseEntries,
	releaseNotes,
	releaseNotice,
	routes,
	views
} from '#lib/content';
import { deriveRelease, parseLatestRelease, type ReleaseInfo } from '#lib/release';

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

/** A release that really exists, carrying all five files -- the only shape that may claim a download. */
const COMPLETE_RELEASE = parseLatestRelease({
	tag_name: `v${appPkg.version}`,
	published_at: '2026-10-29T12:58:00Z',
	html_url: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v' + appPkg.version,
	assets: [
		{ name: 'Ikoro.aab', size: 3375468, browser_download_url: 'https://example.test/a.aab' },
		{ name: 'Ikoro.apk', size: 3526226, browser_download_url: 'https://example.test/a.apk' },
		{
			name: 'Ikoro.AppImage',
			size: 85862904,
			browser_download_url: 'https://example.test/a.AppImage'
		},
		{ name: 'Ikoro.deb', size: 2173842, browser_download_url: 'https://example.test/a.deb' },
		{ name: 'Ikoro.rpm', size: 2174515, browser_download_url: 'https://example.test/a.rpm' }
	]
}) as ReleaseInfo;

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

	/** Statuses must be facts about the release: an offline build knows a version and nothing else. */
	it('releases nothing at all when the release could not be checked', () => {
		const released = platformRows(deriveRelease(appPkg.version)).filter(
			(p) => p.status === 'released'
		);
		expect(released.map((p) => p.id), 'no file was confirmed, so nothing is offered').toEqual([]);
	});

	it('releases exactly the platforms whose files the release carries', () => {
		const released = platformRows(COMPLETE_RELEASE)
			.filter((p) => p.status === 'released')
			.map((p) => p.id);
		expect(released).toEqual(['android', 'linux-desktop']);

		const androidOnly = parseLatestRelease({
			tag_name: `v${appPkg.version}`,
			published_at: '2026-10-29T12:58:00Z',
			html_url: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v' + appPkg.version,
			assets: [{ name: 'Ikoro.apk', size: 1, browser_download_url: 'https://example.test/a.apk' }]
		}) as ReleaseInfo;
		expect(
			platformRows(androidOnly)
				.filter((p) => p.status === 'released')
				.map((p) => p.id)
		).toEqual(['android']);
	});

	it('keeps a platform that is not released in the table, so absence is never silence', () => {
		const rows = platformRows(COMPLETE_RELEASE);
		expect(rows).toHaveLength(4);
		expect(rows.filter((p) => p.status === 'released').length).toBeLessThan(rows.length);
	});

	it('names the version in the notice, and the newer version in a newer notice', () => {
		const derivedNotice = releaseNotice(deriveRelease(appPkg.version));
		expect(derivedNotice.title).toContain(`v${appPkg.version}`);
		const readyNotice = releaseNotice(COMPLETE_RELEASE);
		expect(readyNotice.body).toContain(`v${appPkg.version}`);
		expect(readyNotice.body.toLowerCase(), 'the notice must admit the Play Store gap').toContain(
			'play store'
		);
		expect(releaseNotice(deriveRelease('9.9.9')).title).toContain('9.9.9');
	});

	/** The download page must never build a URL; every link comes from `release.assets`. */
	it('links the release page, never a guessed download URL', () => {
		const derived = deriveRelease(appPkg.version);
		for (const row of platformRows(derived)) {
			if (row.href !== undefined) expect(row.href).toBe(derived.tagUrl);
		}
		const android = platformRows(derived).find((p) => p.id === 'android');
		expect(android?.action).toBe(`v${appPkg.version} release`);
		expect(Object.keys(derived.assets)).toEqual([]);
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
			// A script with a src, or an import from a URL, is the app asking another server for something.
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

	/** No curated `releases` array: a second source of truth cannot creep back in. */
	it('holds no changelog of its own', () => {
		const text = readFileSync(join(SRC, 'lib/content.ts'), 'utf8');
		expect(text).not.toMatch(/export const releases\b/);
		expect(text).not.toMatch(/changelogLimit|lagNotice|isNewer/);
	});

	it('derives the release from the app version, structurally in step', () => {
		const derived = deriveRelease(appPkg.version);
		expect(derived.version).toBe(appPkg.version);
		const android = platformRows(derived).find((p) => p.id === 'android');
		expect(android?.href).toContain(`v${appPkg.version}`);
		expect(android?.action).toContain(`v${appPkg.version}`);
		expect(releaseNotice(derived).title).toContain(`v${appPkg.version}`);
	});

	it('prints the releases in the order GitHub returned them', () => {
		const entries = releaseEntries([COMPLETE_RELEASE, deriveRelease('0.0.1')]);
		expect(entries.map((entry) => entry.version)).toEqual([COMPLETE_RELEASE.version, '0.0.1']);
		expect(entries[0].tagUrl).toBe(COMPLETE_RELEASE.tagUrl);
	});

	it("takes each entry's date from the release, never from a hand-kept string", () => {
		expect(releaseEntries([COMPLETE_RELEASE])[0].date).toBe('2026-10-29');
		// A derived release knows no date, and the page prints no badge for it.
		expect(releaseEntries([deriveRelease('0.0.1')])[0].date).toBe('');
	});

	it('reads the notes out of the release body, dropping links, bold and bot noise', () => {
		const body = [
			'## [0.3.8](https://example.test/compare) (2026-10-31)',
			'',
			'### Features',
			'',
			'* **alarms:** ring audibly ([abc1234](https://example.test/commit/abc1234))',
			'',
			'## New Contributors',
			'* github-actions[bot] made their first contribution in https://example.test/pull/1',
			''
		].join('\n');
		expect(releaseNotes(body)).toEqual(['alarms: ring audibly']);
	});

	it('says a release has no notes rather than inventing them', () => {
		expect(releaseNotes('**Full Changelog**: https://example.test/c')).toEqual([]);
		expect(releaseEntries([deriveRelease('0.0.1')])[0].included).toEqual([]);
	});

	it('names the files a release did not carry, and only those', () => {
		expect(releaseEntries([COMPLETE_RELEASE])[0].missing).toEqual([]);
		expect(releaseEntries([deriveRelease('0.0.1')])[0].missing).toEqual([
			'No APK on this release',
			'No DEB on this release',
			'No AppImage on this release',
			'No RPM on this release'
		]);
	});
});
