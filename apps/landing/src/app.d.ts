// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { ReleaseInfo } from './lib/release';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface PageData {
			/** The live release, or the app-version derivation when GitHub is unreachable. */
			release: ReleaseInfo;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
