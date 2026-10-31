import type { CapacitorConfig } from '@capacitor/cli';

/**
 * A build-time wrapper: `webDir` is the static SPA from `vite build`, shared with Tauri.
 * Must not read the environment — `vite build` evaluates this file.
 */
const config: CapacitorConfig = {
	appId: 'com.michaelobele.ikoro',
	appName: 'Ikoro',
	webDir: 'build',
	android: {
		// No plaintext HTTP — the bundle is local and M11's sync endpoint is HTTPS.
		allowMixedContent: false
	}
};

export default config;
