<script lang="ts">
	/**
	 * The root route renders NOTHING, on purpose.
	 *
	 * `+page.ts` redirects to /today — but this is a static SPA, so that redirect
	 * runs on the CLIENT, after this component has already mounted and painted.
	 * Whatever it renders is therefore the first thing anyone sees when they open
	 * Ikoro, for however long the redirect takes. It used to be the SvelteKit
	 * starter page, so opening the app flashed "Welcome to SvelteKit" before Today
	 * appeared. An empty component makes that hand-off invisible.
	 */
</script>
