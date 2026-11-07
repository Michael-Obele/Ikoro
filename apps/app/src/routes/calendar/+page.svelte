<script lang="ts">
	/** Read-only month calendar. Dots mark days with open top-level tasks; tap a day to list them. */
	import Button from '$lib/components/ui/button/button.svelte';
	import TaskGroup from '$lib/components/task/TaskGroup.svelte';
	import TaskSheet from '$lib/components/task/TaskSheet.svelte';
	import type { Task } from '$lib/db/schema';
	import { liveSubtasksByParent, liveTasks } from '$lib/stores/view';
	import { formatDayHeading, todayISO } from '$lib/utils/time';
	import { monthGrid, monthLabel } from '$lib/utils/calendar';

	const bootDay = todayISO();

	let view = $state({ year: Number(bootDay.slice(0, 4)), month: Number(bootDay.slice(5, 7)) });
	let selected = $state(bootDay);
	let editing = $state<Task | null>(null);
	let sheetOpen = $state(false);

	const label = $derived(monthLabel(view.year, view.month));
	const grid = $derived(monthGrid(view.year, view.month));
	const prefix = $derived(`${view.year}-${String(view.month).padStart(2, '0')}`);
	const subtasksByParent = $derived(liveSubtasksByParent());

	// Open top-level tasks per day; subtasks stay nested under their parent.
	const counts = $derived.by(() => {
		const map = new Map<string, number>();
		for (const t of liveTasks()) {
			if (t.completedAt !== null || t.parentId !== null || t.dueDate === null) continue;
			map.set(t.dueDate, (map.get(t.dueDate) ?? 0) + 1);
		}
		return map;
	});

	const dayTasks = $derived(
		liveTasks()
			.filter((t) => t.completedAt === null && t.parentId === null && t.dueDate === selected)
			.sort(byDue)
	);

	/** Same ordering as Today: date, then clock, then manual order. */
	function byDue(a: Task, b: Task): number {
		const byDate = (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
		if (byDate !== 0) return byDate;
		if (a.dueTime === b.dueTime) return a.sortOrder - b.sortOrder;
		if (a.dueTime === null) return 1;
		if (b.dueTime === null) return -1;
		return a.dueTime.localeCompare(b.dueTime);
	}

	function prev() {
		view =
			view.month === 1
				? { year: view.year - 1, month: 12 }
				: { year: view.year, month: view.month - 1 };
	}

	function next() {
		view =
			view.month === 12
				? { year: view.year + 1, month: 1 }
				: { year: view.year, month: view.month + 1 };
	}

	function goToday() {
		const t = todayISO();
		view = { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) };
		selected = t;
	}

	function openTask(task: Task) {
		editing = task;
		sheetOpen = true;
	}

	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
</script>

<svelte:head>
	<title>Calendar · Ikoro</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-6">
	<header class="mb-3 flex items-center justify-between gap-2">
		<h1 class="text-xl font-semibold tracking-tight">{label}</h1>
		<div class="flex items-center gap-1">
			<Button variant="ghost" size="icon-sm" aria-label="Previous month" onclick={prev}>‹</Button>
			<Button variant="ghost" size="sm" onclick={goToday}>Today</Button>
			<Button variant="ghost" size="icon-sm" aria-label="Next month" onclick={next}>›</Button>
		</div>
	</header>

	<div class="grid grid-cols-7 gap-1">
		{#each WEEKDAYS as day (day)}
			<span class="py-1 text-center text-[0.6875rem] uppercase text-muted-foreground">{day}</span>
		{/each}
	</div>

	<div class="grid grid-cols-7 gap-1">
		{#each grid as day (day)}
			{@const outside = !day.startsWith(prefix)}
			{@const count = counts.get(day) ?? 0}
			{@const isToday = day === bootDay}
			{@const isSelected = day === selected}
			<button
				type="button"
				aria-pressed={isSelected}
				aria-current={isToday ? 'date' : undefined}
				aria-label="{formatDayHeading(day)}{count > 0 ? `, ${count} ${count === 1 ? 'task' : 'tasks'}` : ''}"
				onclick={() => (selected = day)}
				class="flex aspect-square min-h-11 flex-col items-center justify-center gap-1 rounded-xs text-sm transition-colors hover:bg-accent/60 {isSelected
					? 'bg-primary text-primary-foreground'
					: outside
						? 'text-muted-foreground/60'
						: ''} {isToday ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}"
			>
				<span>{Number(day.slice(8, 10))}</span>
				{#if count > 0}
					<span class="size-1 rounded-full bg-current" aria-hidden="true"></span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="mt-6">
		<TaskGroup
			heading={formatDayHeading(selected)}
			tasks={dayTasks}
			onopen={openTask}
			{subtasksByParent}
		/>
		{#if dayTasks.length === 0}
			<p class="px-2 text-sm text-muted-foreground">Nothing due this day.</p>
		{/if}
	</div>
</div>

<TaskSheet bind:task={editing} bind:open={sheetOpen} />
