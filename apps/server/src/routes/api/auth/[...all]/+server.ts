/**
 * Better Auth's HTTP surface, delegated in full.
 *
 * One handler for every method: Better Auth owns routing, challenge state and
 * cookie handling for passkey ceremonies, and re-implementing any of it here
 * would be the fastest way to break WebAuthn.
 *
 * `BETTER_AUTH_ORIGIN` is not a thing — the instance reads `baseURL` from
 * `APP_ORIGIN`, configured once in `src/lib/server/auth.ts`.
 */

import { auth } from '#lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => auth.handler(request);

export const POST: RequestHandler = ({ request }) => auth.handler(request);
