// Every page of this site is a page, not a view of state. Each one is built once
// into HTML at deploy time and served as a file, which is why `ssr` stays at its
// SvelteKit default of `true`: the output is prerendered HTML, not a client-only
// shell. Nothing here reads a request.
import { fetchLatestRelease } from '$lib/release';

export const prerender = true;

/**
 * Runs at build time during prerender; the returned data is serialized into
 * every prerendered page. Client navigations reuse it (this load does not
 * re-run on the static site). Null when GitHub is unreachable — the pages
 * render the curated fallback instead of lying or crashing.
 */
export async function load() {
	return { release: await fetchLatestRelease() };
}
