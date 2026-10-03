<script lang="ts">
	import './layout.css';
	import { browser, dev } from '$app/env';
	import { Agentation } from 'sv-agentation';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import SiteHeader from '$lib/components/SiteHeader.svelte';

	let { children } = $props();
</script>

<!-- The app ships light and dark token sets; this site renders the light one and
     says so, rather than declaring support for a scheme it does not style. -->
<svelte:head>
	<meta name="color-scheme" content="light" />
</svelte:head>

<a
	href="#main"
	class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-xs focus:bg-background focus:px-3 focus:py-2 focus:ring-1 focus:ring-ring"
>
	Skip to content
</a>

<div class="flex min-h-dvh flex-col">
	<SiteHeader />
	<main id="main" class="flex-1">
		{@render children()}
	</main>
	<SiteFooter />
</div>

{#if browser && dev}
	<!-- sv-agentation: UI annotations become markdown context for AI agents. Dev only. -->
	<Agentation
		toolbarPosition="bottom-right"
		outputMode="forensic"
		pauseAnimations
		clearOnCopy
		includeComponentContext={false}
		includeComputedStyles={false}
	/>
{/if}
