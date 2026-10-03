<script lang="ts">
	/**
	 * One dated group of rows, with its heading.
	 *
	 * Shared by Today, Upcoming and Done so a day heading looks and behaves the
	 * same everywhere. Heading text is passed in rather than derived — Today says
	 * "Past", Upcoming says "Wednesday", Done says "12 Mar", and the difference
	 * is the whole point of having three views.
	 */
	import TaskRow from '$lib/components/task/TaskRow.svelte';
	import type { Task } from '$lib/db/schema';

	let {
		heading,
		tasks,
		onopen
	}: {
		heading: string;
		tasks: Task[];
		onopen?: (task: Task) => void;
	} = $props();
</script>

{#if tasks.length > 0}
	<section class="mt-6 first:mt-0">
		<h2 class="mb-1 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{heading}
		</h2>
		<ul class="grid gap-0.5">
			{#each tasks as task (task.id)}
				<li><TaskRow {task} {onopen} /></li>
			{/each}
		</ul>
	</section>
{/if}
