// Every page of this site is a page, not a view of state. Each one is built once
// into HTML at deploy time and served as a file, which is why `ssr` stays at its
// SvelteKit default of `true`: the output is prerendered HTML, not a client-only
// shell. Nothing here reads a request.
import { deriveRelease, fetchLatestRelease } from '$lib/release';
import { version as appVersion } from '../../../app/package.json';

export const prerender = true;

/**
 * Runs at build time during prerender; the returned data is serialized into
 * every prerendered page. Client navigations reuse it (this load does not
 * re-run on the static site). The live GitHub release when reachable,
 * otherwise derived from the app version — never null, never a snapshot.
 */
export async function load() {
	return { release: (await fetchLatestRelease()) ?? deriveRelease(appVersion) };
}
