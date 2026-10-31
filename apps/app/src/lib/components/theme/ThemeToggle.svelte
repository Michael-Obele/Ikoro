<script lang="ts">
	/** System / Light / Dark as a `ToggleGroup`, not a `Switch`: the third state has no on/off. */
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
		// Bits UI emits '' when the pressed item is toggled off; do not fall back to System.
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

	<!-- Announce the RESOLVED theme: "System" alone says nothing about what is on screen now. -->
	<p class="text-xs text-muted-foreground" aria-live="polite">
		Showing the {resolvedTheme()} theme
	</p>
</div>
