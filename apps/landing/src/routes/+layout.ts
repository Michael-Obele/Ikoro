// Every page of this site is a page, not a view of state. Each one is built once
// into HTML at deploy time and served as a file, which is why `ssr` stays at its
// SvelteKit default of `true`: the output is prerendered HTML, not a client-only
// shell. Nothing here reads a request.
export const prerender = true;
