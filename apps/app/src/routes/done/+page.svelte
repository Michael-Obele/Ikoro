<script lang="ts">
	/**
	 * Done: what has been finished, newest first, with a way back.
	 *
	 * Restore is one click on purpose. Completing something by accident is common
	 * — a mis-tap on a phone is one thumb — and a one-way door there would just
	 * teach people not to use the checkbox.
	 */
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Button from '$lib/components/ui/button/button.svelte';
	import TaskSheet from '$lib/components/task/TaskSheet.svelte';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { liveTasks } from '$lib/stores/view';
	import { formatDayHeading, groupByDay } from '$lib/utils/time';

	let editing = $state<Task | null>(null);
	let sheetOpen = $state(false);

	/** Completion day, not due day — "when did I finish this" is what this screen answers. */
	const completedDay = (t: Task) => (t.completedAt ?? '').slice(0, 10);

	const groups = $derived(
		groupByDay(
			liveTasks()
				.filter((t) => t.completedAt !== null)
				.map((t) => ({ ...t, dueDate: completedDay(t) }))
				.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
		)
	);

	const quiet = $derived(groups.length === 0);
</script>

<svelte:head>
	<title>Done · Ikoro</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-6">
	<header class="mb-1 flex items-baseline gap-3">
		<h1 class="text-xl font-semibold tracking-tight">Done</h1>
		{#if !quiet}
			<span class="text-xs text-muted-foreground">
				{groups.reduce((n, g) => n + g.tasks.length, 0)}
				{groups.reduce((n, g) => n + g.tasks.length, 0) === 1 ? 'task' : 'tasks'}
			</span>
		{/if}
	</header>

	{#if quiet}
		<p class="py-24 text-center text-sm text-muted-foreground">Nothing completed yet.</p>
	{:else}
		{#each groups as group (group.day)}
			<section class="mt-6 first:mt-0">
				<h2 class="mb-1 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{formatDayHeading(group.day)}
				</h2>
				<ul class="grid gap-0.5">
					{#each group.tasks as task (task.id)}
						<li class="group flex items-center gap-1 rounded-md px-2 hover:bg-accent/40">
							<button
								type="button"
								class="min-w-0 flex-1 text-left"
								onclick={() => ((editing = task), (sheetOpen = true))}
							>
								<span class="truncate text-sm text-muted-foreground line-through">{task.title}</span
								>
							</button>
							<Button
								variant="ghost"
								size="icon-sm"
								class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
								aria-label="Restore {task.title}"
								onclick={() => repo.toggleTask(task.id)}
							>
								<RotateCcw class="size-4" />
							</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>

<TaskSheet bind:task={editing} bind:open={sheetOpen} />
