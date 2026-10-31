/** The alarm interface. Nothing else imports a notification API. `ScheduleOutcome` exists so a resolved-but-inexact schedule cannot look like success. */
export interface AlarmRequest {
	taskId: string;
	title: string;
	at: string; // ISO 8601, absolute
	/** `content://` uri from the system picker, or null for the device default. Device-scoped, so it never reaches an export. */
	ringtone?: string | null;
	/** The task's notes, shown on the ringing screen. Android-only today: desktop has no screen. */
	description?: string | null;
}

export interface AlarmPermissionStatus {
	notifications: 'granted' | 'denied' | 'prompt';
	exact: 'granted' | 'denied' | 'unsupported';
	/**
	 * Whether a ringing alarm may TAKE OVER THE SCREEN. Android 14 made it revocable, and revoking
	 * downgrades the takeover to a banner rather than muting -- so it is reported, not absorbed.
	 * `unsupported` means the platform has no such concept, and `denied` there would offer a nonexistent fix.
	 */
	fullScreenIntent: 'granted' | 'denied' | 'unsupported';
}

export type Platform = 'android' | 'desktop' | 'browser';

export interface AlarmScheduler {
	readonly platform: Platform;
	ensureReady(): Promise<AlarmPermissionStatus>;
	schedule(alarm: AlarmRequest): Promise<ScheduleOutcome>;
	cancel(platformId: string): Promise<void>;
	getPending(): Promise<Set<string>>;
	/** Resolves when a notification is tapped; yields the taskId. */
	onAction(handler: (taskId: string) => void): void;
	/** Stamps for alarms the OS actually DELIVERED. Only an out-of-process scheduler leaves a trace; without it, a closed-app fire reads as "missed". */
	firedStamps?(): Promise<Set<string>>;
	/** Forget the stamps, once reconcile has accounted for them. */
	clearStamps?(): Promise<void>;
}

/** How the schedule attempt actually went — never just a boolean. */
export type ScheduleOutcome =
	| { ok: true; platformId: string; exact: true }
	| { ok: true; platformId: string; exact: false; warning: string } // degraded, must surface
	| { ok: false; reason: 'permission' | 'unsupported' | 'invalid' };
