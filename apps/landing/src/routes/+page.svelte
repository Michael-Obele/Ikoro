<script lang="ts">
	/** The home page: the promise, then the evidence. Copy lives in `$lib/content`; this file only lays it out. */
	import {
		Alert,
		AlertDescription,
		AlertTitle,
		Button,
		Card,
		CardContent,
		CardHeader,
		CardTitle
	} from '$lib/components/ui';
	import { CircleAlert, Download, ExternalLink } from '@lucide/svelte';
	import { page } from '$app/state';
	import Section from '$lib/components/Section.svelte';
	import {
		limits,
		nameStory,
		privacy,
		promise,
		releaseNotice,
		site,
		taskShape,
		views
	} from '$lib/content';

	/** The release in the header -- a still-building release says so here too, never claiming a file early. */
	const notice = $derived(releaseNotice(page.data.release));
</script>

<svelte:head>
	<title>Ikoro — {site.tagline}</title>
	<meta
		name="description"
		content="Ikoro is a task list for Android where the reminder is the point: you set a time and the alarm is handed to the operating system, so it fires with the app closed."
	/>
	<meta property="og:title" content="Ikoro — {site.tagline}" />
	<meta property="og:type" content="website" />
	<meta property="og:image" content="/icons/icon-1024.png" />
</svelte:head>

<!-- ── hero ──────────────────────────────────────────────────────────────────── -->
<section class="border-b">
	<div class="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
		<p class="text-sm text-muted-foreground">{site.pronunciation} · Android first</p>

		<h1 class="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
			{promise.headline}
		</h1>

		<p class="mt-6 max-w-2xl text-lg text-muted-foreground">{promise.lead}</p>
		<p class="mt-4 max-w-2xl text-base">{promise.proof}</p>

		<div class="mt-8 flex flex-wrap items-center gap-3">
			<Button size="lg" href={site.releases} class="gap-2">
				<Download class="size-4" aria-hidden="true" />
				Get the Android build
			</Button>
			<Button size="lg" variant="outline" href="/download">What runs where</Button>
		</div>

		<!-- `role="note"` on purpose: a standing statement, not a failure. Alert's own
		     `role="alert"` would have assistive technology announce it as urgent. -->
		<Alert role="note" class="mt-12">
			<CircleAlert aria-hidden="true" />
			<AlertTitle>{notice.title}</AlertTitle>
			<AlertDescription>{notice.body}</AlertDescription>
		</Alert>
	</div>
</section>

<!-- ── the name ──────────────────────────────────────────────────────────────── -->
<Section id="name" title="The name" lede={nameStory.link}>
	<p class="max-w-2xl text-base text-muted-foreground">
		An <strong class="font-medium text-foreground">{nameStory.term}</strong> is {nameStory.gloss}
	</p>
</Section>

<!-- ── what it does ──────────────────────────────────────────────────────────── -->
<Section
	id="what-it-does"
	title="What it does"
	lede="Three screens, one idea: the next thing that has to happen, and the time it has to happen by."
>
	<div class="grid gap-4 md:grid-cols-3">
		{#each views as view (view.name)}
			<Card>
				<CardHeader>
					<CardTitle>{view.name}</CardTitle>
				</CardHeader>
				<CardContent>
					<p class="text-sm text-muted-foreground">{view.what}</p>
				</CardContent>
			</Card>
		{/each}
	</div>

	<div class="mt-12 grid gap-8 md:grid-cols-2">
		<div>
			<h3 class="text-lg font-medium tracking-tight">A task is a small thing</h3>
			<ul class="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
				{#each taskShape as field (field)}
					<li class="flex gap-2">
						<span aria-hidden="true" class="text-foreground">—</span>
						<span>{field}</span>
					</li>
				{/each}
			</ul>
			<p class="mt-4 text-sm text-muted-foreground">
				Anything you tick off goes to Done, newest first, and one tap puts it back.
			</p>
		</div>

		<div>
			<h3 class="text-lg font-medium tracking-tight">And the reminder</h3>
			<p class="mt-4 text-sm text-muted-foreground">
				Set the time on the task and the alarm is scheduled by the operating system the moment you
				save it. Nothing inside the app has to stay awake. When the app comes back to the foreground
				it re-arms everything it owns, so a revoked permission or a reboot is repaired instead of
				discovered later.
			</p>
			<p class="mt-4 text-sm text-muted-foreground">
				If a reminder cannot be scheduled exactly, Ikoro refuses it and says so, rather than
				accepting it and firing late.
			</p>
		</div>
	</div>
</Section>

<!-- ── privacy ───────────────────────────────────────────────────────────────── -->
<Section
	id="privacy"
	title="Local first, no account"
	lede="There is nothing to sign up for, and nothing watching what you do with it."
>
	<dl class="grid max-w-3xl gap-6">
		{#each privacy as point (point.claim)}
			<div class="border-l-2 pl-4">
				<dt class="font-medium tracking-tight">{point.claim}</dt>
				<dd class="mt-1 text-sm text-muted-foreground">{point.detail}</dd>
			</div>
		{/each}
	</dl>

	<p class="mt-10">
		<a class="underline underline-offset-4" href="/privacy">Read the full privacy statement</a>
	</p>
</Section>

<!-- ── limits ────────────────────────────────────────────────────────────────── -->
<Section
	id="limits"
	title="What it does not do yet"
	lede="A short list, kept short because every item on it is a reason somebody would be disappointed."
>
	<Alert>
		<CircleAlert aria-hidden="true" />
		<!-- The version comes from the build; the list below is standing copy. -->
		<AlertTitle>In v{page.data.release.version}</AlertTitle>
		<AlertDescription>
			<ul class="mt-1 flex flex-col gap-1.5">
				{#each limits as limit (limit)}
					<li>{limit}</li>
				{/each}
			</ul>
		</AlertDescription>
	</Alert>

	<div class="mt-10 flex flex-wrap gap-3">
		<Button href="/download" variant="outline">See the platform table</Button>
		<Button href={site.repo} variant="ghost" class="gap-2">
			Read the source
			<ExternalLink class="size-4" aria-hidden="true" />
		</Button>
	</div>
</Section>
