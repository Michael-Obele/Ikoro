<script lang="ts">
	/**
	 * The phone's primary navigation. The fourth slot is an ACTION that opens the lists
	 * drawer, not a route — a bottom bar beats a hamburger for 3-5 destinations.
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
	`md:hidden` lives here, not at the call site; the padding is a safe-area inset that
	resolves to zero until the shell opts into `viewport-fit=cover`.
-->
<nav
	class="flex shrink-0 items-stretch border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
	aria-label="Main"
>
	{#each TABS as tab (tab.href)}
		<a
			href={tab.href}
			aria-current={isActive(tab.href) ? 'page' : undefined}
			class="relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[0.6875rem] transition-colors"
		>
			<!-- A 2px bar on the top edge, positioned separately so it fades without shifting the icon. -->
			<span
				aria-hidden="true"
				class="absolute inset-x-3 top-0 h-0.5 bg-primary transition-opacity {isActive(
					tab.href
				)
					? 'opacity-100'
					: 'opacity-0'}"
			></span>
			<tab.icon
				class="size-5 {isActive(tab.href) ? 'text-primary' : 'text-muted-foreground'}"
			/>
			<span class={isActive(tab.href) ? 'font-medium text-foreground' : 'text-muted-foreground'}>
				{tab.label}
			</span>
		</a>
	{/each}

	<button
		type="button"
		class="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[0.6875rem] text-muted-foreground transition-colors"
		onclick={onopenlists}
	>
		<ListIcon class="size-5" />
		<span>Lists</span>
	</button>
</nav>
