<script lang="ts">
	/**
	 * The colour scheme picker: six seed hues, plus the wallpaper one when the
	 * device can supply it.
	 *
	 * WHAT CHANGED, AND WHY IT MATTERED. This used to be six 32px squares filled
	 * with each scheme's `--primary`. In the light theme `--primary` is tone 13 — it
	 * is also `--ring`, and a focus ring has to clear 3:1 against the page, which
	 * drags the token almost to black (see the header of `layout.css`). So all six
	 * squares rendered as near-black and the picker offered six colours that looked
	 * like one.
	 *
	 * Each option is now a MINIATURE OF THE APP in that scheme: a page, a card on
	 * it, a body line, a secondary line and an action bar — drawn in the mode the
	 * app is currently painting, so the card is what clicking it produces. That is
	 * the question a person is actually asking — "what will this do to my screen?"
	 * — and it can only be answered with the SURFACES, because surfaces are what
	 * most of a screen is made of. The colours come from the generated scheme
	 * itself, so the miniature cannot drift from the result.
	 *
	 * WHY NATIVE RADIOS AND NOT A BITS UI RadioGroup. These options are cards, not
	 * 16px circles: the generated `RadioGroup.Item` hardcodes `size-4 rounded-full
	 * border` and draws its own indicator dot, so using it here would mean
	 * overriding generated CSS and then hiding a dot that means nothing inside a
	 * card. A native `<input type="radio">`, visually hidden inside its `<label>`,
	 * is the same widget for free — arrow keys, roving focus, "3 of 7" announced —
	 * with no ARIA to get wrong and nothing to fight. The card IS the label.
	 *
	 * The name is never conveyed by colour alone: it is the visible label, and the
	 * selected option also carries a tick so the state survives colour-blindness
	 * and high-contrast mode.
	 *
	 * BOXY, LIKE EVERYTHING ELSE. 2px corners and a 2px border, in the same edge
	 * language as the rest of the app; the selected card swaps its border to
	 * `--primary` rather than gaining a second outline, so the card does not grow
	 * two borders deep. `rounded-full` is deliberately absent except on the two
	 * text bars inside the miniature, where a circle is what the shape MEANS.
	 *
	 * Data flow is one-way, no `$effect`: `schemeChoice` is the single source of
	 * truth, `setScheme` is the only writer. A local mirror would have to be kept
	 * in sync with a store that can also change from another tab.
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

	/**
	 * The wallpaper option, when there is one.
	 *
	 * A conic gradient rather than a flat colour, and no miniature: the point of
	 * Material You is that the palette is unknown until the wallpaper is read, so
	 * painting a specific page colour would be a lie about what the option does.
	 */
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

	/**
	 * The miniatures are drawn in the mode the app is painting right now, so each
	 * card is literally what happens on click. `resolvedTheme()` is reactive, so
	 * flipping the mode toggle above redraws all six.
	 */
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

	// `resolvedScheme`, not `schemeChoice`: on a device with no wallpaper palette
	// the stored value can be 'dynamic' while crimson is what is on screen, and
	// the highlight has to follow the screen.
	const current = $derived(resolvedScheme());
</script>

<div class="flex flex-col gap-3">
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Colour scheme">
		{#each options as option (option.id)}
			{@const selected = current === option.id}
			<label
				title={option.description}
				class="flex cursor-pointer flex-col gap-2 rounded-xs border-2 p-1.5 outline-none transition-[border-color,box-shadow] has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 {selected
					? 'border-primary'
					: 'border-input hover:border-foreground'}"
			>
				<input
					type="radio"
					name="ikoro-colour-scheme"
					value={option.id}
					checked={selected}
					onchange={() => setScheme(option.id)}
					class="sr-only"
				/>

				<!--
					The miniature. Every colour is an inline style computed from the scheme
					BEING OFFERED, not the one in force — showing a scheme the app is not
					currently painting is the entire job. Decorative, so it is hidden from
					assistive tech: the label below is the name.
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
						<!--
							A tick as well as the border: the selected state must not be carried by
							a 2px edge and a colour, which colour-blind users and high-contrast
							modes both lose.
						-->
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
