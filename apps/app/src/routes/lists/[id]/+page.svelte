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
	import PlusIcon from 'lucide-svelte/icons/plus';
	import Input from '$lib/components/ui/input/input.svelte';
	import TaskRow from '$lib/components/task/TaskRow.svelte';
	import TaskSheet from '$lib/components/task/TaskSheet.svelte';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { liveListById, liveTasksByList } from '$lib/stores/view';

	const listId = $derived(page.params.id ?? '');
	const list = $derived(liveListById(listId));
	const tasks = $derived(liveTasksByList(listId));

	let editing = $state<Task | null>(null);
	let sheetOpen = $state(false);
	let adding = $state(false);

	function openTask(task: Task) {
		editing = task;
		sheetOpen = true;
	}

	// A form because it has an input. `command` is only for input-less actions.
	async function addTask(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const data = new FormData(form);
		const title = String(data.get('title') ?? '').trim();
		if (!title) return;
		await repo.createTask({ listId, title });
		form.reset();
		form.querySelector('input')?.focus();
	}

	async function clearAdd(event: FocusEvent) {
		const form = event.currentTarget as HTMLFormElement;
		if (String(new FormData(form).get('title') ?? '').trim()) return;
		adding = false;
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
			<p class="mt-1 text-sm text-muted-foreground">
				It may have been deleted on another screen.
			</p>
			<a href="/today" class="mt-4 inline-block text-sm underline underline-offset-4">Back to Today</a>
		</div>
	{:else}
		<header class="mb-4 flex items-center gap-3">
			<h1 class="flex-1 truncate text-xl font-semibold tracking-tight">{list.name}</h1>
			<span class="text-xs text-muted-foreground">
				{tasks.length}
				{tasks.length === 1 ? 'task' : 'tasks'}
			</span>
		</header>

		{#if adding}
			<form class="mb-2" onsubmit={addTask}>
				<Input
					name="title"
					placeholder="Task title"
					autofocus
					onblur={clearAdd}
					onkeydown={(e) => e.key === 'Escape' && (adding = false)}
				/>
				<!-- A hidden submit button: Enter in a single-input form submits it in
				     every browser, and autofocus must land here rather than nowhere. -->
				<button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Add</button>
			</form>
		{:else}
			<button
				type="button"
				class="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
				onclick={() => (adding = true)}
			>
				<PlusIcon class="size-4" /> Add a task
			</button>
		{/if}

		{#if tasks.length === 0}
			<p class="py-16 text-center text-sm text-muted-foreground">
				Nothing here yet. Add a task above.
			</p>
		{:else}
			<section aria-label="Tasks">
				<div
					use:dndzone={{ items: tasks, flipDurationMs: 150, dragDisabled: false }}
					onconsider={onReorder}
					onfinalize={onReorder}
					class="grid gap-0.5"
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