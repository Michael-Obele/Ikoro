<script lang="ts">
	import { Download } from '@lucide/svelte';
	import { Button } from '$lib/components/ui';
	import { assetLabels, formatBytes, formatReleaseDate } from '$lib/content';
	import { ASSET_ORDER, type AssetKind, type ReleaseInfo } from '$lib/release';

	/**
	 * The arrival list: one row per file this site offers, each stated as arrived,
	 * in transit, or not confirmed.
	 *
	 * This is the page's signature element, and it is load-bearing rather than
	 * decorative. A release is not one thing that exists or does not: tagging it
	 * starts two builds that upload minutes apart, so there is a real window in
	 * which the release is half-delivered. The old page resolved that window by
	 * guessing a download URL — which 404s — and the visitor reads a 404 as "this
	 * product is broken". Showing the files and what each one is doing says the
	 * same thing without ever lying, and it turns "wait, where is my file?" into a
	 * status you can read.
	 *
	 * Motion is confined to the one row that is genuinely waiting: a slow pulse on
	 * the in-transit dot, silenced under `prefers-reduced-motion`. Nothing else
	 * moves — the page is a status board, not a showreel.
	 */
	let { release }: { release: ReleaseInfo } = $props();

	type RowState = 'arrived' | 'inTransit' | 'unconfirmed';

	const STATE_WORD: Record<RowState, string> = {
		arrived: 'Ready to download',
		inTransit: 'Still building',
		unconfirmed: 'Could not be checked'
	};

	const DOT: Record<RowState, string> = {
		arrived: 'size-2 bg-primary',
		inTransit: 'size-2 animate-pulse bg-muted-foreground/50 motion-reduce:animate-none',
		unconfirmed: 'size-2 border border-muted-foreground/60'
	};

	const rows = $derived(
		ASSET_ORDER.map((kind: AssetKind) => {
			const asset = release.assets[kind];
			const state: RowState =
				asset !== undefined ? 'arrived' : release.source === 'live' ? 'inTransit' : 'unconfirmed';
			return { kind, asset, state, ...assetLabels[kind] };
		})
	);
</script>

<!--
	Keyline box, no radius, mono for the machine facts — the same boxy, ruled
	language as the platform table, so the two read as one document.
-->
<div class="border">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
		<p class="font-mono text-xs tracking-widest uppercase">Release {release.version}</p>
		<p class="font-mono text-xs text-muted-foreground">
			{release.publishedAt !== undefined
				? formatReleaseDate(release.publishedAt)
				: 'date unavailable'}
		</p>
	</div>

	<ul class="divide-y">
		{#each rows as row (row.kind)}
			<li
				class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3"
			>
				<span aria-hidden="true" class={DOT[row.state]}></span>

				<div class="min-w-0">
					<p class="text-sm font-medium">
						<span class="sr-only">{STATE_WORD[row.state]}: </span>{row.label}
					</p>
					<p class="text-xs text-muted-foreground">{row.note}</p>
				</div>

				{#if row.asset}
					<Button size="sm" variant="outline" href={row.asset.url} class="gap-1.5">
						<Download class="size-3.5" aria-hidden="true" />
						{row.asset.sizeBytes !== undefined ? formatBytes(row.asset.sizeBytes) : 'Download'}
					</Button>
				{:else}
					<span class="font-mono text-xs text-muted-foreground">
						{row.state === 'inTransit' ? 'in transit' : 'not confirmed'}
					</span>
				{/if}
			</li>
		{/each}
	</ul>
</div>
