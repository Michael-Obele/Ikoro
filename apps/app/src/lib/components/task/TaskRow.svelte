<script lang="ts">
	/**
	 * One row in a task list.
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
	 */
	import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
	import BellRing from 'lucide-svelte/icons/bell-ring';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { formatDue } from '$lib/utils/time';

	let {
		task,
		onopen,
		dateLabel = 'full'
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
	} = $props();

	const completed = $derived(task.completedAt !== null);
	const due = $derived(formatDue(task));
	const overdue = $derived(due?.tone === 'overdue');
	const shownDue = $derived(dateLabel === 'time' ? task.dueTime : due?.label);

	async function toggle() {
		await repo.toggleTask(task.id);
	}

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
		The checkbox lives inside a 44x44 label rather than being the target itself.
		The generated Checkbox is 16px with a 12px/8px `after:` halo — about 40x32 of
		hit area, which is under the 44px minimum and, worse, is a different size in
		each direction. A wrapper makes the target square, predictable, and big
		enough for a thumb. `-my-1` keeps the row from growing to 44px tall just to
		hold it: the target overflows the row's padding box instead.
	-->
	<label
		class="-my-1 flex size-11 shrink-0 cursor-pointer items-center justify-center"
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
			<span
				class="block text-xs {overdue
					? 'font-medium text-error'
					: 'text-muted-foreground'}"
			>
				{shownDue}
			</span>
		{/if}
	</button>

	<!--
		The trailing markers column. The bell sits to the LEFT of the dot so the dot is
		always the outermost mark, which is what makes priority a scannable right edge.
	-->
	{#if task.alarmAt || task.priority > 0}
		<span class="flex shrink-0 items-center gap-1.5 pr-1">
			{#if task.alarmAt}
				<BellRing
					class="size-3.5 text-muted-foreground"
					role="img"
					aria-label="Has a reminder"
				/>
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
</div>
