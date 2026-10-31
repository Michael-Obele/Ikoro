<script lang="ts">
	/**
	 * Icon shim for shadcn-svelte's generated components. `components.json` pins
	 * `"iconLibrary": "lucide"`, so only the `lucide` prop is rendered. Checked in by
	 * hand: `scripts/fetch-shadcn.ts` does not emit it.
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
