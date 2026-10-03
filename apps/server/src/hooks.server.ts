/**
 * The request guard.
 *
 * Two jobs, both before any route body runs:
 *
 *  1. Attach the authenticated session to `event.locals`, so a route never has to
 *     parse a token itself and there is exactly one place that knows how auth
 *     works.
 *  2. Rate-limit `/api/v1/*` per IP, before the expensive work.
 *
 * ── Why the session is resolved in `handle` and not per route ────────────────
 * Every `/api/v1` route except `/health` requires a session. Doing it here means
 * a new route is guarded by default rather than by remembering. The opt-out is a
 * single exported `PUBLIC_ROUTES` set, which is auditable in one place — better
 * than a `requireAuth(event)` call that a new route can simply forget to make.
 */

// SvelteKit 3 moved `Handle` out of the root entry point and into
// `@sveltejs/kit/hooks`. Importing it from '@sveltejs/kit' is a type error now.
import type { Handle } from '@sveltejs/kit/hooks';
import { auth } from '#lib/server/auth';
import { clientIp, jsonError } from '#lib/http/errors';
import { check } from '#lib/http/rate-limit';

export type Session = typeof auth.$Infer.Session;

/** The only routes allowed through without a session. */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set(['/api/v1/health', '/api/auth']);

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// `/api/auth/**` is Better Auth's own surface; it does its own authorisation
	// (it has to — passkey ceremonies carry their own challenges).
	const needsSession = path.startsWith('/api/v1') && !PUBLIC_ROUTES.has(path);

	if (needsSession) {
		const decision = check(clientIp(event), 'v1');
		if (!decision.allowed) {
			return new Response(
				JSON.stringify({
					error: 'rate_limited',
					message: `Too many requests. Retry in ${decision.retryAfterSeconds}s.`
				}),
				{
					status: 429,
					headers: {
						'content-type': 'application/json',
						'retry-after': String(decision.retryAfterSeconds)
					}
				}
			);
		}
	}

	if (path.startsWith('/api/auth')) {
		// Better Auth reads and sets its own cookies; nothing to attach.
		return resolve(event);
	}

	const session = await auth.api.getSession({
		headers: event.request.headers,
		// `asResponse` would give a Response instead of a session object.
		returnHeaders: false
	});

	event.locals.session = session;
	event.locals.userId = session?.user?.id ?? null;

	if (needsSession && !session?.user?.id) {
		return jsonError(401, 'unauthorized', 'Sign in with a passkey to use sync.');
	}

	return resolve(event);
};
