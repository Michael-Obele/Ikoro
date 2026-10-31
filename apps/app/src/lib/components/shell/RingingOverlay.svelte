<script lang="ts">
	/**
	 * The in-app ringing screen, for when Android will not take over: a full-screen overlay,
	 * never a banner.
	 */
	import Button from '$lib/components/ui/button/button.svelte';
	import Bell from 'lucide-svelte/icons/bell';
	import { ringingTaskId, stopRinging } from '$lib/alarms/ringing.svelte';
	import { IkoroAlarm } from '$lib/alarms/plugin';
	import { liveTasks } from '$lib/stores/view';
	import { hashId } from '$lib/utils/id';

	const task = $derived(
		ringingTaskId() ? (liveTasks().find((row) => row.id === ringingTaskId()) ?? null) : null
	);

	let busy = $state(false);

	async function answer(action: 'snooze' | 'dismiss') {
		const id = ringingTaskId();
		if (!id || busy) return;
		busy = true;
		try {
			const options = { id: hashId(id), taskId: id, title: task?.title ?? '' };
			await (action === 'snooze' ? IkoroAlarm.snooze(options) : IkoroAlarm.dismiss(options));
		} finally {
			// The overlay must come down even if the bridge call failed — `alarmSnoozed` /
			// `alarmDismissed` normally clear it.
			stopRinging();
			busy = false;
		}
	}
</script>

{#if ringingTaskId()}
	<div
		class="fixed inset-0 z-55 flex flex-col justify-center gap-6 bg-background px-6 py-10 text-center"
		role="alertdialog"
		aria-modal="true"
		aria-label="Alarm ringing"
	>
		<div class="flex flex-col items-center gap-3">
			<Bell class="size-10 text-primary" />
			<p class="text-xs tracking-widest text-muted-foreground uppercase">Reminder</p>
			<h2 class="text-2xl font-medium text-foreground">{task?.title ?? 'Reminder'}</h2>
			{#if task?.notes}
				<p class="max-w-prose text-sm text-muted-foreground">{task.notes}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-3">
			<Button class="h-12" onclick={() => answer('snooze')} disabled={busy}>Snooze</Button>
			<Button variant="outline" class="h-12" onclick={() => answer('dismiss')} disabled={busy}>
				Dismiss
			</Button>
		</div>
	</div>
{/if}
