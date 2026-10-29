/**
 * Guards the build-time release fetch against lying or crashing.
 *
 * Class of bug caught: the landing page renders a version number and download
 * links that are only as true as the last person who hand-edited them. This
 * file pins the GitHub API parsing (shape drift, missing assets, error paths
 * that must degrade to the app-version derivation instead of throwing during
 * prerender) and the display formatters (a locale-dependent date or a wrong
 * byte divisor ships a wrong claim to static HTML with no server to fix it).
 * No network here — `fetch` is always an injected fake.
 */
import { describe, expect, it } from 'vitest';
import type { ReleaseInfo } from '#lib/release';
import { formatBytes, formatReleaseDate, isNewer, releaseNoticeFor } from '#lib/content';
import { deriveRelease, fetchLatestRelease, parseLatestRelease } from '#lib/release';

/**
 * The real shape of GET /repos/Michael-Obele/Ikoro/releases/latest on
 * 2026-10-29 (tag v0.3.2). Written from the observed response, not invented:
 * asset entries carry name/size/browser_download_url, nothing else is read.
 */
const LATEST_FIXTURE = {
	tag_name: 'v0.3.2',
	name: 'v0.3.2',
	published_at: '2026-10-28T11:13:48Z',
	html_url: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v0.3.2',
	assets: [
		{
			name: 'Ikoro-v0.3.2.aab',
			size: 3369152,
			browser_download_url:
				'https://github.com/Michael-Obele/Ikoro/releases/download/v0.3.2/Ikoro-v0.3.2.aab'
		},
		{
			name: 'Ikoro-v0.3.2.apk',
			size: 3519874,
			browser_download_url:
				'https://github.com/Michael-Obele/Ikoro/releases/download/v0.3.2/Ikoro-v0.3.2.apk'
		}
	]
};

describe('parseLatestRelease', () => {
	it('reads the verified fixture into a ReleaseInfo without the leading v', () => {
		expect(parseLatestRelease(LATEST_FIXTURE)).toEqual({
			version: '0.3.2',
			tagUrl: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v0.3.2',
			apkUrl: 'https://github.com/Michael-Obele/Ikoro/releases/download/v0.3.2/Ikoro-v0.3.2.apk',
			aabUrl: 'https://github.com/Michael-Obele/Ikoro/releases/download/v0.3.2/Ikoro-v0.3.2.aab',
			apkSizeBytes: 3519874,
			aabSizeBytes: 3369152,
			publishedAt: '2026-10-28T11:13:48Z'
		});
	});

	it('returns null for anything that is not a usable release payload', () => {
		expect(parseLatestRelease(null)).toBeNull();
		expect(parseLatestRelease([])).toBeNull();
		expect(parseLatestRelease({})).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, tag_name: 123 })).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, html_url: null })).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, published_at: null })).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, assets: 'nope' })).toBeNull();
		// No apk asset: a release page without the installable file is not one
		// the site can point at.
		expect(
			parseLatestRelease({
				...LATEST_FIXTURE,
				assets: LATEST_FIXTURE.assets.filter((a) => !a.name.endsWith('.apk'))
			})
		).toBeNull();
		expect(
			parseLatestRelease({
				...LATEST_FIXTURE,
				assets: LATEST_FIXTURE.assets.filter((a) => !a.name.endsWith('.aab'))
			})
		).toBeNull();
		// Wrong-typed asset fields must not slip through.
		expect(
			parseLatestRelease({
				...LATEST_FIXTURE,
				assets: [{ name: 'Ikoro-v0.3.2.apk', size: 'big', browser_download_url: 42 }]
			})
		).toBeNull();
	});

	it('returns null for an unparseable published_at instead of throwing at render time', () => {
		expect(parseLatestRelease({ ...LATEST_FIXTURE, published_at: 'not-a-date' })).toBeNull();
	});

	it('parses a body without sizes, omitting the size fields', () => {
		const withoutSizes = {
			...LATEST_FIXTURE,
			assets: LATEST_FIXTURE.assets.map((a) => ({
				name: a.name,
				browser_download_url: a.browser_download_url
			}))
		};
		expect(parseLatestRelease(withoutSizes)).toEqual({
			version: '0.3.2',
			tagUrl: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v0.3.2',
			apkUrl: 'https://github.com/Michael-Obele/Ikoro/releases/download/v0.3.2/Ikoro-v0.3.2.apk',
			aabUrl: 'https://github.com/Michael-Obele/Ikoro/releases/download/v0.3.2/Ikoro-v0.3.2.aab',
			publishedAt: '2026-10-28T11:13:48Z'
		});
	});
});

