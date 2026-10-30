<script lang="ts">
	/**
	 * Settings.
	 *
	 * Sections that do not exist yet say so, plainly. A toggle that pretends to
	 * work is worse than an honest "not yet", because the user finds out at the
	 * moment they needed it — which, for a reminder, is the moment they trusted it.
	 */
	import AlarmHealth from '$lib/components/ui/AlarmHealth.svelte';
	import Backup from '$lib/components/ui/Backup.svelte';
	import RingtoneSetting from '$lib/components/ui/RingtoneSetting.svelte';
	import SnoozeSetting from '$lib/components/ui/SnoozeSetting.svelte';
	import SyncPanel from '$lib/components/ui/SyncPanel.svelte';
	import ThemeToggle from '$lib/components/theme/ThemeToggle.svelte';
	import ThemeSchemePicker from '$lib/components/theme/ThemeSchemePicker.svelte';
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

<div class="mx-auto w-full min-w-0 max-w-2xl px-4 py-6">
	<h1 class="mb-6 text-xl font-semibold tracking-tight">Settings</h1>

	<div class="grid min-w-0 gap-8">
		<section class="min-w-0">
			<h2 class="mb-1 text-sm font-medium">Appearance</h2>
			<p class="mb-3 text-sm text-muted-foreground">
				Both themes are held to WCAG AAA contrast — at least 7:1, against the 4.5:1 most apps
				settle for. If this screen is hard to read, that is a bug, not a setting.
			</p>
			<ThemeToggle />
			<div class="mt-4">
				<h3 class="mb-2 text-sm font-medium">Colour</h3>
				<ThemeSchemePicker />
			</div>
		</section>

		<section class="min-w-0">
			<h2 class="mb-1 text-sm font-medium">Notifications</h2>
			<div class="grid gap-3">
				<RingtoneSetting />
				<SnoozeSetting />
				<AlarmHealth />
			</div>
		</section>

		<section class="min-w-0">
			<h2 class="mb-1 text-sm font-medium">Backup</h2>
			<Backup />
		</section>

		<section class="min-w-0">
			<h2 class="mb-1 text-sm font-medium">Sync</h2>
			<SyncPanel />
		</section>

		<section class="min-w-0">
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

		<section class="min-w-0">
			<h2 class="mb-1 text-sm font-medium">About</h2>
			<p class="text-sm text-muted-foreground">
				<span class="font-medium text-foreground">Ikoro</span> — an Ịbani is the slit gong its striker
				carries: it is heard when it is sounded, and not a moment before. You set a time; the
				notification arrives at that time.
			</p>
			<p class="mt-2 text-xs text-muted-foreground">Version {VERSION}</p>
		</section>
	</div>
</div>
