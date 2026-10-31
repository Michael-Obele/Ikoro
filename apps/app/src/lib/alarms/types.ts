/**
 * The alarm interface. Nothing else in the codebase imports a notification API.
 *
 * Two things here are deliberate departures from "return a task id or null":
 *
 *  - `ScheduleOutcome` replaces a bare id. Capacitor reports a DEGRADED schedule
 *    (exact-alarm permission denied, alarm quietly demoted to inexact) through
 *    `ScheduleResult.warning` while still resolving successfully. For an app
 *    whose entire promise is "it fires at that time", a schedule that resolved
 *    but cannot honour its instant must never look like a success — so it is a
 *    distinct case with a message the UI has to show, not a boolean.
 *  - `ensureReady()` returns a status rather than requesting and forgetting. The
 *    user can revoke exact-alarm access from system settings at any time, and
 *    that revocation DELETES already-scheduled exact alarms, so the status is
 *    re-read on every resume and the store is re-armed from it.
 */
export interface AlarmRequest {
	taskId: string;
	title: string;
	at: string; // ISO 8601, absolute
	/**
	 * The sound to ring with — a `content://` uri the user picked in the system
	 * ringtone picker, or null/absent for the device default. Device-scoped by
	 * nature (a media uri means nothing on another phone), so it never reaches
	 * the export file; the task row carries it for THIS device.
	 */
	ringtone?: string | null;
	/**
	 * The task's notes, shown on the ringing screen so the alarm can be placed
	 * without unlocking the phone and opening the app. Android-only today; the
	 * desktop notification already carries the title, and systemd has no screen.
	 */
	description?: string | null;
}

export interface AlarmPermissionStatus {
	notifications: 'granted' | 'denied' | 'prompt';
	exact: 'granted' | 'denied' | 'unsupported';
	/**
	 * Whether a ringing alarm may actually TAKE OVER THE SCREEN.
	 *
	 * Android 14 made this a user-revocable permission, and revoking it does not
	 * mute the alarm -- it downgrades the full-screen screen to a heads-up banner
	 * in the shade. That is a silent degradation of the one promise this app
	 * exists to keep, so it is reported here rather than absorbed.
	 *
	 *  - `granted`     a full-screen intent will be honoured
	 *  - `denied`      it will not; the user can still fix it from Settings
	 *  - `unsupported` this platform has no such concept. Desktop and browser
	 *                  reminders are tray popups with no takeover step, so there
	 *                  is nothing to grant and nothing to fix. Answering
	 *                  `denied` there would offer the user a settings screen that
	 *                  does not exist.
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
	/**
	 * Hashes whose stamp file exists — alarms the OS actually DELIVERED.
	 *
	 * Optional, because only a scheduler that leaves a trace outside the process
	 * can answer. The systemd scheduler can: its unit writes a stamp before it
	 * rings. Android does not need it (the receiver reports delivery directly),
	 * and the browser has nothing to report.
	 *
	 * Without this, an alarm that fired while the app was closed comes back as
	 * "missed" on the next open, which is the fastest way to teach a user to
	 * distrust the reminder screen.
	 */
	firedStamps?(): Promise<Set<string>>;
	/** Forget the stamps, once reconcile has accounted for them. */
	clearStamps?(): Promise<void>;
}

/** How the schedule attempt actually went — never just a boolean. */
export type ScheduleOutcome =
	| { ok: true; platformId: string; exact: true }
	| { ok: true; platformId: string; exact: false; warning: string } // degraded, must surface
	| { ok: false; reason: 'permission' | 'unsupported' | 'invalid' };
