<!--
	The sync server has no UI.

	This route exists so a GET / does not fall through to a 404 with a stack
	trace in the response body — a default SvelteKit error page leaks build paths
	and tells a visitor nothing. A one-line JSON 404 is both safer and more
	useful to someone who typed the origin into a browser.
-->
<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Ikoro sync</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main>
	<h1>Ikoro sync server</h1>
	<p>This server exposes an API only. There is nothing to see here.</p>
	<ul>
		<li><code>GET /api/v1/health</code> — liveness, no auth</li>
		<li><code>GET /api/v1/changes</code> — pull (bearer token)</li>
		<li><code>POST /api/v1/changes</code> — push (bearer token)</li>
		<li><code>GET /api/v1/stream</code> — SSE (bearer token)</li>
		<li><code>/api/auth/**</code> — Better Auth</li>
	</ul>
	<p>Signed in: {page.status}</p>
</main>

<style>
	main {
		max-width: 42rem;
		margin: 4rem auto;
		padding: 0 1.5rem;
		font-family: ui-monospace, monospace;
		line-height: 1.6;
	}
	ul {
		padding-left: 1.25rem;
	}
	li {
		margin: 0.25rem 0;
	}
	code {
		background: color-mix(in oklab, currentColor 10%, transparent);
		padding: 0.1em 0.35em;
		border-radius: 0.25em;
	}
</style>
