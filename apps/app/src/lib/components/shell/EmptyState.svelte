<script lang="ts">
	/** The "there is nothing here" panel: icon, one line of what is true, one of what to do, one action. */
	import type { Snippet } from 'svelte';
	import type { LucideIcon } from '@lucide/svelte';

	let {
		/**
		 * Destructured as `icon: Icon` on purpose — Svelte decides component vs element by
		 * capitalisation, so `<icon />` would render an empty unknown element.
		 */
		icon: Icon,
		title,
		hint,
		action
	}: {
		icon: LucideIcon;
		/** What is true. One short line. */
		title: string;
		/** What to do about it. One short line, optional. */
		hint?: string;
		/** The next action — a button or a link. Optional: some states have none. */
		action?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center px-6 py-16 text-center">
	<!-- `aria-hidden`: the icon restates the title, so announcing it is noise. -->
	<div
		class="mb-4 flex size-12 items-center justify-center border border-outline-variant text-muted-foreground"
		aria-hidden="true"
	>
		<Icon class="size-5" />
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
