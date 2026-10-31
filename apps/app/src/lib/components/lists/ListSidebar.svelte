<script lang="ts">
	/**
	 * Navigation contents for both shells: desktop sidebar and phone drawer. Each row
	 * highlights itself from `page.url.pathname`.
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
	import ThemeToggle from '$lib/components/theme/ThemeToggle.svelte';
	import ListDialog from './ListDialog.svelte';
	import { liveListById, liveLists } from '$lib/stores/view';

	// `variant` says which shell is asking: the drawer keeps only the lists, Settings and the theme.
	let { variant = 'sidebar' }: { variant?: 'sidebar' | 'drawer' } = $props();

	let dialog = $state<'create' | 'rename' | 'delete'>('create');
	let dialogListId = $state<string | null>(null);
	// Visibility is tracked apart from `dialog`: 'create' is a mode, not "closed".
	let dialogOpen = $state(false);

	const lists = $derived(liveLists());
	const path = $derived(page.url.pathname);

	// Pulled out of VIEWS so the drawer can render it below the lists.
	const VIEWS = [
		{ href: '/today', label: 'Today', icon: CalendarClock },
		{ href: '/upcoming', label: 'Upcoming', icon: CalendarDays },
		{ href: '/done', label: 'Done', icon: CheckCheck }
	] as const;

	const SETTINGS = { href: '/settings', label: 'Settings', icon: SettingsIcon } as const;

	type NavItem = (typeof VIEWS)[number] | typeof SETTINGS;

	function isActive(href: string): boolean {
		return path === href || path.startsWith(`${href}/`);
	}

	function openDialog(mode: 'create' | 'rename' | 'delete', id: string | null) {
		dialog = mode;
		dialogListId = id;
		dialogOpen = true;
	}

	function onDialogDone(result: { created?: string; renamed?: string; deleted?: string }) {
		// Deleting the list you are standing in must move you somewhere real.
		if (result.deleted && path.startsWith(`/lists/${result.deleted}`)) {
			void goto('/today');
		}
		if (result.created) void goto(`/lists/${result.created}`);
	}
</script>

{#snippet navRow(item: NavItem)}
	<li>
		<!-- Same indicator language as the phone's bottom bar: 2px bar plus a tinted row. -->
		<a
			href={item.href}
			aria-current={isActive(item.href) ? 'page' : undefined}
			class="flex items-center gap-2.5 border-l-2 border-transparent px-2 py-1.5 text-sm transition-colors
			       hover:bg-accent/60 data-[active=true]:border-primary data-[active=true]:bg-accent data-[active=true]:font-medium"
			data-active={isActive(item.href)}
		>
			<item.icon class="size-4 shrink-0 opacity-70" />
			{item.label}
		</a>
	</li>
{/snippet}

{#snippet listsSection()}
	<div class="flex items-center justify-between px-2 {variant === 'sidebar' ? 'mt-5' : ''}">
		<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Lists</span>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="New list"
			onclick={() => openDialog('create', null)}
		>
			<Plus class="size-4" />
		</Button>
	</div>

	<ul class="mt-1 grid gap-0.5">
		{#each lists as list (list.id)}
			<li class="group flex items-center">
				<a
					href="/lists/{list.id}"
					aria-current={path === `/lists/${list.id}` ? 'page' : undefined}
					class="flex min-w-0 flex-1 items-center gap-2.5 border-l-2 border-transparent px-2 py-1.5 text-sm transition-colors
					       hover:bg-accent/60 data-[active=true]:border-primary data-[active=true]:bg-accent data-[active=true]:font-medium"
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
								class="pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover:opacity-100 focus-visible:opacity-100"
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
						<DropdownMenu.Item variant="destructive" onclick={() => openDialog('delete', list.id)}>
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
{/snippet}

<nav class="flex h-full flex-col gap-1 p-3" aria-label="Main">
	<!-- Sidebar carries the brand and the views; the drawer drops both — they already sit in the bottom bar. -->
	{#if variant === 'sidebar'}
		<a href="/today" class="mb-3 flex items-center gap-2 px-2 text-sm font-semibold tracking-tight">
			<CalendarClock class="size-4 text-primary" />
			Ikoro
		</a>

		<ul class="grid grid-cols-1 gap-0.5">
			{#each VIEWS as view (view.href)}
				{@render navRow(view)}
			{/each}
			{@render navRow(SETTINGS)}
		</ul>
	{/if}

	{@render listsSection()}

	<!-- Settings has no bottom-bar slot, so the drawer must carry it. -->
	{#if variant === 'drawer'}
		<ul class="mt-5 grid gap-0.5">
			{@render navRow(SETTINGS)}
		</ul>
	{/if}

	<!-- `mt-auto` pins it to the bottom, where a global setting is expected to be. -->
	<div class="mt-auto pt-4">
		<ThemeToggle />
	</div>
</nav>

<ListDialog
	bind:open={dialogOpen}
	bind:mode={dialog}
	bind:listId={dialogListId}
	listName={dialogListId ? (liveListById(dialogListId)?.name ?? '') : ''}
	ondone={onDialogDone}
/>
