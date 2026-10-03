<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { browser, dev } from '$app/env';
	import { Agentation } from 'sv-agentation';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

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
