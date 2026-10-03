<script lang="ts">
	/**
	 * The app icon, used as the wordmark's picture.
	 *
	 * `alt=""` on purpose: every place this appears already sets the name in text
	 * beside it, so announcing the logo again would just make a screen reader say
	 * "Ikoro, image" after it has already read "Ikoro".
	 */
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
