<script lang="ts">
	/**
	 * System / Light / Dark.
	 *
	 * A `ToggleGroup` rather than a `Switch`. A switch has two positions, and the
	 * third state here — "follow the OS" — is the one most people want and the one
	 * a switch cannot express without becoming a switch whose meaning depends on
	 * context. Three labelled buttons say what they do.
	 *
	 * Icons are deliberately absent: the word is the visible label and the
	 * accessible name, so there is nothing left to be inferred from a glyph.
	 *
	 * Data flow is one-way and has no `$effect`. The store is the single source of
	 * truth — `value` reads from it, `onValueChange` writes to it. Binding
	 * `bind:value` instead would need a local mirror kept in sync with a store that
	 * can also change from another tab, which is sync-by-effect for no gain.
	 */
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import {
		THEME_CHOICES,
		resolvedTheme,
		setTheme,
		themeChoice,
		type ThemeChoice
	} from '#lib/theme/theme.svelte';

	const LABELS: Record<ThemeChoice, string> = {
		system: 'System',
		light: 'Light',
		dark: 'Dark'
	};

	const DESCRIPTIONS: Record<ThemeChoice, string> = {
		system: 'Follow the device setting',
		light: 'Always use the light theme',
		dark: 'Always use the dark theme'
	};

	function select(next: string): void {
		// Bits UI emits an empty string when the pressed item is toggled off.
		// Re-clicking "Dark" must not silently fall back to System.
		if (!next) return;
		if (!THEME_CHOICES.includes(next as ThemeChoice)) return;
		setTheme(next as ThemeChoice);
	}
</script>

<div class="flex flex-col gap-2">
	<ToggleGroup.Root
		type="single"
		value={themeChoice.current}
		onValueChange={select}
		variant="outline"
		size="sm"
		aria-label="Colour theme"
		class="w-fit"
	>
		{#each THEME_CHOICES as choice (choice)}
			<ToggleGroup.Item
				value={choice}
				aria-label={`${LABELS[choice]}: ${DESCRIPTIONS[choice]}`}
				title={DESCRIPTIONS[choice]}
			>
				{LABELS[choice]}
			</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>

	<!--
		Announcing the RESOLVED theme matters as much as the choice: "System" on its
		own says nothing about what is on screen right now.
	-->
	<p class="text-xs text-muted-foreground" aria-live="polite">
		{LABELS[themeChoice.current]} · currently showing the {resolvedTheme} theme
	</p>
</div>
