<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { browser, dev } from '$app/env';
	import { onNavigate } from '$app/navigation';
	import { App as CapApp } from '@capacitor/app';
	import { StatusBar } from '@capacitor/status-bar';
	import { Agentation } from 'sv-agentation';
	import { PersistedState } from 'runed';
	import { Toaster } from 'svelte-sonner';
	import * as Sheet from '$lib/components/ui/sheet';
	import PermissionBanner from '$lib/components/ui/PermissionBanner.svelte';
	import BatteryBanner from '$lib/components/shell/BatteryBanner.svelte';
	import RingingOverlay from '$lib/components/shell/RingingOverlay.svelte';
	import UpdateBanner from '$lib/components/shell/UpdateBanner.svelte';
	import BottomNav from '$lib/components/shell/BottomNav.svelte';
	import ListSidebar from '$lib/components/lists/ListSidebar.svelte';
	import { ensureSeeded } from '$lib/db/seed';
	import {
		applyResolvedTheme,
		resolvedTheme,
		watchDynamicColors,
		watchSystemTheme
	} from '#lib/theme/theme.svelte';
	import {
		onStatus,
		wireAlarmLifecycle,
		openExactAlarmSettings,
		requestNotificationPermission
	} from '$lib/alarms/lifecycle';
	import { detectPlatform } from '$lib/platform';
	import { IkoroAlarm } from '$lib/alarms/plugin';
	import { startRinging, stopRinging } from '$lib/alarms/ringing.svelte';
	import type { AlarmPermissionStatus } from '$lib/alarms/types';

	let { children } = $props();

	// runed, not a hand-rolled localStorage read: it hydrates safely and syncs across tabs.
	const sidebarCollapsed = new PersistedState('ikoro:sidebar-collapsed', false);
	let sheetOpen = $state(false);
	let status = $state<AlarmPermissionStatus | null>(null);

	// Any navigation closes the phone's drawer. `onNavigate` covers the sidebar, in-page
	// links and the Android back button, which never touches the sidebar.
	onNavigate(() => {
		sheetOpen = false;
	});

	// Writes the `dark` class onto a node Svelte does not own — a real external side effect.
	// `applyResolvedTheme` (not `applyTheme`) so the class and the async wallpaper palette
	// land together instead of racing on the same tokens.
	$effect(() => {
		applyResolvedTheme();
		return watchSystemTheme();
	});

	// Material You. A no-op on web and below Android 12; re-reads on resume because the
	// wallpaper can change while the app is backgrounded.
	$effect(() => {
		if (!browser) return;
		return watchDynamicColors();
	});

	// A fresh install needs a list before any screen renders one; seeds once, when empty.
	$effect(() => {
		if (!browser) return;

		/*
		 * Android 15+ draws under the status bar and `env(safe-area-inset-top)` reports 0
		 * there, so the platform plugin has to own the layout.
		 */
		if (detectPlatform() === 'android') {
			void StatusBar.setOverlaysWebView({ overlay: false });

			// Android only takes over the screen while locked; these events let the app show
			// its own ringing screen in the foreground.
			void IkoroAlarm.addListener('alarmRinging', ({ taskId }) => startRinging(taskId));
			void IkoroAlarm.addListener('alarmSnoozed', () => stopRinging());
			void IkoroAlarm.addListener('alarmDismissed', () => stopRinging());
		}

		void ensureSeeded();

		// Only the permission status is needed here; the lifecycle owns its own subscriptions.
		const stopStatus = onStatus((next) => (status = next));
		void wireAlarmLifecycle();

		/*
		 * Android's Back must close the open sheet, or it navigates the route underneath and
		 * leaves the dialog stuck on top. Closing goes through the dialog's own close button
		 * so its teardown (note flushing) still runs.
		 */
		let backHandle: { remove: () => Promise<void> } | null = null;
		void CapApp.addListener('backButton', ({ canGoBack }) => {
			const dialog = document.querySelector('[role="dialog"]');
			if (dialog) {
				// Click the dialog's OWN close button — a synthesised Escape does not reach
				// bits-ui's handler.
				const close = dialog.querySelector<HTMLElement>('[data-slot="sheet-close"]');
				if (close) close.click();
				else document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
				return;
			}
			if (canGoBack) window.history.back();
			else void CapApp.exitApp();
		}).then((handle) => (backHandle = handle));

		return () => {
			stopStatus();
			void backHandle?.remove();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="color-scheme" content="light dark" />
</svelte:head>

<!--
	`fixed inset-0`, not `h-dvh`: in an Android WebView `dvh` is recomputed when the share
	sheet covers us and never resets, collapsing the shell. `overflow-clip`, not `hidden`:
	`hidden` still makes a scroll container the browser can scroll to reveal a focused element.
-->
<div class="fixed inset-0 flex flex-col overflow-clip bg-background text-foreground">
	<PermissionBanner
		{status}
		onfixexact={() => openExactAlarmSettings()}
		onfixnotifications={() => requestNotificationPermission()}
	/>
	<BatteryBanner />
	<UpdateBanner />

	<div class="flex min-h-0 flex-1">
		<!-- Desktop only; on a phone the same component renders inside the drawer. -->
		<aside
			class="hidden shrink-0 overflow-hidden border-r md:block"
			data-collapsed={sidebarCollapsed.current}
			style="width: {sidebarCollapsed.current ? '4rem' : '16rem'}"
		>
			<ListSidebar />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<!--
				`overflow-x-hidden` is explicit: `overflow-y-auto` makes the other axis `auto` too,
				so one long filename let the whole app be dragged sideways.

				`relative` is load-bearing: it is what keeps EVERY `sr-only` / absolute
				descendant inside this scroller. Without a positioned ancestor they are
				contained by the fixed shell, which cannot scroll — and their overflow makes
				it scrollable. See AGENTS.md § LAYOUT.
			-->
			<main class="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
				{@render children()}
			</main>
		</div>
	</div>

	<!-- Sibling of the content row and outside the scroll container, so it never scrolls away. -->
	<BottomNav onopenlists={() => (sheetOpen = true)} />
</div>

<!-- One toast host. `top-center`, not the default bottom: the bottom nav owns that edge. -->
<Toaster theme={resolvedTheme()} position="top-center" closeButton />

<!-- Above the toast host: a ringing alarm outranks a confirmation toast. -->
<RingingOverlay />

<Sheet.Root bind:open={sheetOpen}>
	<!--
		`w-72!` for the same reason TaskSheet's does: the generated `data-[side=left]:w-3/4`
		out-specifies a plain utility.
	-->
	<Sheet.Content side="left" class="w-72! max-w-[85vw] overflow-y-auto p-0">
		<!--
			A real header, for two reasons: it names the dialog for a screen reader, and it keeps
			the lists clear of the generated close button in the top-right corner.
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
