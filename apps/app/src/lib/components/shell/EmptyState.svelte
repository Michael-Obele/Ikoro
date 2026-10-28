<script lang="ts">
	/**
	 * The "there is nothing here" panel, shared by every view.
	 *
	 * WHY THIS EXISTS. Each screen used to answer an empty list with one grey
	 * sentence — "Nothing due — Ikoro is quiet." — centred in a large blank area.
	 * That is a dead end: it tells you the state and offers nothing to do about
	 * it, and on a phone it is the first thing a new user sees on every tab.
	 *
	 * The shape is deliberately the same everywhere: an icon, one line of what is
	 * true, one line of what to do, and one action. Three views inventing three
	 * different empty states is how an app starts feeling assembled rather than
	 * designed.
	 *
	 * BOXY. No card, no radius, no shadow. The icon sits in a square outlined tile
	 * and the action is a normal shadcn Button, so the panel is made of the same
	 * parts as the rest of the screen.
	 */
	import type { Snippet } from 'svelte';
	import type { Icon as IconComponent } from 'lucide-svelte';

	let {
		icon,
		title,
		hint,
		action
	}: {
		/**
		 * A lucide icon component, e.g. `CalendarCheck`. Typed as lucide's own `Icon`
		 * rather than a structural `Component<{ class?: string }>`: lucide's
		 * components are `Component<IconProps>`, and a narrower structural type does
		 * not accept them (their props include `size`, `strokeWidth`, `absoluteStrokeWidth`).
		 */
		icon: typeof IconComponent;
		/** What is true. One short line. */
		title: string;
		/** What to do about it. One short line, optional. */
		hint?: string;
		/** The next action — a button or a link. Optional: some states have none. */
		action?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center px-6 py-16 text-center">
	<!--
		`aria-hidden` on the tile: the icon is decoration that restates the title,
		and a screen reader announcing "calendar icon" before "Nothing due today"
		is noise, not information.
	-->
	<div
		class="mb-4 flex size-12 items-center justify-center border border-outline-variant text-muted-foreground"
		aria-hidden="true"
	>
		<icon class="size-5"></icon>
	</div>

	<p class="text-sm font-medium text-foreground">{title}</p>

	{#if hint}
		<p class="mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p>
	{/if}

	{#if action}
		<div class="mt-4">
			{@render action()}
		</div>
	{/if}
</div>
