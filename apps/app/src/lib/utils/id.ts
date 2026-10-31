/**
 * FNV-1a truncated to a signed 32-bit int — Android's notification ids are signed int32, and
 * 51% of raw FNV values are too large (found on a device, 2026-10-04). Re-arming must land
 * on the same id, or every reschedule leaves a duplicate.
 */
export function hashId(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		// 32-bit FNV prime multiply, in halves so the product stays exact.
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	// `& 0x7fffffff` clears the sign bit so it fits a signed int32.
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
