/**
 * Guards the build-time release fetch against lying or crashing.
 *
 * Class of bug caught: the landing page renders a version number and download
 * links that are only as true as the last person who hand-edited them. This
 * file pins the GitHub API parsing (shape drift, error paths that must degrade
 * to the app-version derivation instead of throwing during prerender) and the
 * display formatters (a locale-dependent date or a wrong byte divisor ships a
 * wrong claim to static HTML with no server to fix it).
 *
 * It also pins the one fact this page exists to stop getting wrong: tagging a
 * release starts two builds minutes apart, so "the release exists" and "the APK
 * exists" are different facts. The old model conflated them, fell back to a
 * hand-built download URL, and sent visitors to a GitHub 404. Every fixture
 * below keeps the two apart on purpose.
 *
 * No network here — `fetch` is always an injected fake.
 */
import { describe, expect, it } from 'vitest';
import type { ReleaseInfo } from '#lib/release';
import { formatBytes, formatReleaseDate, releaseNotice } from '#lib/content';
import {
	deriveRelease,
	fetchReleases,
	isDownloadable,
	missingAssets,
	parseLatestRelease,
	parseReleases
} from '#lib/release';

const DOWNLOAD = 'https://github.com/Michael-Obele/Ikoro/releases/download';

/**
 * The real shape of GET /repos/Michael-Obele/Ikoro/releases/latest on
 * 2026-10-29 (tag v0.3.2). Written from the observed response, not invented:
 * asset entries carry name/size/browser_download_url, nothing else is read.
 * Two assets only — v0.3.2 predates the desktop build, which is a real case:
 * a published release that carries no Linux files at all.
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
			browser_download_url: `${DOWNLOAD}/v0.3.2/Ikoro-v0.3.2.aab`
		},
		{
			name: 'Ikoro-v0.3.2.apk',
			size: 3519874,
			browser_download_url: `${DOWNLOAD}/v0.3.2/Ikoro-v0.3.2.apk`
		}
	]
};

/**
 * The five entries v0.3.4 really carried, with the sizes GitHub reported. The
 * AAB is included on purpose: the release ships it, and the site must ignore
 * it rather than offer it.
 */
const COMPLETE_FIXTURE = {
	tag_name: 'v0.3.4',
	published_at: '2026-10-29T12:58:00Z',
	html_url: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v0.3.4',
	assets: [
		{ name: 'Ikoro-v0.3.4.aab', size: 3375468 },
		{ name: 'Ikoro-v0.3.4.apk', size: 3526226 },
		{ name: 'Ikoro-v0.3.4.AppImage', size: 85862904 },
		{ name: 'Ikoro-v0.3.4.deb', size: 2173842 },
		{ name: 'Ikoro-v0.3.4.rpm', size: 2174515 }
	].map((asset) => ({ ...asset, browser_download_url: `${DOWNLOAD}/v0.3.4/${asset.name}` }))
};

