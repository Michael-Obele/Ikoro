import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
	REFERENCE_HUE,
	SCHEME_IDS,
	SEED_SCHEMES,
	getSeedSchemes,
	referencePalette,
	rotatePalette
} from '#lib/theme/schemes';
import type { TokenMap } from '#lib/theme/monet';
import type { SeedSchemeId } from '#lib/theme/schemes';

/**
 * THE HUE-ROTATION CONTRACT BEHIND THE SIX SEED SCHEMES.
 *
 * WHAT THIS FILE IS FOR. `src/lib/theme/schemes.ts` turns the one audited
 * crimson palette in `layout.css` into six schemes by rotating HUE and
 * nothing else. Its docblock makes four testable promises, and this file
 * holds it to all four:
 *
 *   1. LIGHTNESS IS PRESERVED. Every token keeps its reference L under
 *      rotation — exactly in the rotated objects `rotatePalette` returns,
 *      and to within 3-decimal rounding in the `oklch()` strings the app
 *      actually applies.
 *   2. HUE MOVES BY THE SCHEME DELTA, AND ONLY WHERE IT SHOULD. Seed-family
 *      tokens (reference hue 17.58) and the tertiary family (reference + 60)
 *      move by `scheme hue − REFERENCE_HUE`; the error family (27) never
 *      moves, so "this is destructive" is the same colour in every scheme.
 *   3. CONTRAST SURVIVES. The exact pair list `theme-contrast.test.ts`
 *      audits for crimson is re-measured for all six schemes, light and
 *      dark, against the same WCAG floors (7:1 text, 3:1 non-text).
 *   4. CHROMA IS CARRIED, NOT RE-TUNED. Rotation copies C unchanged; only
 *      CSS Color 4 gamut mapping may reduce it, and it may never increase.
 *
 * THE CLASS OF BUG THIS CATCHES. Someone "improving" a seed by hand — a
 * slightly darker primary in teal, a friendlier error in green — silently
 * breaks the invariant that six schemes share one audit. And because WCAG
 * luminance is a function of the WHOLE colour and not of OKLCH L alone, the
 * contrast audit is re-measured rather than assumed: if a rotation shifts a
 * ratio below its floor, this file names the scheme, the pair and the
 * number, instead of letting the picker ship a scheme nobody audited.
 *
 * WHY THE COLOUR MATHS AND THE PAIR LIST ARE COPIES. They are lifted
 * verbatim from `tests/theme-contrast.test.ts`, whose helpers are
 * module-private (a test file exports nothing) and which cannot be imported
 * without re-registering its whole suite inside this one. The repo treats
 * that file as a finished green audit, so duplicating the maths beats
 * touching it — with the standing obligation that the two copies must never
 * disagree: if the conversion or the pair list changes there, change it here
 * in the same commit.
 *
 * WHY THIS FILE MOCKS THE ?raw IMPORT. `schemes.ts` reads the reference
 * palette from `../../routes/layout.css?raw`. Under Vitest that resolves to
 * an EMPTY STRING: with `test.css` disabled (the default), Vitest's
 * `vitest:css-disable` plugin replaces every `.css` module — `?raw` queries
 * included — with `export default ""`, so `schemes.ts` throws
 * "layout.css has no top-level :root block" at import time. The real Vite
 * build is unaffected; this is a test-runner artefact. The mock hands back
 * the stylesheet's actual bytes via `readFileSync`, the same technique
 * `theme-contrast.test.ts` uses, so the audit still measures the real file.
 */

/* ------------------------------------------------------------------ *
 * The ?raw workaround — must run before schemes.ts is imported
 * ------------------------------------------------------------------ */

vi.mock('../src/routes/layout.css?raw', () => ({
	default: readFileSync(fileURLToPath(new URL('../src/routes/layout.css', import.meta.url)), 'utf8')
}));

/* ------------------------------------------------------------------ *
 * Constants the module keeps private
 * ------------------------------------------------------------------ */

/** The two themes every seed scheme ships. */
const MODES = ['light', 'dark'] as const;
type Mode = (typeof MODES)[number];

/**
 * Private in `schemes.ts`, restated here so the test pins the published
 * contract: if either constant silently changes, the hue assertions below
 * fail loudly instead of drifting along with the implementation.
 */
