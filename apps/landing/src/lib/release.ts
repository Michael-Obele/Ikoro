/**
 * Build-time GitHub release lookup: transport + parsing only, no copy strings.
 *
 * The one caller is the root layout `load`, which runs during prerender — so
 * everything here degrades to `null` instead of throwing. A throw would fail
 * the whole static build; `null` renders the curated fallback the site
 * already ships. No secrets, no env vars: the repo is public and one call per
 * build is nowhere near the unauthenticated rate limit.
 */

export interface ReleaseInfo {
	/** Version WITHOUT the leading `v` (`tag_name` keeps it). */
	version: string;
	tagUrl: string;
	apkUrl: string;
	aabUrl: string;
	apkSizeBytes: number;
	aabSizeBytes: number;
	publishedAt: string;
}

const LATEST_RELEASE_URL = 'https://api.github.com/repos/Michael-Obele/Ikoro/releases/latest';

/** The first asset whose name ends with `ext`, or null when none is usable. */
function findAsset(assets: unknown[], ext: '.apk' | '.aab'): { url: string; size: number } | null {
	for (const entry of assets) {
		if (typeof entry !== 'object' || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.name !== 'string' || !record.name.endsWith(ext)) continue;
		if (typeof record.size !== 'number' || !Number.isFinite(record.size)) continue;
		if (typeof record.browser_download_url !== 'string') continue;
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
		if (!Array.isArray(assets)) return null;
		const version = tag_name.replace(/^v/, '');
		if (version.length === 0) return null;
		const apk = findAsset(assets, '.apk');
		const aab = findAsset(assets, '.aab');
		if (apk === null || aab === null) return null;
		return {
			version,
			tagUrl: html_url,
			apkUrl: apk.url,
			aabUrl: aab.url,
			apkSizeBytes: apk.size,
			aabSizeBytes: aab.size,
			publishedAt: published_at
		};
	} catch {
		return null;
	}
}

/**
 * Fetches the latest release. Non-ok responses, network errors, timeouts and
 * unparseable bodies are all `null` — the pages render the curated fallback.
 * Never throws. `fetchImpl` is injectable so tests never touch the network.
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
