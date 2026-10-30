<script lang="ts">
	/**
	 * Reminder health — the screen a user goes to when a reminder did not arrive.
	 *
	 * It reports three things and offers exactly one action:
	 *
	 *   can we post notifications at all?
	 *   can we post them AT THE RIGHT TIME?
	 *   how many alarms are currently armed?
	 *
	 * "Reschedule all" exists because the platform can lose armed alarms without
	 * telling anyone — revoking exact-alarm access deletes them, a force-stop can
	 * drop them — and the fix is always the same diff against the store. Rather
	 * than pretend the user has to understand that, they get a button.
	 */
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import CircleAlert from 'lucide-svelte/icons/circle-alert';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import Button from '$lib/components/ui/button/button.svelte';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import DesktopAlarmMode from '$lib/components/ui/DesktopAlarmMode.svelte';
	import { armedCount, pendingAlarms } from '$lib/alarms/reconcile';
	import { detectPlatform } from '$lib/platform';
	import { AndroidScheduler } from '$lib/alarms/android-scheduler';
	import { DesktopScheduler } from '$lib/alarms/desktop-scheduler';
	import type { DesktopProbe } from '$lib/alarms/systemd';
	import {
		onReport,
		onStatus,
		syncAlarms,
		openExactAlarmSettings,
		requestNotificationPermission
	} from '$lib/alarms/lifecycle';
	import type { AlarmPermissionStatus } from '$lib/alarms/types';

	let status = $state<AlarmPermissionStatus | null>(null);
	let armed = $state(0);
	let nextUp = $state<{ title: string; dueAt: string } | null>(null);
	let missed = $state<{ taskId: string; title: string; dueAt: string }[]>([]);
	let degraded = $state<{ taskId: string; title: string; warning: string }[]>([]);
	let failed = $state<{ taskId: string; reason: string }[]>([]);
	let busy = $state(false);
	let desktopProbe = $state<DesktopProbe | null>(null);

	const isDesktop = detectPlatform() === 'desktop';

	async function refresh() {
		busy = true;
		await syncAlarms();
		armed = await armedCount();
		const upcoming = await pendingAlarms();
		nextUp = upcoming[0] ? { title: upcoming[0].title, dueAt: upcoming[0].alarmAt ?? '' } : null;
		busy = false;
	}

	$effect(() => {
		const stopStatus = onStatus((next) => (status = next));
		const stopReport = onReport((next) => {
			missed = (next?.missed ?? []).map((m) => ({
				taskId: m.taskId,
				title: m.title,
				dueAt: m.dueAt
			}));
			// Degraded and failed are the two outcomes that used to be computed and
			// then thrown away. A reminder armed inexactly, or refused outright, is a
			// broken promise and has to be said out loud — never only logged.
			degraded = (next?.degraded ?? []).map((d) => ({
				taskId: d.taskId,
				title: d.title,
				warning: d.warning
			}));
			failed = (next?.failed ?? []).map((f) => ({ taskId: f.taskId, reason: f.reason }));
		});
		void refresh();
		if (isDesktop) {
			void new DesktopScheduler().currentMode().then((probe) => (desktopProbe = probe));
		}
		return () => {
			stopStatus();
			stopReport();
		};
	});

	const exactOk = $derived(status?.exact === 'granted' || status?.exact === 'unsupported');
	const notificationsOk = $derived(status?.notifications === 'granted');

	/**
	 * Only Android can ever answer `'denied'` here. The desktop and browser
	 * schedulers answer `'unsupported'`, which is deliberately NOT `'denied'`, so
	 * the warning row below never appears for them.
	 */
	const fullScreenDenied = $derived(status?.fullScreenIntent === 'denied');

	/** Why a schedule was refused, in the user's words rather than the seam's. */
	function failureText(reason: string): string {
		if (reason === 'permission') return 'Not allowed to set alarms — grant notifications and exact alarms above.';
		if (reason === 'invalid') return 'The time had already passed when Ikoro tried to arm it.';
		return 'This device cannot schedule alarms.';
	}

	/**
	 * Open the Android 14+ screen that permits full-screen intents.
	 *
	 * Mirrors `openExactAlarmSettings` in the lifecycle: a hand-off to system
	 * Settings, run from a click, so a plain function — never an effect. The
	 * lifecycle re-reads the status on the next resume, so this row clears itself
	 * once the user comes back having granted it.
	 */
	async function fixFullScreenIntent() {
		try {
			await new AndroidScheduler().openFullScreenIntentSettings();
		} catch (error) {
			// A failed hand-off must not throw out of a click handler.
			console.warn('[ikoro] could not open the full-screen intent settings', error);
		}
	}
