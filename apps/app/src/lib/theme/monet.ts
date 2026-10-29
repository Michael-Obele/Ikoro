/**
 * Material 3 tonal palettes -> M3 colour roles, in plain TypeScript.
 *
 * WHY THIS IS NOT IN KOTLIN. The native plugin (`ikoro-dynamic-colors`) reads the
 * five palettes Android derives from the wallpaper and stops there. The mapping
 * from tones to roles is the part that can be wrong in a way nobody notices until
 * a screen looks broken, so it lives here, where `tests/dynamic-colors.test.ts`
 * can feed it known hexes and assert the exact tone each role landed on — no
 * device, no emulator, no screenshot.
 *
 * THE MAPPING IS THE M3 SPEC'S, NOT THIS APP'S. `routes/layout.css` deliberately
 * deviates from the spec tones to clear a WCAG AAA gate (see the long comment at
 * the top of that file: light `primary` is tone 13, not 40, because `--ring` is
 * `--primary` at 50% alpha and has to clear 3:1). Those deviations are measured
 * against the BRAND palette, where the author could tune each tone by hand. A
 * wallpaper palette is not known in advance, so there is nothing to tune: this
 * module emits the spec mapping and the app accepts that dynamic colour is an
 * AA-grade scheme. Pretending otherwise would mean shipping a contrast claim the
 * code cannot keep.
 *
 * WHAT IT RETURNS. Two token maps keyed by the SAME names `layout.css` uses —
 * `--md-sys-color-*` for the M3 roles and the shadcn aliases (`--primary`,
 * `--background`, ...) — so applying them is a loop of `setProperty`, not a
 * translation table. Values are `oklch()` strings, matching the stylesheet's
 * format, because `tests/theme-contrast.test.ts` refuses anything else and
 * because a hex written into a token that the audit parses would fail the gate
 * the moment someone pointed the audit at the dynamic scheme.
 */
import type { PaletteName, TonalPalette } from 'ikoro-dynamic-colors';

/** The five palettes, as the plugin returns them. */
export type Palettes = Partial<Record<PaletteName, TonalPalette>>;

/** A role name (without the leading `--`) to a CSS colour value. */
export type TokenMap = Record<string, string>;

export interface MonetSchemes {
	light: TokenMap;
	dark: TokenMap;
}

/**
 * M3's fixed error palette, in hex.
 *
 * Error is NOT derived from the wallpaper: M3 keeps it red in every scheme so
 * "this is destructive" never depends on what photo the user chose. These are the
 * baseline M3 error tones (the same values Material Theme Builder emits for the
 * default error palette).
 */
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

/**
 * THE TONE TABLE. One row per role, one column per scheme.
 *
 * `[palette, tone]` — read it as "this role is that palette's tone N". Every row
 * is the M3 spec's assignment; the comment on each group says which part of the
 * spec it comes from.
 */
type ToneRef = readonly [PaletteName, number];

interface RoleSpec {
	/** The `--md-sys-color-*` suffix. */
	role: string;
	light: ToneRef;
	dark: ToneRef;
}

const ROLES: readonly RoleSpec[] = [
	// Primary: the wallpaper's dominant hue. Light uses the 40/100/90/10 quartet,
	// dark the 80/20/30/90 one — the standard M3 inversion.
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

	// The container ladder. M3's own steps: lowest 100, low 96, base 94, high 92,
	// highest 90 in light; 4, 10, 12, 17, 22 in dark.
	{ role: 'surface-container-lowest', light: ['neutral1', 100], dark: ['neutral1', 4] },
	{ role: 'surface-container-low', light: ['neutral1', 96], dark: ['neutral1', 10] },
	{ role: 'surface-container', light: ['neutral1', 94], dark: ['neutral1', 12] },
	{ role: 'surface-container-high', light: ['neutral1', 92], dark: ['neutral1', 17] },
	{ role: 'surface-container-highest', light: ['neutral1', 90], dark: ['neutral1', 22] },

	// Outlines. `outline` is the strong boundary, `outline-variant` the hairline.
	{ role: 'outline', light: ['neutral2', 50], dark: ['neutral2', 60] },
	{ role: 'outline-variant', light: ['neutral2', 80], dark: ['neutral2', 30] },

	// Inverse roles, for snackbars and tooltips: the opposite scheme's surface.
	{ role: 'inverse-surface', light: ['neutral1', 20], dark: ['neutral1', 90] },
	{ role: 'inverse-on-surface', light: ['neutral1', 95], dark: ['neutral1', 20] },

	// Scrim is always near-black; M3 uses neutral1 tone 0.
	{ role: 'scrim', light: ['neutral1', 0], dark: ['neutral1', 0] }
] as const;

/**
 * The shadcn aliases, transcribed from the mapping table at the top of
 * `routes/layout.css`. Kept as a table rather than derived, because the
 * stylesheet's table IS the contract and a derivation would be a second
 * implementation of it.
 */
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

/**
 * sRGB -> OKLCH, per CSS Color 4.
 *
 * The inverse of the matrices in `tests/theme-contrast.test.ts`, so a value this
 * module writes and a value that audit reads are measured the same way.
 */
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

