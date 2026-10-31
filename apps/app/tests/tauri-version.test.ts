import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// Script, not app code — `scripts/` has no `#lib` alias, so this import is relative.
import { checkCargoVersion, readCargoVersion, setCargoVersion } from '../scripts/tauri-version';

/** Guards the Cargo.toml version sync: only the [package] version moves, never a dependency's. */

const SAMPLE = [
	'[package]',
	'name = "ikoro"',
	'version = "0.1.0"',
	'edition = "2021"',
	'',
	'[build-dependencies]',
	'tauri-build = { version = "2", features = [] }',
	'',
	'[dependencies]',
	'tauri = { version = "2", features = [] }',
	'serde = { version = "1", features = ["derive"] }',
	''
].join('\n');

describe('readCargoVersion', () => {
	it('reads the [package] version', () => {
		expect(readCargoVersion(SAMPLE)).toBe('0.1.0');
	});

	it('throws with a clear message when there is no [package] version', () => {
		expect(() => readCargoVersion('[package]\nname = "ikoro"\n')).toThrow(
			/no \[package\] version found in Cargo\.toml/
		);
	});
});

describe('setCargoVersion', () => {
	it('replaces ONLY the [package] version, not dependency versions', () => {
		const out = setCargoVersion(SAMPLE, '0.3.2');
		expect(readCargoVersion(out)).toBe('0.3.2');
		expect(out).toContain('tauri-build = { version = "2", features = [] }');
		expect(out).toContain('tauri = { version = "2", features = [] }');
		expect(out).toContain('serde = { version = "1", features = ["derive"] }');
	});

	it('preserves tabs, spacing and trailing comments', () => {
		const toml = '[package]\n\tversion\t=\t"0.1.0"  # keep me\n';
		expect(setCargoVersion(toml, '0.3.2')).toBe('[package]\n\tversion\t=\t"0.3.2"  # keep me\n');
	});

	it('throws with a clear message when there is no [package] version', () => {
		expect(() => setCargoVersion('[dependencies]\ntauri = { version = "2" }\n', '0.3.2')).toThrow(
			/no \[package\] version found in Cargo\.toml/
		);
	});
});

describe('checkCargoVersion', () => {
	it('returns the version when cargo and package.json agree', () => {
		expect(checkCargoVersion(SAMPLE, '0.1.0')).toBe('0.1.0');
	});

	it('throws naming both sides when they disagree', () => {
		expect(() => checkCargoVersion(SAMPLE, '0.3.2')).toThrow(
			/Cargo\.toml 0\.1\.0 != apps\/app\/package\.json 0\.3\.2/
		);
	});
});

describe('tauri.conf.json version source', () => {
	it('has NO "version" key, so Tauri falls back to Cargo.toml', () => {
		const conf = JSON.parse(
			readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
		) as Record<string, unknown>;
		expect('version' in conf).toBe(false);
	});
});
