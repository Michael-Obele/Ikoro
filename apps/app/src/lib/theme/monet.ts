/** M3 tonal palettes -> M3 colour roles + shadcn tokens. Pure, so tests assert exact tones with no device.
 *  Spec tones, not `layout.css`'s AAA-tuned ones — a wallpaper palette is unknown in advance, so dynamic colour is AA-grade by design. */
import type { PaletteName, TonalPalette } from 'ikoro-dynamic-colors';

/** The five palettes, as the plugin returns them. */
export type Palettes = Partial<Record<PaletteName, TonalPalette>>;

/** A role name (without the leading `--`) to a CSS colour value. */
export type TokenMap = Record<string, string>;

export interface MonetSchemes {
	light: TokenMap;
	dark: TokenMap;
}

/** M3's fixed error tones — red in every scheme, never wallpaper-derived. */
const ERROR = {
	light: {
		error: '#b3261e',
		onError: '#ffffff',
		errorContainer: '#f9dedc',
		onErrorContainer: '#410e0b'
	},
	dark: {
		error: '#f2b8b5',
		onError: '#601410',
		errorContainer: '#8c1d18',
		onErrorContainer: '#f9dedc'
	}
} as const;

/** One row per role: `[palette, tone]`, every row the M3 spec's assignment. */
type ToneRef = readonly [PaletteName, number];

interface RoleSpec {
	/** The `--md-sys-color-*` suffix. */
	role: string;
	light: ToneRef;
	dark: ToneRef;
}

const ROLES: readonly RoleSpec[] = [
	// Primary: the wallpaper's dominant hue; light 40/100/90/10, dark 80/20/30/90.
	{ role: 'primary', light: ['accent1', 40], dark: ['accent1', 80] },
	{ role: 'on-primary', light: ['accent1', 100], dark: ['accent1', 20] },
	{ role: 'primary-container', light: ['accent1', 90], dark: ['accent1', 30] },
	{ role: 'on-primary-container', light: ['accent1', 10], dark: ['accent1', 90] },

	// Secondary: a muted version of the same hue.
	{ role: 'secondary', light: ['accent2', 40], dark: ['accent2', 80] },
	{ role: 'on-secondary', light: ['accent2', 100], dark: ['accent2', 20] },
	{ role: 'secondary-container', light: ['accent2', 90], dark: ['accent2', 30] },
	{ role: 'on-secondary-container', light: ['accent2', 10], dark: ['accent2', 90] },

	// Tertiary: the accent that contrasts with primary.
	{ role: 'tertiary', light: ['accent3', 40], dark: ['accent3', 80] },
	{ role: 'on-tertiary', light: ['accent3', 100], dark: ['accent3', 20] },
	{ role: 'tertiary-container', light: ['accent3', 90], dark: ['accent3', 30] },
	{ role: 'on-tertiary-container', light: ['accent3', 10], dark: ['accent3', 90] },

	// Surfaces: neutral1 is the page, neutral2 the variant/outline family.
	{ role: 'surface', light: ['neutral1', 99], dark: ['neutral1', 10] },
	{ role: 'on-surface', light: ['neutral1', 10], dark: ['neutral1', 90] },
	{ role: 'surface-variant', light: ['neutral2', 90], dark: ['neutral2', 30] },
	{ role: 'on-surface-variant', light: ['neutral2', 30], dark: ['neutral2', 80] },

	// Container ladder: light 100/96/94/92/90, dark 4/10/12/17/22.
	{ role: 'surface-container-lowest', light: ['neutral1', 100], dark: ['neutral1', 4] },
	{ role: 'surface-container-low', light: ['neutral1', 96], dark: ['neutral1', 10] },
	{ role: 'surface-container', light: ['neutral1', 94], dark: ['neutral1', 12] },
	{ role: 'surface-container-high', light: ['neutral1', 92], dark: ['neutral1', 17] },
	{ role: 'surface-container-highest', light: ['neutral1', 90], dark: ['neutral1', 22] },

	// `outline` is the strong boundary, `outline-variant` the hairline.
	{ role: 'outline', light: ['neutral2', 50], dark: ['neutral2', 60] },
	{ role: 'outline-variant', light: ['neutral2', 80], dark: ['neutral2', 30] },

	// Inverse roles, for snackbars and tooltips: the opposite scheme's surface.
	{ role: 'inverse-surface', light: ['neutral1', 20], dark: ['neutral1', 90] },
	{ role: 'inverse-on-surface', light: ['neutral1', 95], dark: ['neutral1', 20] },

	// Scrim: neutral1 tone 0 in both schemes.
	{ role: 'scrim', light: ['neutral1', 0], dark: ['neutral1', 0] }
] as const;

