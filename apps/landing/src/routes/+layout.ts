// Every page of this site is a page, not a view of state. Each one is built once
// into HTML at deploy time and served as a file, which is why `ssr` stays at its
// SvelteKit default of `true`: the output is prerendered HTML, not a client-only
// shell. Nothing here reads a request.
import { deriveRelease, fetchReleases } from '$lib/release';
import { version as appVersion } from '../../../app/package.json';

export const prerender = true;

/**
 * Runs at build time during prerender; the returned data is serialized into
 * every prerendered page. Client navigations reuse it (this load does not
 * re-run on the static site). One call returns the whole history, so `release`
 * is the newest entry and `releases` is what /changelog prints — nothing on the
 * site carries a version of its own.
 *
 * Never throws and never returns null: an unreachable GitHub yields an empty
 * list and the app-version derivation, which the copy layer reports as
 * unconfirmed rather than failing the build.
 */
export async function load() {
	const releases = await fetchReleases();
	return { release: releases[0] ?? deriveRelease(appVersion), releases };
}
