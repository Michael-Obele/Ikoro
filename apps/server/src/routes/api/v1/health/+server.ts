/**
 * The health check. No session, by design — a load balancer cannot present a bearer token. It
 * reports the SEQUENCE's rev and never a stack trace or the connection string.
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
		// Deliberately generic: the cause may carry the connection string, and this route is public.
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
