/**
 * The SSE response, as a `ReadableStream`.
 *
 * Factored out of the route so the framing, the keepalive and the teardown can be
 * tested without an HTTP server — and so the `stream` and `events` paths cannot
 * drift, because they call the same function.
 *
 * ── The four things an SSE endpoint must get right ───────────────────────────
 *  1. **`hello` on connect**, so a client knows the connection is live before it
 *     waits for a change that may be hours away. Without it, a working stream
 *     and a dead socket look identical to the client.
 *  2. **A keepalive comment every 25 s.** Proxies reap idle connections; a
 *     client that reconnects every 60 s forever is a battery bug on a phone.
 *  3. **Cleanup on abort.** A leaked controller per reconnect is a slow OOM on a
 *     512 MB instance. This is the one that is easiest to get wrong and hardest
 *     to notice.
 *  4. **No buffering.** Headers say `no-cache, no-transform` and the response is
 *     a stream — an intermediary that buffers would defeat the entire mechanism.
 */

import { formatEvent, KEEPALIVE_MS, keepaliveChunk, subscribe } from './hub';

/** Headers that stop every layer between here and the phone from buffering. */
export const SSE_HEADERS = {
	'content-type': 'text/event-stream',
	'cache-control': 'no-cache, no-transform',
	connection: 'keep-alive',
	// Tell nginx (and Fly's proxy) not to buffer this response.
	'x-accel-buffering': 'no'
} as const;

export type StreamHandle = {
	readonly response: Response;
	/** How many bytes were pushed. Used by tests to prove frames actually flow. */
	readonly written: () => number;
};

/**
 * Open a stream for `userId` and return it.
 *
 * The enqueue happens inside `start()`, so the opening `hello` frame is written
 * before the function returns — a client that connects and immediately checks
 * for data finds it, rather than waiting for the first keepalive.
 */
export function openStream(userId: string, now = Date.now()): StreamHandle {
	let written = 0;
	let unsubscribe: (() => void) | undefined;
	let keepalive: ReturnType<typeof setInterval> | undefined;
	let teardown: () => void = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (chunk: string) => {
				written += chunk.length;
				controller.enqueue(encoder.encode(chunk));
			};

			// 1. hello — proof of life.
			send(formatEvent('hello', { rev: 0, at: new Date(now).toISOString() }));

			unsubscribe = subscribe(userId, { send, close: () => controller.close() });

			// 2. keepalive, so an idle connection is not reaped.
			keepalive = setInterval(() => {
				try {
					send(keepaliveChunk(Date.now()));
				} catch {
					// The client is gone. Tear down here rather than waiting for a
					// `cancel` that may never arrive, so a dead socket cannot throw on
					// every interval tick until the process restarts.
					teardown();
				}
			}, KEEPALIVE_MS);

			teardown = () => {
				if (keepalive !== undefined) {
					clearInterval(keepalive);
					keepalive = undefined;
				}
				unsubscribe?.();
				unsubscribe = undefined;
			};
		},

		/**
		 * 3. teardown.
		 *
		 * `cancel` IS the disconnect path. When the client goes away — a closed
		 * cell connection, a suspended app, a proxy timeout — the runtime cancels
		 * the response body, and this is where that lands. It is the portable
		 * signal: `controller.signal` is not present on Bun's
		 * `ReadableStreamDefaultController`, so an abort listener added there
		 * throws on the very first connection under Bun — which is the runtime
		 * this server is deployed on.
		 *
		 * The same teardown also runs from the keepalive's catch, because a socket
		 * that has errored can stop cancelling cleanly. Both are idempotent.
		 */
		cancel() {
			teardown();
		}
	});

	return { response: new Response(stream, { headers: SSE_HEADERS }), written: () => written };
}
