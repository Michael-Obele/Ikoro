// Every page is prerendered to a file at build time, so `ssr` stays at its default of true.
import { deriveRelease, fetchReleases } from '$lib/release';
import { version as appVersion } from '../../../app/package.json';

export const prerender = true;

/**
 * Runs at build time during prerender; the result is serialized into every page and
 * reused on client navigation. Never throws: an unreachable GitHub yields an empty
 * list plus the app-version derivation, which the copy layer reports as unconfirmed.
 */
export async function load() {
	const releases = await fetchReleases();
	return { release: releases[0] ?? deriveRelease(appVersion), releases };
}
