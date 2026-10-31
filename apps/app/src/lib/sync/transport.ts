/**
 * The real `/api/v1` transport -- the only module that talks to the sync server, so everything above is testable with a fake.
 *
 * Auth is per-request, never cached, so a sign-out cannot leave a stale token in memory.
 */

import { WIRE_VERSION, type ChangeOp, type ChangeRow } from '@ikoro/sync';
import type { SyncTransport } from './client';

let token: string | null = null;

/** Called by the auth flow. `null` signs out. */
export function setSyncToken(next: string | null): void {
	token = next;
}

export function hasSyncToken(): boolean {
	return token !== null;
}

async function authHeaders(): Promise<Record<string, string>> {
	return {
		'content-type': 'application/json',
		...(token ? { authorization: `Bearer ${token}` } : {})
	};
}

/** A response the user can be shown. */
export class SyncRequestError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'SyncRequestError';
		this.status = status;
	}
}

async function readError(response: Response): Promise<never> {
	let detail = response.statusText;
	try {
		const body = (await response.json()) as { message?: string; error?: string };
		detail = body.message ?? body.error ?? detail;
	} catch {
		// A non-JSON error body is not worth a second failure.
	}
	throw new SyncRequestError(detail || `Request failed (${response.status})`, response.status);
}

export function createHttpTransport(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch
): SyncTransport {
	const root = baseUrl.replace(/\/+$/, '');

	return {
		async push(ops: ChangeOp[]) {
			const response = await fetchImpl(`${root}/api/v1/changes`, {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ wireVersion: WIRE_VERSION, ops })
			});
			if (!response.ok) await readError(response);
			return (await response.json()) as {
				accepted: { opId: string; entityId: string; rev: number }[];
				rejected: { opId: string; reason: string }[];
				nextRev: number;
			};
		},

		async pull(since: number) {
			const response = await fetchImpl(`${root}/api/v1/stream?since=${since}`, {
				headers: await authHeaders()
			});
			if (!response.ok) await readError(response);
			return (await response.json()) as {
				changes: ChangeRow[];
				nextRev: number;
				hasMore?: boolean;
			};
		},

		subscribe(onEvent: () => void) {
			// EventSource cannot send an Authorization header, so the stream is read via fetch.
			const controller = new AbortController();
			let stopped = false;

			void (async () => {
				while (!stopped) {
					try {
						const response = await fetchImpl(`${root}/api/v1/events`, {
							headers: await authHeaders(),
							signal: controller.signal
						});
						if (!response.ok || !response.body) throw new Error(String(response.status));

						const reader = response.body.getReader();
						for (;;) {
							const { done, value } = await reader.read();
							if (done) break;
							// Any bytes mean something changed; the pull does the work.
							if (value?.byteLength) onEvent();
						}
					} catch {
						if (stopped) return;
					}
					// Reconnect on our own; a dropped stream must not need an app restart.
					await new Promise((resolve) => setTimeout(resolve, 5_000));
				}
			})();

			return () => {
				stopped = true;
				controller.abort();
			};
		}
	};
}
