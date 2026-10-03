<script lang="ts">
	/**
	 * Export / import, and the stale-backup nudge.
	 *
	 * Import confirms first, and says out loud which side wins: a user who
	 * restores a two-week-old file onto a device with today's edits needs to know
	 * before the merge, not after.
	 *
	 * Validation errors are listed field by field. "Invalid file" is the least
	 * useful thing this panel could say.
	 */
	import { Download, Upload, TriangleAlert } from 'lucide-svelte/icons';
	import Button from '$lib/components/ui/button/button.svelte';
	import { exportAll, importAll, markExported, lastExportAt, ImportError } from '$lib/db/backup';
	import { downloadJson, fileNameFor, readJsonFile, FileReadError } from '$lib/utils/download';

	let pending = $state<File | null>(null);
	let result = $state<{ lists: number; tasks: number; skipped: number } | null>(null);
	let problems = $state<string[]>([]);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let lastExport = $state<string | null>(null);
	let dismissed = $state(false);

	async function refreshLastExport() {
		lastExport = await lastExportAt();
	}

	async function exportNow() {
		busy = true;
		error = null;
		try {
			const dump = await exportAll();
			downloadJson(fileNameFor(new Date()), dump);
			await markExported();
			await refreshLastExport();
		} finally {
			busy = false;
		}
	}

	function choose(file: File | null) {
		pending = file;
		result = null;
		problems = [];
		error = null;
	}

	async function confirmImport() {
		if (!pending) return;
		busy = true;
		error = null;
		problems = [];
		try {
			const parsed = await readJsonFile(pending);
			result = await importAll(parsed);
		} catch (caught) {
			if (caught instanceof ImportError) {
				error = caught.message;
				problems = caught.paths;
			} else if (caught instanceof FileReadError) {
				error = caught.message;
			} else {
				error = caught instanceof Error ? caught.message : 'Import failed.';
			}
			result = null;
		} finally {
			busy = false;
		}
	}

	const daysSinceExport = $derived(
		lastExport ? Math.floor((Date.now() - new Date(lastExport).getTime()) / 86_400_000) : null
	);
	const stale = $derived(daysSinceExport !== null && daysSinceExport > 7);

	$effect(() => {
		void refreshLastExport();
	});
</script>

<div class="grid gap-4">
	<div class="flex flex-wrap gap-2">
		<Button variant="outline" size="sm" onclick={exportNow} disabled={busy}>
			<Download class="size-4" /> Export
		</Button>

		<label class="inline-flex">
			<input
				type="file"
				accept="application/json,.json"
				class="sr-only"
				onchange={(e) => choose(e.currentTarget.files?.[0] ?? null)}
			/>
			<span
				class="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
			>
				<Upload class="size-4" /> Import
			</span>
		</label>
	</div>

	<p class="text-xs text-muted-foreground">
		The backup is a plain JSON file containing your task titles, notes, dates and alarms in the
		clear. Anyone who has it can read it.
	</p>

	{#if stale && !dismissed}
		<div
			class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm dark:bg-amber-950/30"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0" />
			<p class="flex-1">
				Last backup: {daysSinceExport}
				{daysSinceExport === 1 ? 'day' : 'days'} ago.
				<button class="underline underline-offset-4" onclick={() => (dismissed = true)}
					>Dismiss</button
				>
			</p>
		</div>
	{/if}

	{#if pending}
		<div class="rounded-md border p-3 text-sm">
			<p class="font-medium">Restore from “{pending.name}”?</p>
			<p class="mt-1 text-muted-foreground">
				Records already on this device keep their newer edits. Only fields missing or older than the
				local copy are replaced.
			</p>
			<div class="mt-3 flex gap-2">
				<Button size="sm" onclick={confirmImport} disabled={busy}>Restore</Button>
				<Button size="sm" variant="ghost" onclick={() => choose(null)}>Cancel</Button>
			</div>
		</div>
	{/if}

	{#if result}
		<p class="text-sm">
			Imported {result.lists}
			{result.lists === 1 ? 'list' : 'lists'} · {result.tasks}
			{result.tasks === 1 ? 'task' : 'tasks'}
			{#if result.skipped > 0}
				<span class="font-medium text-amber-600">
					· {result.skipped}
					{result.skipped === 1 ? 'task was' : 'tasks were'} skipped: their list was not in the file
				</span>
			{/if}
		</p>
	{/if}

	{#if error}
		<div class="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm dark:bg-rose-950/30">
			<p class="font-medium">{error}</p>
			{#if problems.length > 0}
				<ul class="mt-1.5 grid gap-0.5 font-mono text-xs text-muted-foreground">
					{#each problems as problem (problem)}
						<li>{problem}</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
