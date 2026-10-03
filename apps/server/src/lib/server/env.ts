/**
 * Every environment read in this app goes through here, and every one of them is
 * LAZY.
 *
 * Not a style preference. `vite build` evaluates the module graph to produce a
 * production bundle, and `drizzle.config.ts` is imported by tooling at times
 * when no `.env` exists at all. A top-level `const url = process.env.DATABASE_URL`
 * followed by `neon(url)` makes the *build* fail on a machine that has never
 * been configured — a failure that has nothing to do with the code being built.
 *
 * Nothing here reads `process.env` at module scope. The error, when a value is
 * genuinely missing, is raised at the moment the value is needed and it names
 * the variable, because "DATABASE_URL is not set" is actionable and
 * "TypeError: undefined is not a string" is not.
 */

/** Placeholders a `.env.example` copy-paste leaves behind. None are a real value. */
const PLACEHOLDERS = new Set(['', '<user>', '<password>', '<host>', '<db>']);

function read(name: string): string | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (PLACEHOLDERS.has(trimmed)) return undefined;
	// A half-edited connection string (`postgresql://<host>/db`) still contains an
	// angle bracket. Catching it here turns a confusing driver error at query time
	// into a clear "you forgot to fill this in" at startup.
	if (trimmed.includes('<')) return undefined;
	return trimmed;
}

/**
 * Read a variable or throw a message that names it.
 *
 * `hint` is appended verbatim, so keep it actionable — the copy-paste command,
 * the file to edit, the reason the value is needed.
 */
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
