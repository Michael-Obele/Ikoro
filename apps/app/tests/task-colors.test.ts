import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TASK_COLORS, TASK_COLOR_IDS, taskColorValue } from '#lib/task-colors';

/**
 * THE TASK-COLOUR CONTRACT — ids in, audited colours out.
 *
 * WHAT THIS FILE IS FOR. `src/lib/task-colors.ts` promises, in its docblock,
 * that every colour clears WCAG 2.1 SC 1.4.11 (3:1 non-text) against every
 * surface it is painted on, in both themes. A promise like that decays the
 * moment someone retunes a value by eye, so this file measures the REAL
 * `TASK_COLORS` values against the REAL `layout.css` tokens — the same
 * parse-the-stylesheet discipline `tests/theme-contrast.test.ts` established.
 * The only way to make it pass is to make the palette pass.
 *
 * THE FOUR SURFACES. The bar renders on the row, whose resting backdrop is
 * `--background`; the picker renders inside the sheet, whose surface is
 * `--popover`. Light and dark each define both. Eight colours x four surfaces
 * = thirty-two measurements, every one asserted at 3:1.
 *
 * THE CLASS OF BUG THIS CATCHES. A colour that looks fine in light mode but
 * dissolves into the dark background (or vice versa); a hue added at a
 * lightness outside the window both themes permit; a value swapped for a raw
 * hex that nothing audits. All three ship silently without this file.
 *
 * WHY THE COLOUR MATHS ARE COPIES. Lifted verbatim from
 * `tests/theme-contrast.test.ts`, whose helpers are module-private and which
 * cannot be imported without re-registering its whole suite here. The repo
 * already accepted that trade in `theme-schemes.test.ts`, with the same
 * standing obligation: if the conversion changes there, change it here too.
 */

const CSS_PATH = fileURLToPath(new URL('../src/routes/layout.css', import.meta.url));

/** WCAG 2.1 SC 1.4.11 non-text contrast — the floor for an accent bar. */
const NON_TEXT = 3;

/* ------------------------------------------------------------------ *
 * Colour maths — copied verbatim from tests/theme-contrast.test.ts
 * ------------------------------------------------------------------ */

type Rgb = readonly [number, number, number];

const GAMUT_EPSILON = 1e-4;

/** OKLCH -> OKLab -> LMS -> linear sRGB. No clamping: out-of-gamut stays out. */
function oklchToLinearSrgb(L: number, C: number, hue: number): Rgb {
	const h = (hue * Math.PI) / 180;
	const a = C * Math.cos(h);
	const b = C * Math.sin(h);

	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;

	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;

	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	] as const;
}

const linearToGamma = (u: number): number =>
	u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;

function oklchToSrgbRaw(L: number, C: number, hue: number): Rgb {
	return oklchToLinearSrgb(L, C, hue).map((v) => linearToGamma(v)) as unknown as Rgb;
}

const isInSrgb = (rgb: Rgb): boolean =>
	rgb.every((v) => v >= -GAMUT_EPSILON && v <= 1 + GAMUT_EPSILON);

/**
 * CSS Color 4 gamut mapping: keep lightness and hue, reduce chroma until the
 * colour is representable in sRGB. Browsers do this when rendering `oklch()`,
 * so it has to happen here too or every out-of-gamut ratio is fiction.
 */
function gamutMap(L: number, C: number, hue: number): { rgb: Rgb; chroma: number } {
	if (isInSrgb(oklchToSrgbRaw(L, C, hue))) {
		return { rgb: oklchToSrgbRaw(L, C, hue), chroma: C };
	}
	let low = 0;
	let high = C;
	for (let i = 0; i < 40; i++) {
		const mid = (low + high) / 2;
		if (isInSrgb(oklchToSrgbRaw(L, mid, hue))) low = mid;
		else high = mid;
	}
	return { rgb: oklchToSrgbRaw(L, low, hue), chroma: low };
}

