<script lang="ts">
	/**
	 * "Add a task" — a ghost row that becomes a one-field form.
	 *
	 * ONE component for every screen that can create a task, because the field, the
	 * submit-on-Enter behaviour and the "a blur on an empty form puts it away" rule
	 * are one decision. The list page used to carry its own copy of all three.
	 *
	 * `listId` is optional. A screen with a list in context (the list page) passes
	 * one; a screen without (Today, Upcoming) gets the user's first list, because
	 * the alternative for those screens was having no way to create anything at all.
	 */
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

	// `liveLists()` is already the user's own order, so "first" is the list they put
	// at the top — the closest thing this app has to a default list.
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
	 * Clicking away from an empty field means "never mind", not "keep this open".
	 *
	 * Read the field's own value. Do NOT reach for `new FormData(event.currentTarget)`
	 * here: this handler is bound to the INPUT, not the form, and FormData only
	 * accepts a <form> — it throws `parameter 1 is not of type 'HTMLFormElement'`
	 * and the field never closes. That is exactly what the list page this component
	 * was extracted from did, so the bug is fixed here and inherited by every
	 * caller instead of being copied into three more screens.
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
			<PlusIcon class="size-4" /> {label}
		</button>
	{/if}
{/if}
