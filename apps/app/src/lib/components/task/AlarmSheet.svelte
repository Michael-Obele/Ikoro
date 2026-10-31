<script lang="ts">
	/** "Remind me" — arms the alarm. The task row is the only state; no local copy. */
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

	/** Default clock: one hour from now, held in state so it stays put. */
	let fallbackTime = $state('');

	/** The switch reflects the STORE, not a local hope. */
	const armed = $derived(task.alarmAt !== null);

	/** The task's own time, else the fallback. */
	const time = $derived(task.dueTime ?? fallbackTime);

	let outcome = $state<
		{ ok: true; exact: boolean; warning?: string } | { ok: false; reason: string } | null
	>(null);
	let busy = $state(false);
	let loadedId: string | null = null;
	let sound = $state<string | null>(null);
	let soundLabel = $state('Default');

	/** Bumped on a rejected clock entry, to re-render the input with the stored value. */
	let resetNonce = $state(0);

	$effect(() => {
		if (task.id !== loadedId) {
			loadedId = task.id;
			fallbackTime = defaultTime();
			outcome = null;
			sound = task.ringtone ?? null;
		}
	});

	// Resolved natively; falls back to a plain word when the uri is gone.
	$effect(() => {
		void ringtoneTitleOf(sound).then(
			(title) => (soundLabel = title ?? (sound ? 'Custom sound' : defaultSoundLabel()))
		);
	});

	function defaultSoundLabel(): string {
		return ringtoneFor(task) ? 'All reminders (default)' : 'Default';
	}

	/** Pick a ringtone, then re-arm — the sound lives inside the platform's alarm record. */
	async function changeSound() {
		if (busy) return;
		const pick = await pickRingtone(ringtoneFor(task));
		if (pick.cancelled) return;
		await repo.updateTask(task.id, { ringtone: pick.uri });
		sound = pick.uri;
		if (!armed) return;
		// `arm()` owns the busy flag; setting it here made it return early and drop the alarm.
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

	/** One hour from now, never derived from the due date — that would arm an alarm nobody asked for. */
	function defaultTime(): string {
		const d = new Date(Date.now() + 3_600_000);
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}

	function instantFor(t: Task, hhmm: string, allowRoll = false): string | null {
		const day = t.dueDate ?? localDayString();
		const at = atLocal(day, hhmm);
		if (!allowRoll || !at) return at;
		if (new Date(at).getTime() > Date.now()) return at;

		// Keep the same clock on the nearest future day; a past EXPLICIT time is still rejected by the caller.
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
		// A subtask tap re-points `task` without unmounting; remember which row this arm belongs to.
		const idAtEntry = task.id;
		try {
			const scheduler = getScheduler();

			if (!next) {
				if (task.alarmId) await scheduler.cancel(task.alarmId);
				// `alarmFiredAt` clears too: a spent reminder is not a record to keep.
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

			// `armAlarm` is the gated entry point — it refuses when notifications are denied.
			const result = await armAlarm(scheduler, {
				taskId: task.id,
				title: task.title,
				at,
				ringtone,
				description: task.notes
			});

			if (!result.ok) {
				// Not clearing `alarmAt`: the platform was never written, so the old alarm still stands.
				outcome = { ok: false, reason: result.reason };
				return;
			}

			if (task.id !== idAtEntry) {
				// The sheet moved rows; cancel rather than leave an orphan notification.
				await scheduler.cancel(result.platformId);
				return;
			}

			// Persist before reporting success so reconcile() can re-arm. The day and clock
			// are written too: a default clock can roll past midnight.
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

	/** Debounced: the input fires per spinner tick, and re-arming per keystroke switched the reminder off. */
	const commitTime = useDebounce((hhmm: string, forId: string) => {
		void (async () => {
			// A queued write must prove it still belongs to the row it was typed on.
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
		// Ignore partial values the picker emits mid-typing; they would delete the due time.
		if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return;
		// A superseded call rejects with 'Cancelled'; that is normal, not an error.
		commitTime(hhmm, task.id).catch(() => {});
	}

	/** Cancel a queued write when the row changes. Keyed on the id: svelte-idb hands out a new object per write. */
	const rowId = $derived(task.id);
	$effect(() => {
		rowId;
		return () => commitTime.cancel();
	});

	const isBrowser = $derived(detectPlatform() === 'browser');

	/** One-tap times; each is a real Date, so it can never land in the past. */
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
		// Derived from day + clock so it has minute granularity and compares equal to `deriveAlarmAt`.
		const at = atLocal(dueDate, hhmm) ?? when.toISOString();
		await repo.updateTask(task.id, { dueDate, dueTime: hhmm });
		await arm(true, hhmm, ringtoneFor(task), at);
	}

	/** Computed from the instant the alarm is armed for, so the label cannot say "Today" for tomorrow. */
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

<!-- No border or radius: TaskSheet already draws the hairline between sections. -->
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
			<!-- Keyed on the rejection counter too, so a refused entry re-renders with the stored time. -->
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
		<!-- Quick times, offered only while the reminder is off. -->
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
