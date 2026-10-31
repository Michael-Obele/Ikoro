<script lang="ts">
	/**
	 * The M4-S1 device harness — ⚠️ NOT a throwaway. The gate has not been cleared, so this route
	 * stays until it is run on a real device; steps are in `docs/build/M4-alarm-engine.md`.
	 * Schedules a real alarm two minutes out through the shipping alarm seam, nothing mocked.
	 */
	import Button from '$lib/components/ui/button/button.svelte';
	import { getScheduler, armAlarm } from '$lib/alarms/scheduler';
	import { hashId } from '$lib/utils/id';

	/** Two minutes: long enough to arm, short enough not to make anybody wait. */
	const DELAY_MS = 120_000;

	/** A fixed fake task id: the shipping `hashId` mapping is what makes it a real notification id. */
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
			// The same gate the app runs before arming anything.
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
				ringtone: null,
				description: 'A description, so the ringing screen can be checked too.'
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
