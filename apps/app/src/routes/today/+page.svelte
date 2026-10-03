<script lang="ts">
	/**
	 * Today: what needs doing now, and what slipped.
	 *
	 * Two buckets, in this order, because the whole reason to open this screen is
	 * to find out what to do next:
	 *
	 *   Past    — open tasks dated before today, most overdue at the top.
	 *   Today   — anything dated today.
	 *
	 * The past bucket stops at 365 days. Not for tidiness: a task from 2022 that
	 * was never completed is not "overdue", it is a mistake, and burying today's
	 * work under it is worse than hiding it. The window is a deliberate trade,
	 * and it is `PAST_WINDOW_DAYS` rather than a literal so M1 and this screen
	 * cannot drift apart.
	 *
	 * Completed tasks never appear. Undated tasks cannot appear — they have no
	 * `dueDate`, so they are not in the `byDue` index these rows come from.
	 */
	import TaskGroup from '$lib/components/task/TaskGroup.svelte';
	import TaskSheet from '$lib/components/task/TaskSheet.svelte';
	import type { Task } from '$lib/db/schema';
	import { PAST_WINDOW_DAYS } from '$lib/db/repo';
	import { liveTasks } from '$lib/stores/view';
	import { isPastDue, todayISO, todayWindowStart } from '$lib/utils/time';

	let editing = $state<Task | null>(null);
	let sheetOpen = $state(false);

	const today = todayISO();
	const windowStart = todayWindowStart();

	// Narrowed in plain code rather than with `where(...)`: svelte-idb's indexed
	// queries are not reactive, so this runs inside $derived over the single
	// liveAll() subscription. Ordering is applied here, not in the view helper,
	// because the ordering IS the view's opinion.
	const dueToday = $derived(
		liveTasks()
			.filter((t) => t.completedAt === null && t.dueDate === today)
			.sort(byDue)
	);

	const overdue = $derived(
		liveTasks()
			.filter((t) => isPastDue(t) && t.dueDate !== null && t.dueDate >= windowStart)
			.sort(byDue)
	);

	/** Overdue first (oldest date at the top), then the clock, then manual order. */
	function byDue(a: Task, b: Task): number {
		const byDate = (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
		if (byDate !== 0) return byDate;
		if (a.dueTime === b.dueTime) return a.sortOrder - b.sortOrder;
		if (a.dueTime === null) return 1;
		if (b.dueTime === null) return -1;
		return a.dueTime.localeCompare(b.dueTime);
	}

	function openTask(task: Task) {
		editing = task;
		sheetOpen = true;
	}

	const quiet = $derived(overdue.length === 0 && dueToday.length === 0);
</script>

<svelte:head>
	<title>Today · Ikoro</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-6">
	<header class="mb-1 flex items-baseline gap-3">
		<h1 class="text-xl font-semibold tracking-tight">Today</h1>
		{#if !quiet}
			<span class="text-xs text-muted-foreground">
				{overdue.length + dueToday.length}
				{overdue.length + dueToday.length === 1 ? 'task' : 'tasks'}
			</span>
		{/if}
	</header>

	{#if quiet}
		<p class="py-24 text-center text-sm text-muted-foreground">Nothing due — Ikoro is quiet.</p>
	{:else}
		<TaskGroup heading="Past" tasks={overdue} onopen={openTask} />
		<TaskGroup heading="Today" tasks={dueToday} onopen={openTask} />
	{/if}
</div>

<TaskSheet bind:task={editing} bind:open={sheetOpen} />

<!-- The window is a product decision, not an implementation detail, so it is
     stated where a reader of this screen can find it. -->
<p class="sr-only">Showing tasks due in the last {PAST_WINDOW_DAYS} days, plus today.</p>
