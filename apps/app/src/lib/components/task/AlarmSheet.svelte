<script lang="ts">
	/**
	 * "Remind me" — the control the whole product exists for.
	 *
	 * THE ROW IS THE TRUTH. `armed` and `time` are derived from the live task and
	 * written straight back through `repo`; this control keeps no second copy of
	 * either. The copy is how the switch could sit on while the store said
	 * otherwise, and how the clock kept showing yesterday's time after the date
	 * above it had already been changed.
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
	import { useDebounce } from 'runed';
	import Switch from '$lib/components/ui/switch/switch.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import Info from 'lucide-svelte/icons/info';
	import Music from 'lucide-svelte/icons/music';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import * as repo from '$lib/db/repo';
	import type { Task } from '$lib/db/schema';
	import { getScheduler, armAlarm, BROWSER_LIMITATION } from '$lib/alarms/scheduler';
	import {
		pickRingtone,
		ringtoneFor,
		ringtoneSupported,
		ringtoneTitleOf
	} from '$lib/alarms/ringtone';
	import { detectPlatform } from '$lib/platform';
	import { atLocal } from '$lib/utils/time';

	let { task }: { task: Task } = $props();

	/**
	 * The clock used when the task has no time of its own. One hour from now, not
	 * "now" — an alarm that fires before the sheet is closed is a bug, not a
	 * default. Held in state so it stays put while the sheet is open.
	 */
	let fallbackTime = $state('');

	/** The switch reflects the STORE, not a local hope. */
	const armed = $derived(task.alarmAt !== null);

	/**
	 * The clock shown, in priority order: the task's own time, then the fallback.
	 * Writing the new value to `dueTime` is what makes this field move.
	 */
	const time = $derived(task.dueTime ?? fallbackTime);

	let outcome = $state<
		{ ok: true; exact: boolean; warning?: string } | { ok: false; reason: string } | null
	>(null);
	let busy = $state(false);
	let loadedId: string | null = null;
	let sound = $state<string | null>(null);
	let soundLabel = $state('Default');

	/** Bumped when a clock entry is rejected, so the input can be re-rendered
	 *  showing the store's value instead of the value it refused. */
	let resetNonce = $state(0);

	$effect(() => {
		if (task.id !== loadedId) {
			loadedId = task.id;
			fallbackTime = defaultTime();
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
		if (!armed) return;
		// No `busy` juggling here: `arm()` owns that flag, and setting it before the
		// call made `arm()` return immediately — which cancelled the old alarm and
		// never armed the new one, leaving the reminder silently gone.
		if (task.alarmId) await getScheduler().cancel(task.alarmId);
		await arm(true, time, pick.uri);
	}

	/** Back to "whatever the rest of the app uses". */
	async function resetSound() {
		if (busy) return;
		await repo.updateTask(task.id, { ringtone: null });
		sound = null;
		if (!armed) return;
		if (task.alarmId) await getScheduler().cancel(task.alarmId);
		await arm(true, time, null);
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

	function instantFor(t: Task, hhmm: string, allowRoll = false): string | null {
		const day = t.dueDate ?? localDayString();
		const at = atLocal(day, hhmm);
		if (!allowRoll || !at) return at;
		if (new Date(at).getTime() > Date.now()) return at;

		//
		// The clock here is the DEFAULT (one hour from now), and the task's day may
		// be long past. Rolling straight to "tomorrow" would move an overdue task a
		// day into the future every time the switch was flipped; rolling to the
		// nearest future occurrence of the same clock keeps it today when today still
		// works, and only reaches tomorrow when the clock has already passed. An
		// explicitly picked past time is still reported as invalid by the caller.
		const today = localDayString();
		const todayAt = atLocal(today, hhmm);
		if (todayAt && new Date(todayAt).getTime() > Date.now()) return todayAt;

		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const nextDay = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
		return atLocal(nextDay, hhmm);
	}

	function localDayString(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	/** The local calendar day an ISO instant falls on. */
	function localDayOfInstant(iso: string): string {
		const d = new Date(iso);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	async function arm(
		next: boolean,
		hhmm: string = time,
		ringtone: string | null = ringtoneFor(task),
		explicitAt?: string
	) {
		if (busy) return;
		busy = true;
		// The sheet is NOT keyed, and a subtask tap re-points `task` without
		// unmounting this control. Remember which row this operation belongs to, so
		// an arm that resolves late cannot stamp itself onto the next row.
		const idAtEntry = task.id;
		try {
			const scheduler = getScheduler();

			if (!next) {
				if (task.alarmId) await scheduler.cancel(task.alarmId);
				// `alarmFiredAt` goes too: a spent reminder is not a record to keep
				// once the user has asked for it to be off.
				await repo.updateTask(task.id, { alarmAt: null, alarmId: null, alarmFiredAt: null });
				outcome = null;
				return;
			}

			const at = explicitAt ?? instantFor(task, hhmm, task.dueTime === null);
			if (!at) {
				// Nothing was touched on the platform, so nothing is lost.
				outcome = { ok: false, reason: 'invalid' };
				resetNonce += 1;
				return;
			}

			// `armAlarm` is the GATED entry point: it refuses before scheduling when
			// notifications are denied. Calling `schedule()` directly here is how an
			// alarm used to be "armed" on a device that could never show it.
			const result = await armAlarm(scheduler, {
				taskId: task.id,
				title: task.title,
				at,
				ringtone,
				description: task.notes
			});

			if (!result.ok) {
				// Do NOT clear `alarmAt` here. The platform was never written, so any
				// alarm that was already armed is still armed.
				outcome = { ok: false, reason: result.reason };
				return;
			}

			if (task.id !== idAtEntry) {
				// The sheet moved to another row while the platform was arming this one.
				// Nothing would ever record it, so cancel it rather than leave a phantom
				// notification behind for the orphan sweep to find much later.
				await scheduler.cancel(result.platformId);
				return;
			}

			// Persist BEFORE reporting success: if the app dies between here and the
			// write, reconcile() will re-arm it. The other way round would leave a
			// notification with nothing in the store to reconcile against.
			//
			// `dueDate`/`dueTime` are written too, so the three can never disagree. A
			// default clock can roll past midnight, and arming for "tomorrow" while the
			// task still said "today" is exactly the stale-promise bug this control is
			// here to prevent. A re-arm after a fire must not inherit the old stamp.
			await repo.updateTask(task.id, {
				alarmAt: at,
				dueDate: localDayOfInstant(at),
				dueTime: hhmm,
				alarmId: result.platformId,
				alarmFiredAt: null
			});
			outcome = {
				ok: true,
				exact: result.exact,
				warning: result.exact ? undefined : result.warning
			};
		} finally {
			busy = false;
		}
	}

	/**
	 * Editing the clock while armed must MOVE the alarm, and must not cancel the
	 * old one until the new value is known to be valid.
	 *
	 * The native time input fires `input` on every spinner tick, so the write is
	 * debounced. Cancelling and re-arming per keystroke is how an intermediate
	 * value reached the failure path and silently switched the reminder off.
	 */
	const commitTime = useDebounce((hhmm: string, forId: string) => {
		void (async () => {
			// A subtask tap re-points `task` without unmounting this control, so a
			// queued write must prove it still belongs to the row it was typed on.
			if (task.id !== forId) return;

			const at = instantFor(task, hhmm);
			if (!at) {
				outcome = { ok: false, reason: 'invalid' };
				resetNonce += 1;
				return;
			}
			if (new Date(at).getTime() <= Date.now()) {
				// A past entry is a typo, not an order: keep whatever is already armed.
				outcome = { ok: false, reason: 'invalid' };
				resetNonce += 1;
				return;
			}

			await repo.updateTask(task.id, { dueTime: hhmm });
			if (task.id !== forId) return;
			if (!armed) {
				outcome = null;
				return;
			}
			if (task.alarmId) await getScheduler().cancel(task.alarmId);
			await arm(true, hhmm);
		})();
	}, 250);

	function changeTime(hhmm: string) {
		// Ignore partial values the picker emits while the user is still choosing
		// ("" while clearing, "1" mid-typing) — persisting those would delete the
		// task's due time.
		if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return;
		// A superseded call rejects with 'Cancelled'; that is normal, not an error.
		commitTime(hhmm, task.id).catch(() => {});
	}

	/**
	 * Switching rows (or unmounting) must not leave a queued write aimed at the
	 * row we just left. runed's debounce is a plain timer with no teardown of its
	 * own, so the cleanup is ours.
	 *
	 * Keyed on the ID, not the object: svelte-idb hands out a fresh row object on
	 * every write, so an object-keyed effect would cancel a clock edit that was
	 * still being typed the moment any other field saved.
	 */
	const rowId = $derived(task.id);
	$effect(() => {
		rowId;
		return () => commitTime.cancel();
	});

	const isBrowser = $derived(detectPlatform() === 'browser');

	/**
	 * The three moments people actually mean, as one-tap choices.
	 *
	 * A native time picker is three taps and a spin. These cover "soon", "this
	 * evening" and "first thing tomorrow" — and `when` is a real Date so the
	 * choice can never land in the past (tonight's 8 pm becomes tomorrow's 8 pm
	 * once it has passed).
	 */
	function quickTimes(): { label: string; when: Date }[] {
		const soon = new Date(Date.now() + 3_600_000);

		const tonight = new Date();
		tonight.setHours(20, 0, 0, 0);
		if (tonight.getTime() <= Date.now()) tonight.setDate(tonight.getDate() + 1);

		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(9, 0, 0, 0);

		return [
			{ label: 'In 1 hour', when: soon },
			{ label: 'Tonight', when: tonight },
			{ label: 'Tomorrow', when: tomorrow }
		];
	}

	/** One tap: set the day, set the clock, arm. The whole promise in one gesture. */
	async function setQuick(when: Date) {
		const dueDate = localDayOfInstant(when.toISOString());
		const hhmm = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
		// Derived from the day + clock, not from `when`, so the instant has the same
		// minute granularity as `dueTime`. A millisecond-precise instant would never
		// compare equal to `deriveAlarmAt(...)`, and every later edit would look like
		// a change.
		const at = atLocal(dueDate, hhmm) ?? when.toISOString();
		await repo.updateTask(task.id, { dueDate, dueTime: hhmm });
		await arm(true, hhmm, ringtoneFor(task), at);
	}

	/**
	 * The promise, in the user's own calendar — computed from the same instant the
	 * alarm will be armed for, so the label cannot claim "Today" for a time that
	 * actually rolls into tomorrow.
	 */
	function whenLabel(t: Task, hhmm: string): string {
		const at = instantFor(t, hhmm, t.dueDate === null);
		if (!at) return `At ${hhmm}`;
		return new Date(at).toLocaleString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
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
<div class="grid grid-cols-1 gap-2.5">
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
		<div class="grid grid-cols-1 gap-1.5">
			<Label for="alarm-time-{task.id}" class="text-xs text-muted-foreground">
				{whenLabel(task, time)}
			</Label>
			<!--
				Keyed on the clock PLUS the rejection counter: when an entry is
				refused, the store still holds the accepted time, and without a
				re-render the input would keep displaying the value it just said no
				to. Harnessing the store value keeps the field honest.
			-->
			{#key resetNonce}
				<Input
					id="alarm-time-{task.id}"
					type="time"
					aria-label="Reminder time"
					class="h-11"
					value={time}
					oninput={(e) => changeTime(e.currentTarget.value)}
				/>
			{/key}
		</div>

		{#if ringtoneSupported()}
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-1.5">
					<Music class="size-3.5 shrink-0 text-muted-foreground" />
					<Label class="text-xs text-muted-foreground">Sound</Label>
					<span class="truncate text-xs">{soundLabel}</span>
				</div>
				<div class="flex shrink-0 items-center gap-1">
					<Button variant="outline" size="sm" class="h-9" disabled={busy} onclick={changeSound}
						>Change</Button
					>
					{#if sound !== null}
						<Button variant="ghost" size="sm" class="h-9" disabled={busy} onclick={resetSound}
							>Default</Button
						>
					{/if}
				</div>
			</div>
		{/if}
	{:else}
		<!--
			One-tap times. Offered only while the reminder is OFF: with it armed, the
			useful controls are the clock and the sound, and a chip row would be a
			third way to do the same thing.
		-->
		<div class="flex flex-wrap gap-1.5">
			{#each quickTimes() as option (option.label)}
				<Button
					variant="outline"
					size="sm"
					class="h-10 px-3"
					disabled={busy}
					onclick={() => setQuick(option.when)}
				>
					{option.label}
				</Button>
			{/each}
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
