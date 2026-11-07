import type { CapacitorConfig } from '@capacitor/cli';

/**
 * A build-time wrapper: `webDir` is the static SPA from `vite build`, shared with Tauri.
 * Must not read the environment — `vite build` evaluates this file.
 */
const config: CapacitorConfig = {
	appId: 'com.michaelobele.ikoro',
	appName: 'Ikoro',
	webDir: 'build',
	plugins: {
		// `native` pads the WebView for the system bars instead of relying on env(),
		// which reports 0 on Chromium < 140.
		SystemBars: {
			insetsHandling: 'native'
		}
	},
	android: {
		// No plaintext HTTP — the bundle is local and M11's sync endpoint is HTTPS.
		allowMixedContent: false
	}
};

export default config;
