/**
 * `GET /api/v1/stream` — server-sent events.
 *
 * This is the canonical path. `docs/design/architecture.md` §6 and M11 Step 5 both
 * name it, and M11's `stream.ts` will connect to exactly this URL.
 *
 * The stream is in-process and there is no Redis (D13). That is why the deploy
 * pins one always-on machine: a second instance would hold subscribers the first
 * one cannot reach, so live updates would work for some devices and silently not
 * for others.
 */

import type { RequestHandler } from './$types';
import { openStream } from '#lib/sse/stream';
import { jsonError } from '#lib/http/errors';

export const GET: RequestHandler = ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return jsonError(401, 'unauthorized', 'Sign in with a passkey to use sync.');

	return openStream(userId).response;
};