const TERTIARY_OFFSET = 60;
const ERROR_HUE = 27;

/** `rotateHue` classifies families with this tolerance; so does this test. */
const FAMILY_TOLERANCE = 0.5;

/** Emitted strings round to 3 decimals; parsed-back values get this slack. */
const ROUNDING_SLACK = 0.0011;

const norm = (h: number): number => ((h % 360) + 360) % 360;
const near = (a: number, b: number): boolean => Math.abs(a - b) < FAMILY_TOLERANCE;

/* ------------------------------------------------------------------ *
 * Colour maths — copied verbatim from tests/theme-contrast.test.ts
 *
 * See the header: that file's helpers are module-private and importing a
 * *.test.ts would re-run its suite here. These two copies must never
 * disagree about what WCAG luminance is.
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

/** Source-over compositing in gamma space, which is how CSS alpha composites. */
const composite = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
	fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as unknown as Rgb;

/* ------------------------------------------------------------------ *
 * The pairs the app actually paints — copied verbatim from
 * tests/theme-contrast.test.ts so both audits measure the same pairs.
 * If a pair is added or changed there, mirror it here: a seed scheme
 * that passes a stale copy of this list proves nothing.
 * ------------------------------------------------------------------ */

/** WCAG 2.1: normal text needs 7:1 (AAA); AA is only 4.5:1. */
const AAA_TEXT = 7;
/** WCAG 2.1 SC 1.4.11 non-text contrast. AAA and AA agree here. */
const NON_TEXT = 3;

interface Colour {
	rgb: Rgb;
	alpha: number;
	declaredChroma: number;
	effectiveChroma: number;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%)?\s*)?\)$/;

function parseColour(token: string, raw: string): Colour {
	const match = OKLCH_RE.exec(raw.trim());
	if (!match) {
		throw new Error(
			`--${token}: "${raw}" is not a bare oklch() value. The schemes are emitted as ` +
				`literal oklch(), so every token this audit measures has to be one.`
		);
	}
	const L = Number(match[1]);
	const C = Number(match[2]);
	const hue = Number(match[3]);
	const mapped = gamutMap(L, C, hue);
	const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
	return {
		rgb: mapped.rgb,
		alpha,
		declaredChroma: C,
		effectiveChroma: mapped.chroma
	};
}

/** Reads one token out of a generated scheme. Keys carry the `--` prefix. */
function tokenColour(map: TokenMap, name: string): Colour {
	const raw = map[`--${name}`];
	if (raw === undefined) {
		throw new Error(
			`--${name} is missing from the generated scheme; the override must carry ` +
				`every token layout.css declares`
		);
	}
	return parseColour(name, raw);
}

type Pair = {
	label: string;
	fg: string;
	bg: string;
	fgAlpha?: number;
	tint?: { token: string; alpha: number };
	only?: Mode[];
	min: number;
};

