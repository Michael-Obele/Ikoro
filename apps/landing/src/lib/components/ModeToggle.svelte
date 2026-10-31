<script lang="ts">
	import { resetMode, setMode } from 'mode-watcher';
	import { Monitor, Moon, Sun } from '@lucide/svelte';
	import { buttonVariants, DropdownMenu } from '$lib/components/ui';

	/**
	 * Theme toggle: a menu of Light / Dark / System. The choice persists under the
	 * mode-watcher key, and an inline script in app.html applies it before first paint.
	 */
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger class={buttonVariants({ variant: 'outline', size: 'icon' })}>
		<Sun
			class="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
			aria-hidden="true"
		/>
		<Moon
			class="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
			aria-hidden="true"
		/>
		<span class="sr-only">Toggle theme</span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Item onclick={() => setMode('light')}>Light</DropdownMenu.Item>
		<DropdownMenu.Item onclick={() => setMode('dark')}>Dark</DropdownMenu.Item>
		<DropdownMenu.Item onclick={() => resetMode()}>
			<Monitor class="size-4" aria-hidden="true" />
			System
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
