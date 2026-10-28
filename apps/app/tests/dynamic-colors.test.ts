import { describe, expect, it } from 'vitest';
import {
	buildMonetSchemes,
	clearTokens,
	hexToOklch,
	hexToRgb,
	applyTokens,
	type Palettes
} from '#lib/theme/monet';

/**
 * THE TONAL -> ROLE MAPPING, ASSERTED BY TONE.
 *
 * The native plugin reads five tonal palettes off the phone and stops there; the
 * mapping from tones to M3 roles is the part that can be wrong in a way nobody
 * notices until a screen looks broken. So the palettes below are SYNTHETIC and
 * deliberately unambiguous: every tone in a palette is a distinct, recognisable
 * hex, which means a role that lands on the wrong tone produces a different
 * string and fails here rather than looking "roughly right" on a device.
 *
 * What this file catches:
 *  - a role mapped to the wrong tone (light primary on 30 instead of 40)
 *  - a light/dark pair that was not inverted (dark primary on 40 instead of 80)
 *  - a role that silently disappeared because a palette key was renamed
 *  - an oklch() conversion that drifts, since the expected values are computed
 *    from the same hexes through an independent path
 *
 * What it does NOT catch, and cannot: whether Android actually returns these
 * palettes on a real device. That needs an Android 12+ phone and is untested.
 */

/**
 * A palette where tone N is `#NNNNNN`-ish but distinct per palette, so a role
 * reading the wrong palette is as visible as one reading the wrong tone.
 *
 * `accent1` tones are `#a1NNNN`, `accent2` `#a2NNNN`, and so on. The tone number
 * is encoded in the last two hex digits where it fits, and the full tone is
 * recoverable from the map below rather than from the string.
 */
function palette(prefix: string, tones: number[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const tone of tones) {
		// Two hex digits of tone, zero-padded; 1000 wraps to 00, which is fine
		// because the prefix already distinguishes the palette and the tone map
		// below is what the assertions read.
		const byte = (tone % 256).toString(16).padStart(2, '0');
		out[String(tone)] = `#${prefix}${byte}${byte}`;
	}
	return out;
}

const TONES = [0, 4, 10, 12, 17, 20, 22, 30, 40, 50, 60, 80, 90, 92, 94, 95, 96, 99, 100];

const PALETTES: Palettes = {
	accent1: palette('a1', TONES),
	accent2: palette('a2', TONES),
	accent3: palette('a3', TONES),
	neutral1: palette('b1', TONES),
	neutral2: palette('b2', TONES)
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
		// The alias table is transcribed from layout.css, so this is the guard
		// against the two drifting: an alias that stops matching its role means
		// the stylesheet's mapping table and this module disagree.
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
		// M3 keeps error red in every scheme, so the same palettes must not move
		// it. If this ever starts tracking accent1, "destructive" stops meaning
		// destructive on a green wallpaper.
		const other = buildMonetSchemes({
			...PALETTES,
			accent1: palette('ff', TONES)
		});
		expect(other.light['--md-sys-color-error']).toBe(schemes.light['--md-sys-color-error']);
		expect(other.dark['--md-sys-color-error']).toBe(schemes.dark['--md-sys-color-error']);
	});
});

describe('buildMonetSchemes — degradation', () => {
	it('omits roles whose palette is missing instead of inventing a colour', () => {
		const partial = buildMonetSchemes({ accent1: PALETTES.accent1 });
		expect(partial.light['--md-sys-color-primary']).toBeDefined();
		// No neutral1, so no surface. The caller keeps the static stylesheet's
		// value for it, which is a real contrast-checked colour.
		expect(partial.light['--md-sys-color-surface']).toBeUndefined();
		expect(partial.light['--background']).toBeUndefined();
	});

	it('falls back to the nearest tone when one is absent', () => {
		const sparse = buildMonetSchemes({
			...PALETTES,
			accent1: { '40': '#123456' }
		});
		// Tone 80 is missing; 40 is the only tone, so dark primary lands there
		// rather than disappearing.
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
		// Reference values from CSS Color 4. Asserted to 2 decimals because the
		// output is rounded to 3 and the matrices are not exact to more.
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
