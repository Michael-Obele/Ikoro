/** The app opens on Today; a static SPA, so the client router does the redirect. */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

export function load() {
	void goto(resolve('/today'), { replaceState: true });
}
