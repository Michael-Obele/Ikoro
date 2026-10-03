<script lang="ts">
	/**
	 * Navigation. Views first, then the user's own lists.
	 *
	 * Reads the active route from `$app/state` (Kit 3 removed `$app/stores`; a
	 * module-level `$state` object is the reactive replacement). Every row
	 * highlights itself from `page.url.pathname` rather than from a prop, so a
	 * row can never be out of step with where the user actually is.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ListIcon from 'lucide-svelte/icons/list';
	import CalendarClock from 'lucide-svelte/icons/calendar-clock';
	import CalendarDays from 'lucide-svelte/icons/calendar-days';
	import CheckCheck from 'lucide-svelte/icons/check-check';
	import SettingsIcon from 'lucide-svelte/icons/settings';
	import Plus from 'lucide-svelte/icons/plus';
	import MoreHorizontal from 'lucide-svelte/icons/more-horizontal';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import ListDialog from './ListDialog.svelte';
	import { liveListById, liveLists } from '$lib/stores/view';

	// The responsive shell (sidebar / sheet) lives in +layout.svelte; this
	// component is only ever the sidebar's contents.

	let dialog = $state<'create' | 'rename' | 'delete'>('create');
	let dialogListId = $state<string | null>(null);

	const lists = $derived(liveLists());
	const path = $derived(page.url.pathname);

	const VIEWS = [
		{ href: '/today', label: 'Today', icon: CalendarClock },
		{ href: '/upcoming', label: 'Upcoming', icon: CalendarDays },
		{ href: '/done', label: 'Done', icon: CheckCheck },
		{ href: '/settings', label: 'Settings', icon: SettingsIcon }
	] as const;

	function isActive(href: string): boolean {
		return path === href || path.startsWith(`${href}/`);
	}

	function openDialog(mode: 'create' | 'rename' | 'delete', id: string | null) {
		dialog = mode;
		dialogListId = id;
	}

	function onDialogDone(result: { created?: string; renamed?: string; deleted?: string }) {
		// Deleting the list you are standing in has to move you somewhere real,
		// or the route renders an empty state that looks like data loss.
		if (result.deleted && path.startsWith(`/lists/${result.deleted}`)) {
			void goto('/today');
		}
		if (result.created) void goto(`/lists/${result.created}`);
	}
</script>

<nav class="flex h-full flex-col gap-1 p-3" aria-label="Main">
	<a href="/today" class="mb-3 flex items-center gap-2 px-2 text-sm font-semibold tracking-tight">
		<CalendarClock class="size-4 text-primary" />
		Ikoro
	</a>

	<ul class="grid gap-0.5">
		{#each VIEWS as view (view.href)}
			<li>
				<a
					href={view.href}
					aria-current={isActive(view.href) ? 'page' : undefined}
					class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors
					       hover:bg-accent/60 data-[active=true]:bg-accent data-[active=true]:font-medium"
					data-active={isActive(view.href)}
				>
					<view.icon class="size-4 shrink-0 opacity-70" />
					{view.label}
				</a>
			</li>
		{/each}
	</ul>

	<div class="mt-5 flex items-center justify-between px-2">
		<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Lists</span>
		<Button variant="ghost" size="icon-sm" aria-label="New list" onclick={() => openDialog('create', null)}>
			<Plus class="size-4" />
		</Button>
	</div>

	<ul class="mt-1 grid gap-0.5">
		{#each lists as list (list.id)}
			<li class="group flex items-center">
				<a
					href="/lists/{list.id}"
					aria-current={path === `/lists/${list.id}` ? 'page' : undefined}
					class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors
					       hover:bg-accent/60 data-[active=true]:bg-accent data-[active=true]:font-medium"
					data-active={path === `/lists/${list.id}`}
				>
					<ListIcon class="size-4 shrink-0 opacity-70" />
					<span class="truncate">{list.name}</span>
				</a>

				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								variant="ghost"
								size="icon-sm"
								class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
								aria-label="Actions for {list.name}"
								{...props}
							>
								<MoreHorizontal class="size-4" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Item onclick={() => openDialog('rename', list.id)}>
							<Pencil class="size-4" /> Rename
						</DropdownMenu.Item>
						<DropdownMenu.Item
							variant="destructive"
							onclick={() => openDialog('delete', list.id)}
						>
							<Trash2 class="size-4" /> Delete
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</li>
		{/each}

		{#if lists.length === 0}
			<li class="px-2 py-1.5 text-xs text-muted-foreground">No lists yet</li>
		{/if}
	</ul>
</nav>

<ListDialog bind:mode={dialog} bind:listId={dialogListId} listName={dialogListId ? (liveListById(dialogListId)?.name ?? '') : ''} ondone={onDialogDone} />