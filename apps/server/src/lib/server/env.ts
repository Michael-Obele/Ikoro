/**
 * Every environment read in this app goes through here, and every one is LAZY.
 *
 * A top-level `process.env` read makes `vite build` fail on an unconfigured machine.
 */

/** Placeholders a `.env.example` copy-paste leaves behind. None are a real value. */
const PLACEHOLDERS = new Set(['', '<user>', '<password>', '<host>', '<db>']);

function read(name: string): string | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (PLACEHOLDERS.has(trimmed)) return undefined;
	// A half-edited connection string still has an angle bracket — treat it as unset.
	if (trimmed.includes('<')) return undefined;
	return trimmed;
}

/** Read a variable or throw a message that names it. `hint` is appended verbatim. */
export function requireEnv(name: string, hint?: string): string {
	const value = read(name);
	if (value !== undefined) return value;
	throw new Error(
		`${name} is not set (or is still an unfilled placeholder).${hint ? ` ${hint}` : ''}`
	);
}

/** Read a variable, or `undefined` if it is absent/unset/placeholder. */
export function optionalEnv(name: string): string | undefined {
	return read(name);
}

/** Split a comma-separated variable, dropping blanks. */
export function envList(name: string): string[] {
	const raw = read(name);
	if (raw === undefined) return [];
	return raw
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/** Read an integer variable, clamped to `[min, max]`, or `fallback`. */
export function envInt(name: string, fallback: number, min: number, max: number): number {
	const raw = read(name);
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}
