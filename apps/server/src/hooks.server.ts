/** The request guard: attaches the session to `event.locals` and rate-limits `/api/v1/*` per IP. */

// SvelteKit 3 moved `Handle` to `@sveltejs/kit/hooks`; the root import is a type error now.
import type { Handle } from '@sveltejs/kit/hooks';
import { auth } from '#lib/server/auth';
import { clientIp, jsonError } from '#lib/http/errors';
import { check } from '#lib/http/rate-limit';

export type Session = typeof auth.$Infer.Session;

/** The only routes allowed through without a session. */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set(['/api/v1/health', '/api/auth']);

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// `/api/auth/**` does its own authorisation — passkey ceremonies carry their own challenges.
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
