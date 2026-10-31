/**
 * The SSE response, as a `ReadableStream`.
 *
 * Shared by the `stream` and `events` routes so they cannot drift, and testable without a server.
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
 * Open a stream for `userId` and return it. The `hello` frame is written inside `start()`,
 * so it is already there when this returns.
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

			// Proof of life before the client waits for a change that may be hours away.
			send(formatEvent('hello', { rev: 0, at: new Date(now).toISOString() }));

			unsubscribe = subscribe(userId, { send, close: () => controller.close() });

			// So an idle connection is not reaped by a proxy.
			keepalive = setInterval(() => {
				try {
					send(keepaliveChunk(Date.now()));
				} catch {
					// Client gone. Tear down here, or a dead socket throws on every tick forever.
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
		 * The disconnect path. `cancel` is the portable signal: `controller.signal` is absent on Bun's
		 * controller. Also reached from the keepalive catch; both are idempotent.
		 */
		cancel() {
			teardown();
		}
	});

	return { response: new Response(stream, { headers: SSE_HEADERS }), written: () => written };
}
