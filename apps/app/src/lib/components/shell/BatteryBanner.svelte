<script lang="ts">
	/**
	 * The battery reliability banner.
	 *
	 * Battery saver and battery optimisation are the two ways a phone quietly
	 * makes an alarm late. Neither can be switched off from inside an app — what
	 * an app can do is notice, say so, and hand the user the exact system screen
	 * that fixes it. That is all this banner does, and only on Android, where
	 * `batteryStatus()` answers with something; elsewhere it renders nothing.
	 *
	 * DISMISSAL IS PER STATE, not forever. Saying "don't show this" while battery
	 * saver is on must not hide the allowlist problem that appears next week — a
	 * changed state re-asks, because it is a different problem.
	 */
	import { PersistedState } from 'runed';
	import { App as CapApp } from '@capacitor/app';
	import BatteryWarning from 'lucide-svelte/icons/battery-warning';
	import X from 'lucide-svelte/icons/x';
	import Button from '$lib/components/ui/button/button.svelte';
	import {
		batteryStatus,
		openBatterySaverSettings,
		requestBatteryExemption
	} from '$lib/alarms/battery';
	import type { IkoroBatteryStatus } from '$lib/alarms/plugin';

	let status = $state<IkoroBatteryStatus | null>(null);

	const dismissed = new PersistedState<string>('ikoro:battery-banner-dismissed', '');

	async function refresh(): Promise<void> {
		status = await batteryStatus();
	}

	$effect(() => {
		void refresh();
		// Re-checked on every resume, like the alarm lifecycle: the user can come
		// back from Settings having fixed (or broken) either switch.
		let disposed = false;
		let handle: { remove: () => Promise<void> } | null = null;
		void CapApp.addListener('appStateChange', ({ isActive }) => {
			if (isActive) void refresh();
		}).then((h) => {
			if (disposed) void h.remove();
			else handle = h;
		});
		return () => {
			disposed = true;
			void handle?.remove();
		};
	});

	const saverOn = $derived(status?.powerSaveMode === true);
	const needsExemption = $derived(status?.ignoringBatteryOptimizations === false);
	const signature = $derived(
		status ? `${status.powerSaveMode}-${status.ignoringBatteryOptimizations}` : ''
	);
	const visible = $derived(
		status !== null && (saverOn || needsExemption) && dismissed.current !== signature
	);
</script>

{#if visible}
	<div
		class="flex items-start gap-3 border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
		role="status"
	>
		<BatteryWarning class="mt-0.5 size-4 shrink-0" />

		<div class="flex-1">
			{#if saverOn}
				<p>Battery saver is on — it can hold your reminders back or delay them.</p>
				<Button
					variant="link"
					class="h-auto p-0 text-sm underline underline-offset-4"
					onclick={() => void openBatterySaverSettings()}
				>
					Open battery saver settings
				</Button>
			{/if}

			{#if needsExemption}
				<p>
					Android may restrict Ikoro in the background. Allow it to skip battery restrictions so
					alarms ring on time.
				</p>
				<Button
					variant="link"
					class="h-auto p-0 text-sm underline underline-offset-4"
					onclick={() => void requestBatteryExemption()}
				>
					Allow in battery settings
				</Button>
			{/if}
		</div>

		<Button
			variant="ghost"
			size="icon"
			class="size-6 shrink-0"
			aria-label="Dismiss"
			onclick={() => (dismissed.current = signature)}
		>
			<X class="size-3.5" />
		</Button>
	</div>
{/if}
