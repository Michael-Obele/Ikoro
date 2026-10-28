import { describe, expect, it } from 'vitest';
// A script, not app code — there is no `#lib` alias for `scripts/`, so this is
// the one relative import in the suite.
import {
	levelBetween,
	levelFor,
	LEVELS,
	parse,
	requiredLevel,
	versionCode
} from '../scripts/version';

/**
 * Pure logic — the commit-to-version policy — so this stays on the default
 * `node` environment. Importing `scripts/version` also proves the CLI stays
 * behind its "invoked directly" guard: if it did not, this file would try to
 * read the git range on import.
 *
 * The bug class this exists to stop: our arithmetic disagreeing with
 * release-please's. The config sets `bump-patch-for-minor-pre-major` (a `feat:`
 * is a patch) and `bump-minor-pre-major` (a `!` is a minor), so a `feat:` that
 * quietly became a minor here would fail releases that release-please computed
 * correctly — and a `!` that quietly became a patch would ship an under-bump
 * nobody can undo.
 */

describe('parse', () => {
	it('reads type, scope and description', () => {
		expect(parse('feat(tasks): subtasks (one level deep)')).toEqual({
			type: 'feat',
			scope: 'tasks',
			breaking: false,
			description: 'subtasks (one level deep)'
		});
	});

	it('has no scope when there is no parenthesis', () => {
		expect(parse('fix: the alarm fired twice')?.scope).toBeNull();
	});

	it('rejects a header that is not conventional', () => {
		expect(parse('updated stuff')).toBeNull();
		expect(parse('feat subtasks')).toBeNull();
		// The colon must be followed by a space (spec rule 1).
		expect(parse('feat:subtasks')).toBeNull();
	});

	it('rejects an empty description', () => {
		expect(parse('feat:')).toBeNull();
		expect(parse('chore:   ')).toBeNull();
	});

	it('treats a `!` before the colon as breaking', () => {
		expect(parse('feat!: drop Android 8')?.breaking).toBe(true);
		expect(parse('feat(api)!: drop Android 8')?.breaking).toBe(true);
	});

	it('treats a BREAKING CHANGE footer as breaking whatever the type', () => {
		expect(parse('chore: rename keys\n\nBREAKING CHANGE: migrate installs')?.breaking).toBe(true);
		// Rule 16: BREAKING-CHANGE is a synonym.
		expect(parse('fix: x\n\nBREAKING-CHANGE: y')?.breaking).toBe(true);
	});

	it('only matches the footer token at the start of a line', () => {
		expect(parse('docs: x\n\nsee BREAKING CHANGE: later')?.breaking).toBe(false);
	});
});

describe('levelFor', () => {
	it('is a patch for everything that is not breaking — `feat:` included', () => {
		for (const type of ['feat', 'fix', 'perf', 'refactor', 'chore', 'docs', 'ci', 'build', 'test', 'style', 'revert']) {
			expect(levelFor(parse(`${type}: something`)!)).toBe('patch');
		}
	});

	it('is a minor for a `!`, whatever the type', () => {
		expect(levelFor(parse('feat!: new storage schema')!)).toBe('minor');
		expect(levelFor(parse('refactor!: drop dueAt')!)).toBe('minor');
		expect(levelFor(parse('chore: x\n\nBREAKING CHANGE: y')!)).toBe('minor');
	});

	it('never asks for a major before 1.0.0', () => {
		const everything = ['feat!: a', 'fix!: b', 'chore: c'].map((m) => parse(m)!);
		expect(requiredLevel(everything)).toBe('minor');
	});
});

describe('requiredLevel', () => {
	it('is null for no commits, not a patch', () => {
		expect(requiredLevel([])).toBeNull();
	});

	it('is a patch when nothing breaks, and a minor as soon as one does', () => {
		expect(requiredLevel(['fix: a', 'feat: b', 'docs: c'].map((m) => parse(m)!))).toBe('patch');
		expect(requiredLevel(['fix: a', 'feat!: b'].map((m) => parse(m)!))).toBe('minor');
	});
});

describe('versionCode', () => {
	it('is what Play orders uploads by', () => {
		expect(versionCode('0.3.1')).toBe(301);
		expect(versionCode('1.0.0')).toBe(10000);
		expect(versionCode('1.2.3')).toBe(10203);
	});

	it('collides when minor or patch passes 99 — the case `check` refuses', () => {
		expect(versionCode('0.3.100')).toBe(versionCode('0.4.0'));
	});

	it('throws rather than silently mangling a non-semver version', () => {
		expect(() => versionCode('0.3')).toThrow(/not a semver: "0.3"/);
	});
});

describe('levelBetween', () => {
	it('names the level a release actually used', () => {
		expect(levelBetween('0.3.0', '0.3.1')).toBe('patch');
		expect(levelBetween('0.3.1', '0.4.0')).toBe('minor');
		expect(levelBetween('0.9.9', '1.0.0')).toBe('major');
	});

	it('is null when the version did not move or went backwards', () => {
		expect(levelBetween('0.3.0', '0.3.0')).toBeNull();
		expect(levelBetween('0.3.0', '0.2.9')).toBeNull();
	});

	it('orders the levels, which is how `check` refuses an under-bump', () => {
		expect(LEVELS.indexOf(levelBetween('0.3.0', '0.3.1')!)).toBeLessThan(
			LEVELS.indexOf(levelBetween('0.3.1', '0.4.0')!)
		);
		expect(LEVELS.indexOf('patch')).toBeLessThan(LEVELS.indexOf('minor'));
	});
});
