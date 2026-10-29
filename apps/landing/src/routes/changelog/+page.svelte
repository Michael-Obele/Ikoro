<script lang="ts">
	import { page } from '$app/state';
	import { Badge, Button } from '$lib/components/ui';
	import Section from '$lib/components/Section.svelte';
	import {
		changelogLimit,
		formatReleaseDate,
		isNewer,
		lagNotice,
		releases,
		site
	} from '$lib/content';

	/**
	 * The newest `changelogLimit` versions. The cap is a ceiling on how much
	 * history this page has actually written up, not a claim that every release
	 * has an entry — an entry is curated copy, and a version with none cannot be
	 * invented into one.
	 */
	const shown = $derived(releases.slice(0, changelogLimit));

	/**
	 * When the live release is newer than the newest curated entry, the notes
	 * lag behind it — say so at the top instead of pretending the entry covers
	 * the release. Never renders GitHub's auto-generated body.
	 */
	const lagging = $derived(
		isNewer(page.data.release.version, shown[0].version) ? page.data.release : null
	);
</script>

<svelte:head>
	<title>Changelog — {site.name}</title>
	<meta name="description" content="What is in each Ikoro release, including what is not in it." />
</svelte:head>

<section class="border-b">
	<div class="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
		<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Changelog</h1>
		<p class="mt-4 max-w-2xl text-base text-muted-foreground">
			Every entry lists what is missing as well as what is in it. A changelog that only lists the
			good parts is marketing.
		</p>
		<p class="mt-3 font-mono text-xs tracking-widest text-muted-foreground uppercase">
			{shown.length} of the newest {changelogLimit} versions
		</p>
		{#if lagging}
			<p class="mt-4 max-w-2xl text-base">
				{lagNotice(lagging.version)}
				<a class="underline underline-offset-4" href={lagging.tagUrl}>Read the release</a>
			</p>
		{/if}
	</div>
</section>

{#each shown as release, index (release.version)}
	<!--
		No 01 / 02 / 03 markers: the version IS the order, and re-stating it as a
		decorative index would encode nothing the reader did not already have.
	-->
	<Section id={index === 0 ? release.version : undefined} title="v{release.version}">
		<Badge variant="outline" class="font-mono">{formatReleaseDate(release.date)}</Badge>

		<p class="mt-6 max-w-3xl text-base">{release.summary}</p>

		<div class="mt-10 grid max-w-5xl gap-10 md:grid-cols-2">
			<div>
				<h3 class="font-medium tracking-tight">In this version</h3>
				<ul class="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
					{#each release.included as item (item)}
						<li class="flex gap-2">
							<span aria-hidden="true" class="text-foreground">—</span>
							<span>{item}</span>
						</li>
					{/each}
				</ul>
			</div>

			<div>
				<h3 class="font-medium tracking-tight">Not in this version</h3>
				<ul class="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
					{#each release.notIncluded as item (item)}
						<li class="flex gap-2">
							<span aria-hidden="true" class="text-foreground">—</span>
							<span>{item}</span>
						</li>
					{/each}
				</ul>
			</div>
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
