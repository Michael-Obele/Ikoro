/**
 * The desktop scheduler: two modes, chosen by a runtime probe, both honest.
 *
 * **Mode A — `systemd`.** The OS owns the alarm. A transient pair of user units
 * is written per alarm, so it fires whether or not Ikoro is running. This is the
 * only mode that keeps the product's promise on Linux.
 *
 * **Mode B — `timer`.** An in-process `setTimeout`. It works exactly as long as
 * the window is open, so `schedule()` returns `exact: false` with a warning that
 * says so. There is no third, silent mode: the UI always states which one is
 * active, because a desktop alarm that quietly depends on the app being open is
 * the failure this whole milestone exists to avoid.
 *
 * Note what this file does NOT do: it does not build the unit files. That is
 * `systemd.ts`, in pure functions, so the escaping rules are testable without a
 * Rust toolchain.
 */
import { invoke } from '@tauri-apps/api/core';
import {
	isPermissionGranted,
	requestPermission,
	sendNotification
} from '@tauri-apps/plugin-notification';
import type { AlarmPermissionStatus, AlarmRequest, AlarmScheduler, ScheduleOutcome } from './types';
import { hashId } from '$lib/utils/id';
import {
	buildServiceUnit,
	buildTimerUnit,
	toOnCalendar,
	type DesktopMode,
	type DesktopProbe
} from './systemd';

/**
 * `setTimeout` overflows past 2^31-1 ms (~24.8 days) and fires IMMEDIATELY.
 * Anything further out is armed in stages, re-armed on each fire, so a reminder
 * set for next month does not ring the instant it is created.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;
const STAGE_MS = MAX_TIMEOUT_MS - 60_000;

/** Resolved by the first probe; `null` until then. */
let cachedProbe: DesktopProbe | null = null;

/**
 * Ask Rust what this machine can do. Cached: the answer cannot change while the
 * app is running, and `systemctl` is a subprocess spawn.
 */
export async function probeDesktop(): Promise<DesktopProbe> {
	if (cachedProbe) return cachedProbe;
	try {
		const probe = await invoke<DesktopProbe>('alarm_probe');
		cachedProbe = probe;
		return probe;
	} catch (error) {
		// A failed probe must not crash the app. Falling back to the in-process
		// timer is the safe answer: it degrades visibly rather than losing alarms
		// without saying so.
		console.warn('[ikoro] alarm_probe failed, falling back to the in-process timer', error);
		cachedProbe = {
			mode: 'timer',
			systemd: false,
			notifySend: false,
			linger: false,
			detail: 'Could not determine what this machine can schedule, so alarms are in-process only.',
			home: ''
		};
		return cachedProbe;
	}
}

/** Test seam — clears the probe cache. */
export function resetDesktopProbe(): void {
	cachedProbe = null;
}

export class DesktopScheduler implements AlarmScheduler {
	readonly platform = 'desktop' as const;

	#mode: DesktopMode = 'timer';
	#probe: DesktopProbe | null = null;
	#home = '';
	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	#handlers: ((taskId: string) => void)[] = [];

	private async ready(): Promise<void> {
		if (this.#probe) return;
		const probe = await probeDesktop();
		this.#probe = probe;
		this.#mode = probe.mode as DesktopMode;
		this.#home = probe.home;
	}

	async currentMode(): Promise<DesktopProbe> {
		await this.ready();
		return this.#probe as DesktopProbe;
	}

	async ensureReady(): Promise<AlarmPermissionStatus> {
		await this.ready();

		// `notification:default` in capabilities covers POSTING. Whether the
		// desktop will SHOW it is the OS's business, so we ask.
		let granted = await isPermissionGranted();
		if (!granted) {
			const asked = await requestPermission();
			granted = asked === 'granted';
		}

		// There is no "exact" concept on desktop — either the OS scheduled it
		// (systemd) or it is in-process. That distinction is carried by
		// `ScheduleOutcome.exact`, not by this status.
		return { notifications: granted ? 'granted' : 'denied', exact: 'unsupported' };
	}

	async schedule(alarm: AlarmRequest): Promise<ScheduleOutcome> {
		await this.ready();

		const at = new Date(alarm.at);
		if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
			return { ok: false, reason: 'invalid' };
		}

		const platformId = String(hashId(alarm.taskId));

		if (this.#mode === 'systemd') {
			return this.#scheduleSystemd(alarm, platformId);
		}
		return this.#scheduleInProcess(alarm, platformId);
	}

