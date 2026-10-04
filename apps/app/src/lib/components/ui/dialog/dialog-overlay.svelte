<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<!--
	The scrim is `foreground/20`, not `bg-black/10`.

	A black veil cannot work in both themes: over the dark page it measures
	1.11:1 against the popover it is meant to lift, which is indistinguishable
	from no scrim at all — the dialog stops reading as a dialog. `foreground`
	darkens the light theme and lightens the dark one (1.64:1 / 1.58:1), which is
	what makes it a theme-agnostic token. Asserted in tests/theme-contrast.test.ts.
-->
<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	class={cn(
		'fixed inset-0 isolate z-50 bg-foreground/20 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
		className
	)}
	{...restProps}
/>