const TEXT_PAIRS: Pair[] = [
	{ label: 'foreground on background', fg: 'foreground', bg: 'background', min: AAA_TEXT },
	{ label: 'card-foreground on card', fg: 'card-foreground', bg: 'card', min: AAA_TEXT },
	{
		label: 'popover-foreground on popover',
		fg: 'popover-foreground',
		bg: 'popover',
		min: AAA_TEXT
	},
	{ label: 'foreground on card', fg: 'foreground', bg: 'card', min: AAA_TEXT },
	{ label: 'foreground on popover', fg: 'foreground', bg: 'popover', min: AAA_TEXT },
	{ label: 'foreground on muted', fg: 'foreground', bg: 'muted', min: AAA_TEXT },
	{ label: 'foreground on accent', fg: 'foreground', bg: 'accent', min: AAA_TEXT },
	{
		label: 'muted-foreground on background',
		fg: 'muted-foreground',
		bg: 'background',
		min: AAA_TEXT
	},
	{ label: 'muted-foreground on card', fg: 'muted-foreground', bg: 'card', min: AAA_TEXT },
	{ label: 'muted-foreground on muted', fg: 'muted-foreground', bg: 'muted', min: AAA_TEXT },
	{ label: 'muted-foreground on popover', fg: 'muted-foreground', bg: 'popover', min: AAA_TEXT },
	{
		label: 'primary-foreground on primary',
		fg: 'primary-foreground',
		bg: 'primary',
		min: AAA_TEXT
	},
	{
		label: 'secondary-foreground on secondary',
		fg: 'secondary-foreground',
		bg: 'secondary',
		min: AAA_TEXT
	},
	{ label: 'accent-foreground on accent', fg: 'accent-foreground', bg: 'accent', min: AAA_TEXT },
	{ label: 'foreground on sidebar', fg: 'foreground', bg: 'sidebar', min: AAA_TEXT },
	{
		label: 'sidebar-foreground on sidebar',
		fg: 'sidebar-foreground',
		bg: 'sidebar',
		min: AAA_TEXT
	},
	{
		label: 'sidebar-accent-foreground on sidebar-accent',
		fg: 'sidebar-accent-foreground',
		bg: 'sidebar-accent',
		min: AAA_TEXT
	},
	{
		label: 'sidebar-primary-foreground on sidebar-primary',
		fg: 'sidebar-primary-foreground',
		bg: 'sidebar-primary',
		min: AAA_TEXT
	},
	{ label: 'destructive on background', fg: 'destructive', bg: 'background', min: AAA_TEXT },
	{ label: 'destructive on card', fg: 'destructive', bg: 'card', min: AAA_TEXT },
	{
		label: 'destructive on destructive/10 over background',
		fg: 'destructive',
		bg: 'background',
		tint: { token: 'destructive', alpha: 0.1 },
		only: ['light'],
		min: AAA_TEXT
	},
	{
		label: 'destructive on destructive/20 over background',
		fg: 'destructive',
		bg: 'background',
		tint: { token: 'destructive', alpha: 0.2 },
		only: ['dark'],
		min: AAA_TEXT
	},
	{
		label: 'destructive on destructive/20 over card',
		fg: 'destructive',
		bg: 'card',
		tint: { token: 'destructive', alpha: 0.2 },
		only: ['dark'],
		min: AAA_TEXT
	},
	{ label: 'destructive on muted', fg: 'destructive', bg: 'muted', min: AAA_TEXT },
	{
		label: 'destructive on destructive/10 over card',
		fg: 'destructive',
		bg: 'card',
		tint: { token: 'destructive', alpha: 0.1 },
		only: ['light'],
		min: AAA_TEXT
	},
	{ label: 'destructive on popover', fg: 'destructive', bg: 'popover', min: AAA_TEXT },
	{
		label: 'destructive on accent (menu item, focused)',
		fg: 'destructive',
		bg: 'accent',
		min: AAA_TEXT
	},
	{
		label: 'destructive-foreground on destructive',
		fg: 'destructive-foreground',
		bg: 'destructive',
		min: AAA_TEXT
	},
	{
		label: 'foreground on input/50 over card',
		fg: 'foreground',
		bg: 'card',
		tint: { token: 'input', alpha: 0.5 },
		min: AAA_TEXT
	},
	{
		label: 'foreground on input/30 over background (dark input fill)',
		fg: 'foreground',
		bg: 'background',
		tint: { token: 'input', alpha: 0.3 },
		min: AAA_TEXT
	}
];

const NON_TEXT_PAIRS: Pair[] = [
	{ label: 'border on background', fg: 'border', bg: 'background', min: NON_TEXT },
	{ label: 'border on card', fg: 'border', bg: 'card', min: NON_TEXT },
	{ label: 'border on muted', fg: 'border', bg: 'muted', min: NON_TEXT },
	{ label: 'sidebar-border on sidebar', fg: 'sidebar-border', bg: 'sidebar', min: NON_TEXT },
	{ label: 'input on background (control boundary)', fg: 'input', bg: 'background', min: NON_TEXT },
	{ label: 'input on card (control boundary)', fg: 'input', bg: 'card', min: NON_TEXT },
	{ label: 'sidebar-ring on sidebar', fg: 'sidebar-ring', bg: 'sidebar', min: NON_TEXT },
	{ label: 'ring on background (opaque token)', fg: 'ring', bg: 'background', min: NON_TEXT },
	{ label: 'ring on card (opaque token)', fg: 'ring', bg: 'card', min: NON_TEXT },
	{ label: 'ring on muted (opaque token)', fg: 'ring', bg: 'muted', min: NON_TEXT },
	{
		label: 'ring/50 on background (as painted on focus)',
		fg: 'ring',
		bg: 'background',
		fgAlpha: 0.5,
		min: NON_TEXT
	},
	{
		label: 'ring/50 on card (as painted on focus)',
		fg: 'ring',
		bg: 'card',
		fgAlpha: 0.5,
		min: NON_TEXT
	},
	{
		label: 'ring/50 on muted (as painted on focus)',
		fg: 'ring',
		bg: 'muted',
		fgAlpha: 0.5,
		min: NON_TEXT
	},
	{
		label: 'primary on background (switch thumb, checked)',
		fg: 'primary',
		bg: 'background',
		min: NON_TEXT
	},
	{ label: 'primary on card (switch thumb, checked)', fg: 'primary', bg: 'card', min: NON_TEXT }
];

