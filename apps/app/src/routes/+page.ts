/**
 * The app opens on Today, not on a marketing page. This is a static SPA with no
 * server, so the client router does the redirect.
 */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

export function load() {
	void goto(resolve('/today'), { replaceState: true });
}