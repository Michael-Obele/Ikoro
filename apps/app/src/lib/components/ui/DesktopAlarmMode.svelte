<script lang="ts">
	/**
	 * Which alarm mode is active on this machine, stated plainly.
	 *
	 * There are only two, and the user is told which one they have. A desktop
	 * alarm that silently depends on the window being open is the failure this
	 * milestone exists to prevent, so the degraded case says exactly what it
	 * means rather than showing a green tick.
	 */
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Info from 'lucide-svelte/icons/info';
	import { LINGER_WARNING, SYSTEMD_MODE_DETAIL, type DesktopProbe } from '$lib/alarms/systemd';

	let { probe }: { probe: DesktopProbe } = $props();

	const systemd = $derived(probe.mode === 'systemd');
</script>

<div class="grid gap-1.5 text-sm">
	<p class="flex items-start gap-2">
		{#if systemd}
			<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" />
		{:else}
			<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
		{/if}
		<span class={systemd ? '' : 'text-muted-foreground'}>
			{systemd ? SYSTEMD_MODE_DETAIL : probe.detail}
		</span>
	</p>

	{#if systemd && !probe.linger}
		<p class="flex items-start gap-2 text-xs text-muted-foreground">
			<Info class="mt-0.5 size-3.5 shrink-0" />
			<span>{LINGER_WARNING}</span>
		</p>
	{/if}

	{#if systemd}
		<p class="flex items-start gap-2 text-xs text-muted-foreground">
			<Info class="mt-0.5 size-3.5 shrink-0" />
			<span>
				Notifications from a scheduled alarm do not open Ikoro — the system shows them on its
				own. Open the app to see the task.
			</span>
		</p>
	{/if}

	<p class="text-xs text-muted-foreground">
		Windows and macOS are not supported yet: reminders there need Ikoro open.
	</p>
</div>