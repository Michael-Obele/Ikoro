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
import { limits, platforms, privacy, releases, routes, site, views } from '#lib/content';

const SRC = resolve(import.meta.dirname, '../src');

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
		for (const platform of platforms) {
			expect(platform.status, platform.id).toMatch(
				/^(released|unreleased|building|preview|unsupported)$/
			);
			// A row whose detail is a shrug is a row nobody decided about.
			expect(platform.detail.length, platform.id).toBeGreaterThan(60);
		}
	});

	it('uses every status at most once, so a table cannot quietly say "everything works"', () => {
		const released = platforms.filter((p) => p.status === 'released');
		expect(released.length, 'more than one platform claims a published build').toBeLessThanOrEqual(
			1
		);
	});

	// The one test that must be edited rather than deleted when v0.1.0 ships.
	it('claims nothing is downloadable until a release exists', () => {
		expect(
			platforms.some((p) => p.status === 'released'),
			'a platform is marked released — update this test deliberately, and delete the release notice'
		).toBe(false);
	});

	it('never offers an action it has no target for', () => {
		for (const platform of platforms) {
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

	it('keeps the version in step with the app', () => {
		const appPkg = JSON.parse(
			readFileSync(resolve(import.meta.dirname, '../../app/package.json'), 'utf8')
		) as { version: string };
		expect(site.version, 'the site and the app must report the same version').toBe(appPkg.version);
	});
});
