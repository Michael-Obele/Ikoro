/**
 * Whether an alarm is ringing RIGHT NOW. Android only starts the native ringing screen when locked, so
 * in the foreground this overlay is the only control left. Module-level: exactly one alarm can ring.
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
