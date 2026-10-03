<script lang="ts">
	/**
	 * A date and an optional time — never a combined datetime.
	 *
	 * The split is not cosmetic: `dueDate` is the part Google Tasks can sync and
	 * `dueTime` is deliberately local-only, because Google's API discards the
	 * time part. Collapsing them into one field would make that loss impossible
	 * to see.
	 *
	 * Clearing the date clears the time too — a time with no day is a value that
	 * would silently do nothing.
	 */
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';

	let {
		dueDate = $bindable(null),
		dueTime = $bindable(null),
		onsetchange
	}: {
		dueDate?: string | null;
		dueTime?: string | null;
		onsetchange?: () => void;
	} = $props();

	function onDateInput(value: string) {
		dueDate = value || null;
		if (!dueDate) dueTime = null;
		onsetchange?.();
	}

	function onTimeInput(value: string) {
		dueTime = value || null;
		onsetchange?.();
	}
</script>

<div class="grid grid-cols-2 gap-3">
	<div class="grid gap-1.5">
		<Label for="due-date">Due date</Label>
		<Input
			id="due-date"
			name="dueDate"
			type="date"
			value={dueDate ?? ''}
			oninput={(e) => onDateInput(e.currentTarget.value)}
		/>
	</div>

	<div class="grid gap-1.5">
		<Label for="due-time" class={dueDate ? '' : 'opacity-50'}>Time</Label>
		<Input
			id="due-time"
			name="dueTime"
			type="time"
			disabled={!dueDate}
			value={dueTime ?? ''}
			oninput={(e) => onTimeInput(e.currentTarget.value)}
		/>
	</div>
</div>