/**
 * OKLCH components -> the stylesheet's own `oklch(L C H)` string.
 *
 * A near-grey has an arbitrary hue (atan2 of two tiny numbers), so its hue is
 * written as 0 rather than as noise that changes between two identical greys.
 * Chroma below 0.0005 is the threshold: at that point the hue is not visible.
 * Every oklch string this module emits goes through here — the direct
 * conversion and the interpolation below — so the format is one definition.
 */
function formatOklch(L: number, C: number, h: number): string {
	const hue = C < 0.0005 ? 0 : h;
	return `oklch(${round(L)} ${round(C)} ${round(hue)})`;
}

/**
 * `#rrggbb` -> `oklch(L C H)` in the stylesheet's own format.
 */
export function hexToOklch(hex: string): string {
	const { L, C, h } = rgbToOklch(hexToRgb(hex));
	return formatOklch(L, C, h);
}

/* ------------------------------------------------------------------ *
 * The mapping
 * ------------------------------------------------------------------ */

/**
 * Look up one tone, interpolating between the two that bracket it when the
 * palette does not carry it exactly.
 *
 * THE COARSE GRID IS THE WHOLE PROBLEM THIS SOLVES. Android publishes only
 * thirteen tones per palette — 0, 10, 50, 100..1000 (verified against the
 * `R.color.system_accent1_*` reference) — but the M3 role table asks for fine
 * tones like 4, 12, 17, 22, 30, 40, 92..99. The old "nearest tone" fallback
 * snapped each of those onto the coarse grid: in dark mode every container tone
 * (4, 12, 17, 22) landed on 10 — the same tone as `surface` itself — and
 * `outline-variant` (30, which draws every input border) snapped to 10 too. The
 * scheme went flat and its control boundaries disappeared, which is what made
 * the dynamic scheme unreadable on a real device while the synthetic unit-test
 * fixture (which carried every wanted tone) stayed green.
 *
 * So: an exact hit is returned verbatim; otherwise the value is interpolated in
 * OKLCH between the two bracketing tones. Linear in L keeps the tone ladder
 * monotonic; hue takes the short way round. A wanted tone outside the palette
 * clamps to the nearest end, which is the honest answer for an OEM that dropped
 * a resource — a real colour from this palette, never an invented one.
 */
function toneOklch(palette: TonalPalette | undefined, wanted: number): string | null {
	if (!palette) return null;
	const exact = palette[String(wanted)];
	if (exact) return hexToOklch(exact);

	const available = Object.keys(palette)
		.map(Number)
		.filter((n) => Number.isFinite(n))
		.sort((a, b) => a - b);
	if (available.length === 0) return null;

	const nearest = (target: number): number => {
		let best = available[0] as number;
		for (const candidate of available) {
			if (Math.abs(candidate - target) < Math.abs(best - target)) best = candidate;
		}
		return best;
	};

	const first = available[0] as number;
	if (wanted <= first) return hexToOklch(palette[String(first)]!);
	const last = available[available.length - 1] as number;
	if (wanted >= last) return hexToOklch(palette[String(last)]!);

	// The two bracketing tones: the last one below `wanted`, the first above it.
	const low = nearestBelow(available, wanted) ?? nearest(wanted);
	const high = available.find((t) => t > low) ?? last;

	const a = rgbToOklch(hexToRgb(palette[String(low)]!));
	const b = rgbToOklch(hexToRgb(palette[String(high)]!));
	const t = (wanted - low) / (high - low);

	// Hue takes the short arc: 350° -> 10° must pass through 0, not through 180.
	let dh = b.h - a.h;
	if (dh > 180) dh -= 360;
	if (dh < -180) dh += 360;
	let h = a.h + dh * t;
	if (h < 0) h += 360;

	return formatOklch(a.L + (b.L - a.L) * t, a.C + (b.C - a.C) * t, h);
}

function nearestBelow(available: number[], wanted: number): number | null {
	let best: number | null = null;
	for (const tone of available) {
		if (tone < wanted && (best === null || tone > best)) best = tone;
	}
	return best;
}

/**
 * Build one scheme's token map.
 *
 * A role whose palette is missing is OMITTED rather than written as a guess. The
 * caller applies the map over the static stylesheet, so an omitted role keeps the
 * static value — which is a real, contrast-checked colour — instead of being
 * overwritten with something invented.
 */
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

/**
 * The whole job: five palettes in, two token maps out.
 *
 * Pure. No DOM, no Capacitor, no clock — which is what makes it testable in the
 * node environment and what makes the theme store's job a `setProperty` loop.
 */
export function buildMonetSchemes(palettes: Palettes): MonetSchemes {
	return {
		light: buildScheme(palettes, 'light'),
		dark: buildScheme(palettes, 'dark')
	};
}

/**
 * Write a token map onto an element as CSS custom properties.
 *
 * `style.setProperty` rather than a `style` attribute string: a value containing
 * a `;` would break out of an attribute, and the values here are generated from
 * device data. Inline custom properties beat the stylesheet's `:root` and `.dark`
 * blocks by specificity, which is exactly the override this needs.
 */
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
