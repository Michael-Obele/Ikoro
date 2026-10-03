/**
 * FNV-1a, 32-bit, forced positive.
 *
 * Android's notification ids and Linux systemd's timer unit names both need a
 * short, stable, collision-resistant integer derived from a UUID. Re-arming an
 * alarm must land on the SAME id, otherwise every reschedule would leave a
 * duplicate notification behind — which is exactly the "reminder fires twice"
 * failure the product cannot have.
 *
 * M6's Rust scheduler computes this identical function from the identical input;
 * if one side ever changes, both must change together.
 */
export function hashId(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		// 32-bit FNV prime multiply, done in halves so the product never
		// loses precision as a JS double.
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	return hash >>> 0;
}

/** `crypto.randomUUID()` — the only id source in the app. */
export function newId(): string {
	return crypto.randomUUID();
}

/** The current instant as ISO 8601 UTC. Every timestamp in the database uses this. */
export function nowIso(): string {
	return new Date().toISOString();
}
