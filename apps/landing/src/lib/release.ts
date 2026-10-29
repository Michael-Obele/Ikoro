/**
 * Build-time GitHub release lookup: transport + parsing + derivation, no copy strings.
 *
 * The one caller is the root layout `load`, which runs during prerender — so
 * nothing here throws. A throw would fail the whole static build; the fetch
 * degrades to `null` and the layout derives the release from the app version
 * instead. No secrets, no env vars: the repo is public and one call per
 * build is nowhere near the unauthenticated rate limit.
 */

export interface ReleaseInfo {
	/** Version WITHOUT the leading `v` (`tag_name` keeps it). */
	version: string;
	tagUrl: string;
	apkUrl: string;
	aabUrl: string;
	/** Present on the live path; unknowable when derived offline. */
	apkSizeBytes?: number;
	/** Present on the live path; unknowable when derived offline. */
	aabSizeBytes?: number;
	/** Present on the live path; unknowable when derived offline. */
	publishedAt?: string;
}

/**
 * Identity of this repo. Hardcoding identity is fine: the owner and name do
 * not change per release. The URL patterns below are verified against the
 * real v0.3.2 response and the release-please/gh-upload flow that names
 * assets `Ikoro-v{version}.apk` / `Ikoro-v{version}.aab`.
 */
const REPO_OWNER = 'Michael-Obele';
const REPO_NAME = 'Ikoro';

/**
 * Builds a ReleaseInfo from a version alone, with no network and no snapshot.
 * The version comes from `apps/app/package.json` (release-please bumps it at
 * every release); the tag and asset URLs are deterministic given the version.
 * Sizes and the published date are omitted — they are unknowable offline.
 */
export function deriveRelease(version: string): ReleaseInfo {
	return {
		version,
		tagUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${version}`,
		apkUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}/Ikoro-v${version}.apk`,
		aabUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}/Ikoro-v${version}.aab`
	};
}

const LATEST_RELEASE_URL = 'https://api.github.com/repos/Michael-Obele/Ikoro/releases/latest';

/**
 * The first asset whose name ends with `ext`, or null when none is usable.
 * A present size must be a finite number; an absent size is omitted (the
 * caller still parses OK). A wrong-typed size is not usable.
 */
function findAsset(assets: unknown[], ext: '.apk' | '.aab'): { url: string; size?: number } | null {
	for (const entry of assets) {
		if (typeof entry !== 'object' || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.name !== 'string' || !record.name.endsWith(ext)) continue;
		if (typeof record.browser_download_url !== 'string') continue;
		if (record.size === undefined) return { url: record.browser_download_url };
		if (typeof record.size !== 'number' || !Number.isFinite(record.size)) continue;
		return { url: record.browser_download_url, size: record.size };
	}
	return null;
}

/**
 * Reads a `GET /repos/.../releases/latest` body into a ReleaseInfo.
 * Anything that is not a usable release payload — not an object, missing or
 * wrong-typed fields, no apk/aab asset match — is `null`. Never throws.
 */
export function parseLatestRelease(json: unknown): ReleaseInfo | null {
	try {
		if (typeof json !== 'object' || json === null) return null;
		const record = json as Record<string, unknown>;
		const { tag_name, html_url, published_at, assets } = record;
		if (typeof tag_name !== 'string') return null;
		if (typeof html_url !== 'string') return null;
		if (typeof published_at !== 'string') return null;
		if (Number.isNaN(Date.parse(published_at))) return null;
		if (!Array.isArray(assets)) return null;
		const version = tag_name.replace(/^v/, '');
		if (version.length === 0) return null;
		const apk = findAsset(assets, '.apk');
		const aab = findAsset(assets, '.aab');
		if (apk === null || aab === null) return null;
		const release: ReleaseInfo = {
			version,
			tagUrl: html_url,
			apkUrl: apk.url,
			aabUrl: aab.url,
			publishedAt: published_at
		};
		if (apk.size !== undefined) release.apkSizeBytes = apk.size;
		if (aab.size !== undefined) release.aabSizeBytes = aab.size;
		return release;
	} catch {
		return null;
	}
}

/**
 * Fetches the latest release. Non-ok responses, network errors, timeouts and
 * unparseable bodies are all `null` — the layout derives the release from
 * the app version instead. Never throws. `fetchImpl` is injectable so tests
 * never touch the network.
 */
export async function fetchLatestRelease(
	fetchImpl: typeof fetch = fetch
): Promise<ReleaseInfo | null> {
	try {
		const response = await fetchImpl(LATEST_RELEASE_URL, {
			headers: { Accept: 'application/vnd.github+json' },
			signal: AbortSignal.timeout(8000)
		});
		if (!response.ok) return null;
		return parseLatestRelease(await response.json());
	} catch {
		return null;
	}
}