const ALL_PAIRS: Pair[] = [...TEXT_PAIRS, ...NON_TEXT_PAIRS];

/**
 * THERE ARE NO EXCEPTIONS, AND THAT IS THE POINT.
 *
 * This used to carry one: teal light, `ring/50 on muted`, at 2.995:1 against
 * the 3:1 non-text floor. It was never a bug in `schemes.ts` — the rotation
 * does preserve OKLCH L and C — it was the rotation's own limit. WCAG relative
 * luminance weights the channels (0.2126 / 0.7152 / 0.0722), so rotating the
 * hue shifts it a little even with OKLCH L frozen, and teal's green-heavy mix at
 * 50 % alpha over `muted` landed just short. `schemes.ts` claims contrast is "a
 * function of LIGHTNESS, not hue"; true of OKLCH L, very nearly true of WCAG
 * luminance, and that pair was where "very nearly" showed.
 *
 * It is fixed rather than excused. The light `primary` in `layout.css` now sits
 * at M3 tone 11 instead of 13, which puts every seed over 3:1 — worst case teal
 * at 3.07:1. So the escape hatch is gone: every pair of every scheme is asserted
 * against the same floor, with no per-scheme carve-out. A future hue that cannot
 * meet its floor must be re-tuned in the stylesheet, not exempted here.
 *
 * Beware the printed numbers: `toFixed(2)` renders 2.995 as "3.00:1", which
 * reads as a pass and is not — the rounding trap `theme-contrast.test.ts`
 * guards against explicitly, and the reason the assertions below print raw ratios.
 */

/** Same compositing order as theme-contrast: tint the backdrop first, then the ink. */
function measure(map: TokenMap, pair: Pair): { ratio: number } {
	const fg = tokenColour(map, pair.fg);
	const bg = tokenColour(map, pair.bg);

	let backdrop = bg.rgb;
	if (pair.tint) {
		backdrop = composite(tokenColour(map, pair.tint.token).rgb, bg.rgb, pair.tint.alpha);
	}

	let fgRgb = fg.rgb;
	if (fg.alpha < 1) fgRgb = composite(fg.rgb, backdrop, fg.alpha);
	if (pair.fgAlpha !== undefined) fgRgb = composite(fg.rgb, backdrop, pair.fgAlpha);

	return { ratio: contrast(fgRgb, backdrop) };
}

/** Parses one emitted `oklch(L C H)` string back into numbers. */
function parseToken(map: TokenMap, name: string): { L: number; C: number; h: number } {
	const raw = map[`--${name}`];
	if (raw === undefined) throw new Error(`scheme is missing --${name}`);
	const m = OKLCH_RE.exec(raw.trim());
	if (!m) throw new Error(`--${name}: "${raw}" is not a bare oklch() value`);
	return { L: Number(m[1]), C: Number(m[2]), h: Number(m[3]) };
}

/* ------------------------------------------------------------------ *
 * 1 + 4 — lightness and chroma survive the rotation
 * ------------------------------------------------------------------ */

