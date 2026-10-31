/**
 * "Is there a newer Ikoro?" — a throttled check against the GitHub latest-release API.
 * Failure is silent: offline, rate-limited and 404 all mean "no news".
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

/** The update newer than `current`, or null. Callers treat null as "nothing to say". */
export async function checkForUpdate(
	current: string,
	fetchImpl: typeof fetch = fetch
): Promise<UpdateInfo | null> {
	const store = storage();
	const last = Number(store?.getItem(CHECKED_KEY) ?? '0');
	if (Date.now() - last < CHECK_INTERVAL_MS) return null;
	// Written before the fetch, so a phone with no signal waits out the window too.
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
