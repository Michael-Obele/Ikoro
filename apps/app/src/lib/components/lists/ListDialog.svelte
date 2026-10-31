<script lang="ts">
	/**
	 * Create / rename / delete a list.
	 *
	 * One dialog, three modes. Delete is behind a confirmation and explains what
	 * it costs — deleting a list cascades to every task inside it, and "it will be
	 * back" is not something this app can promise.
	 */
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as repo from '$lib/db/repo';

	// `open` is what shows the dialog; `mode` only says what it is for. They are
	// separate because 'create' is a real mode, and overloading it as "closed"
	// made opening the create dialog set the very value that kept it shut.
	let {
		open = $bindable(false),
		mode = $bindable<'create' | 'rename' | 'delete'>('create'),
		listId = $bindable(null),
		listName = $bindable(''),
		ondone
	}: {
		open?: boolean;
		mode?: 'create' | 'rename' | 'delete';
		listId?: string | null;
		listName?: string;
		ondone?: (result: { created?: string; renamed?: string; deleted?: string }) => void;
	} = $props();

	let name = $state('');
	let busy = $state(false);
	let loadedFor = $state<string | null>(null);

	$effect(() => {
		const key = `${mode}:${listId ?? ''}`;
		if (mode !== 'delete' && key !== loadedFor) {
			loadedFor = key;
			name = listName ?? '';
		}
	});

	function close() {
		open = false;
		// Drop the identity too, so the next open cannot render a stale name.
		mode = 'create';
		listId = null;
	}

	// A form, because it has a text input. `command` is for input-less actions.
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		const value = name.trim();
		if (mode === 'rename') {
			if (!listId || !value) return;
			busy = true;
			await repo.renameList(listId, value);
			busy = false;
			ondone?.({ renamed: listId });
			close();
			return;
		}
		if (!value) return;
		busy = true;
		const created = await repo.createList(value);
		busy = false;
		ondone?.({ created: created.id });
		close();
	}

	async function confirmDelete() {
		if (!listId || busy) return;
		busy = true;
		await repo.deleteList(listId);
		busy = false;
		ondone?.({ deleted: listId });
		close();
	}
</script>

<Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				{mode === 'rename' ? 'Rename list' : mode === 'delete' ? 'Delete list' : 'New list'}
			</Dialog.Title>
			{#if mode === 'delete'}
				<Dialog.Description>
					“{listName}” and every task inside it will be deleted. This cannot be undone.
				</Dialog.Description>
			{:else}
				<Dialog.Description class="sr-only">Name the list</Dialog.Description>
			{/if}
		</Dialog.Header>

		{#if mode === 'delete'}
			<Dialog.Footer>
				<Button variant="ghost" onclick={close}>Cancel</Button>
				<Button variant="destructive" onclick={confirmDelete}>Delete</Button>
			</Dialog.Footer>
		{:else}
			<form method="dialog" class="grid grid-cols-1 gap-4" onsubmit={submit}>
				<div class="grid grid-cols-1 gap-1.5">
					<Label for="list-name">Name</Label>
					<Input
						id="list-name"
						name="name"
						value={name}
						oninput={(e) => (name = e.currentTarget.value)}
					/>
				</div>
				<Dialog.Footer>
					<Button type="button" variant="ghost" onclick={close}>Cancel</Button>
					<Button type="submit" disabled={busy || !name.trim()}>
						{mode === 'rename' ? 'Save' : 'Create'}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
