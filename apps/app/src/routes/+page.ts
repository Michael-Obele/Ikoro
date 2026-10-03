/**
 * The app opens on real content, not on a marketing page. There is no `/today`
 * until M3, so the root lands on the first list — the seeded one on a fresh
 * install. M3 repoints this at Today.
 */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { liveLists } from '$lib/stores/view';

export function load() {
	const first = liveLists()[0];
	if (first) void goto(resolve('/lists/[id]', { id: first.id }), { replaceState: true });
}