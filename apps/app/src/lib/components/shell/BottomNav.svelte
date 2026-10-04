<script lang="ts">
	/**
	 * The phone's primary navigation — a Material 3 navigation bar.
	 *
	 * WHY THIS REPLACED THE HAMBURGER. Every destination used to sit behind a
	 * drawer: two taps to change view, no hint of what the app even contains, and
	 * the drawer covering the screen you were trying to leave. A bottom bar puts the
	 * three views one thumb-reachable tap away and shows the shape of the app
	 * without opening anything. The mobile-navigation research is unusually
	 * consistent on this: for 3-5 top-level destinations a bottom bar beats a
	 * hamburger.
	 *
	 * THE FOURTH SLOT IS AN ACTION, NOT A ROUTE. Lists are the app's content, not a
	 * view over it — Todoist tucks projects behind the same kind of affordance. It
	 * opens the drawer that already exists instead of inventing a `/lists` page:
	 * that drawer is where the lists, the theme control and the way into Settings
	 * already live, and a second home for them is a second thing to keep in step.
	 *
	 * All four slots clear a 44px touch target by a wide margin (each is roughly
	 * 64px tall and a quarter of the width).
	 */
	import { page } from '$app/state';
	import CalendarClock from 'lucide-svelte/icons/calendar-clock';
	import CalendarDays from 'lucide-svelte/icons/calendar-days';
	import CheckCheck from 'lucide-svelte/icons/check-check';
	import ListIcon from 'lucide-svelte/icons/list';

	let { onopenlists }: { onopenlists: () => void } = $props();

	const path = $derived(page.url.pathname);

	function isActive(href: string): boolean {
		return path === href || path.startsWith(`${href}/`);
	}

	const TABS = [
		{ href: '/today', label: 'Today', icon: CalendarClock },
		{ href: '/upcoming', label: 'Upcoming', icon: CalendarDays },
		{ href: '/done', label: 'Done', icon: CheckCheck }
	] as const;
</script>

<!--
	`md:hidden` lives here rather than at the call site: this component IS the phone
	navigation, so every caller wants the same breakpoint and none of them should
	have to remember it.

	The bottom padding is a safe-area inset. It resolves to zero unless the shell
	opts into `viewport-fit=cover`, and it is correct the moment it does.
-->
<nav
	class="flex shrink-0 items-stretch border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
	aria-label="Main"
>
	{#each TABS as tab (tab.href)}
		<a
			href={tab.href}
			aria-current={isActive(tab.href) ? 'page' : undefined}
			class="flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[0.6875rem] transition-colors"
		>
			<!-- The M3 indicator: the pill marks the destination, not the label, so the
			     states read the same way they do in the sidebar. -->
			<span
				class="flex h-8 w-16 items-center justify-center rounded-full transition-colors {isActive(
					tab.href
				)
					? 'bg-accent text-accent-foreground'
					: 'text-muted-foreground'}"
			>
				<tab.icon class="size-5" />
			</span>
			<span class={isActive(tab.href) ? 'font-medium text-foreground' : 'text-muted-foreground'}>
				{tab.label}
			</span>
		</a>
	{/each}

	<button
		type="button"
		class="flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[0.6875rem] text-muted-foreground transition-colors"
		onclick={onopenlists}
	>
		<span class="flex h-8 w-16 items-center justify-center rounded-full">
			<ListIcon class="size-5" />
		</span>
		<span>Lists</span>
	</button>
</nav>
