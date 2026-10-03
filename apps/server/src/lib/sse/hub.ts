/**
 * The SSE subscriber registry.
 *
 * In-memory `Map<userId, Set<subscriber>>`, deliberately, and the reasoning is
 * in the plan: this server runs as ONE always-on machine (D13 — scale-to-zero
 * would drop every stream). No Redis, no pub/sub, nothing to operate.
 *
 * The cost is that a second instance would only notify its own subscribers. That
 * is a real limitation and it is why the deploy step pins
 * `auto_stop_machines = false` and a single machine count. It is not a bug to be
 * discovered in production.
 *
 * ── Leaked controllers are the failure mode here ─────────────────────────────
 * A reconnecting client that does not fire `abort` leaves a dead `ReadableStream`
 * controller in the set forever, and on a 512 MB instance a few thousand of them
 * is an OOM. Every path that adds a subscriber removes it again: `abort`, an
 * explicit unsubscribe, and the write failure that means the socket is already
 * gone. `subscriberCount()` exists so that a test can prove cleanup happens
 * rather than assume it.
 */

import { envInt } from '#lib/server/env';

/**
 * Keepalive interval.
 *
 * 25 s. Cloudflare and most proxies reap an idle connection at 60 s, so a
 * keepalive has to be comfortably inside that; 25 s leaves room for a slow
 * round trip plus one missed beat. The value is an env var because the correct
 * number depends on the proxy in front of this server, and it is the one number
 * in the SSE path that cannot be verified without deploying.
 */
export const KEEPALIVE_MS = envInt('SSE_KEEPALIVE_MS', 25_000, 5_000, 60_000);

export type Subscriber = {
	readonly send: (chunk: string) => void;
	readonly close: () => void;
};

const subscribers = new Map<string, Set<Subscriber>>();

/** Total live subscriptions. Exported for tests and for the health route. */
export function subscriberCount(): number {
	let total = 0;
	for (const set of subscribers.values()) total += set.size;
	return total;
}

/** How many streams one user currently holds. A phone reconnecting leaves 2 briefly. */
export function subscriberCountFor(userId: string): number {
	return subscribers.get(userId)?.size ?? 0;
}

/**
 * Register a stream for a user. Returns the unsubscribe function.
 *
 * The caller owns the `ReadableStream`; this module only holds the callbacks and
 * guarantees they are dropped.
 */
export function subscribe(userId: string, subscriber: Subscriber): () => void {
	let set = subscribers.get(userId);
	if (!set) {
		set = new Set();
		subscribers.set(userId, set);
	}
	set.add(subscriber);

	let removed = false;
	return () => {
		// Idempotent, because `abort` and the write-failure path can both fire.
		if (removed) return;
		removed = true;
		const current = subscribers.get(userId);
		if (!current) return;
		current.delete(subscriber);
		// Drop the empty set too, or a user who signs out leaves a Map key behind
		// for the lifetime of the process.
		if (current.size === 0) subscribers.delete(userId);
	};
}

/**
 * Tell one user something changed.
 *
 * Every subscriber is wrapped: a controller whose stream has already errored
 * throws on `send`, and one unhandled throw here would stop the loop and leave
 * every LATER subscriber in the set silently un-notified — a bug that looks
 * exactly like "sync stopped working for some users".
 *
 * Returns how many were reached, so the caller can log a useful number.
 */
export function notify(userId: string, event: string, data: unknown): number {
	const set = subscribers.get(userId);
	if (!set || set.size === 0) return 0;

	const chunk = formatEvent(event, data);
	const dead: Subscriber[] = [];
	let delivered = 0;

	for (const subscriber of set) {
		try {
			subscriber.send(chunk);
			delivered++;
		} catch {
			// The socket is gone. Collect it and unsubscribe AFTER the loop, so
			// mutating the Set mid-iteration cannot skip a neighbour.
			dead.push(subscriber);
		}
	}

	for (const subscriber of dead) {
		set.delete(subscriber);
		try {
			subscriber.close();
		} catch {
			// Already closed. Nothing useful to do, and it must not escape.
		}
	}
	if (set.size === 0) subscribers.delete(userId);

	return delivered;
}

/** Notify every user with new changes. Used after a batch push. */
export function notifyAll(userIds: Iterable<string>, event: string, data: unknown): number {
	let delivered = 0;
	for (const userId of new Set(userIds)) delivered += notify(userId, event, data);
	return delivered;
}

/** An SSE frame. `data` must not contain a bare newline — JSON never does. */
export function formatEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** An SSE comment. The standard trick to keep a connection alive silently. */
export function keepaliveChunk(now: number): string {
	return `: keepalive ${now}\n\n`;
}

/** Drop every subscriber. Test-only; a real deploy never calls this. */
export function resetSubscribers(): void {
	subscribers.clear();
}
