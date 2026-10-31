<script lang="ts">
	/** Four states as chips: none, low, medium, high. Tapping the active one clears it. */
	import type { Priority } from '$lib/db/schema';

	let {
		priority = $bindable(0),
		onchange
	}: {
		priority?: Priority;
		onchange?: () => void;
	} = $props();

	/**
	 * Token pairs the contrast test already audits; a ramp, not four hues — `destructive` is
	 * the palette's only chromatic token.
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
		<!-- Square chips, `min-h-9` so each is a comfortable tap target on a phone. -->
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