describe('seed schemes — lightness and chroma survive the rotation', () => {
	it('rotatePalette preserves L exactly, for every token of every seed, in both modes', () => {
		for (const id of SCHEME_IDS) {
			const hue = SEED_SCHEMES[id].hue;
			for (const mode of MODES) {
				const reference = referencePalette(mode);
				const rotated = rotatePalette(reference, hue);
				for (const [name, colour] of Object.entries(reference)) {
					expect(
						rotated[name].L,
						`${id}/${mode}/--${name}: L drifted from ${colour.L}`
					).toBeCloseTo(colour.L, 9);
				}
			}
		}
	});

	it('the emitted oklch strings keep the reference L within 3-decimal rounding', () => {
		for (const id of SCHEME_IDS) {
			for (const mode of MODES) {
				const reference = referencePalette(mode);
				const map = getSeedSchemes(id)[mode];
				for (const [name, colour] of Object.entries(reference)) {
					const out = parseToken(map, name);
					expect(
						Math.abs(out.L - colour.L),
						`${id}/${mode}/--${name}: emitted ${map[`--${name}`]}, reference L ${colour.L}`
					).toBeLessThanOrEqual(ROUNDING_SLACK);
				}
			}
		}
	});

	it('rotatePalette copies C unchanged — rotation never re-tunes chroma', () => {
		for (const id of SCHEME_IDS) {
			const hue = SEED_SCHEMES[id].hue;
			for (const mode of MODES) {
				const reference = referencePalette(mode);
				const rotated = rotatePalette(reference, hue);
				for (const [name, colour] of Object.entries(reference)) {
					expect(
						rotated[name].C,
						`${id}/${mode}/--${name}: C re-tuned from ${colour.C}`
					).toBeCloseTo(colour.C, 9);
				}
			}
		}
	});

	it('gamut mapping only ever reduces chroma, never increases it', () => {
		const mapped: string[] = [];
		for (const id of SCHEME_IDS) {
			for (const mode of MODES) {
				const map = getSeedSchemes(id)[mode];
				for (const [name, colour] of Object.entries(referencePalette(mode))) {
					const out = tokenColour(map, name);
					expect(
						out.effectiveChroma,
						`${id}/${mode}/--${name}: effective C ${out.effectiveChroma} exceeds declared ${colour.C}`
					).toBeLessThanOrEqual(colour.C + 1e-9);
					if (out.effectiveChroma < colour.C - 1e-6) {
						mapped.push(`${id}/${mode} --${name} ${colour.C} -> ${out.effectiveChroma.toFixed(3)}`);
					}
				}
			}
		}
		console.log(
			mapped.length
				? `gamut-mapped tokens (declared C -> effective C):\n  ${mapped.join('\n  ')}`
				: 'every token of every scheme is inside sRGB; no gamut mapping was needed'
		);
	});
});

/* ------------------------------------------------------------------ *
 * The crimson reference round-trips
 * ------------------------------------------------------------------ */

describe('seed schemes — crimson is the reference, delta 0', () => {
	it('crimson reproduces the layout.css palette value for value', () => {
		for (const mode of MODES) {
			const reference = referencePalette(mode);
			const map = getSeedSchemes('crimson')[mode];
			for (const [name, colour] of Object.entries(reference)) {
				const out = parseToken(map, name);
				expect(out.L, `${mode}/--${name} L`).toBeCloseTo(colour.L, 10);
				expect(out.C, `${mode}/--${name} C`).toBeCloseTo(colour.C, 10);
				expect(norm(out.h), `${mode}/--${name} h`).toBeCloseTo(norm(colour.h), 6);
			}
		}
	});

	it('overrides exactly the stylesheet colour tokens — none forgotten, none invented', () => {
		for (const id of SCHEME_IDS) {
			for (const mode of MODES) {
				const expected = Object.keys(referencePalette(mode))
					.map((name) => `--${name}`)
					.sort();
				const actual = Object.keys(getSeedSchemes(id)[mode]).sort();
				expect(actual, `${id}/${mode}`).toEqual(expected);
			}
		}
	});
});

/* ------------------------------------------------------------------ *
 * 2 — hue moves by the scheme delta, and only where it should
 * ------------------------------------------------------------------ */

