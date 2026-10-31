<script lang="ts">
	/**
	 * Offers a newer GitHub release. Throttled inside `checkForUpdate`; a dismissal sticks
	 * per version, so the next release asks again.
	 */
	import { PersistedState } from 'runed';
	import { App as CapApp } from '@capacitor/app';
	import Download from 'lucide-svelte/icons/download';
	import X from 'lucide-svelte/icons/x';
	import Button from '$lib/components/ui/button/button.svelte';
	import { checkForUpdate, type UpdateInfo } from '$lib/update';

	const VERSION = __IKORO_VERSION__;

	let update = $state<UpdateInfo | null>(null);
	const dismissed = new PersistedState<string>('ikoro:update-dismissed', '');

	async function check(): Promise<void> {
		update = await checkForUpdate(VERSION);
	}

	$effect(() => {
		void check();
		let disposed = false;
		let handle: { remove: () => Promise<void> } | null = null;
		void CapApp.addListener('appStateChange', ({ isActive }) => {
			if (isActive) void check();
		}).then((h) => {
			if (disposed) void h.remove();
			else handle = h;
		});
		return () => {
			disposed = true;
			void handle?.remove();
		};
	});

	const visible = $derived(update !== null && dismissed.current !== update.tag);
</script>

{#if visible && update}
	<div
		class="flex items-start gap-3 border-b bg-sky-50 px-4 py-2.5 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100"
		role="status"
	>
		<Download class="mt-0.5 size-4 shrink-0" />

		<div class="flex-1">
			<p>Ikoro {update.tag} is out — you have {VERSION}.</p>
			<a
				href={update.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-block text-sm underline underline-offset-4"
			>
				See what changed
			</a>
		</div>

		<Button
			variant="ghost"
			size="icon"
			class="size-6 shrink-0"
			aria-label="Dismiss"
			onclick={() => update && (dismissed.current = update.tag)}
		>
			<X class="size-3.5" />
		</Button>
	</div>
{/if}
