<script lang="ts">
	/** "Add a task" — a ghost row that becomes a one-field form, shared by every screen. */
	import PlusIcon from 'lucide-svelte/icons/plus';
	import Input from '$lib/components/ui/input/input.svelte';
	import * as repo from '$lib/db/repo';
	import { liveLists } from '$lib/stores/view';

	let {
		listId,
		dueDate = null,
		label = 'Add a task'
	}: {
		listId?: string;
		/** Pre-fills the day, so a task added on Today lands on Today. */
		dueDate?: string | null;
		label?: string;
	} = $props();

	let adding = $state(false);

	// Already in the user's own order, so "first" is the list they put at the top.
	const targetListId = $derived(listId ?? liveLists()[0]?.id ?? null);

	// A form because it has an input. `command` is only for input-less actions.
	async function addTask(event: SubmitEvent) {
		event.preventDefault();
		if (!targetListId) return;
		const form = event.currentTarget as HTMLFormElement;
		const title = String(new FormData(form).get('title') ?? '').trim();
		if (!title) return;
		await repo.createTask({ listId: targetListId, title, dueDate });
		form.reset();
		form.querySelector('input')?.focus();
	}

	/**
	 * Read the field's own value: this handler is bound to the INPUT, not the form, and
	 * `new FormData(input)` throws `parameter 1 is not of type 'HTMLFormElement'`.
	 */
	function clearAdd(event: FocusEvent) {
		if ((event.currentTarget as HTMLInputElement).value.trim()) return;
		adding = false;
	}
</script>

{#if targetListId}
	{#if adding}
		<form class="mb-2" onsubmit={addTask}>
			<Input
				name="title"
				placeholder="Task title"
				autofocus
				onblur={clearAdd}
				onkeydown={(e) => e.key === 'Escape' && (adding = false)}
			/>
			<!-- Hidden submit: Enter must submit, and autofocus must land here. -->
			<button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Add</button>
		</form>
	{:else}
		<!-- Dashed ghost row: 44px tall, so it matches the rows it produces. -->
		<button
			type="button"
			class="mb-2 flex h-11 w-full items-center gap-2 border border-dashed border-outline-variant px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-accent/50 hover:text-foreground"
			onclick={() => (adding = true)}
		>
			<PlusIcon class="size-4 shrink-0" /> {label}
		</button>
	{/if}
{/if}
