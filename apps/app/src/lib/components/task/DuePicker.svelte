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

	/**
	 * CONTROLLED, not bound.
	 *
	 * These fields used to own a copy of the schedule, and that copy is what made
	 * the reminder lie: the alarm control wrote the time it armed, `DuePicker`
	 * kept showing the draft it opened with, and a later date edit saved the draft
	 * back over the real one. The values now come from the task row, and every
	 * edit leaves through a callback. A minimum date of "no date" is still a real
	 * value — the parent decides what clearing the day means for the clock.
	 */
	let {
		dueDate,
		dueTime,
		ondatechange,
		ontimechange
	}: {
		dueDate: string | null;
		dueTime: string | null;
		/** Raw input value. `''` is the user clearing the field; the parent decides
		 *  what that means (and which partial values to ignore). */
		ondatechange?: (value: string) => void;
		ontimechange?: (value: string) => void;
	} = $props();
</script>

<div class="grid grid-cols-2 gap-3">
	<div class="grid gap-1.5">
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

	<div class="grid gap-1.5">
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
