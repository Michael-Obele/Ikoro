/**
 * The Ikoro mark: one geometry, four consumers.
 *
 * An Ịbani is the slit gong its striker carries — a vertical bar with a hollow
 * centre, sounded by hand. That is the whole idea of the name and the whole idea
 * of the product: it is heard when it is sounded, and not a moment before.
 *
 * This is the ONLY place the geometry is written. `make-icons.ts` (web),
 * `make-android-icons.ts` (launcher mipmaps + adaptive layers) and M6's Tauri
 * icons all read from here, so the 1024px master, the maskable variant and a
 * 48px launcher tile cannot drift into four near-copies that slowly diverge.
 *
 * Everything is drawn as rounded rectangles and a circle rather than as strokes
 * or paths, because Android downsamples the launcher icon to 48px — a hairline
 * disappears there, and an icon you cannot read is not an icon.
 */

/** The app's own neutral ramp, so the icon belongs to the product. */
export const SHELL = '#171717'; // --primary
export const GONG = '#fafafa'; // --primary-foreground
export const ACCENT = '#e11d48'; // the striker: one alarm-red, and nothing else

/**
 * The mark's bounding box on the 1024 canvas.
 *
 * Scaling pivots on THIS centre, not the canvas centre: the striker pulls the
 * artwork's real bounding box off-centre, and pivoting on the canvas slides the
 * whole mark into one edge of the safe zone — exactly where a launcher mask
 * clips it.
 */
const MARK_CX = 546;

export interface MarkOptions {
	/** Scale the artwork down to clear a launcher mask's safe zone. 0 = full bleed. */
	inset?: number;
	/** Paint a full-bleed plate behind the mark. Defaults to no plate. */
	background?: string | null;
}

export function markSvg({ inset = 0, background = null }: MarkOptions = {}): string {
	const scale = 1 - inset / 512;

	// `p` transforms a POSITION, `s` a LENGTH (width, radius, stroke). They must
	// be different functions: feeding a position into a width once produced a
	// striker the size of the canvas.
	const p = (value: number) => (value - MARK_CX) * scale + 512;
	const s = (value: number) => value * scale;
	const plate = background ?? SHELL;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  ${background ? `<rect width="1024" height="1024" fill="${background}"/>` : ''}
  <!-- The gong: a tall slab with a hollow centre. -->
  <rect x="${p(238)}" y="${p(150)}" width="${s(392)}" height="${s(724)}" rx="${s(172)}" fill="${GONG}"/>
  <rect x="${p(340)}" y="${p(250)}" width="${s(188)}" height="${s(524)}" rx="${s(94)}" fill="${plate}"/>
  <!-- The striker: a mallet leaning on the gong, clearly separate from it so the
       two shapes do not merge into a blob at 48px. -->
  <rect x="${p(556)}" y="${p(398)}" width="${s(196)}" height="${s(62)}" rx="${s(31)}" fill="${ACCENT}"
        transform="rotate(-24 ${p(654)} ${p(429)})"/>
  <circle cx="${p(742)}" cy="${p(372)}" r="${s(112)}" fill="${ACCENT}"/>
</svg>`;
}
