import type { Session } from './hooks.server';

declare global {
	namespace App {
		interface Locals {
			/** The Better Auth session, or null when unauthenticated. Set in hooks.server.ts. */
			session: Session | null;
			/** The authenticated user's id, or null. The ONLY source of `userId`; never a request body. */
			userId: string | null;
		}
	}
}

export {};
