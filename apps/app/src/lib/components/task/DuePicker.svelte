<script lang="ts">
	/** A date and an optional time — never a combined datetime: Google's API drops the time part. */
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';

	/**
	 * CONTROLLED, not bound: a local copy is what let the picker show a stale time. The
	 * parent decides what clearing the day means for the clock.
	 */
	let {
		dueDate,
		dueTime,
		ondatechange,
		ontimechange
	}: {
		dueDate: string | null;
		dueTime: string | null;
		/** Raw input value; `''` means the user cleared it. The parent decides what that means. */
		ondatechange?: (value: string) => void;
		ontimechange?: (value: string) => void;
	} = $props();
</script>

<div class="grid grid-cols-2 gap-3">
	<div class="grid grid-cols-1 gap-1.5">
		<Label for="due-date">Due date</Label>
		<Input
			id="due-date"
			name="dueDate"
			type="date"
			class="h-11"
			value={dueDate ?? ''}
			oninput={(e) => ondatechange?.(e.currentTarget.value)}
		/>
	</div>

	<div class="grid grid-cols-1 gap-1.5">
		<Label for="due-time" class={dueDate ? '' : 'opacity-50'}>Time</Label>
		<Input
			id="due-time"
			name="dueTime"
			type="time"
			disabled={!dueDate}
			class="h-11"
			value={dueTime ?? ''}
			oninput={(e) => ontimechange?.(e.currentTarget.value)}
		/>
	</div>
</div>
