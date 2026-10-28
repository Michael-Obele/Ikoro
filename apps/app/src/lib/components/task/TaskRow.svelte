<script lang="ts">
	/**
	 * One row in a task list — and, when handed subtasks, the nested rows under it.
	 *
	 * Reads come from the live view model and writes go straight to `repo.ts` —
	 * the row never touches svelte-idb itself. Keeping the toggle inline (rather
	 * than lifting it) is deliberate: ticking a task is the fastest thing anyone
	 * does in this app, and a round trip to the parent to change a boolean would
	 * be latency for nothing.
	 *
	 * THE MARKERS COLUMN. The priority dot and the alarm bell used to sit inline
	 * after the title, so their position moved with the length of the title and the
	 * two could collide on a long one. They are now one trailing column instead: a
	 * priority marker exists to be COMPARED between rows, and that only works if the
	 * markers line up.
	 *
	 * SUBTASKS. The row owns its own expand/collapse state — one boolean per row,
	 * not a tree model in the parent — and renders its children itself, one level
	 * deep (a subtask is always created with `parentId` pointing at a top-level
	 * task, so `subtasks` arriving here never have children of their own). The
	 * chevron and the "n/m" progress marker render only when children exist, so a
	 * childless row is pixel-identical to how it has always been.
	 */
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
		/**
		 * `full` states the day as well as the clock ("Tomorrow 11:00"). `time` states
		 * only the clock, for Upcoming — there the group heading already IS the day,
		 * and saying "Tuesday" again on every row under a "TUESDAY" heading is noise.
		 */
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

	/**
	 * Why the last toggle refused, surfaced under the title. `repo.toggleTask`
	 * throws "Complete its subtasks first" for a parent with open children; an
	 * uncaught throw here would look exactly like a checkbox that does nothing.
	 * The message clears itself — it is an explanation, not a persistent state.
	 */
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

	/**
	 * The same ramp PriorityPicker's chips use — neutral, pale, ink, crimson —
	 * collapsed to the three steps a marker needs. Every one is a token
	 * `tests/theme-contrast.test.ts` measures, which the raw sky/amber/rose these
	 * replace were not: a marker cannot now be the one colour nothing audits.
	 */
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
		THE COLOUR EDGE. Absolutely positioned so it can never participate in the
		flex layout: the 44px checkbox target, the title and the trailing markers
		column keep exactly the geometry they had, and the bar is pure paint. It
		spans the full row height, flush to the left border, 3px wide — wide enough
		to read as a deliberate mark, narrow enough to stay an edge. Decorative by
		`aria-hidden`: the colour is chosen and named in the editor, and the row
		stays clean, which is the point of encoding it as a bar.
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
		The checkbox lives inside a 44x44 label rather than being the target itself.
		The generated Checkbox is 16px with a 12px/8px `after:` halo — about 40x32 of
		hit area, which is under the 44px minimum and, worse, is a different size in
		each direction. A wrapper makes the target square, predictable, and big
		enough for a thumb. `-my-1` keeps the row from growing to 44px tall just to
		hold it: the target overflows the row's padding box instead.
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

	<!--
		The trailing markers column. The bell sits to the LEFT of the dot so the dot is
		always the outermost mark, which is what makes priority a scannable right edge.
	-->
	{#if task.alarmAt || task.priority > 0 || subtasks.length > 0}
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
				<BellRing class="size-3.5 text-muted-foreground" role="img" aria-label="Has a reminder" />
			{/if}

			{#if task.priority > 0}
				<!--
					`role="img"` is load-bearing. An `aria-label` on a bare `<span>` is
					ignored, so without a role the priority was colour-only for a screen
					reader as well as for everyone else.

					Circular on purpose: a dot is a dot. This is the one place in the row
					where `rounded-full` is semantic rather than a rounded corner.
				-->
				<span
					class="size-2 shrink-0 rounded-full {PRIORITY_DOT[task.priority]}"
					role="img"
					aria-label="Priority: {PRIORITY_NAME[task.priority]}"
				></span>
			{/if}
		</span>
	{/if}

	<!--
		The expand/collapse chevron, LAST so it hugs the screen edge — the same
		trailing-column discipline as the markers. Rendered only when subtasks
		exist, so a childless row keeps its exact old geometry. Rotates 90° when
		open; the rotation is the animation, no transition needed on a 16px glyph.
	-->
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
	<!--
		The nested rows. One level only — a subtask is created against a top-level
		parent, so these children never carry children of their own. `indent` shifts
		their checkbox under the parent's title; the hairline separator comes from
		TaskRow itself, so the nesting reads as one continuous ruled list. `<self>`
		is the Svelte 5 recursion form; a subtask's own `subtasks` prop defaults
		to [], so the recursion terminates by construction.
	-->
	<ul>
		{#each subtasks as sub (sub.id)}
			<li>
				<self task={sub} {onopen} {dateLabel} indent></self>
			</li>
		{/each}
	</ul>
{/if}
