<script lang="ts">
	/**
	 * One dated group of rows, with its heading.
	 *
	 * Shared by Today, Upcoming and Done so a day heading looks and behaves the
	 * same everywhere. Heading text is passed in rather than derived — Today says
	 * "Past", Upcoming says "Wednesday", Done says "12 Mar", and the difference
	 * is the whole point of having three views.
	 *
	 * Done hands in its own `row` snippet instead of copying this section/h2/ul
	 * markup the way it used to. A group heading is one decision, and two copies of
	 * it are two chances for the views to drift apart.
	 *
	 * SUBTASKS. `tasks` is expected to hold TOP-LEVEL rows only — callers filter
	 * `parentId === null` before handing a group over (see `liveSubtasksByParent`
	 * for the policy). Children arrive in `subtasksByParent` and render nested
	 * under their parent via TaskRow. A subtask that somehow reaches `tasks`
	 * anyway still renders — as a childless row — so a caller bug degrades to
	 * "flat list" rather than "missing tasks".
	 */
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
			No gap between rows. Each row draws its own hairline bottom border, so a
			gap would leave the separators floating in mid-air instead of reading as
			one continuous ruled list. `divide-y` is not used because Done hands in its
			own row snippet, which would then need to know about the divider.
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
