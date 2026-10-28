<script lang="ts">
	/**
	 * Upcoming: the next seven days, one heading per day.
	 *
	 * Starts at TOMORROW on purpose. Today already has a screen of its own, and
	 * duplicating it here would mean completing something and watching it survive
	 * on the very next tab — which reads as a bug even though it is not.
	 */
	import TaskGroup from '$lib/components/task/TaskGroup.svelte';
	import AddTaskRow from '$lib/components/task/AddTaskRow.svelte';
	import TaskSheet from '$lib/components/task/TaskSheet.svelte';
	import EmptyState from '$lib/components/shell/EmptyState.svelte';
	import CalendarDays from 'lucide-svelte/icons/calendar-days';
	import type { Task } from '$lib/db/schema';
	import { liveTasks } from '$lib/stores/view';
	import { formatDayHeading, groupByDay, isoDaysAgo } from '$lib/utils/time';

	const DAYS_AHEAD = 7;

	const firstDay = isoDaysAgo(new Date(), -1); // tomorrow
	const lastDay = isoDaysAgo(new Date(), -DAYS_AHEAD); // today + 7

	let editing = $state<Task | null>(null);
	let sheetOpen = $state(false);

	// Sorted by day before grouping, so the headings run forward in time even
	// though `groupByDay` preserves first-seen order — that is what makes it safe
	// to hand it an already-ordered list.
	const groups = $derived(
		groupByDay(
			liveTasks()
				.filter(
					(t) =>
						t.completedAt === null &&
						t.dueDate !== null &&
						t.dueDate >= firstDay &&
						t.dueDate <= lastDay
				)
				.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
		)
	);

	const quiet = $derived(groups.length === 0);

	function openTask(task: Task) {
		editing = task;
		sheetOpen = true;
	}
</script>

<svelte:head>
	<title>Upcoming · Ikoro</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-6">
	<header class="mb-3 flex items-baseline gap-3">
		<h1 class="text-xl font-semibold tracking-tight">Upcoming</h1>
		{#if !quiet}
			<span class="text-xs text-muted-foreground">next {DAYS_AHEAD} days</span>
		{/if}
	</header>

	<!-- Files against the first list and pre-fills tomorrow, so a task added here
	     appears in the group the user is looking at. -->
	<AddTaskRow dueDate={firstDay} />

	{#if quiet}
		<EmptyState
			icon={CalendarDays}
			title="Nothing in the next {DAYS_AHEAD} days"
			hint="Add a task above and it lands on tomorrow."
		/>
	{:else}
		{#each groups as group (group.day)}
			<!-- `dateLabel="time"`: the heading already names the day, so a row only
			     needs the clock. -->
			<TaskGroup
				heading={formatDayHeading(group.day)}
				tasks={group.tasks}
				onopen={openTask}
				dateLabel="time"
			/>
		{/each}
	{/if}
</div>

<TaskSheet bind:task={editing} bind:open={sheetOpen} />
