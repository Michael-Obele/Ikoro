<script lang="ts">
	import { Button } from '@ikoro/ui';
	import { Download } from '@lucide/svelte';
	import { page } from '$app/state';
	import { site } from '$lib/content';
	import Logo from './Logo.svelte';

	/**
	 * The navigation.
	 *
	 * A plain list of links, no hamburger and no JavaScript: the whole bar is five
	 * items, and a menu that hides four of them behind a button is a worse thing on
	 * a phone than a wrapped row of small links. On a narrow screen it wraps instead.
	 */
	const links = [
		{ href: '/#what-it-does', label: 'What it does' },
		{ href: '/download', label: 'Download' },
		{ href: '/privacy', label: 'Privacy' },
		{ href: '/changelog', label: 'Changelog' }
	];
</script>

<header class="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
	<div
		class="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8"
	>
		<!-- The wordmark is the home link, so it carries the current-page state on
		     `/` — otherwise the home page has no nav item marked current. -->
		<a
			href="/"
			aria-current={page.url.pathname === '/' ? 'page' : undefined}
			class="flex items-center gap-2 font-semibold tracking-tight"
		>
			<Logo />
			<span>{site.name}</span>
		</a>

		<nav aria-label="Main" class="order-last w-full sm:order-none sm:w-auto sm:flex-1">
			<ul class="flex flex-wrap items-center gap-x-5 gap-y-1">
				{#each links as link (link.href)}
					<li>
						<a
							href={link.href}
							aria-current={page.url.pathname === link.href ? 'page' : undefined}
							class="rounded-xs text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline aria-[current]:text-foreground aria-[current]:underline"
						>
							{link.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		<Button href={site.releases} size="sm" class="ml-auto gap-1.5">
			<Download class="size-4" aria-hidden="true" />
			Download
		</Button>
	</div>
</header>
