<script lang="ts">
	/**
	 * The M4-S1 device harness.
	 *
	 * ⚠️ THIS ROUTE IS NOT A THROWAWAY. The build plan says to build a throwaway
	 * spike route, prove the alarm on a device, and delete it. The device gate has
	 * NOT been cleared — see `docs/build/M4-alarm-engine.md` § Findings — so this
	 * route is the tool that clears it, and it stays until someone runs it.
	 *
	 * WHAT IT DOES: schedules a real alarm two minutes out through the real
	 * Capacitor plugin, with `isExactNotification` and `isExactMandatory` both true,
	 * and shows every raw value the plugin returned. Nothing here is mocked.
	 *
	 * HOW TO RUN THE GATE:
	 *
	 *   1. `bun run build && bunx cap sync android`
	 *   2. `cd android && ./gradlew assembleDebug`
	 *   3. `adb install -r app/build/outputs/apk/debug/app-debug.apk`
	 *   4. Open this route on the device, tap "Schedule in 2 minutes", note the
	 *      time, then force-stop and idle:
	 *
	 *        adb shell am force-stop com.michaelobele.ikoro
	 *        adb shell dumpsys deviceidle force-idle
	 *
	 *   5. Wait past the alarm time. The notification must arrive AT that minute
	 *      (±60 s) with the app killed and the screen off.
	 *   6. Record the result in the milestone's `## Findings`.
	 *
	 * When the gate passes, this route can be deleted.
	 */
	import { LocalNotifications } from '@capacitor/local-notifications';
	import Button from '$lib/components/ui/button/button.svelte';
	import { hashId } from '$lib/utils/id';

	/** Two minutes: long enough to arm, short enough not to make anybody wait. */
	const DELAY_MS = 120_000;

	let permissions = $state<unknown>('<not checked>');
	let exactSetting = $state<unknown>('<not checked>');
	let scheduleResult = $state<unknown>(null);
	let scheduleError = $state<string | null>(null);
	let armedFor = $state<Date | null>(null);
	let busy = $state(false);

	async function probe() {
		busy = true;
		scheduleError = null;
		try {
			permissions = await LocalNotifications.checkPermissions();
			exactSetting = await LocalNotifications.checkExactNotificationSetting();
		} catch (error) {
			scheduleError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	async function arm() {
		busy = true;
		scheduleResult = null;
		scheduleError = null;
		const at = new Date(Date.now() + DELAY_MS);
		try {
			scheduleResult = await LocalNotifications.schedule({
				notifications: [
					{
						id: hashId('spike'),
						title: 'Ikoro spike',
						body: `test — armed for ${at.toLocaleTimeString()}`,
						channelId: 'reminders',
						extra: { taskId: 'spike' },
						isExactNotification: true,
						isExactMandatory: true,
						schedule: { at, allowWhileIdle: true }
					}
				]
			});
			armedFor = at;
		} catch (error) {
			// Rendered verbatim. A rejection here IS the gate failing loudly —
			// `isExactMandatory` exists so a denied permission cannot pass quietly.
			scheduleError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		} finally {
			busy = false;
		}
	}

	async function cancel() {
		busy = true;
		try {
			await LocalNotifications.cancel({ notifications: [{ id: hashId('spike') }] });
			armedFor = null;
		} catch (error) {
			scheduleError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	async function pending() {
		busy = true;
		try {
			scheduleResult = await LocalNotifications.getPending();
		} catch (error) {
			scheduleError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		void probe();
	});
</script>

<svelte:head><title>Spike · Ikoro</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8">
	<h1 class="text-xl font-semibold tracking-tight">M4-S1 device spike</h1>
	<p class="mt-1 text-sm text-muted-foreground">
		Arms a real alarm two minutes out with exact timing mandatory. Force-stop the app, force Doze,
		and check it still arrives on the minute.
	</p>

	<div class="mt-6 flex flex-wrap gap-2">
		<Button onclick={arm} disabled={busy}>Schedule in 2 minutes</Button>
		<Button variant="outline" onclick={pending} disabled={busy}>Show pending</Button>
		<Button variant="outline" onclick={cancel} disabled={busy}>Cancel</Button>
		<Button variant="ghost" onclick={probe} disabled={busy}>Re-probe</Button>
	</div>

	{#if armedFor}
		<p class="mt-4 text-sm font-medium">Armed for {armedFor.toLocaleTimeString()}</p>
	{/if}

	<div class="mt-6 grid gap-4 font-mono text-xs">
		<section>
			<h2 class="mb-1 font-sans text-sm font-medium">checkPermissions()</h2>
			<pre class="overflow-x-auto rounded-md bg-muted p-3">{JSON.stringify(
					permissions,
					null,
					2
				)}</pre>
		</section>

		<section>
			<h2 class="mb-1 font-sans text-sm font-medium">checkExactNotificationSetting()</h2>
			<pre class="overflow-x-auto rounded-md bg-muted p-3">{JSON.stringify(
					exactSetting,
					null,
					2
				)}</pre>
		</section>

		{#if scheduleResult !== null}
			<section>
				<h2 class="mb-1 font-sans text-sm font-medium">Last call result</h2>
				<pre class="overflow-x-auto rounded-md bg-muted p-3">{JSON.stringify(
						scheduleResult,
						null,
						2
					)}</pre>
			</section>
		{/if}

		{#if scheduleError}
			<section>
				<h2 class="mb-1 font-sans text-sm font-medium text-rose-600">Error (verbatim)</h2>
				<pre
					class="overflow-x-auto rounded-md bg-rose-50 p-3 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">{scheduleError}</pre>
			</section>
		{/if}
	</div>
</div>
