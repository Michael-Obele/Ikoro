/**
 * THE SIX SEED SCHEMES — one hue each, the same AAA palette underneath.
 *
 * WHAT THIS IS. `routes/layout.css` ships exactly one colour scheme: crimson,
 * hue 17.58, hand-tuned until `tests/theme-contrast.test.ts` went green at WCAG
 * AAA. This module turns that one scheme into six by rotating its HUE and
 * nothing else.
 *
 * WHY HUE ROTATION AND NOT A FRESH PALETTE. Contrast is a function of LIGHTNESS,
 * not hue: WCAG relative luminance is a weighted sum of linear RGB, and rotating
 * the hue in OKLCH leaves L untouched by construction. So every pair that clears
 * 7:1 in crimson clears 7:1 in blue, green, orange, purple and teal — the same
 * numbers, not "probably similar". Building six palettes from scratch would mean
 * six hand-tuned tone tables and six audits; rotating one audited table means the
 * audit stays true for all six.
 *
 * WHAT IS ROTATED AND WHAT IS NOT.
 *
 *   - The seed hue is the reference hue (17.58) plus a delta. Every token whose
 *     hue is the seed hue moves by that delta.
 *   - The tertiary family sits at seed + 60 (77.58 in crimson) and moves with it,
 *     so the accent keeps its relationship to primary instead of collapsing onto
 *     it.
 *   - The error family is M3's fixed error hue (27) and does NOT move. "This is
 *     destructive" must not depend on which colour scheme the user picked — the
 *     same reason `monet.ts` keeps error fixed for wallpaper palettes.
 *   - Chroma is preserved exactly. A hue rotation that also re-tuned chroma would
 *     be a second, unaudited palette.
 *
 * THE ONE HONEST CAVEAT. A hue can be out of sRGB gamut at a given L and C even
 * though the crimson reference was inside it — sRGB is not a circle. Where that
 * happens the browser gamut-maps the colour (CSS Color 4: hold L and H, reduce C),
 * which changes chroma but NOT lightness, so the contrast ratios still hold. The
 * test file asserts exactly that: L is preserved for every token, and the
 * contrast audit is re-run over all six schemes.
 *
 * WHY THE REFERENCE IS PARSED FROM THE STYLESHEET. The crimson values live in
 * `layout.css` and are the audited source of truth. Copying them here would be a
 * second copy that drifts the moment someone tunes a tone — the exact failure
 * `tests/theme-contrast.test.ts` was written to prevent. So the reference is read
 * out of the stylesheet at module load, and the stylesheet stays the only place
 * a crimson tone is written down.
 */
import type { MonetSchemes, TokenMap } from './monet';

/* ------------------------------------------------------------------ *
 * The schemes
 * ------------------------------------------------------------------ */

export const SCHEME_IDS = ['crimson', 'blue', 'green', 'orange', 'purple', 'teal'] as const;

export type SeedSchemeId = (typeof SCHEME_IDS)[number];

/** A seed scheme, or the wallpaper-derived one. */
export type SchemeId = SeedSchemeId | 'dynamic';

export const SCHEME_CHOICES = [...SCHEME_IDS, 'dynamic'] as const satisfies readonly SchemeId[];

export interface SeedScheme {
	/** Shown in the picker. */
	label: string;
	/** The primary hue in OKLCH degrees. */
	hue: number;
}

/**
 * The six seeds. Crimson is the reference (delta 0), so it reproduces
 * `layout.css` exactly and the picker's default is the audited palette.
 *
 * The hues are spread around the wheel rather than evenly: 17.58 / 45 / 145 /
 * 195 / 250 / 290 leaves a deliberate gap between purple and crimson, because
 * those two are the pair a user is most likely to confuse at a glance.
 */
export const SEED_SCHEMES: Record<SeedSchemeId, SeedScheme> = {
	crimson: { label: 'Crimson', hue: 17.58 },
	blue: { label: 'Blue', hue: 250 },
	green: { label: 'Green', hue: 145 },
	orange: { label: 'Orange', hue: 45 },
	purple: { label: 'Purple', hue: 290 },
	teal: { label: 'Teal', hue: 195 }
};

/** The hue every other scheme is a rotation of. */
export const REFERENCE_HUE = SEED_SCHEMES.crimson.hue;

/** The tertiary family's offset from the seed hue, as `layout.css` defines it. */
const TERTIARY_OFFSET = 60;

/** M3's fixed error hue. Never rotated — see the header. */
const ERROR_HUE = 27;

export function isSchemeId(value: unknown): value is SchemeId {
	return typeof value === 'string' && (SCHEME_CHOICES as readonly string[]).includes(value);
}

