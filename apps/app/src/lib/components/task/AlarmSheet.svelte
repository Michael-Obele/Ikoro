<script lang="ts">
	/**
	 * "Remind me" — the control the whole product exists for.
	 *
	 * Mounted inside `TaskSheet`. The switch is optimistic-looking but the truth
	 * is the OUTCOME: if the platform downgraded the alarm to inexact, or refused
	 * it outright, that is shown here in words. A switch that flips on while the
	 * reminder is quietly inexact is a lie the user discovers hours later, at
	 * exactly the moment the promise was supposed to be kept.
	 *
	 * `alarmAt` is stored, never recomputed at fire time — a later timezone change
	 * must not silently move an alarm that has already been made.
	 */
	import Switch from '$lib/components/ui/switch/switch.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Info from 'lucide-svelte/icons/info';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { getScheduler, BROWSER_LIMITATION } from '$lib/alarms/scheduler';
	import { detectPlatform } from '$lib/platform';
	import { atLocal } from '$lib/utils/time';

	let { task }: { task: Task } = $props();

	let armed = $state(false);
	let time = $state('');
	let outcome = $state<
		{ ok: true; exact: boolean; warning?: string } | { ok: false; reason: string } | null
	>(null);
	let busy = $state(false);
	let loadedId: string | null = null;

	$effect(() => {
		if (task.id !== loadedId) {
			loadedId = task.id;
			armed = task.alarmAt !== null;
			time = task.dueTime ?? defaultTime();
			outcome = null;
		}
	});

	/**
	 * With no time on the task, the least surprising default is one hour from
	 * now — not "now", which would fire before the user has closed the sheet.
	 *
	 * Deliberately not derived from the task: a task with no `dueTime` has no
	 * natural reminder time, and borrowing its due date to invent one would
	 * schedule an alarm the user never agreed to.
	 */
	function defaultTime(): string {
		const d = new Date(Date.now() + 3_600_000);
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}

	function instantFor(t: Task, hhmm: string): string | null {
		const day = t.dueDate ?? localDayString();
		return atLocal(day, hhmm);
	}

	function localDayString(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	async function arm(next: boolean, hhmm: string = time) {
		if (busy) return;
		busy = true;
		const scheduler = getScheduler();

		if (!next) {
			if (task.alarmId) await scheduler.cancel(task.alarmId);
			await repo.updateTask(task.id, { alarmAt: null, alarmId: null });
			armed = false;
			outcome = null;
			busy = false;
			return;
		}

		const at = instantFor(task, hhmm);
		if (!at) {
			outcome = { ok: false, reason: 'invalid' };
			armed = false;
			busy = false;
			return;
		}

		const result = await scheduler.schedule({ taskId: task.id, title: task.title, at });

		if (!result.ok) {
			outcome = { ok: false, reason: result.reason };
			armed = false;
			await repo.updateTask(task.id, { alarmAt: null, alarmId: null });
			busy = false;
			return;
		}

		// Persist BEFORE reporting success: if the app dies between here and the
		// write, reconcile() will re-arm it. The other way round would leave a
		// notification with nothing in the store to reconcile against.
		await repo.updateTask(task.id, { alarmAt: at, alarmId: result.platformId });
		armed = true;
		outcome = { ok: true, exact: result.exact, warning: result.exact ? undefined : result.warning };
		busy = false;
	}

	/** Editing the time while armed must cancel first, or two notifications exist. */
	async function changeTime(hhmm: string) {
		time = hhmm;
		if (!armed) return;
		if (task.alarmId) await getScheduler().cancel(task.alarmId);
		await arm(true, hhmm);
	}

	const isBrowser = $derived(detectPlatform() === 'browser');

	function whenLabel(t: Task, hhmm: string): string {
		return t.dueDate ? `On ${t.dueDate} at ${hhmm}` : `Today at ${hhmm}`;
	}

	function reasonText(reason: string): string {
		if (reason === 'permission') {
			return 'Ikoro is not allowed to set an alarm — allow notifications and exact alarms, then try again.';
		}
		if (reason === 'invalid') return 'Pick a time in the future.';
		return 'This device cannot schedule alarms. Use the Android or desktop app.';
	}
</script>

<div class="grid gap-2.5 rounded-lg border p-3">
	<div class="flex items-center justify-between gap-3">
		<Label for="alarm-{task.id}" class="text-sm font-medium">Remind me</Label>
		<Switch
			id="alarm-{task.id}"
			checked={armed}
			disabled={busy}
			onCheckedChange={(next: boolean) => arm(next)}
		/>
	</div>

	{#if armed}
		<div class="grid gap-1.5">
			<Label for="alarm-time-{task.id}" class="text-xs text-muted-foreground">
				{whenLabel(task, time)}
			</Label>
			<Input
				id="alarm-time-{task.id}"
				type="time"
				value={time}
				oninput={(e) => changeTime(e.currentTarget.value)}
			/>
		</div>
	{/if}

	{#if isBrowser}
		<p class="flex items-start gap-1.5 text-xs text-muted-foreground">
			<Info class="mt-0.5 size-3.5 shrink-0" />
			{BROWSER_LIMITATION}
		</p>
	{/if}

	{#if outcome && !outcome.ok}
		<p class="flex items-start gap-1.5 text-xs font-medium text-rose-600">
			<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
			{reasonText(outcome.reason)}
		</p>
	{:else if outcome && outcome.ok && !outcome.exact}
		<p class="flex items-start gap-1.5 text-xs font-medium text-amber-600">
			<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
			{outcome.warning}
		</p>
	{/if}
</div>
