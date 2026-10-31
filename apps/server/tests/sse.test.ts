import { describe, expect, it, beforeEach } from 'vitest';
import {
	notify,
	notifyAll,
	formatEvent,
	keepaliveChunk,
	subscriberCount,
	subscriberCountFor,
	subscribe,
	resetSubscribers
} from '#lib/sse/hub';
import { openStream, SSE_HEADERS } from '#lib/sse/stream';

/** The SSE hub: leaked subscribers (silent OOM) and one dead stream starving the others. */

beforeEach(() => {
	resetSubscribers();
});

describe('framing', () => {
	it('emits a well-formed SSE frame', () => {
		expect(formatEvent('change', { rev: 7 })).toBe('event: change\ndata: {"rev":7}\n\n');
	});

	it('a keepalive is a comment, so a client parser ignores it', () => {
		// `event: keepalive` would make every EventSource fire a handler for it.
		expect(keepaliveChunk(123)).toMatch(/^: keepalive/);
		expect(keepaliveChunk(123).endsWith('\n\n')).toBe(true);
	});

	it('headers forbid buffering, which would defeat the whole mechanism', () => {
		expect(SSE_HEADERS['content-type']).toBe('text/event-stream');
		expect(SSE_HEADERS['cache-control']).toContain('no-cache');
		expect(SSE_HEADERS['cache-control']).toContain('no-transform');
		expect(SSE_HEADERS['x-accel-buffering']).toBe('no');
	});
});

describe('subscribe / unsubscribe', () => {
	it('tracks one subscriber', () => {
		const off = subscribe('u1', { send: () => {}, close: () => {} });
		expect(subscriberCount()).toBe(1);
		expect(subscriberCountFor('u1')).toBe(1);
		off();
		expect(subscriberCount()).toBe(0);
	});

	it('is idempotent — abort and write-failure both fire', () => {
		// Both paths run on a normal disconnect; a double-decrement would corrupt the count.
		const off = subscribe('u1', { send: () => {}, close: () => {} });
		off();
		expect(() => off()).not.toThrow();
		expect(subscriberCount()).toBe(0);
	});

	it('drops the empty Set, not just the member', () => {
		// Otherwise every signed-out user leaves a Map key behind for the whole process.
		const off = subscribe('u1', { send: () => {}, close: () => {} });
		off();
		expect(subscriberCountFor('u1')).toBe(0);
	});

	it('keeps other users untouched', () => {
		const offA = subscribe('u1', { send: () => {}, close: () => {} });
		subscribe('u2', { send: () => {}, close: () => {} });
		offA();
		expect(subscriberCountFor('u2')).toBe(1);
	});
});

describe('notify', () => {
	it('reaches only the addressed user', () => {
		const mine: string[] = [];
		const theirs: string[] = [];
		subscribe('u1', { send: (c) => mine.push(c), close: () => {} });
		subscribe('u2', { send: (c) => theirs.push(c), close: () => {} });

		expect(notify('u1', 'change', { rev: 1 })).toBe(1);
		expect(mine).toHaveLength(1);
		expect(theirs).toHaveLength(0);
	});

	it('reaches every stream one user holds', () => {
		const a: string[] = [];
		const b: string[] = [];
		// A phone that reconnects briefly holds two. Both must be notified.
		subscribe('u1', { send: (c) => a.push(c), close: () => {} });
		subscribe('u1', { send: (c) => b.push(c), close: () => {} });

		expect(notify('u1', 'change', { rev: 2 })).toBe(2);
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
	});

	it('a throwing subscriber does not stop the ones after it', () => {
		// The dead stream is in the MIDDLE: an uncaught throw would starve the third.
		const before: string[] = [];
		const after: string[] = [];

		subscribe('u1', { send: (c) => before.push(c), close: () => {} });
		subscribe('u1', {
			send: () => {
				throw new Error('stream already errored');
			},
			close: () => {}
		});
		subscribe('u1', { send: (c) => after.push(c), close: () => {} });

		expect(notify('u1', 'change', { rev: 3 })).toBe(2);
		expect(before).toHaveLength(1);
		expect(after).toHaveLength(1);
	});

	it('a subscriber that threw is dropped, so it cannot throw again', () => {
		let attempts = 0;
		subscribe('u1', {
			send: () => {
				attempts++;
				throw new Error('dead');
			},
			close: () => {}
		});

		notify('u1', 'change', { rev: 1 });
		notify('u1', 'change', { rev: 2 });
		expect(attempts).toBe(1);
		expect(subscriberCount()).toBe(0);
	});

	it('a failing close() does not escape', () => {
		subscribe('u1', {
			send: () => {
				throw new Error('dead');
			},
			close: () => {
				throw new Error('already closed');
			}
		});
		expect(() => notify('u1', 'change', { rev: 1 })).not.toThrow();
	});

	it('notifyAll reaches each user once, deduplicated', () => {
		const a: string[] = [];
		const b: string[] = [];
		subscribe('u1', { send: (c) => a.push(c), close: () => {} });
		subscribe('u2', { send: (c) => b.push(c), close: () => {} });

		expect(notifyAll(['u1', 'u2', 'u1'], 'change', { rev: 9 })).toBe(2);
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
	});

	it('notifying a user with no streams is a no-op, not an error', () => {
		expect(notify('nobody', 'change', { rev: 1 })).toBe(0);
	});
});

describe('openStream', () => {
	it('sends `hello` before it returns', () => {
		// A client that connects and immediately probes must find data. Without
		// this it waits 25 s for a keepalive and cannot tell a live stream from a
		// dead socket.
		const handle = openStream('u1');
		expect(handle.written()).toBeGreaterThan(0);

		// Reading it proves the frame was enqueued, not merely counted.
		void handle.response.body
			?.getReader()
			.read()
			.then((r) => {
				expect(new TextDecoder().decode(r.value)).toContain('event: hello');
			});
		resetSubscribers();
	});

	it('registers the stream and cleans up on cancel', async () => {
		const handle = openStream('u1');
		expect(subscriberCountFor('u1')).toBe(1);

		await handle.response.body?.cancel();
		// `cancel` is async on the stream; the registry update is synchronous
		// inside it, so this is safe to assert immediately after the await.
		expect(subscriberCountFor('u1')).toBe(0);
	});

	it('cancelling twice is harmless', async () => {
		const handle = openStream('u1');
		await handle.response.body?.cancel();
		await expect(handle.response.body?.cancel()).resolves.toBeUndefined();
		expect(subscriberCount()).toBe(0);
	});
});
