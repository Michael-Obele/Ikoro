/** Six schemes: hue rotations of the crimson palette in `layout.css`. Contrast depends on L only, so the AAA audit holds for all six; error never rotates. */
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

/** Crimson is delta 0, so the default is the audited palette. Hues are uneven on purpose: purple and crimson must not look alike. */
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

/** Tertiary family's offset from the seed hue, as `layout.css` sets it. */
const TERTIARY_OFFSET = 60;

/** M3's fixed error hue. Never rotated. */
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

/** `?raw`: bundled for the browser, so there is no filesystem — Vite inlines it at build time. */
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

/** One top-level block as token -> value. The selector is line-anchored: `@custom-variant dark` contains `.dark`. */
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

/** Family comes from the reference hue, not the token name. Anything unrecognised is left alone — an unrotated token is still audited. */
function rotateHue(hue: number, delta: number): number {
	const isError = Math.abs(hue - ERROR_HUE) < 0.5;
	if (isError) return hue;

	const isTertiary = Math.abs(hue - (REFERENCE_HUE + TERTIARY_OFFSET)) < 0.5;
	const isSeed = Math.abs(hue - REFERENCE_HUE) < 0.5;
	if (!isSeed && !isTertiary) return hue;

	const rotated = hue + delta;
	return ((rotated % 360) + 360) % 360;
}

/** Rotate one palette to `hue`, preserving L and C. Pure; the test asserts that directly. */
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

/** A hue in, two token maps out, keyed exactly as `layout.css` declares them — no translation table. */
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

/** Per-seed cache: the picker renders six swatches on every flip and the answer cannot change. */
const cache = new Map<SeedSchemeId, MonetSchemes>();

export function getSeedSchemes(id: SeedSchemeId): MonetSchemes {
	const cached = cache.get(id);
	if (cached) return cached;
	const built = buildSeedSchemes(SEED_SCHEMES[id].hue);
	cache.set(id, built);
	return built;
}

/** The colours a picker needs for a miniature. Surfaces change most between schemes; `primary` is near-black, so it only works as the action bar. */
export interface SchemePreview {
	/** The page. */
	surface: string;
	/** A card sitting on the page. */
	container: string;
	/** Buttons, focus ring, the checked switch. */
	primary: string;
	/** Body text. */
	onSurface: string;
	/** Secondary text: timestamps, counts, hints. */
	onSurfaceVariant: string;
	/** Control boundaries — the trim of the whole miniature. */
	outline: string;
}

const PREVIEW_FALLBACK: SchemePreview = {
	surface: 'oklch(0.983 0.012 17.58)',
	container: 'oklch(0.949 0.012 17.58)',
	primary: 'oklch(0.246 0.105 17.58)',
	onSurface: 'oklch(0.225 0.012 17.58)',
	onSurfaceVariant: 'oklch(0.398 0.024 17.58)',
	outline: 'oklch(0.588 0.024 17.58)'
};

/** Preview in the mode currently being painted — a dark-mode user must not be shown light miniatures. */
export function schemePreview(id: SeedSchemeId, mode: 'light' | 'dark'): SchemePreview {
	const scheme = getSeedSchemes(id)[mode];
	return {
		surface: scheme['--background'] ?? PREVIEW_FALLBACK.surface,
		container: scheme['--card'] ?? PREVIEW_FALLBACK.container,
		primary: scheme['--primary'] ?? PREVIEW_FALLBACK.primary,
		onSurface: scheme['--foreground'] ?? PREVIEW_FALLBACK.onSurface,
		onSurfaceVariant: scheme['--muted-foreground'] ?? PREVIEW_FALLBACK.onSurfaceVariant,
		outline: scheme['--border'] ?? PREVIEW_FALLBACK.outline
	};
}
