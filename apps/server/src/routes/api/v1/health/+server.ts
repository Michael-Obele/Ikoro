/**
 * The health check. No session, by design — a load balancer and the deploy smoke
 * test cannot present a bearer token.
 *
 * It reports the current `rev` from the SEQUENCE, not from the user's rows,
 * because the question being asked is "is the database reachable and is this the
 * process serving traffic" rather than "does this account have changes".
 *
 * A failure to reach the database is a 503 with a plain reason, never a stack
 * trace and never the connection string.
 */

import type { RequestHandler } from './$types';
import { currentRev } from '#lib/db/queries';

export const GET: RequestHandler = async () => {
	try {
		const rev = await currentRev();
		return new Response(JSON.stringify({ status: 'ok', rev }), {
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	} catch (cause) {
		// The message is deliberately generic. The cause may be a driver error
		// carrying the connection string, and this route is unauthenticated.
		void cause;
		return new Response(
			JSON.stringify({
				status: 'error',
				error: 'database_unreachable',
				message: 'The sync database is not reachable. Check DATABASE_URL.'
			}),
			{ status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
		);
	}
};
