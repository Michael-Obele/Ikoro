import { describe, expect, it } from 'vitest';
// A script, not app code — there is no `#lib` alias for `scripts/`, so this is
// the one relative import in the suite's rule set.
import { bump, levelBetween, levelFor, LEVELS, parse, requiredLevel } from '../scripts/version';

/**
 * Pure logic — the commit-to-version policy — so this stays on the default
 * `node` environment. Importing `scripts/version` also proves the CLI stays
 * behind its "invoked directly" guard: if it did not, this file would try to
 * read a git range on import.
 *
 * The bug class this exists to stop: a release that ships a *smaller* bump than
 * its history claims. A published version can only go up, so a `feat` released
 * as a patch can never be corrected. Every case pins one of the three claims,
 * plus the two ways a message can silently claim nothing: an unparseable header
 * and an empty description.
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
	it('is a patch for every non-feat type', () => {
		for (const type of ['fix', 'perf', 'refactor', 'chore', 'docs', 'ci', 'build', 'test', 'style', 'revert']) {
			expect(levelFor(parse(`${type}: something`)!)).toBe('patch');
		}
	});

	it('is a minor for feat, and a major for any breaking change', () => {
		expect(levelFor(parse('feat(theme): six seed colours')!)).toBe('minor');
		expect(levelFor(parse('feat!: new storage schema')!)).toBe('major');
		expect(levelFor(parse('refactor!: drop dueAt')!)).toBe('major');
	});
});

describe('requiredLevel', () => {
	it('is null for no commits, not a patch', () => {
		expect(requiredLevel([])).toBeNull();
	});

	it('takes the largest claim in the range', () => {
		const commits = ['fix: a', 'feat: b', 'docs: c'].map((m) => parse(m)!);
		expect(requiredLevel(commits)).toBe('minor');
	});

	it('lets one breaking commit outrank a pile of feats', () => {
		const commits = ['feat: a', 'feat: b', 'chore!: c'].map((m) => parse(m)!);
		expect(requiredLevel(commits)).toBe('major');
	});
});

describe('bump', () => {
	it('bumps each component and resets the ones below it', () => {
		expect(bump('0.3.0', 'patch')).toBe('0.3.1');
		expect(bump('0.2.1', 'minor')).toBe('0.3.0');
		expect(bump('0.3.0', 'major')).toBe('1.0.0');
	});

	it('throws rather than silently mangling a non-semver version', () => {
		expect(() => bump('0.3', 'patch')).toThrow(/not a semver: "0.3"/);
	});
});

describe('levelBetween', () => {
	it('names the level a release actually used', () => {
		expect(levelBetween('0.2.1', '0.3.0')).toBe('minor');
		expect(levelBetween('0.2.0', '0.2.1')).toBe('patch');
		expect(levelBetween('0.9.9', '1.0.0')).toBe('major');
	});

	it('is null when the version did not move or went backwards', () => {
		expect(levelBetween('0.3.0', '0.3.0')).toBeNull();
		expect(levelBetween('0.3.0', '0.2.9')).toBeNull();
	});

	it('orders the levels, which is how `check` refuses an under-bump', () => {
		expect(LEVELS.indexOf(levelBetween('0.2.1', '0.3.0')!)).toBeGreaterThan(
			LEVELS.indexOf(levelBetween('0.2.0', '0.2.1')!)
		);
		expect(LEVELS.indexOf('patch')).toBeLessThan(LEVELS.indexOf('minor'));
	});
});