describe('seed schemes — hue moves by the scheme delta', () => {
	it('classifies every reference token into a family: seed, tertiary (+60) or error (27)', () => {
		// Guards the per-scheme assertions below against vacuity: a token whose
		// hue matches no family is left unrotated by design, so a new tone added
		// at an unexpected hue must be a conscious decision, not an accident.
		for (const mode of MODES) {
			for (const [name, colour] of Object.entries(referencePalette(mode))) {
				const family = near(colour.h, REFERENCE_HUE)
					? 'seed'
					: near(colour.h, REFERENCE_HUE + TERTIARY_OFFSET)
						? 'tertiary'
						: near(colour.h, ERROR_HUE)
							? 'error'
							: null;
				expect(family, `${mode}/--${name} has hue ${colour.h} — no family claims it`).not.toBe(
					null
				);
			}
		}
	});

	it.each(SCHEME_IDS.filter((id) => id !== 'crimson'))(
		'%s: seed and tertiary families move by the delta; error stays at 27',
		(id) => {
			const hue = SEED_SCHEMES[id].hue;
			const delta = hue - REFERENCE_HUE;
			const expectedTertiary = norm(hue + TERTIARY_OFFSET);
			expect(delta, `${id} must differ from the reference`).not.toBe(0);

			for (const mode of MODES) {
				const reference = referencePalette(mode);
				const rotated = rotatePalette(reference, hue);
				let seed = 0;
				let tertiary = 0;
				let error = 0;

				for (const [name, colour] of Object.entries(reference)) {
					if (near(colour.h, REFERENCE_HUE)) {
						seed++;
						expect(rotated[name].h, `${mode}/--${name}`).toBeCloseTo(norm(hue), 6);
					} else if (near(colour.h, REFERENCE_HUE + TERTIARY_OFFSET)) {
						tertiary++;
						expect(rotated[name].h, `${mode}/--${name}`).toBeCloseTo(expectedTertiary, 6);
					} else if (near(colour.h, ERROR_HUE)) {
						error++;
						expect(rotated[name].h, `${mode}/--${name}`).toBe(colour.h);
					}
				}

				// Counts, so the assertions above cannot pass vacuously.
				expect(seed, `${mode}: seed-family tokens`).toBeGreaterThan(0);
				expect(tertiary, `${mode}: tertiary-family tokens`).toBeGreaterThan(0);
				expect(error, `${mode}: error-family tokens`).toBeGreaterThan(0);
			}
		}
	);
});

/* ------------------------------------------------------------------ *
 * 3 — the contrast audit, re-run for all six schemes
 * ------------------------------------------------------------------ */

describe('seed schemes — WCAG contrast across all six schemes', () => {
	for (const id of SCHEME_IDS) {
		for (const mode of MODES) {
			const map = getSeedSchemes(id)[mode];
			const rows = ALL_PAIRS.filter((pair) => !pair.only || pair.only.includes(mode)).map(
				(pair) => {
					const { ratio } = measure(map, pair);
					return { label: pair.label, min: pair.min, ratio };
				}
			);

			const failing = rows.filter((row) => row.ratio < row.min);
			const worst = Math.min(...rows.map((row) => row.ratio));
			console.log(
				`${SEED_SCHEMES[id].label} ${mode}: ${rows.length - failing.length}/${rows.length} pairs pass` +
					` (worst ${worst.toFixed(2)}:1)` +
					(failing.length
						? ' — FAILURES: ' +
							failing.map((f) => `${f.label} ${f.ratio.toFixed(2)}:1 < ${f.min}:1`).join('; ')
						: '')
			);

			describe(`${SEED_SCHEMES[id].label} · ${mode}`, () => {
				it.each(rows)('$label', (row) => {
					expect(
						row.ratio,
						`${row.label}: measured ${row.ratio.toFixed(2)}:1, WCAG requires ${row.min}:1`
					).toBeGreaterThanOrEqual(row.min);
				});
			});
		}
	}
});

/* ------------------------------------------------------------------ *
 * 5 — the reference is TINTED, so a scheme colours the whole app
 * ------------------------------------------------------------------ */

