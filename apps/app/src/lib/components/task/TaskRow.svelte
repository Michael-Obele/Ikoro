<script lang="ts">
	/**
	 * One row in a task list.
	 *
	 * Reads come from the live view model and writes go straight to `repo.ts` —
	 * the row never touches svelte-idb itself. Keeping the toggle inline (rather
	 * than lifting it) is deliberate: ticking a task is the fastest thing anyone
	 * does in this app, and a round trip to the parent to change a boolean would
	 * be latency for nothing.
	 */
	import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
	import BellRing from 'lucide-svelte/icons/bell-ring';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { formatDue } from '$lib/utils/time';

	let {
		task,
		onopen
	}: {
		task: Task;
		/** Opening the editor is the page's job — the sheet is shared by every view. */
		onopen?: (task: Task) => void;
	} = $props();

	const completed = $derived(task.completedAt !== null);
	const due = $derived(formatDue(task));
	const overdue = $derived(due?.tone === 'overdue');

	async function toggle() {
		await repo.toggleTask(task.id);
	}

	const PRIORITY_RING: Record<number, string> = {
		1: 'ring-sky-400',
		2: 'ring-amber-400',
		3: 'ring-rose-500'
	};
</script>

<div
	class="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50 data-[completed=true]:opacity-55"
	data-completed={completed}
>
	<Checkbox
		checked={completed}
		onCheckedChange={toggle}
		aria-label={completed ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
	/>

	<button type="button" class="min-w-0 flex-1 text-left" onclick={() => onopen?.(task)}>
		<span class="flex items-center gap-2">
			<span class="truncate text-sm data-[done=true]:line-through" data-done={completed}>
				{task.title}
			</span>

			{#if task.priority > 0}
				<span
					class="size-1.5 shrink-0 rounded-full ring-2 ring-offset-1 ring-offset-background {PRIORITY_RING[
						task.priority
					]}"
					title={['None', 'Low', 'Medium', 'High'][task.priority]}
					aria-label="Priority: {['none', 'low', 'medium', 'high'][task.priority]}"
				></span>
			{/if}

			{#if task.alarmAt}
				<BellRing class="size-3.5 shrink-0 text-muted-foreground" aria-label="Has a reminder" />
			{/if}
		</span>

		{#if due?.label}
			<span class="mt-0.5 block text-xs {overdue ? 'font-medium text-rose-600' : 'text-muted-foreground'}">
				{due.label}
			</span>
		{/if}
	</button>
</div>