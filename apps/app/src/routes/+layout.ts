// The product app is a client-rendered SPA: it ships inside a Capacitor WebView
// and a Tauri window, where a server does not exist. SSR is dead weight offline.
export const ssr = false;
export const prerender = false;