describe('reference palette — the neutrals carry the scheme', () => {
	/**
	 * THE CLASS OF BUG THIS CATCHES. Re-greying the neutrals.
	 *
	 * The whole six-scheme system rests on one property of the reference palette:
	 * its surface families are CHROMATIC, so rotating the hue moves the page, the
	 * cards, the borders and the secondary text — not just the buttons.
	 * `layout.css` once shipped neutral chroma 0.004 and neutral-variant 0.012,
	 * which is near-grey: all six schemes then painted the same surfaces and the
	 * picker offered six colours that looked like one.
	 *
	 * A contrast audit cannot catch that. Dropping chroma makes every pair measure
	 * the SAME or BETTER - the surfaces drift toward a neutral grey that is easier
	 * to read, not harder. So the failure is silent exactly where this repo is
	 * most careful, and it needs its own assertion rather than a ratio.
	 *
	 * The floors are deliberately below the shipped 0.012 / 0.024: this fails a
	 * re-greying, not a legitimate re-tune of the tint.
	 */
	it('the neutral families are chromatic, in both themes', () => {
		for (const mode of MODES) {
			const palette = referencePalette(mode);
			for (const name of ['surface', 'surface-container', 'on-surface']) {
				expect(
					palette[`md-sys-color-${name}`].C,
					`${mode}/--md-sys-color-${name} is grey — a scheme could not show on it`
				).toBeGreaterThanOrEqual(0.008);
			}
			for (const name of ['surface-variant', 'on-surface-variant', 'outline-variant']) {
				expect(
					palette[`md-sys-color-${name}`].C,
					`${mode}/--md-sys-color-${name} is grey`
				).toBeGreaterThanOrEqual(0.016);
			}
		}
	});

	it('six schemes produce six different page colours', () => {
		const backgrounds = SCHEME_IDS.map((id) => getSeedSchemes(id).light['--background']);
		expect(new Set(backgrounds).size, `page colours: ${backgrounds.join(', ')}`).toBe(
			SCHEME_IDS.length
		);
	});

	/**
	 * THE MAPPING TABLE IS THE CONTRACT, SO LET IT BE CHECKED.
	 *
	 * `layout.css` stores each shadcn token twice: once as an M3 role
	 * (`--md-sys-color-surface`) and once as the alias shadcn components read
	 * (`--background`). The duplication is deliberate — the contrast audit parses
	 * literal `oklch()` values and refuses `var()`, so an alias cannot point at its
	 * role — and the comment above them calls the pairing "the contract".
	 *
	 * Until this test existed nothing enforced it. Retuning one family by search
	 * and replace left `--sidebar-ring` on the old tone while `--primary` moved:
	 * every pair still passed, because a focus ring two tones off is still a focus
	 * ring, and the app shipped two different colours for the same role. That is
	 * exactly the class of bug a test has to catch, because no ratio can.
	 */
	it('every shadcn alias is byte-equal to the M3 role it names', () => {
		const ALIAS_TO_ROLE: Record<string, string> = {
			background: 'surface',
			foreground: 'on-surface',
			card: 'surface-container',
			'card-foreground': 'on-surface',
			popover: 'surface-container-high',
			'popover-foreground': 'on-surface',
			primary: 'primary',
			'primary-foreground': 'on-primary',
			secondary: 'secondary-container',
			'secondary-foreground': 'on-secondary-container',
			muted: 'surface-container-high',
			'muted-foreground': 'on-surface-variant',
			accent: 'secondary-container',
			'accent-foreground': 'on-secondary-container',
			destructive: 'error',
			'destructive-foreground': 'on-error',
			border: 'outline-variant',
			input: 'outline-variant',
			ring: 'primary',
			'chart-1': 'primary',
			'chart-2': 'tertiary',
			'chart-3': 'secondary',
			'chart-4': 'error',
			'chart-5': 'outline',
			sidebar: 'surface',
			'sidebar-foreground': 'on-surface',
			'sidebar-primary': 'primary',
			'sidebar-primary-foreground': 'on-primary',
			'sidebar-accent': 'secondary-container',
			'sidebar-accent-foreground': 'on-secondary-container',
			'sidebar-border': 'outline-variant',
			'sidebar-ring': 'primary'
		};

		for (const mode of MODES) {
			const palette = referencePalette(mode);
			for (const [alias, role] of Object.entries(ALIAS_TO_ROLE)) {
				const aliasValue = palette[alias];
				const roleValue = palette[`md-sys-color-${role}`];
				expect(aliasValue, `${mode}: --${alias} is missing`).toBeDefined();
				expect(roleValue, `${mode}: --md-sys-color-${role} is missing`).toBeDefined();
				expect(aliasValue, `${mode}: --${alias} must equal --md-sys-color-${role}`).toEqual(
					roleValue
				);
			}
		}
	});
});
