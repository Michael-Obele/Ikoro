<script lang="ts">
	/**
	 * The M4-S1 device harness.
	 *
	 * ⚠️ THIS ROUTE IS NOT A THROWAWAY. The build plan says to build a throwaway
	 * spike route, prove the alarm on a device, and delete it. The device gate has
	 * NOT been cleared — see `docs/build/M4-alarm-engine.md` § Findings — so this
	 * route is the tool that clears it, and it stays until someone runs it.
	 *
	 * WHAT IT DOES: schedules a real alarm two minutes out through the SHIPPING alarm
	 * seam (`getScheduler()` → the `IkoroAlarm` plugin on Android), and shows every raw
	 * value it returned. Nothing here is mocked.
	 *
	 * It used to drive `@capacitor/local-notifications` directly. That plugin is no
	 * longer what arms a reminder, so the gate was validating a transport the app had
	 * retired — a green run would have proved nothing about the promise the product
	 * makes. Going through the seam means this route exercises the same permission
	 * gate, the same id hashing and the same native plugin that a real reminder does.
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
	import Button from '$lib/components/ui/button/button.svelte';
	import { getScheduler, armAlarm } from '$lib/alarms/scheduler';
	import { hashId } from '$lib/utils/id';

	/** Two minutes: long enough to arm, short enough not to make anybody wait. */
	const DELAY_MS = 120_000;

	/**
	 * A fixed fake task id. The native side only needs an id to key the alarm and
	 * to name it on the ringing screen, and the shipping `hashId` mapping is what
	 * turns it into the 32-bit notification id — so this exercises the real path.
	 */
	const TASK_ID = 'spike';
	const PLATFORM_ID = String(hashId(TASK_ID));

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
			// The same gate the app runs before arming anything. If this reports
			// `denied`, a real reminder would have been refused too.
			const scheduler = getScheduler();
			const gate = await scheduler.ensureReady();
			permissions = gate;
			exactSetting = { exact: gate.exact, fullScreenIntent: gate.fullScreenIntent };
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
			scheduleResult = await armAlarm(getScheduler(), {
				taskId: TASK_ID,
				title: 'Ikoro spike',
				at: at.toISOString(),
				ringtone: null
			});
			armedFor = at;
		} catch (error) {
			// Rendered verbatim. A rejection here IS the gate failing loudly.
			scheduleError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		} finally {
			busy = false;
		}
	}

	async function cancel() {
		busy = true;
		try {
			await getScheduler().cancel(PLATFORM_ID);
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
			scheduleResult = Array.from(await getScheduler().getPending());
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
			<h2 class="mb-1 font-sans text-sm font-medium">ensureReady() — the arm gate</h2>
			<pre class="overflow-x-auto rounded-md bg-muted p-3">{JSON.stringify(
					permissions,
					null,
					2
				)}</pre>
		</section>

		<section>
			<h2 class="mb-1 font-sans text-sm font-medium">Exact-alarm setting</h2>
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
				<h2 class="mb-1 font-sans text-sm font-medium text-destructive">Error (verbatim)</h2>
				<pre
					class="overflow-x-auto rounded-md bg-destructive/10 p-3 text-destructive dark:bg-destructive/20">{scheduleError}</pre>
			</section>
		{/if}
	</div>
</div>