/** WCAG 2.1 relative luminance. `rgb` is gamma-encoded sRGB in 0..1. */
function relativeLuminance(rgb: Rgb): number {
	const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
	return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG 2.1 contrast ratio. Order-independent; always >= 1. */
function contrast(fg: Rgb, bg: Rgb): number {
	const a = relativeLuminance(fg);
	const b = relativeLuminance(bg);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

/** Parses a literal `oklch(L C H)` string, gamut-mapping exactly as CSS does. */
function parseOklch(raw: string, what: string): Rgb {
	const m = OKLCH_RE.exec(raw.trim());
	if (!m) throw new Error(`${what}: "${raw}" is not a bare oklch() value`);
	return gamutMap(Number(m[1]), Number(m[2]), Number(m[3])).rgb;
}

/* ------------------------------------------------------------------ *
 * Reading the surfaces out of layout.css
 * ------------------------------------------------------------------ */

/**
 * Reads one top-level `<selector> { ... }` block. Same block parser as
 * `theme-contrast.test.ts` — including the start-of-line anchor that keeps
 * `@custom-variant dark (...)` from being mistaken for the `.dark` block.
 */
function readBlock(css: string, selector: string): Record<string, string> {
	const start = css.search(
		new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm')
	);
	if (start === -1) throw new Error(`layout.css has no top-level ${selector} block`);

	const open = css.indexOf('{', start);
	let depth = 0;
	let close = -1;
	for (let i = open; i < css.length; i++) {
		if (css[i] === '{') depth++;
		else if (css[i] === '}' && --depth === 0) {
			close = i;
			break;
		}
	}
	if (close === -1) throw new Error(`unterminated ${selector} block`);

	const tokens: Record<string, string> = {};
	for (const line of css.slice(open + 1, close).split('\n')) {
		const m = /^\s*(--[\w-]+)\s*:\s*(.+?);?\s*$/.exec(line);
		if (m) tokens[m[1].slice(2)] = m[2];
	}
	return tokens;
}

const css = readFileSync(CSS_PATH, 'utf8');
const THEMES = [
	{ id: 'light', name: 'LIGHT (:root)', selector: ':root' },
	{ id: 'dark', name: 'DARK (.dark)', selector: '.dark' }
] as const;

/** The surfaces the bar and the picker actually sit on. */
const SURFACES = ['background', 'popover'] as const;

/* ------------------------------------------------------------------ *
 * 1 — the palette audit
 * ------------------------------------------------------------------ */

describe('task colors — WCAG 2.1 non-text contrast against the real surfaces', () => {
	// Built once, printed once: the audit table for all 8 x 4 pairs.
	const table = THEMES.map((theme) => {
		const tokens = readBlock(css, theme.selector);
		const rows = Object.values(TASK_COLORS).flatMap((entry) =>
			SURFACES.map((surface) => {
				const ratio = contrast(
					parseOklch(entry.value, `task color ${entry.id}`),
					parseOklch(tokens[surface], `--${surface} in ${theme.name}`)
				);
				return { label: `${entry.label} on ${surface}`, ratio };
			})
		);
		const worst = Math.min(...rows.map((r) => r.ratio));
		console.log(
			`${theme.name}: ${rows.map((r) => `${r.label} ${r.ratio.toFixed(2)}:1`).join(' · ')} (worst ${worst.toFixed(2)}:1)`
		);
		return { theme, rows };
	});

	for (const { theme, rows } of table) {
		describe(theme.name, () => {
			it.each(rows)('$label', (row) => {
				expect(
					row.ratio,
					`${row.label} in ${theme.name}: measured ${row.ratio.toFixed(2)}:1, SC 1.4.11 requires ${NON_TEXT}:1`
				).toBeGreaterThanOrEqual(NON_TEXT);
			});
		});
	}

	it('every value is a literal oklch() — no hex, no var(), nothing unauditable', () => {
		for (const entry of Object.values(TASK_COLORS)) {
			expect(
				OKLCH_RE.test(entry.value.trim()),
				`${entry.id}: "${entry.value}" is not a bare oklch() value`
			).toBe(true);
		}
	});

	it('ships exactly eight colours with unique ids and unique hues', () => {
		expect(TASK_COLOR_IDS).toHaveLength(8);
		const hues = Object.values(TASK_COLORS).map((c) => Number(OKLCH_RE.exec(c.value)?.[3]));
		expect(new Set(TASK_COLOR_IDS).size).toBe(8);
		expect(new Set(hues).size).toBe(8);
	});
});

/* ------------------------------------------------------------------ *
 * 2 — the lookup contract
 * ------------------------------------------------------------------ */

describe('taskColorValue', () => {
	it('returns the CSS value for every id the palette publishes', () => {
		for (const entry of Object.values(TASK_COLORS)) {
			expect(taskColorValue(entry.id)).toBe(entry.value);
		}
	});

	it('returns undefined for null, undefined and the empty string — no bar to draw', () => {
		expect(taskColorValue(null)).toBeUndefined();
		expect(taskColorValue(undefined)).toBeUndefined();
		expect(taskColorValue('')).toBeUndefined();
	});

	it('returns undefined for an unknown id — a typo degrades to no bar, never a wrong colour', () => {
		expect(taskColorValue('crimson')).toBeUndefined();
		expect(taskColorValue('#ff0000')).toBeUndefined();
		expect(taskColorValue('Red')).toBeUndefined();
	});
});
