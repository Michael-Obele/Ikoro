/**
 * Build-time GitHub release lookup: transport + parsing + derivation, no copy strings.
 *
 * The one caller is the root layout `load`, which runs during prerender — so
 * nothing here throws. A throw would fail the whole static build; the fetch
 * degrades to an empty list and the app version instead. No secrets, no env
 * vars: the repo is public and one call per build is nowhere near the
 * unauthenticated rate limit.
 *
 * One call returns the whole history, so nothing on the site has to be told a
 * version: the changelog is the releases endpoint, and `[0]` is the current
 * release.
 *
 * WHY AN ASSET IS OPTIONAL, AND WHY THAT IS THE POINT
 * ---------------------------------------------------
 * Tagging a release starts two independent builds — Android, then the Linux
 * desktop bundles — that upload to the same release minutes apart. So for the
 * first few minutes a release exists with SOME of its files, and briefly with
 * none of them. A model that says "the latest release is v0.3.4 and the APK is
 * at <url>" therefore invents URLs for files that are not there yet, and the
 * visitor lands on a GitHub 404 that reads as "the product is broken".
 *
 * So `assets` is a record of what GitHub actually reported, never a set of URL
 * templates. A missing key means "not published yet", and the copy layer says
 * so. A derived release carries no assets at all, because a version number is
 * not evidence that a file exists.
 */

/**
 * The files this site offers, which is not the same list as the files the
 * pipeline publishes: the AAB is a store bundle nobody installs by hand, so it
 * is deliberately absent here and `assetKindOf` ignores it.
 */
export type AssetKind = 'apk' | 'deb' | 'appImage' | 'rpm';

/**
 * The order the pipeline produces them in — Android first, then the Linux
 * bundles. One ordering, shared by the download page's arrival list and by the
 * "what is still missing" sentence, so the two can never disagree.
 */
export const ASSET_ORDER: readonly AssetKind[] = ['apk', 'deb', 'appImage', 'rpm'];

/**
 * What each platform needs before the site may offer it a download. `apk` for
 * Android and `deb` + `appImage` for Linux; `rpm` is excluded because the
 * runner only produces it when rpmbuild happens to be installed.
 */
export const PLATFORM_ASSETS = {
	android: ['apk'],
	linux: ['deb', 'appImage']
} as const satisfies Record<string, readonly AssetKind[]>;

export type PlatformKey = keyof typeof PLATFORM_ASSETS;

/** A file GitHub reported, with its size when it reported one. */
export interface ReleaseAsset {
	/** Direct download. Only ever built from an asset GitHub actually listed. */
	url: string;
	sizeBytes?: number;
}

export interface ReleaseInfo {
	/** Version WITHOUT the leading `v` (`tag_name` keeps it). */
	version: string;
	/** The release page. Always safe to link: it exists whenever the tag does. */
	tagUrl: string;
	/** Keyed by published file. A missing key means "not built yet". */
	assets: Partial<Record<AssetKind, ReleaseAsset>>;
	/** Present on the live path; unknowable when derived offline. */
	publishedAt?: string;
	/**
	 * The release notes exactly as GitHub holds them. Absent when the release has
	 * no body at all — which is a real case, not an error.
	 */
	body?: string;
	/**
	 * `live` — read from GitHub during the build, so `assets` is evidence.
	 * `derived` — GitHub was unreachable; the version is known and nothing else
	 * is, which is why a derived release offers no download at all.
	 */
	source: 'live' | 'derived';
}

/**
 * Identity of this repo. Hardcoding identity is fine: the owner and name do
 * not change per release. These are used for the TAG page only — download URLs
 * are never hand-built from them, because GitHub supplies the real one with
 * every asset it lists, and a hand-built one is a guess that 404s.
 */
const REPO_OWNER = 'Michael-Obele';
const REPO_NAME = 'Ikoro';

/**
 * Builds a ReleaseInfo from a version alone, with no network and no snapshot.
 * The version comes from `apps/app/package.json` (release-please bumps it at
 * every release) and the tag page is deterministic given it. Assets are EMPTY
 * on purpose: an offline build knows a version number, not a file.
 */
