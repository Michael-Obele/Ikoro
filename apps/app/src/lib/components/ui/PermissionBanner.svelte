<script lang="ts">
	/**
	 * The alarm health banner.
	 *
	 * Shown whenever reminders cannot currently be delivered as promised, with a
	 * button that actually goes and fixes it. THREE messages, because the three
	 * failures are not the same severity and not the same fix:
	 *
	 *   notifications denied the reminder cannot fire at all
	 *   exact denied         the reminder cannot be scheduled at all
	 *   full-screen denied   the reminder rings, but cannot take over the screen,
	 *                        so it degrades to a shade banner
	 *
	 * Blurring those into one "notifications are off" is how a user ends up with
	 * alarms that quietly arrive at 9:15 for a 9:00 meeting, or that ring into a
	 * banner nobody wakes up for.
	 *
	 * This component never schedules anything. It reports, and it hands off to the
	 * system screen that can change the answer.
	 */
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Button from '$lib/components/ui/button/button.svelte';
	import { AndroidScheduler } from '$lib/alarms/android-scheduler';
	import type { AlarmPermissionStatus } from '$lib/alarms/types';

	let {
		status,
		onfixnotifications,
		onfixexact,
		onfixfullscreen
	}: {
		status: AlarmPermissionStatus | null;
		onfixnotifications?: () => void;
		onfixexact?: () => void;
		onfixfullscreen?: () => void;
	} = $props();

	const exactDenied = $derived(status?.exact === 'denied');
	const notificationsDenied = $derived(status?.notifications === 'denied');

	/**
	 * Only Android can ever answer 'denied' here: the desktop and browser
	 * schedulers answer 'unsupported', precisely so this banner cannot offer a fix
	 * that cannot exist on them.
	 */
	const fullScreenDenied = $derived(status?.fullScreenIntent === 'denied');

	/**
	 * Open the Android 14+ screen that permits full-screen intents.
	 *
	 * A plain function called from the button — not an effect. It does one thing
	 * on a click, and the alarm lifecycle re-reads the status on the next resume,
	 * so this banner clears itself once the user comes back having granted it.
	 */
	async function fixFullScreenIntent() {
		try {
			await new AndroidScheduler().openFullScreenIntentSettings();
		} catch (error) {
			// A failed hand-off must not throw out of a click handler. The banner
			// simply stays up, which is the truthful state.
			console.warn('[ikoro] could not open the full-screen intent settings', error);
		}
	}
</script>

{#if exactDenied || notificationsDenied || fullScreenDenied}
	<div
		class="flex items-start gap-3 border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
		role="status"
	>
		<TriangleAlert class="mt-0.5 size-4 shrink-0" />

		<div class="flex-1">
			{#if notificationsDenied}
				<p>Notifications are off — Ikoro can't reach you.</p>
				<Button
					variant="link"
					class="h-auto p-0 text-sm underline underline-offset-4"
					onclick={onfixnotifications}
				>
					Turn notifications on
				</Button>
			{/if}

			{#if exactDenied}
				<p>Exact timing is off — Ikoro won't schedule your reminders at all.</p>
				<Button
					variant="link"
					class="h-auto p-0 text-sm underline underline-offset-4"
					onclick={onfixexact}
				>
					Allow exact alarms
				</Button>
			{/if}

			{#if fullScreenDenied}
				<p>
					This alarm can't take over the screen — it will ring, but only as a banner you might sleep
					through.
				</p>
				<Button
					variant="link"
					class="h-auto p-0 text-sm underline underline-offset-4"
					onclick={onfixfullscreen ?? fixFullScreenIntent}
				>
					Allow full-screen alarms
				</Button>
			{/if}

			<p class="mt-1 text-xs opacity-80">
				<strong>Never use "Force stop"</strong> on Ikoro — Android deletes the reminders it had already
				scheduled, and the app can't tell you they're gone. Turn notifications off instead to silence
				it.
			</p>
		</div>
	</div>
{/if}
