/**
 * The task colour palette — eight accents a task can wear as a left-edge bar.
 *
 * IDS, NOT HEXES. A task stores `'teal'`, never `oklch(...)`. The palette lives
 * here and only here, which is what makes it auditable: `tests/task-colors.test.ts`
 * measures every value below against the real stylesheet surfaces, so retuning a
 * colour without re-passing the contrast gate is impossible.
 *
 * THE 3:1 FLOOR, AND HOW IT WAS MET. These bars are non-text UI (WCAG 2.1
 * SC 1.4.11), so the floor is 3:1 against what they sit on — the row background
 * (`--background`, where TaskRow renders) and, because the picker renders inside
 * the sheet, `--popover` too. Light and dark. That is four surfaces per colour,
 * sixteen measurements, all asserted.
 *
 * A single fixed lightness has to clear BOTH themes: the light background is
 * near-white (the colour must be dark enough) and the dark background is near-
 * black (it must be light enough). That pins each colour's WCAG luminance into
 * a window, and the window is narrower for some hues than others — which is why
 * the L values below are not uniform. They were solved per hue against the real
 * `layout.css` tokens, then verified: the worst measured pair is purple in dark
 * at 3.66:1 against the row background, comfortably above the floor. The test
 * re-derives every number from this file and the stylesheet, so the comment
 * cannot outlive the truth.
 *
 * HUES are spread around the wheel (25 → 350) and deliberately do NOT reuse the
 * theme scheme hues: a task colour means "this task", not "this theme", and
 * borrowing the scheme hues would make every red task look like it belonged to
 * the crimson scheme. Chroma is held near 0.11–0.19 — saturated enough to read
 * as a deliberate mark at 3px, inside sRGB at these lightnesses.
 */

export interface TaskColor {
	/** Stored on the task. Stable — renaming a label must never change this. */
	id: string;
	/** Shown in the picker. */
	label: string;
	/** CSS colour, literal oklch(). Audited at 3:1 — see the header. */
	value: string;
}

export const TASK_COLORS: Record<string, TaskColor> = {
	red: { id: 'red', label: 'Red', value: 'oklch(0.57 0.19 25)' },
	orange: { id: 'orange', label: 'Orange', value: 'oklch(0.6 0.16 55)' },
	amber: { id: 'amber', label: 'Amber', value: 'oklch(0.6 0.14 85)' },
	green: { id: 'green', label: 'Green', value: 'oklch(0.55 0.14 145)' },
	teal: { id: 'teal', label: 'Teal', value: 'oklch(0.55 0.11 195)' },
	blue: { id: 'blue', label: 'Blue', value: 'oklch(0.55 0.16 250)' },
	purple: { id: 'purple', label: 'Purple', value: 'oklch(0.56 0.18 300)' },
	pink: { id: 'pink', label: 'Pink', value: 'oklch(0.58 0.19 350)' }
};

/** Picker order — the wheel order of the record above. */
export const TASK_COLOR_IDS = Object.keys(TASK_COLORS);

/**
 * The CSS colour for a stored id, or `undefined` when there is nothing to draw.
 *
 * `undefined` (not a fallback colour) is deliberate: "no colour" and "unknown
 * colour" are both reasons to render no bar at all, and a fallback would turn a
 * typo'd id into a confidently wrong stripe. The row checks the result before
 * rendering, so an unknown id degrades to the plain row it would have been.
 */
export function taskColorValue(color: string | null | undefined): string | undefined {
	if (!color) return undefined;
	return TASK_COLORS[color]?.value;
}
