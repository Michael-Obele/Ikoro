/**
 * Error responses.
 *
 * AGENTS.md's rule applies to a server as much as to an app: assert on the
 * MESSAGE, because the message is what is read when something fails. So every
 * failure this server produces deliberately names the thing that was wrong, and
 * a Valibot issue is rendered with its field path rather than swallowed.
 *
 * Nothing here leaks a stack trace, a connection string, or a SQL fragment.
 */

import * as v from 'valibot';
import type { RequestEvent } from '@sveltejs/kit';

export type ErrorBody = {
	readonly error: string;
	readonly message: string;
	/** Field paths and messages, when the failure was a validation one. */
	readonly issues?: readonly string[];
};

const JSON_HEADERS = { 'content-type': 'application/json' };

export function jsonError(
	status: number,
	error: string,
	message: string,
	issues?: readonly string[]
): Response {
	const body: ErrorBody = issues?.length ? { error, message, issues } : { error, message };
	return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const unauthorized = (message = 'Sign in with a passkey to use sync.') =>
	jsonError(401, 'unauthorized', message);

export const forbidden = (message = 'This record belongs to another account.') =>
	jsonError(403, 'forbidden', message);

export const notFound = (message = 'Not found.') => jsonError(404, 'not_found', message);

/**
 * Render a Valibot failure as a 400.
 *
 * The message includes the path of the offending field, because "ops.3.payload.
 * title: Invalid type: Expected string but received 3" is the difference between
 * a bug report that can be acted on and one that cannot.
 */
export function validationError(schema: v.GenericSchema, input: unknown, what: string): Response {
	const result = v.safeParse(schema, input);
	if (result.success) {
		// Unreachable in practice; returning a 400 beats throwing from an error path.
		return jsonError(400, 'invalid_request', `${what} failed validation.`);
	}

	const issues = result.issues.map(
		(issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`
	);
	return jsonError(
		400,
		'invalid_request',
		`${what} failed validation — ${issues.join('; ')}`,
		issues
	);
}

/**
 * The client IP, for rate limiting only.
 *
 * `fly-client-ip` is set by Fly.io's edge and is the real client address. The
 * `x-forwarded-for` fallback is only trusted to the LEFTMOST value, because a
 * client can prepend anything it likes and every element after the first hop is
 * attacker-influenced on some deployments. This feeds a per-instance bucket,
 * never an access-control decision, so the fallback's imperfection is bounded —
 * but the header is still never used for `userId`.
 */
export function clientIp(event: Pick<RequestEvent, 'request' | 'getClientAddress'>): string {
	const flyIp = event.request.headers.get('fly-client-ip');
	if (flyIp) return flyIp;

	const forwarded = event.request.headers.get('x-forwarded-for');
	if (forwarded) {
		const first = forwarded.split(',')[0]?.trim();
		if (first) return first;
	}

	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

/** Standard headers for every response the sync API returns. */
export const NO_STORE = { 'cache-control': 'no-store' } as const;
