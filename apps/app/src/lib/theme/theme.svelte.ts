/**
 * The theme store: System / Light / Dark.
 *
 * Three states, not two, on purpose. "Dark" plus an auto-switch is the usual
 * two-state design and it has a failure mode: the user cannot express "always
 * light", so the app overrides them every time the OS flips at dusk. An explicit
 * choice has to win permanently, and that needs a state that means "I have not
 * chosen yet".
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE PROBLEM.
 *
 * A theme switch that flashes white on every load is worse than no switch: it is
 * a full-screen strobe for anyone loading the app in a dark room. So the class has
 * to be on `<html>` before the first paint, which is before any module runs. That
 * work is done by an inline script in `src/app.html` — it has to be inline,
 * because an imported module arrives after the CSS has already painted.
 *
 * The consequence is that the storage key, the JSON shape and the resolution rule
 * are written down TWICE: once there, once here. That duplication is deliberate
 * and `tests/theme-store.test.ts` guards the two against drifting apart. Do not
 * "de-duplicate" it by moving the script into a module.
 */
import { PersistedState } from 'runed';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

export const THEME_STORAGE_KEY = 'ikoro:theme';
export const DARK_CLASS = 'dark';
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** The only accepted values. Anything else in storage is ignored, not trusted. */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const satisfies readonly ThemeChoice[];

export function isThemeChoice(value: unknown): value is ThemeChoice {
	return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

/**
 * The persisted choice, defaulting to `system` so a first run follows the OS.
 *
 * runed rather than a hand-rolled `localStorage.getItem`: it reads storage
 * synchronously at construction (which is what makes the class land before the
 * app hydrates), stays reactive through `createSubscriber`, and syncs across
 * tabs for free. The repo rule is to use runed rather than roll our own.
 */
export const themeChoice = new PersistedState<ThemeChoice>(THEME_STORAGE_KEY, 'system');

/**
 * What the OS currently wants. Starts `false` so the very first render is
 * deterministic; `watchSystemTheme()` corrects it before the first paint that
 * anyone can see, because `applyTheme()` reads this synchronously in the same tick.
 */
let systemPrefersDark = $state(false);

/** The single source of truth for what the user actually sees. */
export const resolvedTheme = $derived<ResolvedTheme>(
	themeChoice.current === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themeChoice.current
);

/**
 * Write the resolved theme onto `<html>`.
 *
 * A DOM side effect on a node Svelte does not own — the reason this lives in a
 * plain function rather than a `$derived`. `colorScheme` matters as much as the
 * class: without it the UA stylesheet keeps painting scrollbars, form controls
 * and the caret in light, which is its own small flash on a dark page.
 */
export function applyTheme(): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	const dark = resolvedTheme === 'dark';
	root.classList.toggle(DARK_CLASS, dark);
	root.style.colorScheme = dark ? 'dark' : 'light';
}

/**
 * Track the OS preference. Returns its own teardown so it can be handed straight
 * back out of an `$effect`.
 */
export function watchSystemTheme(): () => void {
	if (typeof window === 'undefined') return () => {};
	const media = window.matchMedia(DARK_MEDIA_QUERY);
	const sync = (): void => {
		systemPrefersDark = media.matches;
		applyTheme();
	};
	sync();
	media.addEventListener('change', sync);
	return () => media.removeEventListener('change', sync);
}

/**
 * The only mutation. An explicit choice is written to storage and takes effect
 * immediately; choosing `system` hands control back to the OS from that moment.
 */
export function setTheme(choice: ThemeChoice): void {
	themeChoice.current = choice;
	if (typeof window !== 'undefined') {
		systemPrefersDark = window.matchMedia(DARK_MEDIA_QUERY).matches;
	}
	applyTheme();
}
