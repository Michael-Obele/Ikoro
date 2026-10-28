/**
 * The version tool. One file, two verbs:
 *
 *   bun scripts/version.ts auto      # bump from the commits since the last tag
 *   bun scripts/version.ts minor     # or say the level: major|minor|patch
 *   bun scripts/version.ts 0.4.0     # or say the number
 *   bun scripts/version.ts check     # the release guard — CI runs this on the tag
 *
 * THE RULE: one commit is one patch. A `feat:` is a minor; a `!` after the
 * type/scope or a `BREAKING CHANGE:` footer is a major; every other
 * conventional type (`fix`, `perf`, `refactor`, `docs`, `chore`, `ci`, `build`,
 * `test`, `style`, `revert`) is a patch.
 *
 * `check` fails when the tag's bump is smaller than its own commits claim — and
 * when a commit since the previous tag does not parse. The second matters as
 * much as the first: an unparseable message claims no level, so it is invisible
 * to the arithmetic and a feature hiding in one would ship as a patch. A bigger
 * bump is always allowed; only a smaller one is refused, because a version that
 * has reached a store listing can never be taken back.
 *
 * Why not semantic-release or commit-and-tag-version: both exist to also write
 * a CHANGELOG and publish a package. Here the release is a tag that triggers an
 * Android build, so the only thing to decide is the number — `git log` plus a
 * regex answers that, and a dependency chain plus a config file is a supply
 * chain bought for a version number.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** `apps/app`, wherever the command was run from. */
const APP = new URL('..', import.meta.url).pathname;
const PKG = resolve(APP, 'package.json');

const POLICY =
	'patch = any other conventional type · minor = feat: · major = type!: / type(scope)!: / a BREAKING CHANGE: footer';

/** Ordered, so "bigger" is a larger index. */
export const LEVELS = ['patch', 'minor', 'major'] as const;
export type Level = (typeof LEVELS)[number];

export interface Commit {
	type: string;
	scope: string | null;
	breaking: boolean;
	description: string;
}

/** `<type>(<scope>)!<: ><description>` — spec rules 1, 4, 5 and 13. */
const HEADER =
	/^(?<type>[a-zA-Z][a-zA-Z0-9-]*)(?:\((?<scope>[^()\r\n]+)\))?(?<bang>!)?: (?<description>\S.*)$/;

/** Rules 12/16: uppercase, `BREAKING-CHANGE` is a synonym, and it is a footer. */
const BREAKING = /(?:^|\n)BREAKING[ -]CHANGE:/;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** `null` when the message is not Conventional Commits at all. */
export function parse(message: string): Commit | null {
	const [header = ''] = message.trim().split('\n');
	const match = HEADER.exec(header);
	if (!match?.groups) return null;
	const { type, scope, bang, description } = match.groups as {
		type: string;
		scope?: string;
		bang?: string;
		description: string;
	};
	return {
		type: type.toLowerCase(),
		scope: scope?.trim() ?? null,
		// The footer is checked against the whole message: `feat!:` may omit it,
		// but a `fix:` carrying one is still a major.
		breaking: Boolean(bang) || BREAKING.test(message),
		description
	};
}

export function levelFor(commit: Commit): Level {
	if (commit.breaking) return 'major';
	return commit.type === 'feat' ? 'minor' : 'patch';
}

/** The largest claim in the list, or `null` when there are no commits at all. */
export function requiredLevel(commits: readonly Commit[]): Level | null {
	if (commits.length === 0) return null;
	return commits.map(levelFor).reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a));
}

