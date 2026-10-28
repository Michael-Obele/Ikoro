/**
 * The version guard. The release workflow runs it on the tag and refuses a
 * release whose own commit history does not justify it.
 *
 *   bun apps/app/scripts/version.ts check
 *
 * WHO OWNS THE NUMBER: release-please. It reads the commits, keeps a release PR
 * open, and cuts the tag when that PR is merged — see `release-please-config.json`
 * and `.github/workflows/release-please.yml`. So this file decides nothing and
 * bumps nothing. It only checks, which is the one thing release-please cannot do
 * for us: a message it cannot parse is silently dropped from the bump and the
 * changelog, with no failure anywhere.
 *
 * THE RULE — and the reason for both flags in `release-please-config.json`:
 *
 * | commit                                                 | bump  |
 * | ------------------------------------------------------ | ----- |
 * | anything conventional — `feat:` included                | patch |
 * | `type!:` / `type(scope)!:` / a BREAKING CHANGE: footer  | minor |
 * |                                                        | no major before 1.0.0 |
 *
 * `bump-patch-for-minor-pre-major` is what makes a `feat:` a patch: before
 * 1.0.0, a new capability is not yet a promise. `bump-minor-pre-major` is what
 * makes a breaking change a minor instead of a major. Both are set, so the
 * arithmetic here and the arithmetic in release-please agree — and if they ever
 * disagree, this check fails the build instead of shipping a number the store
 * cannot take back.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** `apps/app`, wherever the command was run from. */
const APP = new URL('..', import.meta.url).pathname;
const PKG = resolve(APP, 'package.json');

const POLICY =
	'every commit is a patch · a `!` (or a BREAKING CHANGE: footer) is a minor · no major until 1.0.0';

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
		// but a `fix:` carrying one is still a minor.
		breaking: Boolean(bang) || BREAKING.test(message),
		description
	};
}

/** Every commit is a patch; only a breaking marker earns a minor. */
export function levelFor(commit: Commit): Level {
	return commit.breaking ? 'minor' : 'patch';
}

/** The largest claim in the list, or `null` when there are no commits at all. */
export function requiredLevel(commits: readonly Commit[]): Level | null {
	if (commits.length === 0) return null;
	return commits.map(levelFor).reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a));
}

/** Android's versionCode — the number Play actually orders uploads by. */
export function versionCode(version: string): number {
	const [major, minor, patch] = parseSemver(version);
	return major * 10000 + minor * 100 + patch;
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

// ------------------------------------------------------------------------ CLI

function fail(lines: string[]): never {
	console.error(
		['', ...lines, '', `policy: ${POLICY}`, 'see RELEASE.md, "Which bump does my commit need?"'].join(
			'\n'
		)
	);
	process.exit(1);
}

async function check(): Promise<void> {
	const tag = process.env.GITHUB_REF_NAME?.trim() || tagAtHead();
	if (!tag) {
		fail([
			'✗ HEAD is not tagged and GITHUB_REF_NAME is not set.',
			'  This checks a release, so it needs the tag: git tag vX.Y.Z, then re-run.'
		]);
	}

	const { version } = JSON.parse(await readFile(PKG, 'utf8')) as { version: string };
	const tagVersion = tag.replace(/^v/, '');
	if (tagVersion !== version) {
		fail([
			`✗ tag ${tag} != apps/app/package.json ${version}.`,
			'  release-please writes both together, so a mismatch means one was',
			'  edited by hand. Let the next release PR set it.'
		]);
	}

	// Play orders uploads by versionCode, so a collision is a release that can
	// never be published: 0.3.100 and 0.4.0 both come out as 400.
	const [, minor, patch] = parseSemver(version);
	if (minor > 99 || patch > 99) {
		fail([
			`✗ ${version}: minor/patch above 99 collides in the versionCode formula`,
			`  major*10000 + minor*100 + patch == ${versionCode(version)}.`,
			'  Let the next minor through: add a `feat!:` commit and merge that release PR.'
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
			'  release-please ignores a message it cannot parse, so such a commit would',
			'  miss the bump and the changelog without failing anything. Reword it first.'
		]);
	}

	const required = requiredLevel(commits) ?? 'patch';
	if (LEVELS.indexOf(actual) < LEVELS.indexOf(required)) {
		const cause = commits.filter((commit) => commit.breaking && required === 'minor');
		fail([
			`✗ ${previous} -> ${tag} is a ${actual}, but the commits since ${previous} claim a ${required}.`,
			...cause.map((commit) => `    ${label(commit)}: ${commit.description}`),
			'',
			'  A `!` commit is a minor (bump-minor-pre-major). Confirm',
			'  release-please-config.json still sets both pre-major flags.'
		]);
	}

	console.log(
		`${previous} -> ${tag}: ${actual}, history claims ${required} — ok ` +
			`(${total} commits, versionName ${version}, versionCode ${versionCode(version)})`
	);
}

// Only the CLI runs the check; vitest imports the rules above.
const invokedDirectly = process.argv[1]?.endsWith('version.ts') ?? false;

if (invokedDirectly) {
	if (process.argv[2] !== 'check') {
		console.error('usage: bun apps/app/scripts/version.ts check');
		console.error(`       ${POLICY}`);
		process.exit(1);
	}
	await check();
}