describe('deriveRelease', () => {
	it('builds the exact verified URL patterns for a sample version', () => {
		expect(deriveRelease('0.3.2')).toEqual({
			version: '0.3.2',
			tagUrl: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v0.3.2',
			apkUrl: 'https://github.com/Michael-Obele/Ikoro/releases/download/v0.3.2/Ikoro-v0.3.2.apk',
			aabUrl: 'https://github.com/Michael-Obele/Ikoro/releases/download/v0.3.2/Ikoro-v0.3.2.aab'
		});
	});

	it('omits sizes and the published date, which are unknowable offline', () => {
		const derived = deriveRelease('0.3.2');
		expect(derived.apkSizeBytes).toBeUndefined();
		expect(derived.aabSizeBytes).toBeUndefined();
		expect(derived.publishedAt).toBeUndefined();
	});
});

describe('fetchLatestRelease', () => {
	it('parses an ok response through the same parser', async () => {
		const ok = (async () => ({
			ok: true,
			json: async () => LATEST_FIXTURE
		})) as unknown as typeof fetch;
		expect(await fetchLatestRelease(ok)).toEqual(parseLatestRelease(LATEST_FIXTURE));
	});

	it('returns null on non-ok responses, network errors, and unparseable bodies', async () => {
		const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
		expect(await fetchLatestRelease(notOk)).toBeNull();

		const throwing = (async () => {
			throw new Error('network down');
		}) as unknown as typeof fetch;
		expect(await fetchLatestRelease(throwing)).toBeNull();

		const badJson = (async () => ({
			ok: true,
			json: async () => {
				throw new Error('not json');
			}
		})) as unknown as typeof fetch;
		expect(await fetchLatestRelease(badJson)).toBeNull();

		const wrongShape = (async () => ({
			ok: true,
			json: async () => ({ hello: 'world' })
		})) as unknown as typeof fetch;
		expect(await fetchLatestRelease(wrongShape)).toBeNull();
	});

	it('hits releases/latest with a JSON accept header and an 8s timeout', async () => {
		let seenUrl: unknown;
		let seenInit: RequestInit | undefined;
		const spy = (async (url: unknown, init?: RequestInit) => {
			seenUrl = url;
			seenInit = init;
			return { ok: false, json: async () => ({}) };
		}) as unknown as typeof fetch;
		expect(await fetchLatestRelease(spy)).toBeNull();
		expect(seenUrl).toBe('https://api.github.com/repos/Michael-Obele/Ikoro/releases/latest');
		expect((seenInit?.headers as Record<string, string>)['Accept']).toBe(
			'application/vnd.github+json'
		);
		expect(seenInit?.signal).toBeInstanceOf(AbortSignal);
	});
});

describe('release display helpers', () => {
	it('formats bytes as megabytes with one decimal', () => {
		expect(formatBytes(3519874)).toBe('3.4 MB');
		expect(formatBytes(3369152)).toBe('3.2 MB');
		expect(formatBytes(1048576)).toBe('1.0 MB');
	});

	it('formats an ISO timestamp as an en-GB date regardless of host locale', () => {
		expect(formatReleaseDate('2026-10-28T11:13:48Z')).toBe('28 Oct 2026');
	});

	it('compares semver triples numerically, not lexicographically', () => {
		expect(isNewer('0.3.3', '0.3.2')).toBe(true);
		expect(isNewer('0.4.0', '0.3.9')).toBe(true);
		expect(isNewer('0.3.2', '0.3.2')).toBe(false);
		expect(isNewer('0.3.1', '0.3.2')).toBe(false);
		expect(isNewer('0.3.10', '0.3.9')).toBe(true);
	});

	it('derives the notice from the app version when GitHub is unreachable', () => {
		const derived = deriveRelease('0.3.2');
		expect(releaseNoticeFor(derived)).toContain('0.3.2');
		expect(releaseNoticeFor(derived).toLowerCase()).toContain('play store');
		expect(releaseNoticeFor(derived)).not.toContain('Published');
		expect(releaseNoticeFor(derived)).not.toContain('MB');
	});

	it('names the live version, size, date and the Play Store gap in the live notice', () => {
		const live = parseLatestRelease(LATEST_FIXTURE) as ReleaseInfo;
		expect(releaseNoticeFor(live)).toContain('0.3.2');
		expect(releaseNoticeFor(live).toLowerCase()).toContain('play store');
		expect(releaseNoticeFor(live)).toContain('3.4 MB');
		expect(releaseNoticeFor(live)).toContain('Published 28 Oct 2026');
	});
});
