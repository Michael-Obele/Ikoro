<script lang="ts">
	import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from '$lib/components/ui';
	import { CircleAlert, Download } from '@lucide/svelte';
	import { page } from '$app/state';
	import PlatformTable from '$lib/components/PlatformTable.svelte';
	import ReleaseArrivals from '$lib/components/ReleaseArrivals.svelte';
	import Section from '$lib/components/Section.svelte';
	import { platformRows, releaseNotice, site } from '$lib/content';

	const release = $derived(page.data.release);

	/**
	 * The release in words — and the only place this page decides what it may
	 * promise. `ready` means GitHub listed every file; anything else means some
	 * or all of them have not landed, and the page says so rather than offering a
	 * link that 404s.
	 */
	const notice = $derived(releaseNotice(release));

	const rows = $derived(platformRows(release));

	/**
	 * The one primary action. It is a real file or it is not there: there is no
	 * "probably this URL" branch, because that is how a download page ends up
	 * sending people to a GitHub 404 eighteen seconds after a tag is cut.
	 */
	const apk = $derived(release.assets.apk);

	/** The install steps are only worth printing while there is something to install. */
	const android = $derived(rows.find((p) => p.id === 'android'));
	const linux = $derived(rows.find((p) => p.id === 'linux-desktop'));
</script>

<svelte:head>
	<title>Download — {site.name}</title>
	<meta
		name="description"
		content="Where Ikoro runs, what each platform does with a reminder, and how to install it on Android and on Linux."
	/>
</svelte:head>

<section class="border-b">
	<div class="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
		<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Download</h1>
		<p class="mt-4 max-w-2xl text-base text-muted-foreground">
			One build of the app, three ways to run it, and a table that says plainly which of them can
			actually wake you up.
		</p>

		<div class="mt-8 flex flex-wrap items-center gap-3">
			{#if apk}
				<Button size="lg" href={apk.url} class="gap-2">
					<Download class="size-4" aria-hidden="true" />
					Android APK
				</Button>
			{:else}
				<!-- No file on the release: send them somewhere honest instead of nowhere. -->
				<Button size="lg" href={release.tagUrl} class="gap-2">Open the {release.version} release</Button>
			{/if}
			<Button size="lg" variant="outline" href="#platforms">What runs where</Button>
		</div>
	</div>
</section>

<Section
	title="What is on this release"
	lede="Two builds publish this release minutes apart. This is where each file is."
>
	<div class="max-w-3xl">
		<!-- `role="note"`: a standing statement about the release, not a live
		     update. Alert's own `role="alert"` would make assistive technology
		     interrupt whatever is being read to announce it. -->
		<Alert role="note">
			<CircleAlert aria-hidden="true" />
			<AlertTitle>{notice.title}</AlertTitle>
			<AlertDescription>{notice.body}</AlertDescription>
		</Alert>
	</div>

	<div class="mt-8 max-w-3xl">
		<ReleaseArrivals {release} />
	</div>
</Section>

{#if android?.status === 'released'}
	<Section
		id="install"
		title="Installing the Android build"
		lede="It is an APK. There is no store listing, so Android asks you to allow installs from the app you opened the link with."
	>
		<ol class="grid max-w-3xl gap-6">
			<li class="border-l-2 pl-4">
				<h3 class="font-medium tracking-tight">Open the APK</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					It is at the top of this page. Allow your browser to install it when Android asks.
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
			{#if apk}
				<Button href={apk.url} class="gap-2">
					<Download class="size-4" aria-hidden="true" />
					Ikoro v{release.version} APK
				</Button>
			{/if}
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

{#if linux?.status === 'released'}
	<Section
		title="Installing on Linux"
		lede="Two files, one choice: a package your distro manages, or a single file you run where it sits."
	>
		<ol class="grid max-w-3xl gap-6">
			<li class="border-l-2 pl-4">
				<h3 class="font-medium tracking-tight">Pick the file</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					The <code class="font-mono text-foreground">.deb</code> is for Debian, Ubuntu, Zorin and
					Mint. The <code class="font-mono text-foreground">.AppImage</code> works anywhere else — it
					carries its own runtime, so there is nothing to install. The
					<code class="font-mono text-foreground">.rpm</code>, when the release has one, is for
					Fedora and openSUSE.
				</p>
			</li>
			<li class="border-l-2 pl-4">
				<h3 class="font-medium tracking-tight">Install it, or just run it</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					Open the <code class="font-mono text-foreground">.deb</code> with your software installer.
					For the AppImage, mark it executable and run it:
				</p>
				<pre
					class="mt-3 overflow-x-auto border bg-muted px-3 py-2 font-mono text-xs"
				><code>chmod +x Ikoro-{release.version}.AppImage
./Ikoro-{release.version}.AppImage</code></pre>
			</li>
			<li class="border-l-2 pl-4">
				<h3 class="font-medium tracking-tight">Try one reminder with the window closed</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					Linux reminders are handed to systemd as per-alarm user timers, which is what should make
					them fire with Ikoro closed. Set one a minute ahead, close the window, and watch for it —
					that is the whole check, and it is worth running on your machine rather than trusting ours.
				</p>
			</li>
		</ol>
	</Section>
{/if}

<Section
	id="platforms"
	title="What runs where"
	lede="Every platform, and a plain statement of what each one does with a reminder."
>
	<PlatformTable rows={rows} />
</Section>
