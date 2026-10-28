/**
 * Bumps the app version and keeps every consumer of it in step.
 *
 * `apps/app/package.json`'s `version` is the single source of truth: the
 * Android `versionName`/`versionCode` are derived from it in
 * `android/app/build.gradle`, the Settings screen displays it, and the release
 * workflow (.github/workflows/release-android.yml) refuses to build a tag that
 * disagrees with it. So a release is: bump here, commit, tag `v<version>`,
 * push the tag. This script does the bump and prints the exact tag command —
 * it never commits or tags for you, because a release tag is a deliberate act.
 *
 *   bun scripts/bump-version.ts 0.3.0        # set an exact version
 *   bun scripts/bump-version.ts patch        # 0.2.0 -> 0.2.1
 *   bun scripts/bump-version.ts minor        # 0.2.0 -> 0.3.0
 *   bun scripts/bump-version.ts major        # 0.2.0 -> 1.0.0
 *
 * The versionCode derivation (major*10000 + minor*100 + patch) caps each
 * component at two digits, so 0.10.0 is fine (1000) but 0.0.100 collides with
 * 0.1.0 (both 100). The script warns if you cross that, because a colliding
 * versionCode means the Play Store / package manager can't tell two builds
 * apart.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PKG = resolve(import.meta.dir, '..', 'package.json');

type Semver = [number, number, number];

function parse(v: string): Semver {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
	if (!m) throw new Error(`not a semver: "${v}" (want MAJOR.MINOR.PATCH)`);
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bump([maj, min, pat]: Semver, kind: string): Semver {
	if (kind === 'major') return [maj + 1, 0, 0];
	if (kind === 'minor') return [maj, min + 1, 0];
	if (kind === 'patch') return [maj, min, pat + 1];
	throw new Error(`unknown bump "${kind}" (want major|minor|patch or an exact x.y.z)`);
}

const arg = process.argv[2];
if (!arg) {
	console.error('usage: bun scripts/bump-version.ts <major|minor|patch|x.y.z>');
	process.exit(1);
}

const pkg = JSON.parse(await readFile(PKG, 'utf8'));
const current: string = pkg.version;
const next: Semver = /^\d+\.\d+\.\d+$/.test(arg)
	? parse(arg)
	: bump(parse(current), arg);
const nextStr = next.join('.');

if (nextStr === current) {
	console.log(`already at ${current} — nothing to do`);
	process.exit(0);
}

// The versionCode formula caps minor/patch at two digits; warn on overflow.
const [, minor, patch] = next;
if (minor > 99 || patch > 99) {
	console.warn(
		`⚠ ${nextStr}: minor/patch above 99 collides in the versionCode formula ` +
			`(major*10000 + minor*100 + patch). Consider bumping the major instead.`
	);
}

pkg.version = nextStr;
await writeFile(PKG, JSON.stringify(pkg, null, '\t') + '\n');

const versionCode = next[0] * 10000 + next[1] * 100 + next[2];
console.log(`${current} -> ${nextStr}  (android versionCode ${versionCode})`);
console.log('');
console.log('next steps:');
console.log(`  git add apps/app/package.json`);
console.log(`  git commit -m "chore(release): v${nextStr}"`);
console.log(`  git tag v${nextStr}`);
console.log(`  git push origin master --tags   # the tag push triggers the release build`);
