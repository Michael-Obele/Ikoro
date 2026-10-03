<script lang="ts">
	/**
	 * The task editor.
	 *
	 * Every field saves itself. There is no Save button because there is nothing
	 * to lose: this is a local-first app with a single local database and no
	 * remote round trip, so deferring a write only creates a window where closing
	 * the sheet loses work.
	 *
	 * Notes autosave on a 400 ms debounce (runed's `useDebounce`) rather than on
	 * every keystroke — each keystroke is a full `put()`, and IndexedDB will not
	 * thank you for 400 of them while somebody types a sentence.
	 *
	 * "Remind me" is M4's, not this milestone's. The row of controls is laid out
	 * so it drops in without moving anything above it.
	 */
	import { useDebounce } from 'runed';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Textarea from '$lib/components/ui/textarea/textarea.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';

	let {
		task = $bindable(null),
		open = $bindable(false),
		onopenchange
	}: {
		task: Task | null;
		open?: boolean;
		onopenchange?: (open: boolean) => void;
	} = $props();

	const NOTES_DEBOUNCE_MS = 400;

	// Local drafts. The live task is the truth on open, but editing writes
	// straight through so the row behind the sheet updates as you type.
	let title = $state('');
	let notes = $state('');
	let dueDate = $state<string | null>(null);
	let dueTime = $state<string | null>(null);
	let priority = $state<Task['priority']>(0);
	let lastSavedNotes = $state<string | null>(null);
	let confirmingDelete = $state(false);
	let loadedId: string | null = null;

	$effect(() => {
		// Re-seed the drafts when a DIFFERENT task is opened. Keyed on the id, not
		// the object, so a live update to the row being edited (a sync pull, a tick
		// from another tab) refreshes the fields but does not wipe the half-typed
		// title the user is in the middle of.
		if (task && task.id !== loadedId) {
			loadedId = task.id;
			title = task.title;
			notes = task.notes ?? '';
			dueDate = task.dueDate;
			dueTime = task.dueTime;
			priority = task.priority;
			lastSavedNotes = task.notes ?? '';
			confirmingDelete = false;
		}
	});

	const saveNotes = useDebounce(async (value: string) => {
		if (!task) return;
		await repo.updateTask(task.id, { notes: value || null });
	}, NOTES_DEBOUNCE_MS);

	function onNotesInput(value: string) {
		notes = value;
		if (task && value !== lastSavedNotes) saveNotes(value);
	}

	async function saveTitle(value: string) {
		if (!task || !value.trim()) return;
		await repo.updateTask(task.id, { title: value.trim() });
	}

	async function saveSchedule() {
		if (!task) return;
		await repo.updateTask(task.id, { dueDate, dueTime });
	}

	async function savePriority() {
		if (!task) return;
		await repo.updateTask(task.id, { priority });
	}

	async function remove() {
		if (!task) return;
		await repo.deleteTask(task.id);
		close();
	}

	/**
	 * Close, but first flush anything still sitting in the debounce window.
	 * Closing the sheet must never be the reason a note is lost.
	 */
	async function close() {
		saveNotes.cancel();
		if (task && notes !== lastSavedNotes) {
			await repo.updateTask(task.id, { notes: notes || null });
		}
		open = false;
		onopenchange?.(false);
	}
</script>

<Sheet.Root bind:open onOpenChange={(next) => !next && close()}>
	<Sheet.Content side="right" class="w-full sm:max-w-md">
		{#if task}
			<Sheet.Header>
				<Sheet.Title>Task</Sheet.Title>
				<Sheet.Description class="sr-only">Edit this task</Sheet.Description>
			</Sheet.Header>

			<div class="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
				<div class="grid gap-1.5">
					<Label for="task-title">Title</Label>
					<Input
						id="task-title"
						name="title"
						value={title}
						oninput={(e) => {
							title = e.currentTarget.value;
							saveTitle(e.currentTarget.value);
						}}
					/>
				</div>

				<div class="grid gap-1.5">
					<Label for="task-notes">Notes</Label>
					<Textarea
						id="task-notes"
						name="notes"
						rows={5}
						placeholder="Add details"
						value={notes}
						oninput={(e) => onNotesInput(e.currentTarget.value)}
					/>
				</div>

				<DuePicker bind:dueDate bind:dueTime onsetchange={saveSchedule} />

				<div class="grid gap-1.5">
					<span class="text-sm font-medium">Priority</span>
					<PriorityPicker bind:priority onchange={savePriority} />
				</div>

				<!-- M4 drops the reminder control here. It has to be the one field
				     that arms a platform alarm, so it stays out of this milestone
				     rather than being faked with a local state. -->

				<div class="mt-auto border-t pt-4">
					{#if confirmingDelete}
						<div class="flex items-center gap-2">
							<p class="flex-1 text-sm text-muted-foreground">
								Delete this task? This cannot be undone.
							</p>
							<Button variant="ghost" size="sm" onclick={() => (confirmingDelete = false)}>
								Keep
							</Button>
							<Button variant="destructive" size="sm" onclick={remove}>Delete</Button>
						</div>
					{:else}
						<Button variant="ghost" size="sm" class="text-destructive" onclick={() => (confirmingDelete = true)}>
							Delete task
						</Button>
					{/if}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>