<script lang="ts">
	/**
	 * Settings.
	 *
	 * Sections that do not exist yet say so, plainly. A toggle that pretends to
	 * work is worse than an honest "not yet", because the user finds out at the
	 * moment they needed it — which, for a reminder, is the moment they trusted it.
	 */
	import * as repo from '$lib/db/repo';
	import AlarmHealth from '$lib/components/ui/AlarmHealth.svelte';
	import Backup from '$lib/components/ui/Backup.svelte';
	import { liveLists, liveTasks } from '$lib/stores/view';

	const lists = $derived(liveLists());
	const tasks = $derived(liveTasks());
	const completed = $derived(tasks.filter((t) => t.completedAt !== null).length);

	// Injected from package.json by vite.config.ts — Kit 3 has no `$app/version`,
	// and a second hard-coded copy here is how Settings ends up disagreeing with
	// the APK about which build this is.
	const VERSION = __IKORO_VERSION__;
</script>

<svelte:head>
	<title>Settings · Ikoro</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-6">
	<h1 class="mb-6 text-xl font-semibold tracking-tight">Settings</h1>

	<div class="grid gap-8">
		<section>
			<h2 class="mb-1 text-sm font-medium">Notifications</h2>
			<AlarmHealth />
		</section>

		<section>
			<h2 class="mb-1 text-sm font-medium">Backup</h2>
			<Backup />
		</section>

		<section>
			<h2 class="mb-1 text-sm font-medium">Sync</h2>
			<p class="text-sm text-muted-foreground">
				Optional sync across your own devices, with passkeys instead of a password. Opt-in:
				everything stays on this device until you turn it on.
			</p>
		</section>

		<section>
			<h2 class="mb-1 text-sm font-medium">Data</h2>
			<p class="text-sm text-muted-foreground">
				{lists.length}
				{lists.length === 1 ? 'list' : 'lists'} · {tasks.length}
				{tasks.length === 1 ? 'task' : 'tasks'} · {completed}
				{completed === 1 ? 'task' : 'tasks'} completed
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				Everything lives in this device's own storage. Ikoro has no account and no server.
			</p>
		</section>

		<section>
			<h2 class="mb-1 text-sm font-medium">About</h2>
			<p class="text-sm text-muted-foreground">
				<span class="font-medium text-foreground">Ikoro</span> — an Ịbani is the slit
				gong its striker carries: it is sounded by hand, and it is heard when it is
				sounded, and not a moment before. This app is named for the same promise. You set a
				time; the notification arrives at that time.
			</p>
			<p class="mt-2 text-xs text-muted-foreground">Version {VERSION}</p>
		</section>
	</div>
</div>