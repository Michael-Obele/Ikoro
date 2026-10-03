<script lang="ts">
	import Logo from './Logo.svelte';
	import { site } from '$lib/content';
</script>

<footer class="border-t py-10">
	<div
		class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-start md:justify-between lg:px-8"
	>
		<div class="flex items-start gap-3">
			<Logo class="size-7" />
			<div>
				<p class="font-semibold tracking-tight">{site.name}</p>
				<p class="mt-1 text-sm text-muted-foreground">{site.tagline}</p>
			</div>
		</div>

		<nav aria-label="Footer">
			<ul class="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
				<li><a class="text-muted-foreground hover:text-foreground" href="/">Home</a></li>
				<li>
					<a class="text-muted-foreground hover:text-foreground" href="/download">Download</a>
				</li>
				<li>
					<a class="text-muted-foreground hover:text-foreground" href="/privacy">Privacy</a>
				</li>
				<li>
					<a class="text-muted-foreground hover:text-foreground" href="/changelog">Changelog</a>
				</li>
			</ul>
		</nav>
	</div>

	<div class="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
		<p class="text-sm text-muted-foreground">
			Open source. <a class="underline underline-offset-4" href={site.repo}>Source and issues</a>.
			No trackers on this site and no account in the app.
		</p>
	</div>
</footer>
