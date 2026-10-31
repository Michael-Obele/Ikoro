/**
 * Better Auth's HTTP surface, delegated in full: it owns passkey routing, challenge state and
 * cookies. The instance reads `baseURL` from `APP_ORIGIN`.
 */

import { auth } from '#lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => auth.handler(request);

export const POST: RequestHandler = ({ request }) => auth.handler(request);
