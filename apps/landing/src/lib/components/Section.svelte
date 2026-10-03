<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A titled band of the page.
	 *
	 * Every page on this site is a stack of these, which is why it is a component:
	 * the heading level, the container width and the anchor offset are decided once
	 * here instead of being retyped per page until one of them drifts.
	 */
	let {
		id,
		title,
		lede,
		children
	}: { id?: string; title: string; lede?: string; children: Snippet } = $props();
</script>

<!-- `scroll-mt` keeps an anchored section from landing under the sticky header. -->
<section {id} class="scroll-mt-16 py-12 sm:py-16">
	<div class="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
		<h2 class="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
		{#if lede}
			<p class="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{lede}</p>
		{/if}
		<div class="mt-8">
			{@render children()}
		</div>
	</div>
</section>
