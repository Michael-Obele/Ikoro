<script lang="ts">
	import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from '@ikoro/ui';
	import { CircleAlert, Download } from '@lucide/svelte';
	import PlatformTable from '$lib/components/PlatformTable.svelte';
	import Section from '$lib/components/Section.svelte';
	import { platforms, releaseNotice, site } from '$lib/content';

	/** The steps are only worth printing while there is something to install. */
	const android = platforms.find((p) => p.id === 'android');
</script>

<svelte:head>
	<title>Download — {site.name}</title>
	<meta
		name="description"
		content="Where Ikoro runs, what each platform does with a reminder, and how to install the Android APK."
	/>
</svelte:head>

<section class="border-b">
	<div class="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
		<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Download</h1>
		<p class="mt-4 max-w-2xl text-base text-muted-foreground">
			One build of the app, three ways to run it, and a table that says plainly which of them can
			actually wake you up.
		</p>
	</div>
</section>

<section class="py-12">
	<div class="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
		<Alert role="note">
			<CircleAlert aria-hidden="true" />
			<AlertTitle>Nothing to download yet</AlertTitle>
			<AlertDescription>{releaseNotice}</AlertDescription>
		</Alert>

		<div class="mt-10">
			<PlatformTable />
		</div>
	</div>
</section>

{#if android?.href}
	<Section
		id="install"
		title="Installing the Android build"
		lede="It is an APK. There is no store listing, so Android asks you to allow installs from the app you opened the link with."
	>
		<ol class="grid max-w-3xl gap-6">
			<li class="border-l-2 pl-4">
				<h3 class="font-medium tracking-tight">Open the APK</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					It is on the <a class="underline underline-offset-4" href={android.href}
						>{android.action}</a
					>. Allow your browser to install it when Android asks.
				</p>
			</li>
			<li class="border-l-2 pl-4">
				<h3 class="font-medium tracking-tight">Allow the notifications</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					Android will ask for notification permission the first time you set a reminder. If the
					permission was denied, Ikoro keeps a banner on screen until it is granted.
				</p>
			</li>
			<li class="border-l-2 pl-4">
				<h3 class="font-medium tracking-tight">Allow exact alarms</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					Android 12 and later treat reminders as alarms and keep that permission separate. Ikoro
					opens that system screen for you the first time a reminder needs it, and says so if you
					decline rather than downgrading the reminder to something that can arrive late.
				</p>
			</li>
		</ol>

		<div class="mt-10 flex flex-wrap gap-3">
			<Button href={android.href} class="gap-2">
				<Download class="size-4" aria-hidden="true" />
				{android.action}
			</Button>
			<Button href={site.repo} variant="outline">Build it yourself</Button>
		</div>

		<Card class="mt-10 max-w-3xl">
			<CardContent class="pt-6 text-sm text-muted-foreground">
				If a reminder arrives late, or not at all, the cause is almost always one of those two
				permissions, and Ikoro shows you which one. A battery saver that strips the app of
				background work is the next most common reason — exact alarms are the cure, and that is the
				permission above.
			</CardContent>
		</Card>
	</Section>
{/if}
