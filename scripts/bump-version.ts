#!/usr/bin/env bun
/**
 * Bump the app version and cut the release tag.
 *
 *   bun scripts/bump-version.ts 0.2.0
 *
 * The version lives in exactly one place — `apps/app/package.json` — and
 * everything downstream derives from it: the Android `versionName` and
 * `versionCode` (see `apps/app/android/app/build.gradle`), the Tauri bundle
 * version, and the tag the release workflow asserts against. That is why this
 * script edits the file in place instead of re-serialising it: a JSON
 * round-trip would reformat the whole file and bury a one-line change in
 * noise.
 *
 * It refuses to run on a dirty tree or an existing tag, because a release tag
 * that points at a commit nobody can reproduce is worse than no tag.
 */

import { $ } from 'bun';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG_PATH = join(import.meta.dir, '..', 'apps', 'app', 'package.json');

function fail(message: string): never {
	console.error(`bump-version: ${message}`);
	process.exit(1);
}

const arg = process.argv[2];
if (!arg) {
	fail('usage: bun scripts/bump-version.ts <major.minor.patch>');
}

if (!/^\d+\.\d+\.\d+$/.test(arg)) {
	fail(`"${arg}" is not a semver version (expected major.minor.patch, e.g. 0.2.0)`);
}

const tag = `v${arg}`;

if (!existsSync(PKG_PATH)) {
	fail(`cannot find ${PKG_PATH}`);
}

// A dirty tree means the tag would capture work that is not in the commit.
const status = await $`git status --porcelain`.text();
if (status.trim() !== '') {
	fail('working tree is dirty — commit or stash your changes first');
}

// An existing tag means the release already happened.
const tagCheck = await $`git rev-parse --verify --quiet refs/tags/${tag}`.nothrow();
if (tagCheck.exitCode === 0) {
	fail(`tag ${tag} already exists`);
}

const source = readFileSync(PKG_PATH, 'utf8');
const versionLine = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
const match = source.match(versionLine);
if (!match) {
	fail(`no "version" field found in ${PKG_PATH}`);
}

const previous = match[2];
const updated = source.replace(versionLine, `$1${arg}$3`);
writeFileSync(PKG_PATH, updated);

console.log(`bump-version: ${previous} -> ${arg}`);

await $`git add apps/app/package.json`;
await $`git commit -m ${`chore: bump version to ${tag}`}`;
await $`git tag ${tag}`;

console.log(`bump-version: committed and tagged ${tag}`);
console.log('bump-version: next step — git push && git push --tags');
