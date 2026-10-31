/**
 * `GET /api/v1/stream` — server-sent events. The canonical path; M11's client connects here.
 * In-process, no Redis, which is why the deploy pins one always-on machine.
 */

import type { RequestHandler } from './$types';
import { openStream } from '#lib/sse/stream';
import { jsonError } from '#lib/http/errors';

export const GET: RequestHandler = ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return jsonError(401, 'unauthorized', 'Sign in with a passkey to use sync.');

	return openStream(userId).response;
};
