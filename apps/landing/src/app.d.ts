// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { ReleaseInfo } from './lib/release';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface PageData {
			/** The live release from the root layout load, or null when the fetch failed. */
			release: ReleaseInfo | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