describe('parseLatestRelease', () => {
	it('reads the verified fixture into an asset record keyed by kind', () => {
		expect(parseLatestRelease(LATEST_FIXTURE)).toEqual({
			version: '0.3.2',
			tagUrl: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v0.3.2',
			assets: {
				apk: { url: `${DOWNLOAD}/v0.3.2/Ikoro-v0.3.2.apk`, sizeBytes: 3519874 }
			},
			publishedAt: '2026-10-28T11:13:48Z',
			source: 'live'
		});
	});

	it('maps every offered extension to its kind, capitals included, and ignores the AAB', () => {
		const complete = parseLatestRelease(COMPLETE_FIXTURE) as ReleaseInfo;
		expect(Object.keys(complete.assets).sort()).toEqual(['apk', 'appImage', 'deb', 'rpm']);
		expect(complete.assets.appImage?.sizeBytes).toBe(85862904);
	});

	it('returns null for anything that is not a usable release payload', () => {
		expect(parseLatestRelease(null)).toBeNull();
		expect(parseLatestRelease([])).toBeNull();
		expect(parseLatestRelease({})).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, tag_name: 123 })).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, tag_name: 'v' })).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, html_url: null })).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, published_at: null })).toBeNull();
		expect(parseLatestRelease({ ...LATEST_FIXTURE, assets: 'nope' })).toBeNull();
	});

	it('returns null for an unparseable published_at instead of throwing at render time', () => {
		expect(parseLatestRelease({ ...LATEST_FIXTURE, published_at: 'not-a-date' })).toBeNull();
	});

	/**
	 * The case the old parser turned into a 404. A tag exists the moment
	 * release-please cuts it; the files arrive minutes later. That release is
	 * real, so it must parse — and it must not offer a download.
	 */
	it('parses a release with no assets at all as a release that has nothing to download', () => {
		const empty = parseLatestRelease({ ...LATEST_FIXTURE, assets: [] });
		expect(empty).not.toBeNull();
		expect(empty?.assets).toEqual({});
		expect(empty?.source).toBe('live');
		expect(missingAssets(empty as ReleaseInfo, 'android')).toEqual(['apk']);
		expect(missingAssets(empty as ReleaseInfo, 'linux')).toEqual(['deb', 'appImage']);
		expect(isDownloadable(empty as ReleaseInfo, 'android')).toBe(false);
		expect(isDownloadable(empty as ReleaseInfo, 'linux')).toBe(false);
	});

	/**
	 * The two-minute window that started all of this: Android uploaded, desktop
	 * still compiling. Android is downloadable; Linux is not; and neither answer
	 * involves inventing a URL.
	 */
	it('opens Android as soon as its file lands, without waiting for the desktop build', () => {
		const androidOnly = parseLatestRelease({
			...COMPLETE_FIXTURE,
			assets: COMPLETE_FIXTURE.assets.filter((asset) => /\.apk$/.test(asset.name))
		}) as ReleaseInfo;
		expect(isDownloadable(androidOnly, 'android')).toBe(true);
		expect(isDownloadable(androidOnly, 'linux')).toBe(false);
		expect(missingAssets(androidOnly, 'linux')).toEqual(['deb', 'appImage']);
	});

	it('does not let a missing DEB slip past as a downloadable Linux build', () => {
		const noDeb = parseLatestRelease({
			...COMPLETE_FIXTURE,
			assets: COMPLETE_FIXTURE.assets.filter((asset) => !asset.name.endsWith('.deb'))
		}) as ReleaseInfo;
		expect(isDownloadable(noDeb, 'linux')).toBe(false);
	});

	it('parses a body without sizes, omitting the size fields', () => {
		const withoutSizes = {
			...LATEST_FIXTURE,
			assets: LATEST_FIXTURE.assets.map((asset) => ({
				name: asset.name,
				browser_download_url: asset.browser_download_url
			}))
		};
		expect(parseLatestRelease(withoutSizes)).toEqual({
			version: '0.3.2',
			tagUrl: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v0.3.2',
			assets: {
				apk: { url: `${DOWNLOAD}/v0.3.2/Ikoro-v0.3.2.apk` }
			},
			publishedAt: '2026-10-28T11:13:48Z',
			source: 'live'
		});
	});

	it('drops one unusable asset and keeps the rest, instead of blanking the release', () => {
		const oneBadSize = parseLatestRelease({
			...COMPLETE_FIXTURE,
			assets: COMPLETE_FIXTURE.assets.map((asset) =>
				asset.name.endsWith('.apk') ? { ...asset, size: 'big' } : asset
			)
		}) as ReleaseInfo;
		expect(oneBadSize.assets.apk).toBeUndefined();
		expect(oneBadSize.assets.appImage?.sizeBytes).toBe(85862904);
	});

	it('ignores a file this site does not offer, including the AAB', () => {
		const withStray = parseLatestRelease({
			...LATEST_FIXTURE,
			assets: [
				...LATEST_FIXTURE.assets,
				{ name: 'checksums.txt', size: 10, browser_download_url: `${DOWNLOAD}/x` },
				{ name: 'Ikoro-v0.3.2.aab', size: 3369152, browser_download_url: `${DOWNLOAD}/z` },
				{ name: 'Ikoro-v0.3.2.zip', size: 10, browser_download_url: `${DOWNLOAD}/y` }
			]
		}) as ReleaseInfo;
		expect(Object.keys(withStray.assets)).toEqual(['apk']);
	});
});

describe('deriveRelease', () => {
	it('builds the tag URL and carries no assets, because a version is not a file', () => {
		expect(deriveRelease('0.3.2')).toEqual({
			version: '0.3.2',
			tagUrl: 'https://github.com/Michael-Obele/Ikoro/releases/tag/v0.3.2',
			assets: {},
			source: 'derived'
		});
	});

	/**
	 * The regression that started all of this: the offline path used to build
	 * apk/aab URLs from the version alone. Every one of them 404s until the
	 * build finishes, and some of them 404 forever.
	 */
	it('offers no download for either platform, and says so', () => {
		const derived = deriveRelease('0.3.2');
		expect(isDownloadable(derived, 'android')).toBe(false);
		expect(isDownloadable(derived, 'linux')).toBe(false);
		expect(missingAssets(derived, 'android')).toEqual(['apk']);
		expect(releaseNotice(derived).state).toBe('unconfirmed');
	});
});

