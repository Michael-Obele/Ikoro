/** Desktop alarms: `systemd` (the OS owns it) or an in-process `timer` (`exact: false`, warned). No third silent mode; units are built in `systemd.ts`. */
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

/** `setTimeout` overflows past 2^31-1 ms and fires IMMEDIATELY, so far-off alarms are armed in stages. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const STAGE_MS = MAX_TIMEOUT_MS - 60_000;

/** Resolved by the first probe; `null` until then. */
let cachedProbe: DesktopProbe | null = null;

/** Ask Rust what this machine can do. Cached -- the answer cannot change while running. */
export async function probeDesktop(): Promise<DesktopProbe> {
	if (cachedProbe) return cachedProbe;
	try {
		const probe = await invoke<DesktopProbe>('alarm_probe');
		cachedProbe = probe;
		return probe;
	} catch (error) {
		// A failed probe must not crash the app; the in-process timer degrades visibly.
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

		// Posting is covered by capabilities; whether the desktop SHOWS it is the OS's call, so ask.
		let granted = await isPermissionGranted();
		if (!granted) {
			const asked = await requestPermission();
			granted = asked === 'granted';
		}

		// No "exact" concept here -- that is carried by `ScheduleOutcome.exact`. `fullScreenIntent` is
		// 'unsupported' for the same reason: nothing on desktop can seize the screen, so nothing to fix.
		return {
			notifications: granted ? 'granted' : 'denied',
			exact: 'unsupported',
			fullScreenIntent: 'unsupported'
		};
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

	/** Mode A. Units built here, written by Rust, which never inspects a task title. */
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
			// Never fall back silently: the user would believe they had an alarm that dies with the window.
			return { ok: false, reason: 'unsupported' };
		}
	}

	/** Mode B. Immediate delivery via the notification plugin -- the only thing it can do. */
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
			// Absence is not worth surfacing -- reconcile treats it as "not armed" either way.
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

	/** Hashes with a stamp on disk -- alarms the OS actually delivered. Tells "fired while we slept" from "never happened". */
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
