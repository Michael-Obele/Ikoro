<script lang="ts">
	/**
	 * The icon shim shadcn-svelte's generated components import.
	 *
	 * Upstream, registry components are library-agnostic: a close button is
	 * declared as `<IconPlaceholder lucide="XIcon" tabler="IconX" … />` so the
	 * same component works whichever icon set the project installed. Ikoro pins
	 * one — `components.json` says `"iconLibrary": "lucide"` — so this shim
	 * renders the `lucide` prop and ignores the rest, which is exactly what the
	 * upstream placeholder resolves to when only one library is present.
	 *
	 * Icons are imported from `lucide-svelte/icons/<name>` (one module per icon,
	 * 7240 of them) rather than the barrel, so the bundler pulls in three icons
	 * instead of the whole set.
	 */
	import CheckIcon from 'lucide-svelte/icons/check';
	import MinusIcon from 'lucide-svelte/icons/minus';
	import XIcon from 'lucide-svelte/icons/x';

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
		MinusIcon,
		XIcon
	} as const;

	const Icon = $derived(REGISTRY[lucide as keyof typeof REGISTRY] ?? XIcon);
</script>

<Icon {...rest} />
