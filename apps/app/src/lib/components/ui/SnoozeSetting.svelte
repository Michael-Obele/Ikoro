<script lang="ts">
	/**
	 * How far the ringing screen's Snooze button pushes an alarm back.
	 *
	 * Four chips, not a dropdown — the same reason `PriorityPicker` gives: every
	 * choice is visible without opening anything, and the selected one is obvious
	 * at a glance. The value lives in SharedPreferences on the device (the ringing
	 * screen reads it with no Bridge); this row is a thin client that sets its
	 * state from the WRITE ECHO, never from its own input, so the UI cannot show a
	 * length the alarm will not honour.
	 *
	 * Android-only: desktop fires notifications, not ringing alarms, so there is
	 * nothing to snooze and the row honestly does not exist there.
	 */
	import Clock from 'lucide-svelte/icons/clock';
	import {
		DEFAULT_SNOOZE_MINUTES,
		SNOOZE_CHOICES,
		setSnoozeMinutes,
		snoozeMinutes,
		snoozeSupported,
		type SnoozeMinutes
	} from '#lib/alarms/snooze';

	let minutes = $state<SnoozeMinutes>(DEFAULT_SNOOZE_MINUTES);

	// Device state, not app state: read the truth once, and only writes update it
	// afterwards. `snoozeSupported()` is not reactive, so this is a mount read.
	$effect(() => {
		if (!snoozeSupported()) return;
		void snoozeMinutes().then((stored) => (minutes = stored));
	});

	async function pick(value: SnoozeMinutes) {
		if (value === minutes) return;
		minutes = await setSnoozeMinutes(value);
	}
</script>

{#if snoozeSupported()}
	<!--
		The control WRAPS below the label when it cannot fit beside it.

		Four chips are ~266px of `shrink-0`, which on a 390-443px phone left the
		label about 90px: "Snooze length" broke across two lines and the hint became
		a one-word-per-line column. `grow basis-56` gives the text block a sensible
		minimum before the chips are pushed to their own line, and `min-w-0` on both
		blocks is what actually lets the text wrap instead of forcing the row wider.
	-->
	<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
		<div class="flex min-w-0 grow basis-56 items-center gap-2">
			<Clock class="size-4 shrink-0 text-muted-foreground" />
			<div class="min-w-0">
				<p class="text-sm font-medium">Snooze length</p>
				<p class="text-xs text-muted-foreground">How far Snooze pushes a ringing alarm back</p>
			</div>
		</div>
		<!-- Same chip language as PriorityPicker: square, min-h-9 tap target, the
		     selected one filled, the rest quiet. -->
		<div class="flex shrink-0 gap-1.5" role="radiogroup" aria-label="Snooze length">
			{#each SNOOZE_CHOICES as choice (choice)}
				<button
					type="button"
					role="radio"
					aria-checked={minutes === choice}
					data-on={minutes === choice}
					class="min-h-9 border px-3 text-xs transition-colors
					       data-[on=true]:border-transparent data-[on=true]:bg-primary data-[on=true]:text-primary-foreground
					       data-[on=false]:border-border data-[on=false]:text-muted-foreground"
					onclick={() => void pick(choice)}
				>
					{choice} min
				</button>
			{/each}
		</div>
	</div>
{/if}
