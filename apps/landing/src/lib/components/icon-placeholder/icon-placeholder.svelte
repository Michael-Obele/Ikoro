<script lang="ts">
	/**
	 * The icon shim shadcn-svelte's generated components import.
	 *
	 * Upstream, registry components are library-agnostic: an indicator is
	 * declared as `<IconPlaceholder lucide="CheckIcon" tabler="IconCheck" … />`
	 * so the same file works whichever icon set the project installed. This site
	 * pins one — `components.json` says `"iconLibrary": "lucide"` — so the shim
	 * renders the `lucide` prop and ignores the rest, which is exactly what the
	 * upstream placeholder resolves to when only one library is present.
	 *
	 * Icons are imported from `@lucide/svelte/icons/<name>` (one module per
	 * icon) rather than the barrel, so the bundler pulls in four icons instead
	 * of the whole set. This file is what `shadcn-svelte add` generates next to
	 * the components; scripts/fetch-shadcn.ts does not emit it, so it is
	 * checked in by hand.
	 */
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		lucide,
		tabler: _tabler,
		hugeicons: _hugeicons,
		phosphor: _phosphor,
		remixicon: _remixicon,
		...rest
	}: {
		lucide: string;
		tabler?: string;
		hugeicons?: string;
		phosphor?: string;
		remixicon?: string;
	} & Record<string, unknown> = $props();

	const REGISTRY = {
		CheckIcon,
		ChevronRightIcon,
		MinusIcon,
		XIcon
	} as const;

	const Icon = $derived(REGISTRY[lucide as keyof typeof REGISTRY] ?? XIcon);
</script>

<Icon {...rest} />
