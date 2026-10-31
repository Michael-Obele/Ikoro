<script lang="ts">
	/** The app icon for the wordmark. `alt=""` is on purpose: the name is always set in text beside it. */
	let { class: className = 'size-8' }: { class?: string } = $props();
</script>

<img
	src="/icons/icon-512.png"
	alt=""
	width="32"
	height="32"
	decoding="async"
	class="shrink-0 rounded-md {className}"
/>
