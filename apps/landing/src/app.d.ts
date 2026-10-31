// See https://svelte.dev/docs/kit/types#app.d.ts
import type { ReleaseInfo } from './lib/release';

declare global {
	namespace App {
		interface PageData {
			/** The live release, or the app-version derivation when GitHub is unreachable. */
			release: ReleaseInfo;
			/** Every release GitHub returned, newest first; empty when unreachable. */
			releases: ReleaseInfo[];
		}
	}
}

export {};
