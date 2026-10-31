<script lang="ts">
	import { page } from '$app/state';
	import { Badge, Button } from '$lib/components/ui';
	import Section from '$lib/components/Section.svelte';
	import { formatReleaseDate, limits, releaseEntries, site } from '$lib/content';

	/** Every release GitHub returned, newest first; the notes are GitHub's own release body. */
	const shown = $derived(releaseEntries(page.data.releases));
</script>

<svelte:head>
	<title>Changelog — {site.name}</title>
	<meta name="description" content="What is in each Ikoro release, including what is not in it." />
</svelte:head>

<section class="border-b">
	<div class="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
		<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Changelog</h1>
		<p class="mt-4 max-w-2xl text-base text-muted-foreground">
			Each entry is the release's own notes, read from GitHub when this page was built. It lists
			every change that release records, because a changelog that only lists the good parts is
			marketing.
		</p>
		<p class="mt-3 font-mono text-xs tracking-widest text-muted-foreground uppercase">
			{shown.length} releases, newest first
		</p>
		{#if shown.length === 0}
			<p class="mt-4 max-w-2xl text-base">
				GitHub could not be reached while this page was built, so there are no entries to print.
				<a class="underline underline-offset-4" href={site.releases}>Read the releases</a>
			</p>
		{/if}
	</div>
</section>

<Section
	id="not-yet"
	title="Not in any of these"
	lede="True of every version above, so it is said once here rather than repeated under each one."
>
	<ul class="flex max-w-3xl flex-col gap-2 text-sm text-muted-foreground">
		{#each limits as limit (limit)}
			<li class="flex gap-2">
				<span aria-hidden="true" class="text-foreground">—</span>
				<span>{limit}</span>
			</li>
		{/each}
	</ul>
</Section>

{#each shown as entry, index (entry.version)}
	<!-- No 01 / 02 / 03 markers: the version IS the order. -->
	<Section id={index === 0 ? entry.version : undefined} title="v{entry.version}">
		{#if entry.date}
			<Badge variant="outline" class="font-mono">{formatReleaseDate(entry.date)}</Badge>
		{/if}

		<div class="mt-10 grid max-w-5xl gap-10 md:grid-cols-2">
			<div>
				<h3 class="font-medium tracking-tight">In this version</h3>
				{#if entry.included.length > 0}
					<ul class="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
						{#each entry.included as item (item)}
							<li class="flex gap-2">
								<span aria-hidden="true" class="text-foreground">—</span>
								<span>{item}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-4 text-sm text-muted-foreground">
						The release carries no notes on GitHub, and this page does not write them for it.
					</p>
				{/if}
			</div>

			{#if entry.missing.length > 0}
				<div>
					<h3 class="font-medium tracking-tight">Not on this release</h3>
					<ul class="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
						{#each entry.missing as item (item)}
							<li class="flex gap-2">
								<span aria-hidden="true" class="text-foreground">—</span>
								<span>{item}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	</Section>
{/each}

<Section
	title="Before that"
	lede="The history starts at the first tagged build. Earlier work is in the commit log, unsorted and not written up."
>
	<div class="flex flex-wrap gap-3">
		<Button href={site.releases} variant="outline">Every release on GitHub</Button>
		<Button href={site.repo} variant="ghost">The commit log</Button>
	</div>
</Section>
