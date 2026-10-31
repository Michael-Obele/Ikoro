/**
 * A naive per-IP, per-instance rate limit for `/api/v1/*`. It stops a looping client, not a flood;
 * `sweep()` runs per request because an unswept IP-keyed Map is a leak.
 */

import { envInt } from '#lib/server/env';

/** Requests per window, per IP, per route family. */
export const DEFAULT_LIMIT = 120;
export const WINDOW_MS = 60_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateDecision = {
	readonly allowed: boolean;
	readonly remaining: number;
	/** Seconds until the window resets. Present on a 429. */
	readonly retryAfterSeconds: number;
};

function limitFor(scope: string): number {
	return envInt(`RATE_LIMIT_${scope.toUpperCase()}`, DEFAULT_LIMIT, 1, 100_000);
}

/**
 * Count one request against an IP within a scope. `scope` is in the key so health checks cannot
 * exhaust the sync routes' bucket.
 */
export function check(ip: string, scope = 'v1'): RateDecision {
	const limit = limitFor(scope);
	const now = Date.now();
	sweep(now);

	const key = `${scope}:${ip}`;
	const bucket = buckets.get(key);

	if (!bucket || now >= bucket.resetAt) {
		buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
		return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
	}

	bucket.count++;
	const allowed = bucket.count <= limit;

	return {
		allowed,
		remaining: Math.max(0, limit - bucket.count),
		retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
	};
}

/** Drop buckets whose window has closed. Called from `check`, not on a timer. */
function sweep(now: number): void {
	for (const [key, bucket] of buckets) {
		if (now >= bucket.resetAt) buckets.delete(key);
	}
}

/** Test-only. */
export function resetRateLimits(): void {
	buckets.clear();
}

/** Test-only. How many buckets are currently held. */
export function bucketCount(): number {
	return buckets.size;
}
