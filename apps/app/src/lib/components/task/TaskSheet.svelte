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
	import AlarmSheet from './AlarmSheet.svelte';
	import * as repo from '$lib/db/repo';
	import { TASK_COLOR_IDS, TASK_COLORS, taskColorValue } from '$lib/task-colors';
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

	/** Mirrors PriorityPicker's chip labels — the prose form of the ramp. */
	const PRIORITY_NAMES = ['None', 'Low', 'Medium', 'High'] as const;

	// Local drafts. The live task is the truth on open, but editing writes
	// straight through so the row behind the sheet updates as you type.
	let title = $state('');
	let notes = $state('');
	let dueDate = $state<string | null>(null);
	let dueTime = $state<string | null>(null);
	let priority = $state<Task['priority']>(0);
	let color = $state<string | null>(null);
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
			color = task.color ?? null;
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

	/**
	 * Autosave for the colour, same pattern as `savePriority`: the picker writes
	 * straight through, no Save button. `null` is the explicit "None" choice.
	 */
	async function saveColor(value: string | null) {
		color = value;
		if (!task) return;
		await repo.updateTask(task.id, { color: value });
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
	<!--
		`rounded-none` is explicit rather than inherited. The sheet is a full-height
		panel flush against the screen edge, so a corner on it would be a corner
		against nothing — and the generated Sheet.Content carries no radius of its
		own, which means the shape is decided here, once, instead of by whatever
		`--radius` happens to be.
	-->
	<Sheet.Content side="right" class="w-full rounded-none sm:max-w-md">
		{#if task}
			<!-- The header is separated by a hairline, not by a card. Every section
			     below is divided the same way, so the sheet reads as one ruled
			     document rather than a stack of floating panels. -->
			<Sheet.Header class="border-b border-outline-variant">
				<Sheet.Title>Task</Sheet.Title>
				<Sheet.Description class="sr-only">Edit this task</Sheet.Description>
			</Sheet.Header>

			<div class="flex flex-col overflow-y-auto px-4 pb-6">
				<div class="grid gap-1.5 border-b border-outline-variant py-4">
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

				<div class="grid gap-1.5 border-b border-outline-variant py-4">
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

				<div class="border-b border-outline-variant py-4">
					<DuePicker bind:dueDate bind:dueTime onsetchange={saveSchedule} />
				</div>

				<div class="grid gap-1.5 border-b border-outline-variant py-4">
					<!--
						The picker's chips already carry their own labels; this line states
						the CURRENT value in prose so the section answers "what is it now?"
						at a glance, and `aria-live` repeats the change for a screen reader
						that did not walk the radio group. Styled like the section label so
						the pair reads as one ruled row.
					-->
					<div class="flex items-center justify-between">
						<span class="text-sm font-medium">Priority</span>
						<span class="text-sm text-muted-foreground" aria-live="polite">
							{PRIORITY_NAMES[priority]}
						</span>
					</div>
					<PriorityPicker bind:priority onchange={savePriority} />
				</div>

				<!--
					The colour picker. Same swatch language as ThemeSchemePicker: boxy
					2px corners, a 2px border, and the selected swatch wears a 2px
					`--primary` ring offset by 2px. "None" is a bordered empty swatch —
					a real choice, not the absence of one — and sits first so clearing
					is always one tap to the left.
				-->
				<div class="grid gap-1.5 border-b border-outline-variant py-4">
					<div class="flex items-center justify-between">
						<span class="text-sm font-medium">Color</span>
						<span class="text-sm text-muted-foreground" aria-live="polite">
							{color ? (TASK_COLORS[color]?.label ?? 'Custom') : 'None'}
						</span>
					</div>
					<div class="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color">
						<button
							type="button"
							role="radio"
							aria-checked={color === null}
							aria-label="No color"
							title="No color"
							onclick={() => saveColor(null)}
							class="size-8 shrink-0 rounded-xs border-2 border-input bg-transparent outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 {color ===
							null
								? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-popover'
								: 'hover:border-foreground'}"
						>
							<span class="sr-only">No color</span>
						</button>

						{#each TASK_COLOR_IDS as id (id)}
							{@const selected = color === id}
							<button
								type="button"
								role="radio"
								aria-checked={selected}
								aria-label="{TASK_COLORS[id].label} color"
								title={TASK_COLORS[id].label}
								onclick={() => saveColor(id)}
								class="size-8 shrink-0 rounded-xs border-2 border-input outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 {selected
									? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-popover'
									: 'hover:border-foreground'}"
								style="background: {TASK_COLORS[id].value}"
							>
								<span class="sr-only">{TASK_COLORS[id].label}</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- The reminder control. It has to be the one field that arms a
				     platform alarm, so it lives with the scheduler rather than in
				     this file's local state. -->
				<div class="border-b border-outline-variant py-4">
					<AlarmSheet {task} />
				</div>

				<div class="mt-auto pt-4">
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
						<Button
							variant="ghost"
							size="sm"
							class="text-destructive"
							onclick={() => (confirmingDelete = true)}
						>
							Delete task
						</Button>
					{/if}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
