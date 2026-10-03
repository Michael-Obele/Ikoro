import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor is a build-time wrapper, not a runtime dependency of the web app:
 * `webDir` is the static SPA from `vite build`, and one build feeds both this and
 * Tauri in M6. Nothing here may read the environment — `vite build` evaluates
 * this file, and a missing variable would break a build that has nothing to do
 * with Capacitor.
 */
const config: CapacitorConfig = {
	appId: 'com.michaelobele.ikoro',
	appName: 'Ikoro',
	webDir: 'build',
	android: {
		// No plaintext HTTP. Everything this app talks to is either the local
		// bundle or, from M11, an HTTPS sync endpoint.
		allowMixedContent: false
	}
};

export default config;
