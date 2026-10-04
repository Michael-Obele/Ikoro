<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { browser, dev } from '$app/env';
	import { Agentation } from 'sv-agentation';
	import Menu from 'lucide-svelte/icons/menu';
	import { PersistedState } from 'runed';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import PermissionBanner from '$lib/components/ui/PermissionBanner.svelte';
	import ListSidebar from '$lib/components/lists/ListSidebar.svelte';
	import { ensureSeeded } from '$lib/db/seed';
	import { applyTheme, watchSystemTheme } from '#lib/theme/theme.svelte';
	import {
		onStatus,
		wireAlarmLifecycle,
		openExactAlarmSettings,
		requestNotificationPermission
	} from '$lib/alarms/lifecycle';
	import type { AlarmPermissionStatus } from '$lib/alarms/types';

	let { children } = $props();

	// runed, not a hand-rolled localStorage read: it hydrates safely, stays
	// reactive, and syncs the collapsed state across tabs for free.
	const sidebarCollapsed = new PersistedState('ikoro:sidebar-collapsed', false);
	let sheetOpen = $state(false);
	let status = $state<AlarmPermissionStatus | null>(null);

	// The theme. `document.documentElement` is a node Svelte does not own, so
	// writing the `dark` class and `color-scheme` onto it is a genuine external
	// side effect — the case `$effect` is actually for. It re-runs whenever
	// `resolvedTheme` changes, which covers both an explicit choice and the OS
	// flipping at dusk while the app is open, and it hands back the listener's
	// teardown.
	//
	// This runs FIRST because it is idempotent and cheap, and because everything
	// else here touches storage. The inline script in app.html has already put the
	// class on <html> before first paint; this is the reactive half that keeps it
	// correct after mount.
	$effect(() => {
		applyTheme();
		return watchSystemTheme();
	});

	// A fresh install needs a list before any screen can render one. This is a
	// static SPA with no server load, so seeding happens here — once, and only
	// when the database is empty.
	$effect(() => {
		if (!browser) return;
		void ensureSeeded();

		// The alarm lifecycle owns its own subscriptions; this component only
		// needs the permission status to render the banner.
		const stopStatus = onStatus((next) => (status = next));
		void wireAlarmLifecycle();

		return stopStatus;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="color-scheme" content="light dark" />
</svelte:head>

<div class="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
	<PermissionBanner
		{status}
		onfixexact={() => openExactAlarmSettings()}
		onfixnotifications={() => requestNotificationPermission()}
	/>

	<div class="flex min-h-0 flex-1">
		<!-- Desktop gets a real sidebar. On narrow screens it collapses into a sheet so
		     the task list gets the whole width — two columns on a phone wastes the one
		     thing a phone has plenty of. -->
		<aside
			class="hidden shrink-0 overflow-hidden border-r md:block"
			data-collapsed={sidebarCollapsed.current}
			style="width: {sidebarCollapsed.current ? '4rem' : '16rem'}"
		>
			<ListSidebar />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="flex items-center gap-2 border-b px-3 py-2 md:hidden">
				<Button
					variant="ghost"
					size="icon"
					aria-label="Open navigation"
					onclick={() => (sheetOpen = true)}
				>
					<Menu class="size-5" />
				</Button>
				<span class="text-sm font-semibold">Ikoro</span>
			</header>

			<main class="min-h-0 flex-1 overflow-y-auto">
				{@render children()}
			</main>
		</div>
	</div>
</div>

<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content side="left" class="w-72 p-0">
		<ListSidebar />
	</Sheet.Content>
</Sheet.Root>

{#if browser && dev}
	<!-- sv-agentation: UI annotations become markdown context for AI agents. Dev only. -->
	<Agentation
		toolbarPosition="bottom-right"
		outputMode="forensic"
		pauseAnimations
		clearOnCopy
		includeComponentContext={false}
		includeComputedStyles={false}
	/>
{/if}
