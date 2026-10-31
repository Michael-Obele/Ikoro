<script lang="ts">
	import { Download } from '@lucide/svelte';
	import { Button } from '$lib/components/ui';
	import { assetLabels, formatBytes, formatReleaseDate } from '$lib/content';
	import { ASSET_ORDER, type AssetKind, type ReleaseInfo } from '$lib/release';

	/**
	 * One row per offered file, stated as arrived, in transit, or not confirmed. The
	 * window matters: tagging a release starts two builds minutes apart, and guessing a
	 * download URL in that window produced a 404 that read as "the product is broken".
	 * Only the in-transit dot moves (a pulse, silenced under `prefers-reduced-motion`).
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
