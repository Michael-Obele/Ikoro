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
	import Button from '$lib/components/ui/button/button.svelte';
	import Info from 'lucide-svelte/icons/info';
	import Music from 'lucide-svelte/icons/music';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { getScheduler, BROWSER_LIMITATION } from '$lib/alarms/scheduler';
	import {
		pickRingtone,
		ringtoneFor,
		ringtoneSupported,
		ringtoneTitleOf
	} from '$lib/alarms/ringtone';
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
	let sound = $state<string | null>(null);
	let soundLabel = $state('Default');

	$effect(() => {
		if (task.id !== loadedId) {
			loadedId = task.id;
			armed = task.alarmAt !== null;
			time = task.dueTime ?? defaultTime();
			outcome = null;
			sound = task.ringtone ?? null;
		}
	});

	// The NAME of the sound, resolved natively. Runs whenever `sound` changes —
	// including when the picker below returns — and degrades to a plain word
	// when the uri cannot be resolved (a sound the device no longer has).
	$effect(() => {
		void ringtoneTitleOf(sound).then(
			(title) => (soundLabel = title ?? (sound ? 'Custom sound' : defaultSoundLabel()))
		);
	});

	function defaultSoundLabel(): string {
		return ringtoneFor(task) ? 'All reminders (default)' : 'Default';
	}

	/**
	 * The system ringtone picker, then re-arm.
	 *
	 * Re-arming matters: an alarm that is already armed carries its sound INSIDE
	 * the platform's alarm record, so changing the sound on an armed task without
	 * re-arming it would do nothing until the next reconcile happened to notice.
	 */
	async function changeSound() {
		if (busy) return;
		const pick = await pickRingtone(ringtoneFor(task));
		if (pick.cancelled) return;
		await repo.updateTask(task.id, { ringtone: pick.uri });
		sound = pick.uri;
		if (armed) {
			busy = true;
			if (task.alarmId) await getScheduler().cancel(task.alarmId);
			await arm(true, time, pick.uri);
			busy = false;
		}
	}

	/** Back to "whatever the rest of the app uses". */
	async function resetSound() {
		if (busy) return;
		await repo.updateTask(task.id, { ringtone: null });
		sound = null;
		if (armed) {
			busy = true;
			if (task.alarmId) await getScheduler().cancel(task.alarmId);
			await arm(true, time, null);
			busy = false;
		}
	}

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

	async function arm(
		next: boolean,
		hhmm: string = time,
		ringtone: string | null = ringtoneFor(task)
	) {
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

		const result = await scheduler.schedule({
			taskId: task.id,
			title: task.title,
			at,
			ringtone
		});

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

<!--
	No border and no radius. This block sits inside TaskSheet, which already draws a
	hairline between sections — a second box around it would be a card inside a
	card, and the rounded one it used to be was the only rounded thing on the sheet.
-->
<div class="grid gap-2.5">
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

		{#if ringtoneSupported()}
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-1.5">
					<Music class="size-3.5 shrink-0 text-muted-foreground" />
					<Label class="text-xs text-muted-foreground">Sound</Label>
					<span class="truncate text-xs">{soundLabel}</span>
				</div>
				<div class="flex shrink-0 items-center gap-1">
					<Button variant="outline" size="sm" disabled={busy} onclick={changeSound}>Change</Button>
					{#if sound !== null}
						<Button variant="ghost" size="sm" disabled={busy} onclick={resetSound}>Default</Button>
					{/if}
				</div>
			</div>
		{/if}
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
