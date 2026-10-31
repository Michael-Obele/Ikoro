/**
 * The SSE subscriber registry: `Map<userId, Set<subscriber>>`. In-process by design (D13) —
 * leaked controllers are the failure mode, so every subscribe path unsubscribes.
 */

import { envInt } from '#lib/server/env';

/**
 * Keepalive interval: 25 s, comfortably inside the 60 s idle timeout most proxies apply. An env
 * var because the right value depends on the proxy in front of this server.
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

/** Register a stream for a user. Returns the unsubscribe function. */
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
		// Drop the empty set too, or a signed-out user leaves a Map key forever.
		if (current.size === 0) subscribers.delete(userId);
	};
}

/**
 * Tell one user something changed. A dead subscriber throws on `send`, so the loop catches per
 * subscriber — an uncaught throw would silently skip every later subscriber.
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
			// Collect it, and unsubscribe AFTER the loop so mutating the Set cannot skip a neighbour.
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
