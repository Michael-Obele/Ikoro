/**
 * Whether an alarm is ringing RIGHT NOW, as far as the web UI knows.
 *
 * WHY THIS EXISTS: Android only lets an app take over the screen when it is
 * locked or off. With Ikoro in the foreground the full-screen intent becomes a
 * heads-up notification and the native ringing screen is never started — the
 * phone rings and the user sees nothing they can act on. This is the in-app
 * counterpart: the service announces `alarmRinging`, an overlay appears, and its
 * two buttons deliver the same intents the native screen sends.
 *
 * Deliberately module-level state, not a store: there is exactly one possible
 * ringing alarm, and every writer is an event handler that already lives for the
 * app's lifetime.
 */
let taskId = $state<string | null>(null);

/** The task whose alarm is ringing, or null when nothing is. */
export function ringingTaskId(): string | null {
	return taskId;
}

export function startRinging(id: string): void {
	taskId = id;
}

export function stopRinging(): void {
	taskId = null;
}
