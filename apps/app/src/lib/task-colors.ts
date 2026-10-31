/**
 * The task colour palette — eight accents a task can wear as a left-edge bar. Tasks store an
 * id, never a hex, so `tests/task-colors.test.ts` can hold every value to WCAG's 3:1 floor.
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
 * The CSS colour for a stored id, or `undefined` — a fallback would turn a typo'd id into a
 * confidently wrong stripe.
 */
export function taskColorValue(color: string | null | undefined): string | undefined {
	if (!color) return undefined;
	return TASK_COLORS[color]?.value;
}