export function bump(version: string, level: Level): string {
	const [major, minor, patch] = parseSemver(version);
	if (level === 'major') return `${major + 1}.0.0`;
	if (level === 'minor') return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

/** The level going from `from` to `to`; null when `to` is not ahead of `from`. */
export function levelBetween(from: string, to: string): Level | null {
	const [a1, a2, a3] = parseSemver(from);
	const [b1, b2, b3] = parseSemver(to);
	if (b1 !== a1) return b1 > a1 ? 'major' : null;
	if (b2 !== a2) return b2 > a2 ? 'minor' : null;
	if (b3 !== a3) return b3 > a3 ? 'patch' : null;
	return null;
}

function parseSemver(version: string): [number, number, number] {
	const match = SEMVER.exec(version.trim());
	if (!match) throw new Error(`not a semver: "${version}" (want MAJOR.MINOR.PATCH)`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// ------------------------------------------------------------------------ git

function git(args: string[]): string {
	return execFileSync('git', args, { cwd: APP, encoding: 'utf8' });
}

/**
 * Release tags reachable from HEAD, newest first. `--sort=-v:refname` is git's
 * version sort — plain text sort puts v0.9.0 above v0.10.0 and would quietly
 * pick the wrong "previous" tag once the minor reaches ten.
 */
function releaseTags(): string[] {
	return git(['tag', '--list', 'v*', '--merged', 'HEAD', '--sort=-v:refname'])
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function tagAtHead(): string | null {
	try {
		return execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
			cwd: APP,
			encoding: 'utf8',
			// "no tag exactly matches" is the expected answer half the time.
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	} catch {
		return null;
	}
}

/** Commits in `range`, parsed. `%B` + a record separator keeps bodies intact. */
function readCommits(range: string) {
	const all = git(['log', '--format=%B%x1e', range])
		.split('\x1e')
		.map((message) => message.trim())
		.filter(Boolean)
		// A merge commit records topology, not intent — it claims nothing.
		.filter((message) => !message.startsWith('Merge '));

	const commits: Commit[] = [];
	const unreadable: string[] = [];
	for (const message of all) {
		const commit = parse(message);
		if (commit) commits.push(commit);
		else unreadable.push(message.split('\n')[0]);
	}
	return { total: all.length, commits, unreadable };
}

function label(commit: Commit): string {
	const scope = commit.scope ? `(${commit.scope})` : '';
	return `${commit.type}${scope}${commit.breaking ? '!' : ''}`;
}

// ---------------------------------------------------------------------- verbs

function fail(lines: string[]): never {
	console.error(['', ...lines, '', `policy: ${POLICY}`, 'see RELEASE.md, "Which bump does my commit need?"'].join('\n'));
	process.exit(1);
}

async function readPackage(): Promise<{ version: string }> {
	return JSON.parse(await readFile(PKG, 'utf8')) as { version: string };
}

async function bumpVerb(arg: string): Promise<void> {
	const pkg = await readPackage();
	const current = pkg.version;
	const isExact = SEMVER.test(arg);

	let level: Level = 'patch';
	if (isExact) {
		// Stated outright — nothing to derive, nothing to argue with.
	} else if (arg === 'auto') {
		const [last] = releaseTags();
		const { total, commits, unreadable } = readCommits(last ? `${last}..HEAD` : 'HEAD');
		if (total === 0) fail([`✗ no commits since ${last ?? 'the first commit'} — nothing to release`]);

		// Print the evidence first: a number derived from a commit list the
		// author cannot see is a number nobody can argue with.
		console.log(`commits since ${last ?? 'the first commit'}: ${total}`);
		for (const commit of commits) {
			console.log(`  ${levelFor(commit).padEnd(5)}  ${label(commit)}: ${commit.description}`);
		}
		if (unreadable.length > 0) {
			console.warn('\nnot Conventional Commits, counted as a patch — fix before releasing:');
			for (const subject of unreadable) console.warn(`  ${subject}`);
		}
		level = requiredLevel(commits) ?? 'patch';
	} else {
		if (!LEVELS.includes(arg as Level)) {
			fail([`✗ unknown bump "${arg}" — want major|minor|patch|auto or an exact x.y.z`]);
		}
		level = arg as Level;
	}

	const next = isExact ? arg : bump(current, level);
	if (next === current) {
		console.log(`already at ${current} — nothing to do`);
		return;
	}

	const [major, minor, patch] = parseSemver(next);
	if (minor > 99 || patch > 99) {
		console.warn(
			`⚠ ${next}: minor/patch above 99 collides in the versionCode formula ` +
				`(major*10000 + minor*100 + patch). Consider bumping the major instead.`
		);
	}

	pkg.version = next;
	await writeFile(PKG, JSON.stringify(pkg, null, '\t') + '\n');

	console.log(`${current} -> ${next}  (android versionCode ${major * 10000 + minor * 100 + patch})`);
	console.log('\nnext steps:');
	console.log('  git add apps/app/package.json');
	console.log(`  git commit -m "chore(release): v${next}"`);
	console.log(`  git tag v${next}`);
	console.log('  git push origin master --tags   # the tag push triggers the release build');
}

async function checkVerb(): Promise<void> {
	const tag = process.env.GITHUB_REF_NAME?.trim() || tagAtHead();
	if (!tag) {
		fail([
			'✗ HEAD is not tagged and GITHUB_REF_NAME is not set.',
			'  This checks a release, so it needs the tag: git tag vX.Y.Z, then re-run.'
		]);
	}

	const { version } = await readPackage();
	const tagVersion = tag.replace(/^v/, '');
	if (tagVersion !== version) {
		fail([
			`✗ tag ${tag} != apps/app/package.json ${version}.`,
			'  A release whose release page and package manager disagree about the',
			'  version is worse than no release. Re-run:',
			'    bun apps/app/scripts/version.ts auto'
		]);
	}

	const tags = releaseTags();
	const index = tags.indexOf(tag);
	if (index === -1) {
		fail([
			`✗ ${tag} is not a reachable release tag.`,
			'  In CI that means a shallow checkout — the workflow sets fetch-depth: 0.'
		]);
	}

	const previous = tags[index + 1];
	if (!previous) {
		console.log(`first release (${tag}) — nothing to compare`);
		return;
	}

	const actual = levelBetween(previous.replace(/^v/, ''), version);
	if (!actual) fail([`✗ ${previous} -> ${tag} does not move the version forward.`]);

	const { total, commits, unreadable } = readCommits(`${previous}..HEAD`);
	if (total === 0) fail([`✗ no commits between ${previous} and ${tag}.`]);

	if (unreadable.length > 0) {
		fail([
			`✗ ${unreadable.length} of ${total} commits since ${previous} are not Conventional Commits:`,
			...unreadable.map((subject) => `    ${subject}`),
			'',
			'  An unparseable message claims no level, so it is invisible to this check',
			'  — a feature hiding in one would ship as a patch. Reword it (git rebase -i)',
			'  before tagging, or split it out of this release.'
		]);
	}

	const required = requiredLevel(commits) ?? 'patch';
	if (LEVELS.indexOf(actual) < LEVELS.indexOf(required)) {
		const cause = commits.filter((commit) =>
			required === 'major'
				? commit.breaking
				: required === 'minor' && !commit.breaking && commit.type === 'feat'
		);
		fail([
			`✗ ${previous} -> ${tag} is a ${actual}, but the commits since ${previous} claim a ${required}.`,
			...cause.map((commit) => `    ${label(commit)}: ${commit.description}`),
			'',
			`  Bump at least a ${required}: bun apps/app/scripts/version.ts ${required}`,
			'  then commit, re-tag, and push. A bigger bump is always allowed; only a',
			'  smaller one is refused.'
		]);
	}

	console.log(
		`${previous} -> ${tag}: ${actual}, history claims ${required} — ok (${total} commits)`
	);
}

// Only the CLI runs the verbs; vitest imports the rules above.
const invokedDirectly = process.argv[1]?.endsWith('version.ts') ?? false;

if (invokedDirectly) {
	const arg = process.argv[2];
	if (!arg) {
		console.error('usage: bun apps/app/scripts/version.ts <auto|major|minor|patch|x.y.z|check>');
		console.error(`       ${POLICY}`);
		process.exit(1);
	}
	await (arg === 'check' ? checkVerb() : bumpVerb(arg));
}