export function isSeedSchemeId(value: unknown): value is SeedSchemeId {
	return typeof value === 'string' && (SCHEME_IDS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * Reading the reference palette out of layout.css
 * ------------------------------------------------------------------ */

/**
 * The stylesheet, as text.
 *
 * `?raw` rather than `readFileSync`: the app is a static SPA, so this module is
 * bundled for the browser and there is no filesystem there. Vite inlines the file
 * as a string at build time, which is what makes the reference palette available
 * before first paint without a network request — and it keeps the crimson tones
 * written down in exactly one place.
 */
import layoutCss from '../../routes/layout.css?raw';

interface Oklch {
	L: number;
	C: number;
	h: number;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

function parseOklch(raw: string): Oklch {
	const match = OKLCH_RE.exec(raw.trim());
	if (!match) throw new Error(`"${raw}" is not a bare oklch(L C H) value`);
	return { L: Number(match[1]), C: Number(match[2]), h: Number(match[3]) };
}

/**
 * One top-level `<selector> { ... }` block, as token name -> raw value.
 *
 * The selector is anchored to the start of a line for the same reason the
 * contrast audit anchors it: `@custom-variant dark (&:is(.dark *));` contains the
 * substring `.dark`, and a plain `indexOf` finds that one first.
 */
function readBlock(css: string, selector: string): Record<string, string> {
	const start = css.search(
		new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{`, 'm')
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

/** Every colour token in a block, parsed. Non-colour tokens (`--radius`) are skipped. */
function readPalette(css: string, selector: string): Record<string, Oklch> {
	const out: Record<string, Oklch> = {};
	for (const [name, raw] of Object.entries(readBlock(css, selector))) {
		if (OKLCH_RE.test(raw.trim())) out[name] = parseOklch(raw);
	}
	return out;
}

const REFERENCE = {
	light: readPalette(layoutCss, ':root'),
	dark: readPalette(layoutCss, '.dark')
} as const;

/* ------------------------------------------------------------------ *
 * The rotation
 * ------------------------------------------------------------------ */

/** Round to 3 decimals and drop a trailing `.000`, matching `monet.ts`. */
const round = (value: number): string => {
	const fixed = value.toFixed(3);
	return fixed.endsWith('.000') ? fixed.slice(0, -4) : fixed;
};

const format = ({ L, C, h }: Oklch): string => `oklch(${round(L)} ${round(C)} ${round(h)})`;

/**
 * Which family a token belongs to, decided by its hue in the reference palette.
 *
 * Reading the family off the hue rather than off the token NAME is deliberate:
 * the name says what the role is for, the hue says where the colour came from,
 * and it is the second one that decides whether rotating it is correct. A token
 * whose hue is neither the seed, the tertiary offset, nor error is left alone —
 * that is the safe answer, because an unrotated token is still an audited colour.
 */
function rotateHue(hue: number, delta: number): number {
	const isError = Math.abs(hue - ERROR_HUE) < 0.5;
	if (isError) return hue;

	const isTertiary = Math.abs(hue - (REFERENCE_HUE + TERTIARY_OFFSET)) < 0.5;
	const isSeed = Math.abs(hue - REFERENCE_HUE) < 0.5;
	if (!isSeed && !isTertiary) return hue;

	const rotated = hue + delta;
	return ((rotated % 360) + 360) % 360;
}

/**
 * Rotate one scheme's palette to a target hue.
 *
 * Pure: same input, same output, no DOM. Exported so the test can assert the
 * L/C preservation directly rather than inferring it from the formatted strings.
 */
export function rotatePalette(palette: Record<string, Oklch>, hue: number): Record<string, Oklch> {
	const delta = hue - REFERENCE_HUE;
	const out: Record<string, Oklch> = {};
	for (const [name, colour] of Object.entries(palette)) {
		out[name] = { L: colour.L, C: colour.C, h: rotateHue(colour.h, delta) };
	}
	return out;
}

/** The reference palette for one scheme, before rotation. Exported for the test. */
export function referencePalette(scheme: 'light' | 'dark'): Record<string, Oklch> {
	return REFERENCE[scheme];
}

/**
 * The whole job: a hue in, two token maps out.
 *
 * The keys are exactly the ones `layout.css` declares, so applying the result is
 * a `setProperty` loop over the same names the stylesheet already uses — no
 * translation table, and no token that the stylesheet has but the override
 * forgets (which would leave one role in the old hue).
 */
export function buildSeedSchemes(hue: number): MonetSchemes {
	const build = (scheme: 'light' | 'dark'): TokenMap => {
		const tokens: TokenMap = {};
		for (const [name, colour] of Object.entries(rotatePalette(REFERENCE[scheme], hue))) {
			tokens[`--${name}`] = format(colour);
		}
		return tokens;
	};
	return { light: build('light'), dark: build('dark') };
}

/**
 * The schemes for one seed, computed once.
 *
 * Cached because the picker renders six swatches and the store re-applies on
 * every light/dark flip; recomputing ~120 string formats per call is pure waste
 * when the answer cannot change.
 */
const cache = new Map<SeedSchemeId, MonetSchemes>();

export function getSeedSchemes(id: SeedSchemeId): MonetSchemes {
	const cached = cache.get(id);
	if (cached) return cached;
	const built = buildSeedSchemes(SEED_SCHEMES[id].hue);
	cache.set(id, built);
	return built;
}

/**
 * The swatch colour for a seed: its light-theme primary.
 *
 * Read from the generated scheme rather than from a hand-written hex, so the
 * swatch is literally the colour the app will paint — a swatch that disagrees
 * with the result is the one bug a colour picker cannot afford.
 */
export function seedSwatch(id: SeedSchemeId): string {
	return getSeedSchemes(id).light['--primary'] ?? 'oklch(0.5 0.1 0)';
}
