<script lang="ts">
	/**
	 * Done: what has been finished, newest first, with a way back.
	 *
	 * Restore is one click on purpose. Completing something by accident is common
	 * — a mis-tap on a phone is one thumb — and a one-way door there would just
	 * teach people not to use the checkbox.
	 *
	 * That promise only holds while the button can be SEEN, and it could not: the
	 * reveal was `opacity-0 group-hover:opacity-100`, and a touch screen has no
	 * hover, so on the platform this app is built for the undo measured a permanent
	 * opacity of 0. It is now gated on `pointer-fine`, which leaves a coarse pointer
	 * the button outright.
	 *
	 * The group markup is TaskGroup's, with Done's own row handed in as a snippet.
	 * It used to be a copy of that section/h2/ul, which is two places for a heading
	 * style to drift apart.
	 */
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import Button from '$lib/components/ui/button/button.svelte';
	import TaskGroup from '$lib/components/task/TaskGroup.svelte';
	import TaskSheet from '$lib/components/task/TaskSheet.svelte';
	import EmptyState from '$lib/components/shell/EmptyState.svelte';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { liveTasks } from '$lib/stores/view';
	import { formatDayHeading, groupByDay } from '$lib/utils/time';

	let editing = $state<Task | null>(null);
	let sheetOpen = $state(false);

	function openTask(task: Task) {
		editing = task;
		sheetOpen = true;
	}

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
		<!--
			Done has no add row — you cannot complete something that does not exist —
			so this is the one empty state that needs a real action of its own. It
			points at Today, which is where the work that would fill this screen is.
		-->
		<EmptyState
			icon={CheckCheck}
			title="Nothing completed yet"
			hint="Tick a task on Today and it will show up here."
		>
			{#snippet action()}
				<Button variant="outline" size="sm" href="/today">Go to Today</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{#each groups as group (group.day)}
			<TaskGroup heading={formatDayHeading(group.day)} tasks={group.tasks}>
				{#snippet row(task)}
					<div class="group flex items-center gap-1 border-b border-outline-variant/40 px-1 last:border-b-0 hover:bg-accent/40">
						<button type="button" class="min-w-0 flex-1 py-2.5 pr-2 text-left" onclick={() => openTask(task)}>
							<span class="block truncate text-sm text-muted-foreground line-through">
								{task.title}
							</span>
						</button>
						<Button
							variant="ghost"
							size="icon-sm"
							class="pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover:opacity-100 focus-visible:opacity-100"
							aria-label="Restore {task.title}"
							onclick={() => repo.toggleTask(task.id)}
						>
							<RotateCcw class="size-4" />
						</Button>
					</div>
				{/snippet}
			</TaskGroup>
		{/each}
	{/if}
</div>

<TaskSheet bind:task={editing} bind:open={sheetOpen} />
