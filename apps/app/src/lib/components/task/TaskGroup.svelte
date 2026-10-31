<script lang="ts">
	/** One dated group of rows, with its heading. `tasks` must hold TOP-LEVEL rows only. */
	import TaskRow from '$lib/components/task/TaskRow.svelte';
	import type { Task } from '$lib/db/schema';
	import type { Snippet } from 'svelte';

	let {
		heading,
		tasks,
		onopen,
		dateLabel = 'full',
		row,
		subtasksByParent
	}: {
		heading: string;
		tasks: Task[];
		onopen?: (task: Task) => void;
		dateLabel?: 'full' | 'time';
		/** Replaces the default row. The `<li>` stays here, so a snippet renders content only. */
		row?: Snippet<[Task]>;
		/** Parent id → its alive subtasks, in order. Absent = no nesting anywhere. */
		subtasksByParent?: Map<string, Task[]>;
	} = $props();
</script>

{#if tasks.length > 0}
	<section class="mt-6 first:mt-0">
		<h2 class="mb-1 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{heading}
		</h2>
		<!--
			No gap between rows: each draws its own hairline, so a gap would leave the
			separators floating.
		-->
		<ul class="grid">
			{#each tasks as task (task.id)}
				<li>
					{#if row}
						{@render row(task)}
					{:else}
						<TaskRow {task} {onopen} {dateLabel} subtasks={subtasksByParent?.get(task.id) ?? []} />
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
