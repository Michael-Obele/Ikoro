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

	const OPTIONS: { value: Priority; label: string; class: string }[] = [
		{ value: 0, label: 'None', class: 'data-[on=true]:bg-accent data-[on=true]:text-accent-foreground' },
		{ value: 1, label: 'Low', class: 'data-[on=true]:bg-sky-500 data-[on=true]:text-white' },
		{ value: 2, label: 'Medium', class: 'data-[on=true]:bg-amber-500 data-[on=true]:text-white' },
		{ value: 3, label: 'High', class: 'data-[on=true]:bg-rose-600 data-[on=true]:text-white' }
	];

	function pick(value: Priority) {
		priority = priority === value ? 0 : value;
		onchange?.();
	}
</script>

<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Priority">
	{#each OPTIONS as option (option.value)}
		<button
			type="button"
			role="radio"
			aria-checked={priority === option.value}
			data-on={priority === option.value}
			class="rounded-full border px-2.5 py-1 text-xs transition-colors {option.class}
			       data-[on=true]:border-transparent data-[on=false]:border-border data-[on=false]:text-muted-foreground"
			onclick={() => pick(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>