/**
 * "Is there a newer Ikoro?" — a throttled check against the GitHub releases
 * that release-please publishes.
 *
 * WHY THE API AND NOT A TAG PAGE. `GET /repos/{owner}/{repo}/releases/latest`
 * answers JSON with `tag_name` and `html_url`, needs no auth for a public repo,
 * and skips prereleases and drafts by definition — exactly the set a user should
 * be offered. The comparison is numeric per segment, because `0.3.10` is newer
 * than `0.3.9` and a string compare says otherwise.
 *
 * FAILURE IS SILENT AND CHEAP. Offline, rate-limited, or a 404 all mean "no
 * news", never an error the user has to see; the throttle timestamp is written
 * BEFORE the fetch so a failing network does not turn every resume into a new
 * request. The banner component owns the UI; this module owns only the facts.
 */
export const RELEASES_API = 'https://api.github.com/repos/Michael-Obele/Ikoro/releases/latest';
export const RELEASES_PAGE = 'https://github.com/Michael-Obele/Ikoro/releases/latest';

/** How often the network is actually touched. Resume-safe: a check per window. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const CHECKED_KEY = 'ikoro:update-checked';

export interface UpdateInfo {
	/** The remote version, without the leading `v`. */
	tag: string;
	/** The release page to send the user to. */
	url: string;
}

/** Numeric segment-wise compare: is `remote` a higher version than `current`? */
export function isNewer(remote: string, current: string): boolean {
	const parse = (value: string): number[] =>
		value
			.trim()
			.replace(/^v/i, '')
			.split('.')
			.map((part) => Number.parseInt(part, 10) || 0);
	const a = parse(remote);
	const b = parse(current);
	for (let i = 0; i < 3; i++) {
		const left = a[i] ?? 0;
		const right = b[i] ?? 0;
		if (left !== right) return left > right;
	}
	return false;
}

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * The update newer than `current`, or null when there is none — including when
 * the check was throttled, the network failed, or the release does not exist.
 * Callers treat null as "nothing to say".
 */
export async function checkForUpdate(
	current: string,
	fetchImpl: typeof fetch = fetch
): Promise<UpdateInfo | null> {
	const store = storage();
	const last = Number(store?.getItem(CHECKED_KEY) ?? '0');
	if (Date.now() - last < CHECK_INTERVAL_MS) return null;
	// Written BEFORE the fetch: a phone with no signal must not retry on every
	// single resume, it must wait out the window like a successful check does.
	store?.setItem(CHECKED_KEY, String(Date.now()));

	try {
		const response = await fetchImpl(RELEASES_API, {
			headers: { accept: 'application/vnd.github+json' }
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { tag_name?: string; html_url?: string };
		const tag = data.tag_name?.replace(/^v/i, '');
		if (!tag || !isNewer(tag, current)) return null;
		return { tag, url: data.html_url ?? RELEASES_PAGE };
	} catch {
		// Offline is a normal state for a local-first app, not an error.
		return null;
	}
}
