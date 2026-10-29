<script lang="ts">
	/**
	 * The device-wide reminder sound.
	 *
	 * One row, and the choosing is the SYSTEM's ringtone picker (Android's
	 * `ACTION_RINGTONE_PICKER` through `IkoroAlarm.pickRingtone`): it lists every
	 * sound the phone has, previews each one on tap, and needs no UI built here.
	 * What is stored is the picked `content://` uri in `localStorage` — a device
	 * preference, deliberately NOT a database row, because it must never reach
	 * the backup file or the sync wire (a media uri means nothing elsewhere).
	 *
	 * Per-task sounds live on the task itself (see `AlarmSheet`); this row is the
	 * fallback those tasks without one ring with.
	 */
	import Music from 'lucide-svelte/icons/music';
	import Button from '$lib/components/ui/button/button.svelte';
	import {
		globalRingtone,
		pickRingtone,
		ringtoneSupported,
		ringtoneTitleOf,
		setGlobalRingtone
	} from '$lib/alarms/ringtone';

	let uri = $state<string | null>(globalRingtone());
	let label = $state('Default');

	$effect(() => {
		void ringtoneTitleOf(uri).then(
			(title) => (label = title ?? (uri ? 'Custom sound' : 'Default'))
		);
	});

	async function change() {
		const pick = await pickRingtone(uri);
		if (pick.cancelled) return; // backed out — keep what they had
		uri = pick.uri; // null here means the user chose Silent on purpose
		setGlobalRingtone(pick.uri);
	}

	function reset() {
		uri = null;
		setGlobalRingtone(null);
	}
</script>

{#if ringtoneSupported()}
	<div class="flex items-center justify-between gap-3">
		<div class="flex min-w-0 items-center gap-2">
			<Music class="size-4 shrink-0 text-muted-foreground" />
			<div class="min-w-0">
				<p class="text-sm font-medium">Reminder sound</p>
				<p class="truncate text-xs text-muted-foreground">
					{label} — tasks with their own sound override this
				</p>
			</div>
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			<Button variant="outline" size="sm" onclick={change}>Change</Button>
			{#if uri !== null}
				<Button variant="ghost" size="sm" onclick={reset}>Reset</Button>
			{/if}
		</div>
	</div>
{/if}
