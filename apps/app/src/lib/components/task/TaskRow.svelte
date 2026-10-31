<script lang="ts">
	/** One row in a task list, plus the nested rows when handed subtasks. */
	// Svelte 5 has no `<self>`: a recursive component imports its own file.
	import Self from './TaskRow.svelte';
	import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
	import BellRing from 'lucide-svelte/icons/bell-ring';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import * as repo from '$lib/db/repo';
	import { taskColorValue } from '$lib/task-colors';
	import type { Task } from '$lib/db/schema';
	import { formatDue } from '$lib/utils/time';

	let {
		task,
		onopen,
		dateLabel = 'full',
		subtasks = [],
		indent = false
	}: {
		task: Task;
		/** Opening the editor is the page's job — the sheet is shared by every view. */
		onopen?: (task: Task) => void;
		/** `time` drops the day, for Upcoming where the group heading already is the day. */
		dateLabel?: 'full' | 'time';
		/** This task's subtasks, alive and in order. Empty for a childless row. */
		subtasks?: Task[];
		/** Extra leading padding — subtask rows sit under their parent's title. */
		indent?: boolean;
	} = $props();

	const completed = $derived(task.completedAt !== null);
	const due = $derived(formatDue(task));
	const overdue = $derived(due?.tone === 'overdue');
	const shownDue = $derived(dateLabel === 'time' ? task.dueTime : due?.label);
	/** Resolved CSS colour for the left edge, or `undefined` when the task has none. */
	const colorValue = $derived(taskColorValue(task.color));

	/** Expansion is per-row local state: nothing else needs to know it. */
	let open = $state(true);

	/** Why the last toggle refused, shown under the title — an uncaught throw looks like a dead checkbox. */
	let blocked = $state<string | null>(null);
	let blockedTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(blockedTimer));

	async function toggle() {
		try {
			await repo.toggleTask(task.id);
			blocked = null;
		} catch (error) {
			blocked = error instanceof Error ? error.message : String(error);
			clearTimeout(blockedTimer);
			blockedTimer = setTimeout(() => (blocked = null), 4000);
		}
	}

	const doneCount = $derived(subtasks.filter((s) => s.completedAt !== null).length);

	/** Same ramp as PriorityPicker's chips, in tokens the contrast test measures. */
	const PRIORITY_DOT: Record<number, string> = {
		1: 'bg-outline',
		2: 'bg-primary',
		3: 'bg-destructive'
	};
	const PRIORITY_NAME = ['none', 'low', 'medium', 'high'];
</script>

<div
	class="group relative flex items-center gap-1 border-b border-outline-variant/40 px-1 transition-colors last:border-b-0 hover:bg-accent/50 data-[completed=true]:opacity-55"
	data-completed={completed}
>
	<!--
		The colour edge. Absolute so it never joins the flex layout; `aria-hidden` because
		the colour is named in the editor.
	-->
	{#if colorValue}
		<span
			class="pointer-events-none absolute inset-y-0 left-0 w-0.75"
			style="background: {colorValue}"
			aria-hidden="true"
			data-testid="task-color-edge"
		></span>
	{/if}

	<!--
		The 44x44 label is the tap target: the generated Checkbox is 16px with a ~40x32 hit
		area. `-my-1` keeps the row from growing to 44px tall.
	-->
	<label
		class="-my-1 flex size-11 shrink-0 cursor-pointer items-center justify-center {indent
			? 'ml-9'
			: ''}"
	>
		<Checkbox
			checked={completed}
			onCheckedChange={toggle}
			aria-label={completed ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
		/>
	</label>

	<button
		type="button"
		class="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2.5 pr-2 text-left"
		onclick={() => onopen?.(task)}
	>
		<span class="block w-full truncate text-sm data-[done=true]:line-through" data-done={completed}>
			{task.title}
		</span>

		{#if shownDue}
			<span class="block text-xs {overdue ? 'font-medium text-error' : 'text-muted-foreground'}">
				{shownDue}
			</span>
		{/if}

		{#if blocked}
			<!-- The refusal, in the row's own words. `role="status"` announces it. -->
			<span class="block text-xs font-medium text-error" role="status">{blocked}</span>
		{/if}
	</button>

	<!-- Bell left of the dot, so the dot is always the outermost mark. -->
	{#if task.alarmAt || task.alarmFiredAt || task.priority > 0 || subtasks.length > 0}
		<span class="flex shrink-0 items-center gap-1.5 pr-1">
			{#if subtasks.length > 0}
				<!-- Progress: "done/total" for the subtasks, before the other markers. -->
				<span
					class="text-xs text-muted-foreground tabular-nums"
					aria-label="{doneCount} of {subtasks.length} subtasks done"
				>
					{doneCount}/{subtasks.length}
				</span>
			{/if}

			{#if task.alarmAt}
				<!-- Armed: accent colour, and it animates in so the change is noticed. -->
				<BellRing
					class="size-3.5 animate-in text-primary zoom-in-75 fade-in-0 duration-150"
					role="img"
					aria-label="Reminder armed"
				/>
			{:else if task.alarmFiredAt}
				<!-- Fired: faded, and not announced as armed. -->
				<BellRing
					class="size-3.5 text-muted-foreground/50"
					role="img"
					aria-label="Reminder has fired"
				/>
			{/if}

			{#if task.priority > 0}
				<!-- `role="img"` is load-bearing: an `aria-label` on a bare `<span>` is ignored. -->
				<span
					class="size-2 shrink-0 rounded-full {PRIORITY_DOT[task.priority]}"
					role="img"
					aria-label="Priority: {PRIORITY_NAME[task.priority]}"
				></span>
			{/if}
		</span>
	{/if}

	<!-- Chevron last, so it hugs the edge. Rendered only when subtasks exist. -->
	{#if subtasks.length > 0}
		<button
			type="button"
			class="-my-1 flex size-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
			aria-expanded={open}
			aria-label={open ? 'Collapse subtasks' : 'Expand subtasks'}
			onclick={() => (open = !open)}
		>
			<ChevronRight class="size-4 transition-transform {open ? 'rotate-90' : ''}" />
		</button>
	{/if}
</div>

{#if subtasks.length > 0 && open}
	<!-- One level only: a subtask's own `subtasks` defaults to [], so the recursion terminates. -->
	<ul>
		{#each subtasks as sub (sub.id)}
			<li>
				<Self task={sub} {onopen} {dateLabel} indent />
			</li>
		{/each}
	</ul>
{/if}