	/**
	 * Mode A. The units are built here and written by Rust, which never inspects
	 * a task title.
	 */
	async #scheduleSystemd(alarm: AlarmRequest, platformId: string): Promise<ScheduleOutcome> {
		try {
			await invoke('alarm_arm', {
				hash: platformId,
				service: buildServiceUnit({ hash: platformId, title: alarm.title, home: this.#home }),
				timer: buildTimerUnit({ hash: platformId, at: toOnCalendar(alarm.at) })
			});
			return { ok: true, platformId: `systemd:${platformId}`, exact: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('[ikoro] alarm_arm failed', message);
			// Never fall back silently to an in-process timer: the user would then
			// believe they have an alarm that dies with the window.
			return { ok: false, reason: 'unsupported' };
		}
	}

	/**
	 * Mode B. Immediate delivery via the notification plugin — which is exactly
	 * what that plugin is good at, and the only thing it can do.
	 */
	async #scheduleInProcess(alarm: AlarmRequest, platformId: string): Promise<ScheduleOutcome> {
		this.#clearTimer(platformId);

		const delay = new Date(alarm.at).getTime() - Date.now();
		if (delay <= 0) return { ok: false, reason: 'invalid' };

		const arm = () => {
			const timer = setTimeout(
				() => {
					this.#timers.delete(platformId);
					void sendNotification({ title: 'Ikoro', body: alarm.title });
					for (const handler of this.#handlers) handler(alarm.taskId);
					// Re-arm for anything still in the future beyond the timer ceiling.
					if (new Date(alarm.at).getTime() > Date.now()) arm();
				},
				Math.min(delay, STAGE_MS)
			);
			this.#timers.set(platformId, timer);
		};
		arm();

		return {
			ok: true,
			platformId,
			exact: false,
			warning: 'Ikoro must be running to remind you on this machine.'
		};
	}

	async cancel(platformId: string): Promise<void> {
		this.#clearTimer(platformId.replace(/^systemd:/, ''));
		try {
			await invoke('alarm_cancel', { hash: platformId.replace(/^systemd:/, '') });
		} catch (error) {
			// Cancelling something already gone is not an error worth surfacing;
			// reconcile treats absence as "not armed" either way.
			console.warn('[ikoro] alarm_cancel failed', error);
		}
	}

	#clearTimer(platformId: string): void {
		const existing = this.#timers.get(platformId);
		if (existing !== undefined) {
			clearTimeout(existing);
			this.#timers.delete(platformId);
		}
	}

	async getPending(): Promise<Set<string>> {
		await this.ready();
		if (this.#mode === 'systemd') {
			try {
				const hashes = await invoke<string[]>('alarm_list');
				return new Set(hashes.map((hash) => `systemd:${hash}`));
			} catch (error) {
				console.warn('[ikoro] alarm_list failed', error);
				return new Set();
			}
		}
		return new Set([...this.#timers.keys()]);
	}

	/**
	 * Hashes whose stamp exists — alarms the OS actually delivered.
	 *
	 * Only meaningful in systemd mode: in-process delivery is observed directly.
	 * This is what lets reconcile tell "the OS delivered it and we were asleep"
	 * apart from "the alarm never happened".
	 */
	async firedStamps(): Promise<Set<string>> {
		try {
			return new Set(await invoke<string[]>('alarm_stamps'));
		} catch {
			return new Set();
		}
	}

	async clearStamps(): Promise<void> {
		try {
			await invoke('alarm_clear_stamps');
		} catch (error) {
			console.warn('[ikoro] alarm_clear_stamps failed', error);
		}
	}

	onAction(handler: (taskId: string) => void): void {
		this.#handlers.push(handler);
	}
}
