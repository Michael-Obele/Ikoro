<script lang="ts">
	import Section from '$lib/components/Section.svelte';
	import { privacy, releases, site, sitePrivacy } from '$lib/content';

	const latest = releases[0];
</script>

<svelte:head>
	<title>Privacy — {site.name}</title>
	<meta
		name="description"
		content="What Ikoro stores, where it stores it, and what leaves the device. The short answer: nothing leaves the device."
	/>
</svelte:head>

<section class="border-b">
	<div class="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
		<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Privacy</h1>
		<p class="mt-4 max-w-2xl text-base text-muted-foreground">
			Ikoro has no account, so there is nothing here about a user. What follows is what the app
			stores, where it stores it, and what the website does.
		</p>
	</div>
</section>

<Section id="app" title="The app">
	<dl class="grid max-w-3xl gap-6">
		{#each privacy as point (point.claim)}
			<div class="border-l-2 pl-4">
				<dt class="font-medium tracking-tight">{point.claim}</dt>
				<dd class="mt-1 text-sm text-muted-foreground">{point.detail}</dd>
			</div>
		{/each}
	</dl>
</Section>

<Section
	id="site"
	title="This website"
	lede="A marketing page has no business collecting anything, so it collects nothing."
>
	<dl class="grid max-w-3xl gap-6">
		{#each sitePrivacy as point (point.claim)}
			<div class="border-l-2 pl-4">
				<dt class="font-medium tracking-tight">{point.claim}</dt>
				<dd class="mt-1 text-sm text-muted-foreground">{point.detail}</dd>
			</div>
		{/each}
	</dl>
</Section>

<Section
	id="data"
	title="Taking your data with you"
	lede="You do not need this project to keep your tasks readable — you need a text file."
>
	<p class="max-w-3xl text-base text-muted-foreground">
		Settings writes every list and task to a JSON file you can open in any text editor. Import reads
		that file back. Import merges by id and keeps whichever version was edited more recently, so
		restoring an old backup cannot roll back something you changed since. A task whose list is
		missing is reported rather than quietly dropped, because a silent skip looks exactly like data
		loss.
	</p>
	<p class="mt-4 max-w-3xl text-base text-muted-foreground">
		Deleting the app removes its local database with it. Export first if you want to keep any of it.
	</p>
</Section>

<Section id="questions" title="Questions, and corrections">
	<p class="max-w-3xl text-base text-muted-foreground">
		If something on this page is wrong, it is a bug worth knowing about. Open an issue on the
		repository — it is the same place the code is.
	</p>
	<p class="mt-4">
		<a class="underline underline-offset-4" href={site.issues}>Report it</a>
	</p>
	<p class="mt-8 text-sm text-muted-foreground">
		This page describes v{latest.version}. It changes when the app does, and the
		<a class="underline underline-offset-4" href="/changelog">changelog</a> says when.
	</p>
</Section>
