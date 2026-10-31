/**
 * Release list for the landing page: build-time GitHub lookup, parsing, derivation. Never
 * throws -- a failure must not fail the prerender. Assets are only what GitHub reported.
 */

/** A file this site offers (the AAB is a store bundle, not an installable). */
export type AssetKind = 'apk' | 'deb' | 'appImage' | 'rpm';

/** Pipeline order: Android first, then Linux. Shared by the arrival list and the "still missing" copy. */
export const ASSET_ORDER: readonly AssetKind[] = ['apk', 'deb', 'appImage', 'rpm'];

/** What a platform needs before it may be offered a download. `rpm` is excluded: it only exists when rpmbuild is installed. */
export const PLATFORM_ASSETS = {
	android: ['apk'],
	linux: ['deb', 'appImage']
} as const satisfies Record<string, readonly AssetKind[]>;

export type PlatformKey = keyof typeof PLATFORM_ASSETS;

/** A file GitHub reported, with its size when it reported one. */
export interface ReleaseAsset {
	/** Direct download, from the URL GitHub listed (never hand-built). */
	url: string;
	sizeBytes?: number;
}

export interface ReleaseInfo {
	/** Version without the leading `v`. */
	version: string;
	/** The release page; safe to link whenever the tag exists. */
	tagUrl: string;
	/** Keyed by published file. A missing key means "not built yet". */
	assets: Partial<Record<AssetKind, ReleaseAsset>>;
	/** Present on the live path; unknowable when derived offline. */
	publishedAt?: string;
	/** Release notes as GitHub holds them; absent when the body is empty. */
	body?: string;
	/** `live` = read from GitHub, so `assets` is evidence; `derived` = offline, so no downloads. */
	source: 'live' | 'derived';
}

/** Repo identity, used for the tag page only -- download URLs always come from GitHub. */
const REPO_OWNER = 'Michael-Obele';
const REPO_NAME = 'Ikoro';

/** ReleaseInfo from a version alone, no network. Assets stay empty: a version is no evidence a file exists. */
export function deriveRelease(version: string): ReleaseInfo {
	return {
		version,
		tagUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${version}`,
		assets: {},
		source: 'derived'
	};
}

/** Whole history, newest first; 100 is the endpoint maximum. */
const RELEASES_URL = 'https://api.github.com/repos/Michael-Obele/Ikoro/releases?per_page=100';

/** Asset kind for a published filename, or null if we do not offer it; `.AppImage` is matched first. */
function assetKindOf(name: string): AssetKind | null {
	if (name.endsWith('.AppImage')) return 'appImage';
	if (name.endsWith('.apk')) return 'apk';
	if (name.endsWith('.deb')) return 'deb';
	if (name.endsWith('.rpm')) return 'rpm';
	return null;
}

/** One asset entry, or null if unusable. A bad entry drops only that file, never the release. */
function readAsset(entry: unknown): ReleaseAsset | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const record = entry as Record<string, unknown>;
	if (typeof record.browser_download_url !== 'string') return null;
	if (record.size === undefined) return { url: record.browser_download_url };
	if (typeof record.size !== 'number' || !Number.isFinite(record.size)) return null;
	return { url: record.browser_download_url, sizeBytes: record.size };
}

/** Every kind GitHub reported, keyed by kind; a missing key means "not built yet". */
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

/** One release payload as a ReleaseInfo, or null when malformed; a release with no assets is still valid. */
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

/** A releases response body as a list; one unreadable entry is dropped, never the whole list. */
export function parseReleases(json: unknown): ReleaseInfo[] {
	if (!Array.isArray(json)) return [];
	return json.flatMap((entry) => {
		const release = parseLatestRelease(entry);
		return release === null ? [] : [release];
	});
}

/** Fetches every release; any failure is an empty array. `fetchImpl` is injectable for tests. */
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

/** Promised files GitHub did not report; empty means downloadable. A derived release returns them all. */
export function missingAssets(release: ReleaseInfo, platform: PlatformKey): AssetKind[] {
	return PLATFORM_ASSETS[platform].filter((kind) => release.assets[kind] === undefined);
}

/** Downloadable only when the release is live and every promised file is present. */
export function isDownloadable(release: ReleaseInfo, platform: PlatformKey): boolean {
	return release.source === 'live' && missingAssets(release, platform).length === 0;
}
