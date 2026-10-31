import { describe, expect, it } from 'vitest';
import {
	buildMonetSchemes,
	clearTokens,
	hexToOklch,
	hexToRgb,
	hexToTone,
	applyTokens,
	type Palettes
} from '#lib/theme/monet';
import type { TonalPalette } from 'ikoro-dynamic-colors';

/**
 * Guards the tone -> M3 role mapping from synthetic palettes whose every tone is a distinct hex, so a mis-mapped role fails instead of looking "roughly right". What it cannot catch: what a real Android device returns.
 */

/** Linear-light -> gamma sRGB. The transfer function `hexToRgb` undoes. */
function encode(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** `oklch(L C H)` -> `#rrggbb`, clamped into sRGB — used to build fixtures. */
function oklchHex(L: number, C: number, h: number): string {
	const rad = (h * Math.PI) / 180;
	const a = C * Math.cos(rad);
	const bb = C * Math.sin(rad);
	const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
	const channels = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	].map((c) => Math.round(Math.min(1, Math.max(0, encode(c))) * 255));
	return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance of a linear-sRGB triple, straight out of WCAG 2.1. */
function linearY(r: number, g: number, b: number): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * The colour whose CIE L* (Material's tone axis) is exactly `tone`, solved by bisecting OKLCH L — a tone is measured from the colour, never read from a key.
 */
function toneHex(tone: number, chroma: number, hue: number): string {
	// tone -> relative luminance, the CIE L* definition (linear branch below 8).
	const targetY = tone >= 8 ? ((tone + 16) / 116) ** 3 : tone / 903.296296296;
	let low = 0;
	let high = 1;
	for (let i = 0; i < 32; i++) {
		const mid = (low + high) / 2;
		const [r, g, b] = hexToRgb(oklchHex(mid, chroma, hue)).map(toLinear) as [number, number, number];
		if (linearY(r, g, b) < targetY) low = mid;
		else high = mid;
	}
	return oklchHex((low + high) / 2, chroma, hue);
}

/** One hue per palette, so a role reading the wrong palette is as visible as a wrong tone. */
function palette(hue: number, tones: number[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const tone of tones) out[String(tone)] = toneHex(tone, 0.03, hue);
	return out;
}

const TONES = [0, 4, 10, 12, 17, 20, 22, 30, 40, 50, 60, 80, 90, 92, 94, 95, 96, 99, 100];

const PALETTES: Palettes = {
	accent1: palette(20, TONES),
	accent2: palette(140, TONES),
	accent3: palette(260, TONES),
	neutral1: palette(80, TONES),
	neutral2: palette(320, TONES)
};

/** The hex a role should have landed on, read straight out of the fixture. */
const hexOf = (name: keyof Palettes, tone: number): string => PALETTES[name]![String(tone)]!;

const schemes = buildMonetSchemes(PALETTES);

describe('buildMonetSchemes — light', () => {
	it('maps primary to accent1 tone 40, on-primary to tone 100', () => {
		expect(schemes.light['--md-sys-color-primary']).toBe(hexToOklch(hexOf('accent1', 40)));
		expect(schemes.light['--md-sys-color-on-primary']).toBe(hexToOklch(hexOf('accent1', 100)));
	});

	it('maps the primary container pair to tones 90 and 10', () => {
		expect(schemes.light['--md-sys-color-primary-container']).toBe(
			hexToOklch(hexOf('accent1', 90))
		);
		expect(schemes.light['--md-sys-color-on-primary-container']).toBe(
			hexToOklch(hexOf('accent1', 10))
		);
	});

	it('maps secondary to accent2 and tertiary to accent3, both at tone 40', () => {
		expect(schemes.light['--md-sys-color-secondary']).toBe(hexToOklch(hexOf('accent2', 40)));
		expect(schemes.light['--md-sys-color-tertiary']).toBe(hexToOklch(hexOf('accent3', 40)));
	});

	it('maps surface to neutral1 tone 99 and on-surface to tone 10', () => {
		expect(schemes.light['--md-sys-color-surface']).toBe(hexToOklch(hexOf('neutral1', 99)));
		expect(schemes.light['--md-sys-color-on-surface']).toBe(hexToOklch(hexOf('neutral1', 10)));
	});

	it('maps outline to neutral2 tone 50 and outline-variant to tone 80', () => {
		expect(schemes.light['--md-sys-color-outline']).toBe(hexToOklch(hexOf('neutral2', 50)));
		expect(schemes.light['--md-sys-color-outline-variant']).toBe(hexToOklch(hexOf('neutral2', 80)));
	});

	it('maps the surface container ladder to 100/96/94/92/90', () => {
		expect(schemes.light['--md-sys-color-surface-container-lowest']).toBe(
			hexToOklch(hexOf('neutral1', 100))
		);
		expect(schemes.light['--md-sys-color-surface-container-low']).toBe(
			hexToOklch(hexOf('neutral1', 96))
		);
		expect(schemes.light['--md-sys-color-surface-container']).toBe(
			hexToOklch(hexOf('neutral1', 94))
		);
		expect(schemes.light['--md-sys-color-surface-container-high']).toBe(
			hexToOklch(hexOf('neutral1', 92))
		);
		expect(schemes.light['--md-sys-color-surface-container-highest']).toBe(
			hexToOklch(hexOf('neutral1', 90))
		);
	});
});

describe('buildMonetSchemes — dark', () => {
	it('inverts primary: tone 80 with on-primary at tone 20', () => {
		expect(schemes.dark['--md-sys-color-primary']).toBe(hexToOklch(hexOf('accent1', 80)));
		expect(schemes.dark['--md-sys-color-on-primary']).toBe(hexToOklch(hexOf('accent1', 20)));
	});

	it('inverts the primary container pair to tones 30 and 90', () => {
		expect(schemes.dark['--md-sys-color-primary-container']).toBe(hexToOklch(hexOf('accent1', 30)));
		expect(schemes.dark['--md-sys-color-on-primary-container']).toBe(
			hexToOklch(hexOf('accent1', 90))
		);
	});

	it('maps surface to neutral1 tone 10 and on-surface to tone 90', () => {
		expect(schemes.dark['--md-sys-color-surface']).toBe(hexToOklch(hexOf('neutral1', 10)));
		expect(schemes.dark['--md-sys-color-on-surface']).toBe(hexToOklch(hexOf('neutral1', 90)));
	});

	it('maps outline to neutral2 tone 60 and outline-variant to tone 30', () => {
		expect(schemes.dark['--md-sys-color-outline']).toBe(hexToOklch(hexOf('neutral2', 60)));
		expect(schemes.dark['--md-sys-color-outline-variant']).toBe(hexToOklch(hexOf('neutral2', 30)));
	});

	it('maps the surface container ladder to 4/10/12/17/22', () => {
		expect(schemes.dark['--md-sys-color-surface-container-lowest']).toBe(
			hexToOklch(hexOf('neutral1', 4))
		);
		expect(schemes.dark['--md-sys-color-surface-container-low']).toBe(
			hexToOklch(hexOf('neutral1', 10))
		);
		expect(schemes.dark['--md-sys-color-surface-container']).toBe(
			hexToOklch(hexOf('neutral1', 12))
		);
		expect(schemes.dark['--md-sys-color-surface-container-high']).toBe(
			hexToOklch(hexOf('neutral1', 17))
		);
		expect(schemes.dark['--md-sys-color-surface-container-highest']).toBe(
			hexToOklch(hexOf('neutral1', 22))
		);
	});
});

describe('buildMonetSchemes — the shadcn aliases', () => {
	it('points every alias at the same value as its M3 role', () => {
		// Guards the alias table against drifting from layout.css's mapping.
		const pairs: [string, string][] = [
			['--background', '--md-sys-color-surface'],
			['--foreground', '--md-sys-color-on-surface'],
			['--card', '--md-sys-color-surface-container'],
			['--popover', '--md-sys-color-surface-container-high'],
			['--primary', '--md-sys-color-primary'],
			['--primary-foreground', '--md-sys-color-on-primary'],
			['--secondary', '--md-sys-color-secondary-container'],
			['--muted-foreground', '--md-sys-color-on-surface-variant'],
			['--destructive', '--md-sys-color-error'],
			['--border', '--md-sys-color-outline-variant'],
			['--ring', '--md-sys-color-primary'],
			['--sidebar', '--md-sys-color-surface']
		];
		for (const scheme of ['light', 'dark'] as const) {
			for (const [alias, role] of pairs) {
				expect(schemes[scheme][alias], `${scheme} ${alias}`).toBe(schemes[scheme][role]);
			}
		}
	});

	it('keeps error fixed rather than wallpaper-derived', () => {
		// M3 keeps error red in every scheme, so no wallpaper may move it.
		const other = buildMonetSchemes({
			...PALETTES,
			accent1: palette(0, TONES)
		});
		expect(other.light['--md-sys-color-error']).toBe(schemes.light['--md-sys-color-error']);
		expect(other.dark['--md-sys-color-error']).toBe(schemes.dark['--md-sys-color-error']);
	});
});

describe('buildMonetSchemes — degradation', () => {
	it('omits roles whose palette is missing instead of inventing a colour', () => {
		const partial = buildMonetSchemes({ accent1: PALETTES.accent1 });
		expect(partial.light['--md-sys-color-primary']).toBeDefined();
		// The caller keeps the static stylesheet's contrast-checked surface instead.
		expect(partial.light['--md-sys-color-surface']).toBeUndefined();
		expect(partial.light['--background']).toBeUndefined();
	});

	it('falls back to the nearest tone when one is absent', () => {
		const sparse = buildMonetSchemes({
			...PALETTES,
			accent1: { '40': '#123456' }
		});
		// Tone 80 is missing, so dark primary falls back to the only tone there is.
		expect(sparse.dark['--md-sys-color-primary']).toBe(hexToOklch('#123456'));
	});

	it('returns empty maps for empty palettes rather than throwing', () => {
		const empty = buildMonetSchemes({});
		// Error is fixed, so it survives; everything wallpaper-derived does not.
		expect(empty.light['--md-sys-color-error']).toBeDefined();
		expect(empty.light['--md-sys-color-primary']).toBeUndefined();
	});
});

describe('hexToOklch', () => {
	it('converts the sRGB primaries to the known OKLCH values', () => {
		// Reference values from CSS Color 4, asserted to 2 decimals — the output is rounded to 3.
		expect(hexToOklch('#ff0000')).toMatch(/^oklch\(0\.628 0\.258 29\.2\d*\)$/);
		expect(hexToOklch('#00ff00')).toMatch(/^oklch\(0\.866 0\.295 142\.\d+\)$/);
		expect(hexToOklch('#0000ff')).toMatch(/^oklch\(0\.452 0\.313 264\.\d+\)$/);
	});

	it('writes black and white with zero chroma and zero hue', () => {
		expect(hexToOklch('#000000')).toBe('oklch(0 0 0)');
		expect(hexToOklch('#ffffff')).toBe('oklch(1 0 0)');
	});

	it('accepts the three-digit form', () => {
		expect(hexToOklch('#f00')).toBe(hexToOklch('#ff0000'));
	});

	it('rejects anything that is not a hex colour', () => {
		expect(() => hexToRgb('rebeccapurple')).toThrow(/not a #rrggbb colour/);
		expect(() => hexToRgb('#12345')).toThrow(/not a #rrggbb colour/);
	});
});

describe('buildMonetSchemes — the REAL Android tone grid', () => {
	/**
	 * Android's real grid is 0, 10, 50, 100..1000 — none of M3's fine tones exist, so this fixture exercises the fallback path a device does.
	 */
	const REAL_TONES = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
	const REAL: Palettes = {
		accent1: palette(20, REAL_TONES),
		accent2: palette(140, REAL_TONES),
		accent3: palette(260, REAL_TONES),
		neutral1: palette(80, REAL_TONES),
		neutral2: palette(320, REAL_TONES)
	};
	const real = buildMonetSchemes(REAL);

	/** OKLCH lightness out of a token string, for ordering assertions. */
	const L = (token: string | undefined): number => Number(token?.split(' ')[0]?.slice(6));

	it('keeps the dark container ladder strictly ordered instead of collapsing to tone 10', () => {
		const ladder = [
			real.dark['--md-sys-color-surface-container-lowest'], // tone 4, between 0 and 10
			real.dark['--md-sys-color-surface-container'], //       tone 12, between 10 and 50
			real.dark['--md-sys-color-surface-container-high'], //  tone 17
			real.dark['--md-sys-color-surface-container-highest'] // tone 22
		].map(L);
		for (let i = 1; i < ladder.length; i++) {
			expect(ladder[i] as number, `ladder step ${i}`).toBeGreaterThan(ladder[i - 1] as number);
		}
		// Guarded bug: snapping everything to tone 10 made dark cards equal the surface.
		expect(real.dark['--card']).not.toBe(real.dark['--background']);
		expect(real.dark['--muted']).not.toBe(real.dark['--background']);
		expect(real.light['--card']).not.toBe(real.light['--background']);
	});

	it('keeps dark outline-variant (every input border) off the surface tone', () => {
		// Tone 30 used to snap to 10, so borders matched the page; it must sit between 10 and 50.
		const border = L(real.dark['--border']);
		expect(border).toBeGreaterThan(L(hexToOklch(REAL.neutral1!['10']!)));
		expect(border).toBeLessThan(L(hexToOklch(REAL.neutral2!['50']!)));
		expect(real.dark['--border']).not.toBe(real.dark['--background']);
		expect(real.light['--border']).not.toBe(real.light['--background']);
	});

	it('returns available tones verbatim — interpolation never touches an exact hit', () => {
		// Only 0, 10, 50 and 100 are exact hits here; the rest is interpolated.
		expect(real.dark['--md-sys-color-surface']).toBe(hexToOklch(REAL.neutral1!['10']!));
		expect(real.light['--md-sys-color-on-surface']).toBe(hexToOklch(REAL.neutral1!['10']!));
		expect(real.light['--md-sys-color-scrim']).toBe(hexToOklch(REAL.neutral1!['0']!));
		// Light surface is tone 99, which this grid lacks, so it must be a colour the grid does not contain.
		expect(real.light['--md-sys-color-surface']).not.toBe(
			hexToOklch(REAL.neutral1!['50']!)
		);
		expect(L(real.light['--md-sys-color-surface'])).toBeGreaterThan(
			L(hexToOklch(REAL.neutral1!['50']!))
		);
	});

	it('still emits every alias its role has, so no token goes half-populated', () => {
		for (const scheme of ['light', 'dark'] as const) {
			expect(real[scheme]['--background']).toBeDefined();
			expect(real[scheme]['--foreground']).toBeDefined();
			expect(real[scheme]['--border']).toBeDefined();
			expect(real[scheme]['--input']).toBeDefined();
		}
	});
});

/**
 * Verbatim from `IkoroDynamicColors.getPalettes()` on a Pixel 10 Pro XL, Android 17 (2026-10-31). The suffixes are shade indices, not tones: `_0` is #ffffff, `_1000` is #000000.
 */
const DEVICE: Palettes = {
	accent1: {
		'0': '#ffffff',
		'10': '#fffbff',
		'50': '#ffedec',
		'100': '#ffdad9',
		'200': '#ffb3b3',
		'300': '#ff888c',
		'400': '#f85965',
		'500': '#d6404e',
		'600': '#b32538',
		'700': '#910423',
		'800': '#680015',
		'900': '#40000a',
		'1000': '#000000'
	},
	accent2: {
		'0': '#ffffff',
		'10': '#fffbff',
		'50': '#ffecef',
		'100': '#ffd9e0',
		'200': '#ffb1c4',
		'300': '#ff85a8',
		'400': '#e06a8d',
		'500': '#c15174',
		'600': '#a1385b',
		'700': '#832044',
		'800': '#64042e',
		'900': '#3f001a',
		'1000': '#000000'
	},
	accent3: {
		'0': '#ffffff',
		'10': '#fffbff',
		'50': '#f8edff',
		'100': '#ecdcff',
		'200': '#d6baff',
		'300': '#c197ff',
		'400': '#a67be6',
		'500': '#8b61ca',
		'600': '#7148af',
		'700': '#592e95',
		'800': '#41107e',
		'900': '#280056',
		'1000': '#000000'
	},
	neutral1: {
		'0': '#ffffff',
		'10': '#fffbff',
		'50': '#ffecef',
		'100': '#ffd9e0',
		'200': '#f7b5c4',
		'300': '#d99aa9',
		'400': '#bc808f',
		'500': '#9f6775',
		'600': '#834f5d',
		'700': '#683845',
		'800': '#4e222f',
		'900': '#350e1a',
		'1000': '#000000'
	},
	neutral2: {
		'0': '#ffffff',
		'10': '#fffbff',
		'50': '#ffecef',
		'100': '#ffd9e0',
		'200': '#ffb1c4',
		'300': '#e594a9',
		'400': '#c77a8e',
		'500': '#aa6175',
		'600': '#8d495c',
		'700': '#713345',
		'800': '#551c2f',
		'900': '#3a071a',
		'1000': '#000000'
	}
};

describe('buildMonetSchemes — what a real Android device returns', () => {
	const device = buildMonetSchemes(DEVICE);

	/** OKLCH lightness out of a token string, for ordering assertions. */
	const L = (token: string | undefined): number => Number(token?.split(' ')[0]?.slice(6));

	/** Relative luminance of a token, measured through the same maths the browser uses. */
	function luminance(token: string | undefined): number {
		const match = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(token ?? '');
		if (!match) throw new Error(`not a colour token: ${token}`);
		const [r, g, b] = hexToRgb(
			oklchHex(Number(match[1]), Number(match[2]), Number(match[3]))
		).map(toLinear) as [number, number, number];
		return linearY(r, g, b);
	}

	function contrast(a: string | undefined, b: string | undefined): number {
		const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
			number,
			number
		];
		return (light + 0.05) / (dark + 0.05);
	}

	it('ignores the tone keys entirely — relabelling the palette changes nothing', () => {
		// The tone is measured from the colour, so renaming or reversing the keys must not move a byte.
		const scrambled: Palettes = {};
		for (const [name, tones] of Object.entries(DEVICE) as [keyof Palettes, TonalPalette][]) {
			const relabelled: TonalPalette = {};
			let index = 0;
			for (const hex of Object.values(tones)) relabelled[`colour${index++}`] = hex;
			scrambled[name] = relabelled;
		}
		expect(buildMonetSchemes(scrambled)).toEqual(device);
	});

	it('puts body text above 7:1 in both schemes', () => {
		// The shipped bug: suffixes read as tones gave near-white ink on a near-white page (1.04:1 on device).
		expect(contrast(device.light['--foreground'], device.light['--background'])).toBeGreaterThan(7);
		expect(contrast(device.dark['--foreground'], device.dark['--background'])).toBeGreaterThan(7);
	});

	it('keeps secondary text readable and control boundaries visible', () => {
		for (const scheme of ['light', 'dark'] as const) {
			expect(
				contrast(device[scheme]['--muted-foreground'], device[scheme]['--background']),
				`${scheme} muted-foreground`
			).toBeGreaterThan(4.5);
			// `--border`/`--input` is the hairline on every input, separator and row.
			expect(
				contrast(device[scheme]['--border'], device[scheme]['--background']),
				`${scheme} border`
			).toBeGreaterThan(1.3);
			expect(device[scheme]['--card']).not.toBe(device[scheme]['--background']);
		}
	});

	it('inverts the page and the primary role between schemes', () => {
		expect(luminance(device.light['--background'])).toBeGreaterThan(0.8);
		expect(luminance(device.dark['--background'])).toBeLessThan(0.05);
		// Primary must be dark ink on a light page and light ink on a dark one.
		expect(luminance(device.light['--primary'])).toBeLessThan(0.2);
		expect(luminance(device.dark['--primary'])).toBeGreaterThan(0.4);
	});

	it('keeps both container ladders ordered', () => {
		const light = [
			device.light['--md-sys-color-surface-container-highest'],
			device.light['--md-sys-color-surface-container-high'],
			device.light['--md-sys-color-surface-container'],
			device.light['--md-sys-color-surface-container-low'],
			device.light['--md-sys-color-surface-container-lowest']
		].map(L);
		const dark = [
			device.dark['--md-sys-color-surface-container-lowest'],
			device.dark['--md-sys-color-surface-container-low'],
			device.dark['--md-sys-color-surface-container'],
			device.dark['--md-sys-color-surface-container-high'],
			device.dark['--md-sys-color-surface-container-highest']
		].map(L);
		for (const ladder of [light, dark]) {
			for (let i = 1; i < ladder.length; i++) {
				expect(ladder[i], `step ${i} of ${ladder.join(' ')}`).toBeGreaterThan(
					ladder[i - 1] as number
				);
			}
		}
	});

	it('never emits a hue outside 0–360', () => {
		// Interpolating across 350° once produced a 367° hue, which the CSS parser rejects silently.
		for (const scheme of ['light', 'dark'] as const) {
			for (const [name, value] of Object.entries(device[scheme])) {
				const match = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(value);
				expect(match, `${scheme} ${name} is not an oklch triple: ${value}`).not.toBeNull();
				const hue = Number(match![3]);
				expect(hue >= 0 && hue <= 360, `${scheme} ${name} hue ${hue}`).toBe(true);
			}
		}
	});
});

describe('applyTokens / clearTokens', () => {
	/** A stand-in for `document.documentElement` — the node is not what is under test. */
	function fakeRoot() {
		const props = new Map<string, string>();
		return {
			props,
			style: {
				setProperty: (name: string, value: string) => void props.set(name, value),
				removeProperty: (name: string) => void props.delete(name)
			}
		} as unknown as HTMLElement & { props: Map<string, string> };
	}

	it('writes every token and removes exactly those on clear', () => {
		const root = fakeRoot();
		const tokens = schemes.light;
		applyTokens(root, tokens);
		expect(root.props.size).toBe(Object.keys(tokens).length);
		expect(root.props.get('--md-sys-color-primary')).toBe(tokens['--md-sys-color-primary']);

		clearTokens(root, tokens);
		expect(root.props.size).toBe(0);
	});
});