export function deriveRelease(version: string): ReleaseInfo {
	return {
		version,
		tagUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${version}`,
		assets: {},
		source: 'derived'
	};
}

/**
 * The whole history, newest first, which is how GitHub returns it. 100 is the
 * most the endpoint will give; this project is nowhere near that, and a fixed
 * page size keeps the response shape the same every build.
 */
const RELEASES_URL = 'https://api.github.com/repos/Michael-Obele/Ikoro/releases?per_page=100';

/**
 * The asset kind a published filename belongs to, or null for a file this site
 * does not offer. Extension-based because the extension is what the pipeline
 * controls — both workflows rename to `Ikoro-v<version>.<ext>` before uploading.
 *
 * `.AppImage` is matched first, and case-sensitively: it is the one extension
 * with capitals, and a lowercased comparison would also fold a stray `.APK`
 * variant into the wrong slot. `.aab` returns null on purpose — the release
 * still carries it, the page just has nothing useful to say about it.
 */
function assetKindOf(name: string): AssetKind | null {
	if (name.endsWith('.AppImage')) return 'appImage';
	if (name.endsWith('.apk')) return 'apk';
	if (name.endsWith('.deb')) return 'deb';
	if (name.endsWith('.rpm')) return 'rpm';
	return null;
}

/**
 * One asset entry as a ReleaseAsset, or null when it is not usable. A missing
 * size is fine (the page renders no size); a wrong-typed size drops just that
 * one file rather than the whole release, so a single odd entry cannot blank
 * every download on the page.
 */
function readAsset(entry: unknown): ReleaseAsset | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const record = entry as Record<string, unknown>;
	if (typeof record.browser_download_url !== 'string') return null;
	if (record.size === undefined) return { url: record.browser_download_url };
	if (typeof record.size !== 'number' || !Number.isFinite(record.size)) return null;
	return { url: record.browser_download_url, sizeBytes: record.size };
}

/**
 * Every kind GitHub reported, keyed by kind. A file it did not list is simply
 * absent from the record — which is the fact the download page renders.
 */
function readAssets(assets: unknown[]): Partial<Record<AssetKind, ReleaseAsset>> {
	const found: Partial<Record<AssetKind, ReleaseAsset>> = {};
	for (const entry of assets) {
		if (typeof entry !== 'object' || entry === null) continue;
		const name = (entry as Record<string, unknown>).name;
		if (typeof name !== 'string') continue;
		const kind = assetKindOf(name);
		if (kind === null || found[kind] !== undefined) continue;
		const asset = readAsset(entry);
		if (asset !== null) found[kind] = asset;
	}
	return found;
}

/**
 * Reads one release payload into a ReleaseInfo. Both endpoints carry entries of
 * this shape, so `parseReleases` uses it once per entry; the name is historical
 * — its first caller was `releases/latest`.
 *
 * Anything that is not a usable release payload — not an object, missing or
 * wrong-typed tag/url/date — is `null`, and the caller drops it. A release WITH
 * NO ASSETS IS NOT NULL: that is the "tagged, still building" state, and
 * describing it honestly is the reason this module exists.
 */
export function parseLatestRelease(json: unknown): ReleaseInfo | null {
	try {
		if (typeof json !== 'object' || json === null) return null;
		const record = json as Record<string, unknown>;
		const { tag_name, html_url, published_at, assets, body } = record;
		if (typeof tag_name !== 'string') return null;
		if (typeof html_url !== 'string') return null;
		if (typeof published_at !== 'string') return null;
		if (Number.isNaN(Date.parse(published_at))) return null;
		if (!Array.isArray(assets)) return null;
		const version = tag_name.replace(/^v/, '');
		if (version.length === 0) return null;
		const release: ReleaseInfo = {
			version,
			tagUrl: html_url,
			assets: readAssets(assets),
			publishedAt: published_at,
			source: 'live'
		};
		if (typeof body === 'string' && body.length > 0) release.body = body;
		return release;
	} catch {
		return null;
	}
}

/**
 * Reads a `GET /repos/.../releases` body into the release list.
 *
 * One unusable entry is dropped, not the list: a release this parser cannot
 * read is missing from the changelog, while a release that fails the whole page
 * would take every good entry with it. An empty array is the honest answer when
 * GitHub was unreachable, and the copy layer says so instead of inventing
 * history.
 */
export function parseReleases(json: unknown): ReleaseInfo[] {
	if (!Array.isArray(json)) return [];
	return json.flatMap((entry) => {
		const release = parseLatestRelease(entry);
		return release === null ? [] : [release];
	});
}

/**
 * Fetches every release. Non-ok responses, network errors, timeouts and
 * unparseable bodies are all an empty array — the layout derives the version
 * instead, and /changelog says it could not check. Never throws. `fetchImpl` is
 * injectable so tests never touch the network.
 */
export async function fetchReleases(fetchImpl: typeof fetch = fetch): Promise<ReleaseInfo[]> {
	try {
		const response = await fetchImpl(RELEASES_URL, {
			headers: { Accept: 'application/vnd.github+json' },
			signal: AbortSignal.timeout(8000)
		});
		if (!response.ok) return [];
		return parseReleases(await response.json());
	} catch {
		return [];
	}
}

/**
 * The promised files for a platform that GitHub did NOT report. An empty array
 * means the platform is downloadable; a derived release returns all of them,
 * because it cannot vouch for any.
 */
export function missingAssets(release: ReleaseInfo, platform: PlatformKey): AssetKind[] {
	return PLATFORM_ASSETS[platform].filter((kind) => release.assets[kind] === undefined);
}

/**
 * Whether the site may offer this platform a download: the release is live and
 * every promised file is on it. Everything else — derived, or a build still
 * uploading — is "no download yet", and the copy layer explains which.
 */
export function isDownloadable(release: ReleaseInfo, platform: PlatformKey): boolean {
	return release.source === 'live' && missingAssets(release, platform).length === 0;
}
