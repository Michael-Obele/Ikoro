/**
 * The desktop version sync. The release workflow runs it before building so
 * the Tauri bundles never ship a stale version.
 *
 *   bun apps/app/scripts/tauri-version.ts sync    # copy package.json -> Cargo.toml
 *   bun apps/app/scripts/tauri-version.ts check   # fail when they disagree
 *
 * WHO OWNS THE NUMBER: release-please. It only touches apps/app/package.json
 * (see release-please-config.json). Cargo.toml is the single Rust-side source
 * — tauri.conf.json deliberately has NO "version" key so Tauri falls back to
 * it — but nothing keeps it in sync except this script, run by
 * .github/workflows/release-desktop.yml. So this file decides nothing and
 * bumps nothing. It only copies and checks.
 *
 * WHY Cargo.lock IS NEVER TOUCHED: cargo rewrites the lock's own `ikoro`
 * entry from Cargo.toml on the next build, and a hand-edited lock risks a
 * checksum mismatch that fails the build. Leave it alone; `tauri build`
 * regenerates it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** `apps/app`, wherever the command was run from. */
const APP = new URL('..', import.meta.url).pathname;
const PKG = resolve(APP, 'package.json');
const CARGO = resolve(APP, 'src-tauri/Cargo.toml');

/** A bare `version = "x.y.z"` line, capturing the prefix (with quote) and suffix. */
const VERSION_LINE = /^([ \t]*version[ \t]*=[ \t]*")([^"]*)("[ \t]*(?:#.*)?)$/;
/** A `[section]` header, so only the `[package]` version is ever touched. */
const SECTION = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/;

const NO_VERSION = 'no [package] version found in Cargo.toml';

/** The section a line belongs to, walking headers top to bottom. */
function sectionAt(lines: string[], index: number): string | null {
	let section: string | null = null;
	for (let i = 0; i <= index; i++) {
		const header = SECTION.exec(lines[i]);
		if (header) section = header[1].trim();
	}
	return section;
}

/**
 * Read the [package] version from Cargo.toml text. Throws when there is none —
 * the message is what the release log shows, so it says where it looked.
 */
export function readCargoVersion(toml: string): string {
	const lines = toml.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (SECTION.exec(lines[i])) continue;
		if (sectionAt(lines, i) !== 'package') continue;
		const match = VERSION_LINE.exec(lines[i]);
		if (match) return match[2];
	}
	throw new Error(NO_VERSION);
}

/**
 * Rewrite ONLY the [package] `version = "..."` line to `version`, preserving
 * the line's tabs/spacing and any trailing comment. Dependency versions such
 * as `tauri = { version = "2", ... }` sit under [dependencies] / [build-...],
 * so the section check skips them — and the anchored `version` key never
 * matches a `tauri = ...` line anyway. Throws when there is no [package]
 * version to replace.
 */
export function setCargoVersion(toml: string, version: string): string {
	const lines = toml.split('\n');
	let replaced = false;
	const out = lines.map((line, i) => {
		if (replaced) return line;
		if (SECTION.exec(line)) return line;
		if (sectionAt(lines, i) !== 'package') return line;
		const match = VERSION_LINE.exec(line);
		if (!match) return line;
		replaced = true;
		return `${match[1]}${version}${match[3]}`;
	});
	if (!replaced) throw new Error(NO_VERSION);
	return out.join('\n');
}

/**
 * Pure check-style comparison: returns the cargo version when it matches
 * `pkgVersion`, throws with the release-log message when it does not. The CLI
 * `check` mode is a thin wrapper around this, so tests cover the same path.
 */
export function checkCargoVersion(toml: string, pkgVersion: string): string {
	const cargoVersion = readCargoVersion(toml);
	if (cargoVersion !== pkgVersion.trim()) {
		throw new Error(
			`Cargo.toml ${cargoVersion} != apps/app/package.json ${pkgVersion}. ` +
				`Run \`bun apps/app/scripts/tauri-version.ts sync\` (CI does this before building).`
		);
	}
	return cargoVersion;
}

function fail(lines: string[]): never {
	console.error(['', ...lines, ''].join('\n'));
	process.exit(1);
}

async function sync(): Promise<void> {
	const { version } = JSON.parse(await readFile(PKG, 'utf8')) as { version: string };
	const toml = await readFile(CARGO, 'utf8');
	let next: string;
	try {
		next = setCargoVersion(toml, version);
	} catch (error) {
		fail([`✗ ${(error as Error).message}`]);
	}
	if (next === toml) {
		console.log(`Cargo.toml ${version} already matches apps/app/package.json — ok`);
		return;
	}
	await writeFile(CARGO, next, 'utf8');
	console.log(`synced src-tauri/Cargo.toml to ${version} (from apps/app/package.json)`);
}

async function check(): Promise<void> {
	const { version } = JSON.parse(await readFile(PKG, 'utf8')) as { version: string };
	const toml = await readFile(CARGO, 'utf8');
	try {
		const cargoVersion = checkCargoVersion(toml, version);
		console.log(`Cargo.toml ${cargoVersion} == apps/app/package.json ${version} — ok`);
	} catch (error) {
		fail([`✗ ${(error as Error).message}`]);
	}
}

// Only the CLI runs sync/check; vitest imports the pure helpers above.
const invokedDirectly = process.argv[1]?.endsWith('tauri-version.ts') ?? false;

if (invokedDirectly) {
	if (process.argv[2] === 'sync') {
		await sync();
	} else if (process.argv[2] === 'check') {
		await check();
	} else {
		console.error('usage: bun apps/app/scripts/tauri-version.ts <sync|check>');
		process.exit(1);
	}
}
