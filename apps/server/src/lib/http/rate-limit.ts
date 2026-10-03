/**
 * A naive per-IP in-memory rate limit for `/api/v1/*`.
 *
 * ── What this is NOT ────────────────────────────────────────────────────────
 * It is not a defence against a distributed flood, and it will not stop anyone
 * determined. It is per INSTANCE: two Fly machines have two independent
 * buckets, and restarting the process empties them. The only thing it reliably
 * stops is a misbehaving client in a loop and a bored script against a single
 * host, which is the realistic case for a personal sync server.
 *
 * Documented here rather than left to be discovered, because a rate limiter that
 * looks load-bearing and is not is worse than none.
 *
 * ── Why a fixed window and not a sliding one ─────────────────────────────────
 * A fixed window is O(1) memory and trivially correct. The known burst at the
 * boundary (2x the limit across a window edge) is acceptable here because the
 * limit is already generous relative to real sync traffic.
 *
 * ── Why the buckets sweep themselves ─────────────────────────────────────────
 * A `Map` keyed by IP that only ever grows is a memory leak with an IP-scan
 * attack's shape: every distinct address leaves an entry that lives until the
 * process restarts. `sweep()` is called on every request; it is O(1) amortised
 * because it only walks when the current window has turned over.
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
 * Count one request against an IP within a scope.
 *
 * `scope` is part of the key so the health check — which a load balancer hits
 * every few seconds — cannot exhaust the bucket the sync routes draw from.
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
