<script lang="ts">
	/**
	 * Four states as a badge group: none, low, medium, high.
	 *
	 * A segmented control rather than a `<select>` because every state has a
	 * colour, and a dropdown hides the colour until you have already committed to
	 * opening it. Tapping the active one clears it — priority 0 is a real choice,
	 * not a starting state.
	 */
	import type { Priority } from '$lib/db/schema';

	let {
		priority = $bindable(0),
		onchange
	}: {
		priority?: Priority;
		onchange?: () => void;
	} = $props();

	/**
	 * Each chip is a token pairing this palette already measures, so a chip cannot
	 * drift into a colour nothing audits. The picker only ever renders inside a
	 * Sheet or a Dialog, and both paint `bg-popover`.
	 *
	 *   None     accent      + accent-foreground      15.0:1 / 14.5:1
	 *   Low      input/50    + foreground             10.8:1 /  9.1:1
	 *   Medium   primary     + primary-foreground     17.2:1 / 14.2:1
	 *   High     destructive + destructive-foreground  8.8:1 / 12.6:1
	 *
	 * (light / dark.) It is a four-step ramp — pale, grey, ink, red — rather than
	 * four hues, because `destructive` is the only chromatic token in the palette;
	 * three hues would mean raw Tailwind colours, which is what used to be here
	 * (2.77 / 2.15 / 4.70:1, identical in both themes because a hardcoded hex
	 * never changes).
	 */
	const OPTIONS: { value: Priority; label: string; class: string }[] = [
		{
			value: 0,
			label: 'None',
			class: 'data-[on=true]:bg-accent data-[on=true]:text-accent-foreground'
		},
		{
			value: 1,
			label: 'Low',
			class: 'data-[on=true]:bg-input/50 data-[on=true]:text-foreground'
		},
		{
			value: 2,
			label: 'Medium',
			class: 'data-[on=true]:bg-primary data-[on=true]:text-primary-foreground'
		},
		{
			value: 3,
			label: 'High',
			class: 'data-[on=true]:bg-destructive data-[on=true]:text-destructive-foreground'
		}
	];

	function pick(value: Priority) {
		priority = priority === value ? 0 : value;
		onchange?.();
	}
</script>

<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Priority">
	{#each OPTIONS as option (option.value)}
		<!--
			Square chips, not pills. A pill here was the only rounded control left in
			the sheet once the shape scale went boxy, and it read as a leftover. The
			chips are `min-h-9` so each is a comfortable tap target on a phone.
		-->
		<button
			type="button"
			role="radio"
			aria-checked={priority === option.value}
			data-on={priority === option.value}
			class="min-h-9 border px-3 text-xs transition-colors {option.class}
			       data-[on=false]:border-border data-[on=false]:text-muted-foreground data-[on=true]:border-transparent"
			onclick={() => pick(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>
