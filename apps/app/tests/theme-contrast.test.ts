import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the real palette at AAA by parsing `src/routes/layout.css` and compositing alpha as the components paint — so a stylesheet edit cannot leave a green test behind.
 */

const CSS_PATH = fileURLToPath(new URL('../src/routes/layout.css', import.meta.url));

/** WCAG 2.1: normal text needs 7:1 (AAA); AA is only 4.5:1. */
const AAA_TEXT = 7;
/** WCAG 2.1 SC 1.4.11 non-text contrast. AAA and AA agree here. */
const NON_TEXT = 3;

/* Colour maths */

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

/** CSS Color 4 gamut mapping: reduce chroma until sRGB-representable, as browsers do. */
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

/* Parsing layout.css */

interface Colour {
	rgb: Rgb;
	alpha: number;
	/** Declared chroma, so an out-of-gamut token can be reported rather than hidden. */
	declaredChroma: number;
	effectiveChroma: number;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%)?\s*)?\)$/;

function parseColour(token: string, raw: string): Colour {
	const match = OKLCH_RE.exec(raw.trim());
	if (!match) {
		throw new Error(
			`--${token}: "${raw}" is not a bare oklch() value. This audit reads the ` +
				`stylesheet directly, so every token it measures has to be literal oklch().`
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

/**
 * Reads one top-level `<selector> { ... }` block, matched at the start of a line — `.dark` also appears inside `@custom-variant dark (...)`, and a substring search silently measured `:root` twice.
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

const css = readFileSync(CSS_PATH, 'utf8');

/**
 * Raw token values, parsed lazily by `colour()`: `--radius` shares the block and is not a colour.
 */
function palette(selector: string): Record<string, string> {
	return readBlock(css, selector);
}

function colour(tokens: Record<string, string>, name: string): Colour {
	const raw = tokens[name];
	if (raw === undefined) throw new Error(`no --${name} token`);
	return parseColour(name, raw);
}

const THEMES = [
	{ id: 'light', name: 'LIGHT (:root)', selector: ':root' },
	{ id: 'dark', name: 'DARK (.dark)', selector: '.dark' }
] as const;

type ThemeId = (typeof THEMES)[number]['id'];

/* The pairs the app actually paints */

type Pair = {
	/** Shown in the audit table, so the report names what a user sees. */
	label: string;
	fg: string;
	bg: string;
	/** Extra alpha on the foreground, for `ring-ring/50`-style rendering. */
	fgAlpha?: number;
	/** A translucent colour laid over `bg`, for `bg-destructive/20`-style fills. */
	tint?: { token: string; alpha: number };
	/**
	 * Restricts the pair to one theme: the destructive Button is `bg-destructive/10` with `dark:bg-destructive/20`, so the light theme never paints the /20 tint.
	 */
	only?: ThemeId[];
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
	// `text-muted-foreground` carries every secondary line — the pair that decides if AAA is real.
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
	// `bg-destructive/10` (light) and `dark:bg-destructive/20` are the real backdrop for "Delete".
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
	// The delete row sits on the popover surface and on `bg-accent` when focused.
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
	// `--input` is a border AND a translucent fill: a token can pass as a 3:1 boundary and still fail as a text backdrop.
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
	// `--input` bounds every field, checkbox, switch and outline button — exactly SC 1.4.11.
	{ label: 'input on background (control boundary)', fg: 'input', bg: 'background', min: NON_TEXT },
	{ label: 'input on card (control boundary)', fg: 'input', bg: 'card', min: NON_TEXT },
	{ label: 'sidebar-ring on sidebar', fg: 'sidebar-ring', bg: 'sidebar', min: NON_TEXT },
	// Both the opaque ring and the 50 %-alpha form the components paint (`focus-visible:ring-ring/50`).
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

/* Measurement */

interface Measurement {
	ratio: number;
	min: number;
	fg: Colour;
	bg: Colour;
	backdrop: Colour;
}

function measure(tokens: Record<string, string>, pair: Pair): Measurement {
	const fg = colour(tokens, pair.fg);
	const bg = colour(tokens, pair.bg);

	// Resolve the tint over `bg` first — compositing the backdrop with itself measures nothing.
	let backdrop = bg.rgb;
	if (pair.tint) {
		backdrop = composite(colour(tokens, pair.tint.token).rgb, bg.rgb, pair.tint.alpha);
	}

	let fgRgb = fg.rgb;
	if (fg.alpha < 1) fgRgb = composite(fg.rgb, backdrop, fg.alpha);
	if (pair.fgAlpha !== undefined) fgRgb = composite(fg.rgb, backdrop, pair.fgAlpha);

	return {
		ratio: contrast(fgRgb, backdrop),
		min: pair.min,
		fg,
		bg,
		backdrop: { ...bg, rgb: backdrop }
	};
}

const ALL_PAIRS: Pair[] = [...TEXT_PAIRS, ...NON_TEXT_PAIRS];

/** Printed once, verbatim, into the test output — this is the audit table. */
function report() {
	const lines: string[] = [];
	const out = THEMES.map((theme) => {
		const tokens = palette(theme.selector);
		const rows = ALL_PAIRS.filter((pair) => !pair.only || pair.only.includes(theme.id)).map(
			(pair) => {
				const m = measure(tokens, pair);
				const verdict = m.ratio >= m.min ? 'PASS' : 'FAIL';
				return {
					label: pair.label,
					verdict,
					ratio: m.ratio,
					min: m.min,
					measured: `${m.ratio.toFixed(2)}:1`,
					threshold: `${m.min}:1`
				};
			}
		);

		lines.push(`\n=== ${theme.name} ===`);
		lines.push(`${'pair'.padEnd(46)}${'result'.padEnd(8)}${'measured'.padEnd(12)}need`);
		for (const r of rows) {
			lines.push(
				`${r.label.padEnd(46)}${r.verdict.padEnd(8)}${r.measured.padEnd(12)}${r.threshold}`
			);
		}
		const failures = rows.filter((r) => r.verdict === 'FAIL').length;
		lines.push(
			`-- ${theme.name}: ${rows.length - failures}/${rows.length} pass` +
				(failures ? `, ${failures} FAIL` : '')
		);

		// A silently clamped channel is how the spec and the screen drift apart.
		const mapped = Object.keys(tokens)
			.filter((name) => OKLCH_RE.test(tokens[name]))
			.map((name) => [name, colour(tokens, name)] as const)
			.filter(([, c]) => c.effectiveChroma < c.declaredChroma - 1e-6);
		lines.push(
			mapped.length === 0
				? '-- every token is inside sRGB; no gamut mapping was needed'
				: '-- gamut-mapped (declared C -> effective C): ' +
						mapped
							.map(([name, c]) => `${name} ${c.declaredChroma} -> ${c.effectiveChroma.toFixed(3)}`)
							.join(', ')
		);
		return { theme, rows, tokens };
	});

	console.log(lines.join('\n'));
	return out;
}

describe('Ikoro palette — WCAG 2.1 AAA contrast', () => {
	const results = report();

	for (const result of results) {
		describe(result.theme.name, () => {
			it.each(result.rows)('$label', (row) => {
				expect(
					row.ratio,
					`${row.label}: measured ${row.measured}, WCAG requires ${row.threshold}`
				).toBeGreaterThanOrEqual(row.min);
			});
		});
	}

	it('no failure is a pass that only appears after rounding', () => {
		// Reading "6.94:1" as "7:1" is the failure; printed and raw must agree on pass/fail.
		for (const { theme, rows } of results) {
			for (const row of rows) {
				const printed = Number.parseFloat(row.measured);
				expect(
					printed >= row.min,
					`${theme.name} / ${row.label}: table prints ${row.measured} but the raw ratio is ${row.ratio}`
				).toBe(row.ratio >= row.min);
			}
		}
	});

	it('leaves no pure #000 ink and no pure #fff page', () => {
		/*
		 * Not "no colour may be 0 or 255" — a #ffffff card is fine. What is not fine is halation: pure black ink on near-black, or pure white text on a pure white page.
		 */
		for (const theme of THEMES) {
			const tokens = palette(theme.selector);
			const ink = [
				'foreground',
				'card-foreground',
				'popover-foreground',
				'primary-foreground',
				'secondary-foreground',
				'accent-foreground',
				'muted-foreground',
				'destructive-foreground',
				'sidebar-foreground',
				'sidebar-primary-foreground',
				'sidebar-accent-foreground'
			];
			for (const name of ink) {
				const [r, g, b] = colour(tokens, name).rgb;
				expect(r < 0.002 && g < 0.002 && b < 0.002, `--${name} in ${theme.name} is pure #000`).toBe(
					false
				);
			}
		}

		// Dark surfaces must stay off pure black.
		const dark = palette('.dark');
		for (const name of ['background', 'card', 'popover', 'sidebar', 'muted']) {
			const [r, g, b] = colour(dark, name).rgb;
			expect(r < 0.002 && g < 0.002 && b < 0.002, `--${name} in dark is pure #000`).toBe(false);
		}

		// And no theme may put pure white text on its own page colour.
		for (const theme of THEMES) {
			const tokens = palette(theme.selector);
			for (const name of ['foreground', 'card-foreground', 'muted-foreground']) {
				const [r, g, b] = colour(tokens, name).rgb;
				expect(r > 0.998 && g > 0.998 && b > 0.998, `--${name} in ${theme.name} is pure #fff`).toBe(
					false
				);
			}
		}
	});
});
