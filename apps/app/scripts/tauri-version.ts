/**
 * Copies the app version into `src-tauri/Cargo.toml`; release-please owns the number.
 * Usage: `bun apps/app/scripts/tauri-version.ts <sync|check>`
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

/** Reads the [package] version; the thrown message is what the release log shows. */
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

/** Rewrite only the [package] `version` line, keeping spacing and any trailing comment. */
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

/** Returns the cargo version when it matches `pkgVersion`, else throws. */
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
