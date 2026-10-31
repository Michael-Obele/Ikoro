/**
 * The Ikoro mark — the ONLY place the geometry is written; every icon script reads it.
 * An Ịbani is the slit gong its striker carries: heard when sounded, and not a moment before.
 */

/** The app's own neutral ramp. */
export const SHELL = '#171717'; // --primary
export const GONG = '#fafafa'; // --primary-foreground
export const ACCENT = '#e11d48'; // the striker: one alarm-red, and nothing else
/** Any opaque colour works; the launcher keeps the alpha and tints it. */
export const MONO = '#ffffff';

// Pivot on the mark's own centre: the striker pushes the bbox off-centre, and
// pivoting on the canvas slides the mark into a launcher mask's clip edge.
const MARK_CX = 546;

/** Gap (canvas units) between gong and striker; monochrome only. */
const GAP = 18;

export interface MarkOptions {
	/** Scale the artwork down to clear a launcher mask's safe zone. 0 = full bleed. */
	inset?: number;
	/** Paint a full-bleed plate behind the mark. Defaults to no plate. */
	background?: string | null;
	/** One flat colour with a real transparent hole — Android 13+ themed icons. */
	monochrome?: boolean;
}

export function markSvg({ inset = 0, background = null, monochrome = false }: MarkOptions = {}): string {
	const scale = 1 - inset / 512;

	// `p` maps a position, `s` a length — mixing them once broke the striker's size.
	const p = (value: number) => (value - MARK_CX) * scale + 512;
	const s = (value: number) => value * scale;
	const plate = background ?? SHELL;
	const gong = monochrome ? MONO : GONG;
	const accent = monochrome ? MONO : ACCENT;

	// Monochrome: the hole is a MASK, not a painted rect, and the striker is punched
	// out too — EXPANDED by GAP so the single tint does not fuse the two shapes.
	const mask = monochrome
		? `
  <defs>
    <mask id="gong">
      <rect x="${p(238)}" y="${p(150)}" width="${s(392)}" height="${s(724)}" rx="${s(172)}" fill="#fff"/>
      <rect x="${p(340)}" y="${p(250)}" width="${s(188)}" height="${s(524)}" rx="${s(94)}" fill="#000"/>
      <g fill="#000">
        <rect x="${p(556) - GAP}" y="${p(398) - GAP}" width="${s(196) + GAP * 2}" height="${s(62) + GAP * 2}" rx="${s(31) + GAP}"
              transform="rotate(-24 ${p(654)} ${p(429)})"/>
        <circle cx="${p(742)}" cy="${p(372)}" r="${s(112) + GAP}"/>
      </g>
    </mask>
  </defs>`
		: '';

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${mask}
  ${background ? `<rect width="1024" height="1024" fill="${background}"/>` : ''}
  <!-- The gong: a tall slab with a hollow centre. -->
  <rect x="${p(238)}" y="${p(150)}" width="${s(392)}" height="${s(724)}" rx="${s(172)}" fill="${gong}"${
		monochrome ? ' mask="url(#gong)"' : ''
	}/>
  ${monochrome ? '' : `<rect x="${p(340)}" y="${p(250)}" width="${s(188)}" height="${s(524)}" rx="${s(94)}" fill="${plate}"/>`}
  <!-- The striker: a mallet leaning on the gong, clearly separate from it so the
       two shapes do not merge into a blob at 48px. -->
  <rect x="${p(556)}" y="${p(398)}" width="${s(196)}" height="${s(62)}" rx="${s(31)}" fill="${accent}"
        transform="rotate(-24 ${p(654)} ${p(429)})"/>
  <circle cx="${p(742)}" cy="${p(372)}" r="${s(112)}" fill="${accent}"/>
</svg>`;
}
