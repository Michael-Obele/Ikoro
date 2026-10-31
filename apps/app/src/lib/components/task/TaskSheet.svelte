<script lang="ts">
	/** The task editor. Every field saves itself — there is no Save button to lose work behind. */
	import { useDebounce } from 'runed';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Textarea from '$lib/components/ui/textarea/textarea.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import DuePicker from './DuePicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import AlarmSheet from './AlarmSheet.svelte';
	import * as repo from '$lib/db/repo';
	import { TASK_COLOR_IDS, TASK_COLORS, taskColorValue } from '$lib/task-colors';
	import { liveSubtasksByParent, liveTasks } from '$lib/stores/view';
	import { getScheduler, armAlarm } from '$lib/alarms/scheduler';
	import { ringtoneFor } from '$lib/alarms/ringtone';
	import { deriveAlarmAt } from '$lib/utils/time';
	import { dismissKeyboard } from '$lib/utils/keyboard';
	import { toast } from 'svelte-sonner';
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

	// Drafts write straight through, so the row behind the sheet updates as you type.
	let title = $state('');
	let notes = $state('');
	let priority = $state<Task['priority']>(0);
	let color = $state<string | null>(null);
	let lastSavedNotes = $state<string | null>(null);
	let confirmingDelete = $state(false);
	let loadedId: string | null = null;

	$effect(() => {
		// Re-seed drafts only when a DIFFERENT task opens, keyed on the id.
		if (task && task.id !== loadedId) {
			loadedId = task.id;
			title = task.title;
			notes = task.notes ?? '';
			priority = task.priority;
			color = task.color ?? null;
			lastSavedNotes = task.notes ?? '';
			confirmingDelete = false;
		}
	});

	/** The live row behind the sheet — a route's tap-time snapshot goes stale on the first write. */
	const liveTask = $derived.by(() => {
		const id = task?.id;
		if (!id) return null;
		return liveTasks().find((row) => row.id === id) ?? task;
	});

	// No draft here: `DuePicker` is controlled by these two, so picker, alarm and row cannot disagree.
	const dueDate = $derived(liveTask?.dueDate ?? null);
	const dueTime = $derived(liveTask?.dueTime ?? null);

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

	/** Write the schedule and MOVE any armed alarm with it — `alarmAt` does not follow the date on its own. */
	let scheduleChain: Promise<void> = Promise.resolve();

	/**
	 * One schedule write at a time, with the row id captured at ENQUEUE time — a late
	 * lookup would land on whatever row the sheet had moved to.
	 */
	function queueSchedule(nextDate: string | null, nextTime: string | null): Promise<void> {
		const id = liveTask?.id ?? null;
		if (!id) return Promise.resolve();
		scheduleChain = scheduleChain.then(
			() => applySchedule(id, nextDate, nextTime),
			() => applySchedule(id, nextDate, nextTime)
		);
		return scheduleChain;
	}

	/**
	 * 300 ms of quiet: the first digit of a typed date must not clear the clock. Never
	 * call `.cancel()` first — runed's `cancel()` kills the next call too.
	 */
	const applyScheduleDebounced = useDebounce(
		(nextDate: string | null, nextTime: string | null) => {
			queueSchedule(nextDate, nextTime).catch(() => {});
		},
		300
	);

	function debounceSchedule(nextDate: string | null, nextTime: string | null) {
		// A superseded call rejects with 'Cancelled'; swallow it.
		applyScheduleDebounced(nextDate, nextTime).catch(() => {});
	}

	/** `''` is a real clear; a partial value is a keystroke still in progress. */
	function onDateChange(value: string) {
		if (value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
		// Clearing the day clears the time too; both go through the debounce.
		debounceSchedule(value || null, value ? dueTime : null);
	}

	function onTimeChange(value: string) {
		if (value !== '' && !/^\d{2}:\d{2}$/.test(value)) return;
		debounceSchedule(dueDate, value || null);
	}

	async function applySchedule(
		rowId: string,
		nextDate: string | null,
		nextTime: string | null
	) {
		const row = liveTasks().find((candidate) => candidate.id === rowId);
		if (!row) return;
		await repo.updateTask(rowId, { dueDate: nextDate, dueTime: nextTime });
		if (row.alarmAt === null) return;

		const scheduler = getScheduler();
		const at = deriveAlarmAt(nextDate, nextTime);

		const disarm = async (note: string) => {
			if (row.alarmId) await scheduler.cancel(row.alarmId);
			await repo.updateTask(rowId, { alarmAt: null, alarmId: null, alarmFiredAt: null });
			toast(note);
		};

		if (!at) {
			return disarm(
				nextDate === null
					? 'Date cleared — reminder switched off.'
					: 'Time cleared — reminder switched off.'
			);
		}
		if (at === row.alarmAt) return;
		if (new Date(at).getTime() <= Date.now()) {
			return disarm('That time has already passed — reminder switched off.');
		}

		// Cancel only once the replacement is known to be valid and in the future.
		if (row.alarmId) await scheduler.cancel(row.alarmId);
		const outcome = await armAlarm(scheduler, {
			taskId: row.id,
			title: row.title,
			at,
			ringtone: ringtoneFor(row),
			description: row.notes
		});

		if (!outcome.ok) {
			await repo.updateTask(rowId, { alarmAt: null, alarmId: null, alarmFiredAt: null });
			toast.error('Could not move the reminder — check alarm permissions.');
			return;
		}

		await repo.updateTask(rowId, { alarmAt: at, alarmId: outcome.platformId, alarmFiredAt: null });
		toast.success(`Reminder moved to ${new Date(at).toLocaleString()}`, {
			description: outcome.exact ? undefined : outcome.warning
		});
	}

	async function savePriority() {
		if (!task) return;
		await repo.updateTask(task.id, { priority });
	}

	/** Autosave, same as `savePriority`. `null` is the explicit "None" choice. */
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

	// ── subtasks ────────────────────────────────────────────────────────────────

	/** Subtasks of the open task, only when it is TOP-LEVEL — subtasks are one level deep. */
	const subtasks = $derived(
		task && task.parentId === null ? (liveSubtasksByParent().get(task.id) ?? []) : []
	);
	const subtaskProgress = $derived(
		subtasks.length === 0
			? null
			: `${subtasks.filter((s) => s.completedAt !== null).length}/${subtasks.length}`
	);

	/** "Add subtask" — one field, Enter commits, Escape or empty-blur puts it away. */
	let addingSubtask = $state(false);

	async function addSubtask(event: SubmitEvent) {
		event.preventDefault();
		if (!task) return;
		const form = event.currentTarget as HTMLFormElement;
		const title = String(new FormData(form).get('subtask-title') ?? '').trim();
		if (!title) {
			addingSubtask = false;
			return;
		}
		// repo.createTask inherits listId from the parent; passing it keeps the call honest.
		await repo.createTask({ listId: task.listId, title, parentId: task.id });
		form.reset();
		// The keyboard was hiding the list it just grew.
		dismissKeyboard();
		addingSubtask = false;
	}

	function clearSubtaskAdd(event: FocusEvent) {
		if ((event.currentTarget as HTMLInputElement).value.trim()) return;
		addingSubtask = false;
	}

	async function toggleSubtask(id: string) {
		await repo.toggleTask(id);
	}

	async function removeSubtask(id: string) {
		await repo.deleteTask(id);
	}

	/** Close, flushing anything still in the debounce window. */
	async function close() {
		saveNotes.cancel();
		// A focused input keeps the keyboard up over a closing sheet.
		dismissKeyboard();
		if (task && notes !== lastSavedNotes) {
			await repo.updateTask(task.id, { notes: notes || null });
		}
		open = false;
		onopenchange?.(false);
	}
</script>

<Sheet.Root bind:open onOpenChange={(next) => !next && close()}>
	<!--
		`w-full!` / `sm:max-w-md!` are load-bearing: a data-variant selector in the generated
		sheet-content out-specifies a plain utility, so the width override needs the `!`.
	-->
	<Sheet.Content side="right" class="w-full! rounded-none sm:max-w-md!">
		{#if task}
			<!-- Hairline, not a card — every section below is divided the same way. -->
			<Sheet.Header class="border-b border-outline-variant">
				<Sheet.Title>Task</Sheet.Title>
				<Sheet.Description class="sr-only">Edit this task</Sheet.Description>
			</Sheet.Header>

			<!-- `min-h-0` makes `overflow-y-auto` mean anything: a flex child defaults to min-height auto. -->
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
				<div class="grid grid-cols-1 gap-1.5 border-b border-outline-variant py-4">
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

				<div class="grid grid-cols-1 gap-1.5 border-b border-outline-variant py-4">
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
					<DuePicker {dueDate} {dueTime} ondatechange={onDateChange} ontimechange={onTimeChange} />
				</div>

				<div class="grid grid-cols-1 gap-1.5 border-b border-outline-variant py-4">
					<!-- Current value in prose, so the section answers "what is it now?" at a glance. -->
					<div class="flex items-center justify-between">
						<span class="text-sm font-medium">Priority</span>
						<span class="text-sm text-muted-foreground" aria-live="polite">
							{PRIORITY_NAMES[priority]}
						</span>
					</div>
					<PriorityPicker bind:priority onchange={savePriority} />
				</div>

				<!-- Same swatch language as ThemeSchemePicker. "None" is a real choice, so it comes first. -->
				<div class="grid grid-cols-1 gap-1.5 border-b border-outline-variant py-4">
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
							class="size-8 shrink-0 rounded-xs border-2 border-input bg-transparent transition-[box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 {color ===
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
								class="size-8 shrink-0 rounded-xs border-2 border-input transition-[box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 {selected
									? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-popover'
									: 'hover:border-foreground'}"
								style="background: {TASK_COLORS[id].value}"
							>
								<span class="sr-only">{TASK_COLORS[id].label}</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- Gets the LIVE row, not the snapshot, or it arms from a stale date. -->
				<div class="border-b border-outline-variant py-4">
					<AlarmSheet task={liveTask ?? task} />
				</div>

				<!-- Subtasks, only for top-level tasks — they cannot nest. -->
				{#if task.parentId === null}
					<div class="border-b border-outline-variant py-4">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">Subtasks</span>
							{#if subtaskProgress}
								<span class="text-xs text-muted-foreground tabular-nums" aria-live="polite">
									{subtaskProgress}
								</span>
							{/if}
						</div>

						{#if subtasks.length > 0}
							<ul class="mt-2">
								{#each subtasks as sub (sub.id)}
									<li
										class="flex items-center gap-1 border-b border-outline-variant/40 py-1 last:border-b-0"
									>
										<label class="flex size-8 shrink-0 cursor-pointer items-center justify-center">
											<Checkbox
												checked={sub.completedAt !== null}
												onCheckedChange={() => toggleSubtask(sub.id)}
												aria-label={sub.completedAt !== null
													? `Mark "${sub.title}" as not done`
													: `Mark "${sub.title}" as done`}
											/>
										</label>
										<!-- `task` is $bindable, so assigning swaps the sheet onto the subtask. -->
										<button
											type="button"
											class="min-w-0 flex-1 truncate py-1 text-left text-sm {sub.completedAt
												? 'text-muted-foreground line-through'
												: ''}"
											onclick={() => (task = sub)}
										>
											{sub.title}
										</button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Delete {sub.title}"
											onclick={() => removeSubtask(sub.id)}
										>
											<Trash2 class="size-4 text-muted-foreground" />
										</Button>
									</li>
								{/each}
							</ul>
						{/if}

						{#if addingSubtask}
							<form class="mt-2" onsubmit={addSubtask}>
								<Input
									name="subtask-title"
									placeholder="Subtask title"
									autofocus
									onblur={clearSubtaskAdd}
									onkeydown={(e) => e.key === 'Escape' && (addingSubtask = false)}
								/>
								<button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Add</button>
							</form>
						{:else}
							<button
								type="button"
								class="mt-2 flex h-9 w-full items-center gap-2 border border-dashed border-outline-variant px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-accent/50 hover:text-foreground"
								onclick={() => (addingSubtask = true)}
							>
								Add subtask
							</button>
						{/if}
					</div>
				{/if}

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
