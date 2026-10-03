<script lang="ts">
	/**
	 * The alarm health banner.
	 *
	 * Shown whenever reminders cannot currently be delivered exactly, with a
	 * button that actually goes and fixes it. Two separate messages because the
	 * two failures are not the same severity and not the same fix:
	 *
	 *   exact denied         the reminder WILL fire, possibly minutes late
	 *   notifications denied the reminder cannot fire at all
	 *
	 * Blurring those into one "notifications are off" is how a user ends up with
	 * alarms that quietly arrive at 9:15 for a 9:00 meeting.
	 *
	 * This component never schedules anything. It reports, and it links to the
	 * system screen — which is the only thing that can change the answer.
	 */
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { AlarmPermissionStatus } from '$lib/alarms/types';

	let {
		status,
		onfixnotifications,
		onfixexact
	}: {
		status: AlarmPermissionStatus | null;
		onfixnotifications?: () => void;
		onfixexact?: () => void;
	} = $props();

	const exactDenied = $derived(status?.exact === 'denied');
	const notificationsDenied = $derived(status?.notifications === 'denied');
</script>

{#if exactDenied || notificationsDenied}
	<div
		class="flex items-start gap-3 border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
		role="status"
	>
		<TriangleAlert class="mt-0.5 size-4 shrink-0" />

		<div class="flex-1">
			{#if notificationsDenied}
				<p>Notifications are off — Ikoro can't reach you.</p>
				<Button variant="link" class="h-auto p-0 text-sm underline underline-offset-4" onclick={onfixnotifications}>
					Turn notifications on
				</Button>
			{/if}

			{#if exactDenied}
				<p>Exact timing is off — reminders may be late.</p>
				<Button variant="link" class="h-auto p-0 text-sm underline underline-offset-4" onclick={onfixexact}>
					Allow exact alarms
				</Button>
			{/if}
		</div>
	</div>
{/if}