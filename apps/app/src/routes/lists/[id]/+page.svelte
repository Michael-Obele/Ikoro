<script lang="ts">
	/**
	 * One list: its name, an inline add-task field, and the rows.
	 *
	 * Rows come from `stores/view.ts`, which owns the single `liveAll()`
	 * subscription for the app. An unknown id renders an empty state with a way
	 * back rather than throwing — a stale link or a deleted list is a navigation
	 * mistake, not a crash.
	 */
	import { flip } from 'svelte/animate';
	import { page } from '$app/state';
	import { dndzone } from 'svelte-dnd-action';
	import AddTaskRow from '$lib/components/task/AddTaskRow.svelte';
	import TaskRow from '$lib/components/task/TaskRow.svelte';
	import TaskSheet from '$lib/components/task/TaskSheet.svelte';
	import EmptyState from '$lib/components/shell/EmptyState.svelte';
	import ListIcon from 'lucide-svelte/icons/list';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { liveListById, liveTasksByList } from '$lib/stores/view';

	const listId = $derived(page.params.id ?? '');
	const list = $derived(liveListById(listId));
	const tasks = $derived(liveTasksByList(listId));

	let editing = $state<Task | null>(null);
	let sheetOpen = $state(false);

	function openTask(task: Task) {
		editing = task;
		sheetOpen = true;
	}

	// Reordering writes one `put()` per row, sequentially — svelte-idb has no
	// transaction to wrap them in. The operation is idempotent, so a drag that
	// lands twice costs nothing.
	async function onReorder(event: CustomEvent<{ items: Task[] }>) {
		for (const [index, task] of event.detail.items.entries()) {
			if (task.sortOrder === index) continue;
			await repo.updateTask(task.id, { sortOrder: index });
		}
	}
</script>

<svelte:head>
	<title>{list ? `${list.name} · Ikoro` : 'Ikoro'}</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-6">
	{#if !list}
		<div class="py-24 text-center">
			<h1 class="text-lg font-medium">This list no longer exists</h1>
			<p class="mt-1 text-sm text-muted-foreground">It may have been deleted on another screen.</p>
			<a href="/today" class="mt-4 inline-block text-sm underline underline-offset-4"
				>Back to Today</a
			>
		</div>
	{:else}
		<header class="mb-4 flex items-center gap-3">
			<h1 class="flex-1 truncate text-xl font-semibold tracking-tight">{list.name}</h1>
			<span class="text-xs text-muted-foreground">
				{tasks.length}
				{tasks.length === 1 ? 'task' : 'tasks'}
			</span>
		</header>

		<!-- The same add row Today and Upcoming render, bound to this list. -->
		<AddTaskRow listId={listId} />

		{#if tasks.length === 0}
			<EmptyState
				icon={ListIcon}
				title="This list is empty"
				hint="Add a task above — it stays in this list until you move it."
			/>
		{:else}
			<section aria-label="Tasks">
				<div
					use:dndzone={{ items: tasks, flipDurationMs: 150, dragDisabled: false }}
					onconsider={onReorder}
					onfinalize={onReorder}
					class="grid"
				>
					{#each tasks as task (task.id)}
						<div animate:flip={{ duration: 150 }}>
							<TaskRow {task} onopen={openTask} />
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<TaskSheet bind:task={editing} bind:open={sheetOpen} />