describe('fetchReleases', () => {
	it('parses an ok response through the same per-entry parser', async () => {
		const ok = (async () => ({
			ok: true,
			json: async () => [LATEST_FIXTURE, COMPLETE_FIXTURE]
		})) as unknown as typeof fetch;
		expect(await fetchReleases(ok)).toEqual([
			parseLatestRelease(LATEST_FIXTURE),
			parseLatestRelease(COMPLETE_FIXTURE)
		]);
	});

	/**
	 * An empty list, not null: the layout has one shape to reason about, and
	 * /changelog says "could not reach GitHub" rather than printing nothing.
	 */
	it('returns an empty list on non-ok responses, network errors, and unparseable bodies', async () => {
		const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
		expect(await fetchReleases(notOk)).toEqual([]);

		const throwing = (async () => {
			throw new Error('network down');
		}) as unknown as typeof fetch;
		expect(await fetchReleases(throwing)).toEqual([]);

		const badJson = (async () => ({
			ok: true,
			json: async () => {
				throw new Error('not json');
			}
		})) as unknown as typeof fetch;
		expect(await fetchReleases(badJson)).toEqual([]);

		const wrongShape = (async () => ({
			ok: true,
			json: async () => ({ hello: 'world' })
		})) as unknown as typeof fetch;
		expect(await fetchReleases(wrongShape)).toEqual([]);
	});

	it('hits the releases list with a JSON accept header and an 8s timeout', async () => {
		let seenUrl: unknown;
		let seenInit: RequestInit | undefined;
		const spy = (async (url: unknown, init?: RequestInit) => {
			seenUrl = url;
			seenInit = init;
			return { ok: false, json: async () => ({}) };
		}) as unknown as typeof fetch;
		expect(await fetchReleases(spy)).toEqual([]);
		expect(seenUrl).toBe('https://api.github.com/repos/Michael-Obele/Ikoro/releases?per_page=100');
		expect((seenInit?.headers as Record<string, string>)['Accept']).toBe(
			'application/vnd.github+json'
		);
		expect(seenInit?.signal).toBeInstanceOf(AbortSignal);
	});
});

describe('parseReleases', () => {
	it('drops one unreadable entry instead of the whole history', () => {
		expect(parseReleases([LATEST_FIXTURE, { nope: true }, COMPLETE_FIXTURE])).toEqual([
			parseLatestRelease(LATEST_FIXTURE),
			parseLatestRelease(COMPLETE_FIXTURE)
		]);
	});

	it('returns an empty list for anything that is not an array', () => {
		expect(parseReleases(null)).toEqual([]);
		expect(parseReleases({})).toEqual([]);
		expect(parseReleases(LATEST_FIXTURE)).toEqual([]);
		expect(parseReleases([])).toEqual([]);
	});

	/**
	 * The changelog's notes ARE the release body. Carrying it through the parser
	 * is what lets /changelog stop holding a copy that goes stale.
	 */
	it('carries the release body through, and omits it when the release has none', () => {
		const withBody = parseLatestRelease({ ...LATEST_FIXTURE, body: '### Features\n\n* x' });
		expect(withBody?.body).toBe('### Features\n\n* x');
		expect(parseLatestRelease(LATEST_FIXTURE)?.body).toBeUndefined();
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

	it('names the live version, size, date and the Play Store gap when every file is there', () => {
		const live = parseLatestRelease(COMPLETE_FIXTURE) as ReleaseInfo;
		const notice = releaseNotice(live);
		expect(notice.state).toBe('ready');
		expect(notice.body).toContain('0.3.4');
		expect(notice.body.toLowerCase()).toContain('play store');
		expect(notice.body).toContain('3.4 MB');
		expect(notice.body).toContain('Published 29 Oct 2026');
	});

	/**
	 * The sentence the whole change exists for. Somebody who opens the page
	 * eighteen seconds after a tag is cut must be told to wait — not handed a
	 * download that 404s.
	 */
	it('tells the reader a half-uploaded release is still building, and which files are late', () => {
		const androidOnly = parseLatestRelease({
			...COMPLETE_FIXTURE,
			assets: COMPLETE_FIXTURE.assets.filter((asset) => /\.apk$/.test(asset.name))
		}) as ReleaseInfo;
		const notice = releaseNotice(androidOnly);
		expect(notice.state).toBe('building');
		expect(notice.title).toContain('0.3.4');
		expect(notice.title.toLowerCase()).toContain('still');
		expect(notice.body).toContain('DEB');
		expect(notice.body).toContain('AppImage');
		// No size or date clause: those would read as a finished release.
		expect(notice.body).not.toContain('Published');
	});

	it('says a release with no assets yet is still building, not missing', () => {
		const empty = parseLatestRelease({ ...COMPLETE_FIXTURE, assets: [] }) as ReleaseInfo;
		const notice = releaseNotice(empty);
		expect(notice.state).toBe('building');
		for (const label of ['APK', 'DEB', 'AppImage', 'RPM']) {
			expect(notice.body, label).toContain(label);
		}
	});

	it('admits it could not check, instead of naming a file, when GitHub was unreachable', () => {
		const notice = releaseNotice(deriveRelease('0.3.2'));
		expect(notice.state).toBe('unconfirmed');
		expect(notice.title).toContain('0.3.2');
		expect(notice.body.toLowerCase()).toContain('could not reach github');
		// Never a download claim on evidence this thin.
		expect(notice.body).not.toContain('Published');
		expect(notice.body).not.toContain('MB');
	});
});
