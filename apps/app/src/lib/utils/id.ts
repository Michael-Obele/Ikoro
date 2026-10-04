/**
 * FNV-1a, truncated to a **signed** 32-bit positive integer.
 *
 * Android's notification ids and Linux systemd's timer unit names both need a
 * short, stable, collision-resistant integer derived from a UUID. Re-arming an
 * alarm must land on the SAME id, otherwise every reschedule would leave a
 * duplicate notification behind — which is exactly the "reminder fires twice"
 * failure the product cannot have.
 *
 * ## Why the mask is load-bearing (found on a real device, 2026-10-04)
 *
 * FNV-1a produces an UNSIGNED 32-bit value, up to 4 294 967 295. Android's
 * notification id is a signed 32-bit int, and the Capacitor native layer
 * rejects anything larger with:
 *
 *     Error: The identifier must be a 32 bit integer.
 *
 * `>>> 0` only makes the number non-negative as a JS number; it does not make it
 * fit in an `int32`. Measured over 20 000 realistic task ids, **51.2 %** came out
 * above 2 147 483 647 — so roughly one alarm in two would have failed to
 * schedule, and the device spike hit one on its very first attempt. Mocked
 * unit tests could never have seen this; it took a real Pixel.
 *
 * Clearing the sign bit costs one bit of hash space (2³¹ rather than 2³²),
 * which doubles the collision probability and is still negligible at the scale
 * this app works at — and a collision can only mean two tasks share a
 * notification id, never data loss.
 */
export function hashId(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		// 32-bit FNV prime multiply, done in halves so the product never
		// loses precision as a JS double.
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	// `& 0x7fffffff` clears the sign bit: the result always fits a signed int32,
	// which is what Android's notification id actually is.
	return hash & 0x7fffffff;
}

/** `crypto.randomUUID()` — the only id source in the app. */
export function newId(): string {
	return crypto.randomUUID();
}

/** The current instant as ISO 8601 UTC. Every timestamp in the database uses this. */
export function nowIso(): string {
	return new Date().toISOString();
}
