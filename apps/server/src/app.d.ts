import type { Session } from './hooks.server';

declare global {
	namespace App {
		interface Locals {
			/** The Better Auth session, or null when unauthenticated. Set in hooks.server.ts. */
			session: Session | null;
			/**
			 * The authenticated user's id, or null.
			 *
			 * This is the ONLY source of `userId` for any query in this server. It
			 * comes from the session, never from a request body or query string — a
			 * client-supplied `userId` would be an IDOR, and the rule is enforced by
			 * having exactly one place a route can read it from.
			 */
			userId: string | null;
		}
	}
}

export {};
