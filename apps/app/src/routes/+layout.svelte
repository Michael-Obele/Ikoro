<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { browser, dev } from '$app/env';
	import { onNavigate } from '$app/navigation';
	import { Agentation } from 'sv-agentation';
	import { PersistedState } from 'runed';
	import * as Sheet from '$lib/components/ui/sheet';
	import PermissionBanner from '$lib/components/ui/PermissionBanner.svelte';
	import BottomNav from '$lib/components/shell/BottomNav.svelte';
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

	// A navigation must close the phone's nav drawer. Without this you tap a list
	// and the page underneath changes while the drawer sits on top of the screen
	// you just asked for. `onNavigate` is the right hook rather than a click
	// handler: it is one rule for every source of navigation — a sidebar tap, a
	// link inside a page, and the Android back button, which arrives as a
	// popstate and never touches the sidebar at all. On desktop the drawer is
	// never open, so this writes false over false and costs nothing.
	onNavigate(() => {
		sheetOpen = false;
	});

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
		<!-- Desktop gets a real sidebar. On a phone the same component renders inside
		     the sheet, which the bottom bar's "Lists" slot opens — two columns on a
		     phone would waste the one thing a phone has plenty of. -->
		<aside
			class="hidden shrink-0 overflow-hidden border-r md:block"
			data-collapsed={sidebarCollapsed.current}
			style="width: {sidebarCollapsed.current ? '4rem' : '16rem'}"
		>
			<ListSidebar />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<main class="min-h-0 flex-1 overflow-y-auto">
				{@render children()}
			</main>
		</div>
	</div>

	<!--
		The phone's navigation, as a sibling of the content row so it spans the full
		width, and outside the scroll container so it never scrolls away. It hides
		itself above `md`, where the sidebar takes over. There is no phone header any
		more: the bar carries the navigation, and each screen already has an h1 naming
		itself, so a header holding only the wordmark was 44px of nothing.
	-->
	<BottomNav onopenlists={() => (sheetOpen = true)} />
</div>

<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content side="left" class="w-72 p-0">
		<!--
			The drawer needs a real header, for two reasons.

			One: a sheet with no `Sheet.Title` is an UNNAMED dialog to a screen
			reader, so this is where its accessible name comes from. TaskSheet sets
			the same pair, and an sr-only Description keeps the name from being read
			out as the first thing in the panel.

			Two: the close button is `absolute top-3 right-3` in the generated
			sheet-content, so whatever renders first slides underneath it. The drawer
			now leads with the lists — the whole point of dropping the views — which
			put the Lists row's "New list" button in exactly that corner and stacked
			two icon buttons on top of each other. The header occupies that band,
			which pushes the lists clear of the close button.
		-->
		<Sheet.Header>
			<Sheet.Title>Ikoro</Sheet.Title>
			<Sheet.Description class="sr-only">Lists and settings</Sheet.Description>
		</Sheet.Header>

		<ListSidebar variant="drawer" />
	</Sheet.Content>
</Sheet.Root>

{#if browser && dev}
	<!-- sv-agentation: UI annotations become markdown context for AI agents. Dev only. -->
	<Agentation
		toolbarPosition="top-left"
		outputMode="forensic"
		pauseAnimations
		clearOnCopy
		includeComponentContext={false}
		includeComputedStyles={false}
	/>
{/if}