/** shadcn aliases, transcribed from `layout.css`'s mapping table — that table is the contract, so no derivation. */
const ALIASES: Readonly<Record<string, string>> = {
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

/* ------------------------------------------------------------------ *
 * Colour maths
 * ------------------------------------------------------------------ */

type Rgb = readonly [number, number, number];

/** `#rrggbb` (or `#rgb`) -> gamma-encoded sRGB in 0..1. Throws on anything else. */
export function hexToRgb(hex: string): Rgb {
	const raw = hex.trim().replace(/^#/, '');
	const full =
		raw.length === 3
			? raw
					.split('')
					.map((c) => c + c)
					.join('')
			: raw;
	if (!/^[0-9a-fA-F]{6}$/.test(full)) {
		throw new Error(`"${hex}" is not a #rrggbb colour`);
	}
	return [
		Number.parseInt(full.slice(0, 2), 16) / 255,
		Number.parseInt(full.slice(2, 4), 16) / 255,
		Number.parseInt(full.slice(4, 6), 16) / 255
	] as const;
}

const toLinear = (c: number): number =>
	c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** sRGB -> OKLCH per CSS Color 4; the same matrices the contrast test inverts. */
export function rgbToOklch(rgb: Rgb): { L: number; C: number; h: number } {
	const [r, g, b] = rgb.map(toLinear) as unknown as Rgb;

	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

	const C = Math.sqrt(a * a + bb * bb);
	let h = (Math.atan2(bb, a) * 180) / Math.PI;
	if (h < 0) h += 360;
	return { L, C, h };
}

/** Round to 3 decimals and drop a trailing `.000`, so the output is stable. */
const round = (value: number): string => {
	const fixed = value.toFixed(3);
	return fixed.endsWith('.000') ? fixed.slice(0, -4) : fixed;
};

/** Format as `oklch(L C H)`; a near-grey's hue is noise, so it is written as 0. */
function formatOklch(L: number, C: number, h: number): string {
	// Normalise so a 360.x overshoot cannot emit a hue the CSS parser rejects.
	const hue = C < 0.0005 ? 0 : ((h % 360) + 360) % 360;
	return `oklch(${round(L)} ${round(C)} ${round(hue)})`;
}

export function hexToOklch(hex: string): string {
	const { L, C, h } = rgbToOklch(hexToRgb(hex));
	return formatOklch(L, C, h);
}

/** `#rrggbb` -> CIE L*, which is what Material calls a tone — NOT OKLCH's L (a ~15-tone gap on dark surfaces). */
export function hexToTone(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map(toLinear) as unknown as Rgb;
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return y > 0.008856451679 ? 116 * Math.cbrt(y) - 16 : 903.296296296 * y;
}

/* ------------------------------------------------------------------ *
 * The mapping
 * ------------------------------------------------------------------ */

/**
 * Tone lookup, interpolated in OKLCH between the bracketing tones. Android ships only 13
 * coarse tones but M3 asks for 4/12/17/92.., and a nearest-tone snap flattened the scheme.
 * The palette KEY is ignored: `_600` is tone ~43, not 600, so the tone is measured.
 */
function toneOklch(palette: TonalPalette | undefined, wanted: number): string | null {
	if (!palette) return null;
	const tones = paletteTones(palette);
	if (tones.length === 0) return null;

	const exact = tones.find((t) => Math.abs(t.tone - wanted) <= TONE_SNAP);
	if (exact) return hexToOklch(exact.hex);

	const first = tones[0]!;
	const last = tones[tones.length - 1]!;
	if (wanted <= first.tone) return hexToOklch(first.hex);
	if (wanted >= last.tone) return hexToOklch(last.hex);

	// The last tone below `wanted`, the first above it.
	let low = first;
	let high = last;
	for (const tone of tones) {
		if (tone.tone <= wanted) low = tone;
		else {
			high = tone;
			break;
		}
	}
	if (high.tone - low.tone < 1e-6) return hexToOklch(low.hex);

	const a = rgbToOklch(hexToRgb(low.hex));
	const b = rgbToOklch(hexToRgb(high.hex));
	const t = (wanted - low.tone) / (high.tone - low.tone);

	// Hue takes the short arc: 350° -> 10° must pass through 0, not through 180.
	let dh = b.h - a.h;
	if (dh > 180) dh -= 360;
	if (dh < -180) dh += 360;

	return formatOklch(a.L + (b.L - a.L) * t, a.C + (b.C - a.C) * t, a.h + dh * t);
}

/** One available colour, with the tone it actually is. */
interface PaletteTone {
	tone: number;
	hex: string;
}

/** 8-bit sRGB means tone 40 measures 39.9; a wider snap would pull roles onto neighbouring tones. */
const TONE_SNAP = 0.75;

/** Palette as tones sorted light->dark, keys dropped, duplicate hexes removed (a zero-width step would divide by zero). */
function paletteTones(palette: TonalPalette): PaletteTone[] {
	const seen = new Set<string>();
	const tones: PaletteTone[] = [];
	for (const value of Object.values(palette)) {
		if (typeof value !== 'string' || seen.has(value)) continue;
		try {
			tones.push({ tone: hexToTone(value), hex: value });
			seen.add(value);
		} catch {
			// Malformed value: skip it, the caller omits the role and keeps the static colour.
		}
	}
	return tones.sort((a, b) => a.tone - b.tone);
}

/** A role whose palette is missing is OMITTED, so the static stylesheet value survives instead of being guessed. */
function buildScheme(palettes: Palettes, scheme: 'light' | 'dark'): TokenMap {
	const roles: TokenMap = {};

	for (const spec of ROLES) {
		const [paletteName, wanted] = spec[scheme];
		const value = toneOklch(palettes[paletteName], wanted);
		if (value) roles[spec.role] = value;
	}

	// Error is fixed, not wallpaper-derived.
	for (const [role, hex] of Object.entries(ERROR[scheme])) {
		const kebab = role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
		roles[kebab] = hexToOklch(hex);
	}

	const tokens: TokenMap = {};
	for (const [role, value] of Object.entries(roles)) {
		tokens[`--md-sys-color-${role}`] = value;
	}
	for (const [alias, role] of Object.entries(ALIASES)) {
		const value = roles[role];
		if (value) tokens[`--${alias}`] = value;
	}
	return tokens;
}

/** Palettes in, light+dark token maps out. Pure — no DOM, no clock. */
export function buildMonetSchemes(palettes: Palettes): MonetSchemes {
	return {
		light: buildScheme(palettes, 'light'),
		dark: buildScheme(palettes, 'dark')
	};
}

/** `setProperty`, not a style string: these values come from device data and a `;` would break out. */
export function applyTokens(root: HTMLElement, tokens: TokenMap): void {
	for (const [name, value] of Object.entries(tokens)) {
		root.style.setProperty(name, value);
	}
}

/** Remove every token a previous `applyTokens` wrote, restoring the static scheme. */
export function clearTokens(root: HTMLElement, tokens: TokenMap): void {
	for (const name of Object.keys(tokens)) {
		root.style.removeProperty(name);
	}
}
