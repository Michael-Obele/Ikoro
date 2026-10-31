<script lang="ts">
	/**
	 * The icon shim shadcn-svelte's generated components import — renders the `lucide` prop
	 * only. Per-icon imports keep the bundle at three icons, not the whole set.
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
