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
	import DesktopAlarmMode from '$lib/components/ui/DesktopAlarmMode.svelte';
	import { armedCount, pendingAlarms } from '$lib/alarms/reconcile';
	import { detectPlatform } from '$lib/platform';
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
	let missed = $state<{ title: string; dueAt: string }[]>([]);
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
			missed = (next?.missed ?? []).map((m) => ({ title: m.title, dueAt: m.dueAt }));
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
				<span>Exact timing is off — reminders may be late.</span>
			{/if}
		</li>

		<li class="flex items-center gap-2 text-muted-foreground">
			<span class="size-4"></span>
			<span>{armed} armed reminder{armed === 1 ? '' : 's'}</span>
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
				{#each missed as item (item.dueAt)}
					<li>{item.title} — was due {new Date(item.dueAt).toLocaleString()}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="flex flex-wrap gap-2">
		<Button variant="outline" size="sm" disabled={busy} onclick={refresh}>
			<RefreshCw class="size-4" /> Reschedule all
		</Button>
		{#if !notificationsOk}
			<Button variant="outline" size="sm" onclick={requestNotificationPermission}>
				Allow notifications
			</Button>
		{/if}
		{#if !exactOk}
			<Button variant="outline" size="sm" onclick={openExactAlarmSettings}
				>Allow exact alarms</Button
			>
		{/if}
	</div>
</div>
