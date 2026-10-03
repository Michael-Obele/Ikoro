<script lang="ts">
	/**
	 * Sync is opt-in, and the panel says so before it asks for anything.
	 *
	 * Turning sync on marks every existing row dirty, because the server has
	 * never seen it — skip that and the user's tasks silently never appear on
	 * their other phone, with no error anywhere. It is the classic local-first
	 * sync bug and it is worth a sentence in the UI rather than only a line in a
	 * commit message.
	 */
	import Cloud from 'lucide-svelte/icons/cloud';
	import CloudOff from 'lucide-svelte/icons/cloud-off';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import {
		currentStatus,
		onStatus,
		sync,
		enableSync,
		disableSync,
		type SyncStatus
	} from '$lib/sync/client';
	import { getSyncSettings } from '$lib/sync/config';
	import { createHttpTransport } from '$lib/sync/transport';
	import { reconcile } from '$lib/alarms/reconcile';
	import { getScheduler } from '$lib/alarms/scheduler';

	let status = $state<SyncStatus>(currentStatus());
	let baseUrl = $state('');
	let editing = $state(false);
	let loaded = $state(false);

	$effect(() => {
		const stop = onStatus((next) => (status = next));
		if (!loaded) {
			loaded = true;
			void getSyncSettings().then((settings) => {
				baseUrl = settings.baseUrl;
				editing = !settings.enabled;
			});
		}
		return stop;
	});

	async function runSync() {
		const settings = await getSyncSettings();
		if (!settings.baseUrl) return;
		await sync(createHttpTransport(settings.baseUrl));
		// Imported alarms arrive as data, not as armed platform notifications, so
		// the store has to be reconciled against the platform after every pull.
		await reconcile({ scheduler: getScheduler() });
	}

	async function turnOn() {
		await enableSync(baseUrl);
		editing = false;
		await runSync();
	}

	async function turnOff() {
		await disableSync();
		editing = true;
	}

	const pending = $derived(status.pending);
	const enabled = $derived(status.state !== 'off');
</script>

<div class="grid gap-4">
	{#if !enabled && !editing}
		<div class="flex items-start gap-2 text-sm text-muted-foreground">
			<CloudOff class="mt-0.5 size-4 shrink-0" />
			<p>
				Sync is off. Everything stays on this device — there is no account, and nothing leaves it
				until you turn this on.
			</p>
		</div>
		<Button variant="outline" size="sm" class="justify-self-start" onclick={() => (editing = true)}>
			<Cloud class="size-4" /> Turn on sync
		</Button>
	{:else}
		<div class="flex items-start gap-2 text-sm">
			<Cloud class="mt-0.5 size-4 shrink-0 text-emerald-600" />
			<p>
				Syncing with <span class="font-medium">{baseUrl || 'your server'}</span>
				{#if status.lastSyncedAt}
					— last synced {new Date(status.lastSyncedAt).toLocaleString()}.
				{/if}
			</p>
		</div>

		{#if status.state === 'error' && status.error}
			<p class="flex items-start gap-2 text-xs font-medium text-amber-600">
				<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
				{status.error} — your changes are safe and will be retried.
			</p>
		{/if}

		{#if pending > 0}
			<p class="text-xs text-muted-foreground">
				{pending} change{pending === 1 ? '' : 's'} waiting to upload.
			</p>
		{/if}

		<div class="flex flex-wrap gap-2">
			<Button
				variant="outline"
				size="sm"
				onclick={runSync}
				disabled={status.state === 'pushing' || status.state === 'pulling'}
			>
				<RefreshCw class="size-4" />
				{status.state === 'pushing' || status.state === 'pulling' ? 'Syncing…' : 'Sync now'}
			</Button>
			<Button variant="ghost" size="sm" onclick={turnOff}>Turn off</Button>
		</div>

		<p class="text-xs text-muted-foreground">
			Turning sync on uploads everything currently on this device, including tasks you already wrote
			down. Nothing on this device is deleted when you turn it off.
		</p>
	{/if}

	{#if editing}
		<div class="grid gap-2 border-t pt-4">
			<Label for="sync-url" class="text-sm">Your sync server</Label>
			<Input
				id="sync-url"
				type="url"
				placeholder="https://ikoro-sync.example.com"
				value={baseUrl}
				oninput={(e) => (baseUrl = e.currentTarget.value)}
			/>
			<div class="flex gap-2">
				<Button size="sm" onclick={turnOn} disabled={!baseUrl.trim()}>Connect</Button>
				<Button size="sm" variant="ghost" onclick={() => (editing = false)}>Cancel</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				Self-hosted, and yours alone. Ikoro does not run one, and there is no account to create —
				you sign in with a passkey on the server you point this at.
			</p>
		</div>
	{/if}
</div>
