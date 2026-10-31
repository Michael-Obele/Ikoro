<script lang="ts">
	/**
	 * The scheme picker: six seed hues plus wallpaper. Each card is a miniature of the app,
	 * drawn in the current mode, so it answers "what will this do to my screen?".
	 */
	import { Check, Sparkles } from '@lucide/svelte';
	import {
		SCHEME_IDS,
		SEED_SCHEMES,
		schemePreview,
		type SchemeId,
		type SchemePreview
	} from '#lib/theme/schemes';
	import { isDynamicAvailable, resolvedScheme, resolvedTheme, setScheme } from '#lib/theme/theme.svelte';

	/** A conic gradient and no miniature: the Material You palette is unknown until it is read. */
	const WALLPAPER_LABEL = 'Wallpaper';
	const WALLPAPER_DESCRIPTION = 'Colours taken from your wallpaper (Material You)';
	const WALLPAPER_SWATCH =
		'conic-gradient(from 0deg, oklch(0.6 0.18 20), oklch(0.6 0.18 90), oklch(0.6 0.18 160), oklch(0.6 0.18 230), oklch(0.6 0.18 300), oklch(0.6 0.18 20))';

	interface Option {
		id: SchemeId;
		label: string;
		description: string;
		/** `null` for the wallpaper scheme — it has no knowable palette. */
		preview: SchemePreview | null;
	}

	/** The miniatures are drawn in the mode the app is painting now, so each card is what clicking it does. */
	const mode = $derived(resolvedTheme());

	const options = $derived<Option[]>([
		...SCHEME_IDS.map((id) => ({
			id: id as SchemeId,
			label: SEED_SCHEMES[id].label,
			description: `${SEED_SCHEMES[id].label} colour scheme`,
			preview: schemePreview(id, mode)
		})),
		...(isDynamicAvailable()
			? [
					{
						id: 'dynamic' as SchemeId,
						label: WALLPAPER_LABEL,
						description: WALLPAPER_DESCRIPTION,
						preview: null
					}
				]
			: [])
	]);

	// `resolvedScheme`, not `schemeChoice`: with no wallpaper palette the stored value can be
	// 'dynamic' while crimson is what is on screen.
	const current = $derived(resolvedScheme());
</script>

<div class="flex flex-col gap-3">
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Colour scheme">
		{#each options as option (option.id)}
			{@const selected = current === option.id}
			<label
				title={option.description}
				class="relative flex cursor-pointer flex-col gap-2 rounded-xs border-2 p-1.5 outline-none transition-[border-color,box-shadow] has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 {selected
					? 'border-primary'
					: 'border-input hover:border-foreground'}"
			>
				<!--
					`relative` on the label is load-bearing: `sr-only` is absolute, and without it the
					radio escapes to the fixed shell and the browser scrolls the whole app to reveal it.
				-->
				<input
					type="radio"
					name="ikoro-colour-scheme"
					value={option.id}
					checked={selected}
					onchange={() => setScheme(option.id)}
					class="sr-only"
				/>

				<!--
					Colours come from the scheme being OFFERED, not the one in force. Decorative: the
					label below is the name.
				-->
				<span
					aria-hidden="true"
					class="block overflow-hidden rounded-xs border"
					style={option.preview
						? `background:${option.preview.surface};border-color:${option.preview.outline}`
						: `background:${WALLPAPER_SWATCH};border-color:transparent`}
				>
					{#if option.preview}
						{@const p = option.preview}
						<span
							class="m-1.5 flex flex-col justify-center gap-1 rounded-xs border p-1.5"
							style="background:{p.container};border-color:{p.outline}"
						>
							<span class="block h-1 w-3/4 rounded-full" style="background:{p.onSurface}"></span>
							<span
								class="block h-1 w-1/2 rounded-full"
								style="background:{p.onSurfaceVariant}"
							></span>
							<span class="mt-0.5 block h-2 w-8 rounded-full" style="background:{p.primary}"
							></span>
						</span>
					{:else}
						<span class="flex h-15 items-center justify-center">
							<Sparkles class="size-5 text-background" strokeWidth={2.5} />
						</span>
					{/if}
				</span>

				<span class="flex items-center justify-between gap-1 px-0.5 leading-none">
					<span class="text-xs font-medium">{option.label}</span>
					{#if selected}
						<!-- A tick as well as the border: a 2px edge and a colour are lost to colour-blindness. -->
						<Check class="size-3.5 shrink-0" aria-hidden="true" strokeWidth={3} />
					{/if}
				</span>
			</label>
		{/each}
	</div>

	<p class="text-xs text-muted-foreground" aria-live="polite">
		{options.find((o) => o.id === current)?.label ?? 'Crimson'} colour scheme
	</p>
</div>
