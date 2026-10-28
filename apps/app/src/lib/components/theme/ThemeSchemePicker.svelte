<script lang="ts">
	/**
	 * The colour scheme picker: six seed hues, plus the wallpaper one when the
	 * device can supply it.
	 *
	 * WHY SWATCHES AND NOT A ToggleGroup OF WORDS. The theme toggle above can say
	 * "Light" because the word is the thing. A colour scheme's name ("Teal") is
	 * not the thing — the colour is — and six words in a row is a wall of text
	 * where six squares is a glance. The name is still there, as the accessible
	 * name and the tooltip, so nothing is conveyed by colour alone.
	 *
	 * BOXY, LIKE EVERYTHING ELSE. 2px corners, a 2px border, and the selected
	 * swatch gets a 2px `--primary` ring offset by 2px — the same edge language as
	 * the rest of the app. `rounded-full` is deliberately absent: a circle here
	 * would read as a different design system.
	 *
	 * Data flow is one-way, no `$effect`: `schemeChoice` is the single source of
	 * truth, `setScheme` is the only writer. A local mirror would have to be kept
	 * in sync with a store that can also change from another tab.
	 */
	import { SCHEME_IDS, SEED_SCHEMES, seedSwatch, type SchemeId } from '#lib/theme/schemes';
	import {
		isDynamicAvailable,
		resolvedScheme,
		schemeChoice,
		setScheme
	} from '#lib/theme/theme.svelte';

	/**
	 * The wallpaper swatch, when there is one.
	 *
	 * A conic gradient rather than a flat colour: the point of Material You is
	 * that the palette is unknown until the wallpaper is read, so a fixed colour
	 * would be a lie about what the option does.
	 */
	const DYNAMIC_LABEL = 'Wallpaper';
	const DYNAMIC_DESCRIPTION = 'Colours taken from your wallpaper (Material You)';

	const options = $derived<{ id: SchemeId; label: string; description: string; swatch: string }[]>(
		[
			...SCHEME_IDS.map((id) => ({
				id: id as SchemeId,
				label: SEED_SCHEMES[id].label,
				description: `${SEED_SCHEMES[id].label} colour scheme`,
				swatch: seedSwatch(id)
			})),
			...(isDynamicAvailable()
				? [
						{
							id: 'dynamic' as SchemeId,
							label: DYNAMIC_LABEL,
							description: DYNAMIC_DESCRIPTION,
							swatch:
								'conic-gradient(from 0deg, oklch(0.6 0.18 20), oklch(0.6 0.18 90), oklch(0.6 0.18 160), oklch(0.6 0.18 230), oklch(0.6 0.18 300), oklch(0.6 0.18 20))'
						}
					]
				: [])
		]
	);

	// `resolvedScheme`, not `schemeChoice`: on a device with no wallpaper palette
	// the stored value can be 'dynamic' while crimson is what is on screen, and
	// the highlight has to follow the screen.
	const current = $derived(resolvedScheme());
</script>

<div class="flex flex-col gap-2">
	<div class="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Colour scheme">
		{#each options as option (option.id)}
			{@const selected = current === option.id}
			<button
				type="button"
				role="radio"
				aria-checked={selected}
				aria-label={`${option.label}: ${option.description}`}
				title={option.description}
				onclick={() => setScheme(option.id)}
				class="size-8 shrink-0 rounded-xs border-2 border-input outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 {selected
					? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
					: 'hover:border-foreground'}"
				style="background: {option.swatch}"
			>
				<span class="sr-only">{option.label}</span>
			</button>
		{/each}
	</div>

	<p class="text-xs text-muted-foreground" aria-live="polite">
		{options.find((o) => o.id === current)?.label ?? 'Crimson'} colour scheme
	</p>
</div>