</script>

<div class="grid gap-3">
	<ul class="grid gap-1.5 text-sm">
		<li class="flex items-center gap-2">
			{#if notificationsOk}
				<CircleCheck class="size-4 text-emerald-600" />
				<span>Notifications are on</span>
			{:else}
				<CircleAlert class="size-4 text-amber-600" />
				<span>Notifications are off — Ikoro can't reach you.</span>
			{/if}
		</li>

		<li class="flex items-center gap-2">
			{#if exactOk}
				<CircleCheck class="size-4 text-emerald-600" />
				<span>Reminders fire at the exact minute</span>
			{:else}
				<CircleAlert class="size-4 text-amber-600" />
				<span>Exact timing is off — Ikoro won't schedule reminders at all.</span>
			{/if}
		</li>

		{#if fullScreenDenied}
			<li class="flex items-center gap-2">
				<CircleAlert class="size-4 text-amber-600" />
				<span>Alarms can't take over the screen — yours will ring, but only as a banner.</span>
			</li>
		{/if}

		<li class="flex items-center gap-2 text-muted-foreground">
			<span class="size-4"></span>
			<span>{armed} armed reminder{armed === 1 ? '' : 's'}</span>
		</li>
		<li class="flex items-start gap-2 text-xs text-muted-foreground">
			<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
			<span>
				<strong>Never use "Force stop"</strong> on Ikoro. Android deletes the reminders it had already
				scheduled and the app cannot tell you they are gone — turn notifications off instead to silence
				it.
			</span>
		</li>
	</ul>

	{#if nextUp}
		<p class="text-sm text-muted-foreground">
			Next: <span class="text-foreground">{nextUp.title}</span> at
			{new Date(nextUp.dueAt).toLocaleString()}
		</p>
	{/if}

	{#if desktopProbe}
		<DesktopAlarmMode probe={desktopProbe} />
	{/if}

	{#if missed.length > 0}
		<div class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
			<p class="font-medium">Missed while Ikoro was closed</p>
			<ul class="mt-1 grid gap-0.5 text-muted-foreground">
				{#each missed as item (item.taskId)}
					<li>{item.title} — was due {new Date(item.dueAt).toLocaleString()}</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if degraded.length > 0}
		<div class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
			<p class="font-medium">These reminders may run late</p>
			<ul class="mt-1 grid gap-0.5 text-muted-foreground">
				{#each degraded as item (item.taskId)}
					<li>{item.title} — {item.warning}</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if failed.length > 0}
		<div class="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm dark:bg-rose-950/30">
			<p class="font-medium">These reminders could not be armed</p>
			<ul class="mt-1 grid gap-0.5 text-muted-foreground">
				{#each failed as item (item.taskId)}
					<li>{failureText(item.reason)}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="flex flex-wrap gap-2">
		<Button variant="outline" size="sm" class="h-10" disabled={busy} onclick={refresh}>
			<RefreshCw class="size-4" /> Reschedule all
		</Button>
		{#if !notificationsOk}
			<Button variant="outline" size="sm" class="h-10" onclick={requestNotificationPermission}>
				Allow notifications
			</Button>
		{/if}
		{#if !exactOk}
			<Button
				variant="outline"
				size="sm"
				class="h-10"
				onclick={openExactAlarmSettings}>Allow exact alarms</Button
			>
		{/if}
		{#if fullScreenDenied}
			<Button variant="outline" size="sm" class="h-10" onclick={fixFullScreenIntent}>
				Allow full-screen alarms
			</Button>
		{/if}
	</div>
</div>
