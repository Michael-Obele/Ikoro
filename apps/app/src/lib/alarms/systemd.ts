/**
 * Linux desktop alarms, via systemd user timers.
 *
 * WHY NOT THE TAURI NOTIFICATION PLUGIN: it cannot schedule. Its own reference
 * says *"Scheduling is only supported on mobile; desktop notifications are
 * always shown immediately"*, `pending()` is mobile-only, and there is no cancel
 * API (upstream issue plugins-workspace#2141, open since 2022). So the plugin can
 * only show a notification immediately — it is not a scheduler. What is needed is
 * a scheduler the OS owns, and on Linux that is `systemd --user`.
 *
 * WHY THIS FILE, IN TYPESCRIPT, GENERATES THE UNITS: the build plan had Rust
 * generate them, with `hashId` and the escaping implemented in BOTH languages and
 * kept in step by a shared test vector. That is two implementations of the same
 * escaping rules, where a drift means alarms that cancel the wrong unit and unit
 * files that will not load. Generating here means ONE implementation, and the
 * Rust side becomes a thin `exec` wrapper that never reasons about a task title.
 *
 * The escaping rules are the load-bearing part of this file. A task title is
 * arbitrary user text; if it can contain a `%`, the timer for it silently does
 * not exist.
 */

/** The marker files that record "this alarm actually fired". */
export const STATE_DIR = '.local/state/ikoro';

/** Where fired-stamps live. Resolved from the home directory Rust reports. */
export function firedDir(home: string): string {
	return `${home}/${STATE_DIR}/fired`;
}

export const UNIT_PREFIX = 'ikoro-';

/** `systemd` (real OS scheduling) or `timer` (in-process fallback). */
export type DesktopMode = 'systemd' | 'timer';

export interface DesktopProbe {
	mode: DesktopMode;
	/** True when the user manager is usable AND notify-send exists. */
	systemd: boolean;
	notifySend: boolean;
	/** False means alarms stop when the user logs out. Worth saying out loud. */
	linger: boolean;
	/** One sentence, shown verbatim in Settings. */
	detail: string;
	/**
	 * The resolved home directory, reported by Rust.
	 *
	 * JS needs an absolute path for the stamp files and cannot discover one —
	 * and it must not smuggle systemd's `%h` specifier through the escaping,
	 * because `%h` in a value the unit generator produced is indistinguishable
	 * from a specifier the user typed into a task title.
	 */
	home: string;
}

/**
 * Escape a value for use inside a systemd unit's quoted argument.
 *
 * `%` MUST be doubled. systemd expands `%h`, `%t`, `%n` and friends, and any
 * other `%X` is a hard error — the unit does not load, so the alarm does not
 * exist, and nothing reports why. `\` is escaped FIRST, so the backslashes added
 * for quotes are not themselves escaped a second time.
 *
 * Newlines are STRIPPED, not escaped. A newline would end the `ExecStart=` line
 * and everything after it would be parsed as a directive — that is how a task
 * title becomes an arbitrary command.
 */
export function escapeUnitArg(value: string): string {
	return value
		.replace(/[\r\n]/g, '')
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/%/g, '%%');
}

/** `ikoro-<hash>.service` / `.timer`. The hash is the task's `hashId`. */
export const serviceUnitName = (hash: string) => `${UNIT_PREFIX}${hash}.service`;
export const timerUnitName = (hash: string) => `${UNIT_PREFIX}${hash}.timer`;

/**
 * The freedesktop event id for "the alarm went off".
 *
 * An EVENT ID, not a file path, so the sound comes from whatever theme the user
 * actually has. Every Linux sound theme inherits it from `freedesktop`.
 */
export const ALARM_SOUND_ID = 'alarm-clock-elapsed';

/**
 * The fallback file, used only when `canberra-gtk-play` is not installed.
 *
 * From the freedesktop sound theme, which ships on any system that has a sound
 * theme at all. It is not a release-specific path, and the generated command
 * checks that it exists before using it.
 */
export const ALARM_SOUND_FILE =
	'/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga';

/**
 * How long the alarm rings for.
 *
 * A notification chime is not an alarm. On Android the alarm loops a MediaPlayer
 * on STREAM_ALARM until it is dismissed; this is the desktop equivalent. A
 * wall-clock duration is deliberate: the sound file's own length never has to be
 * known here, and `alarm_cancel` cuts the ring short by stopping the service.
 */
export const RING_SECONDS = 30;

/**
 * The command that keeps ringing until `timeout` kills it.
 *
 * Deliberately free of `$`, `%` and `"`. This text is placed inside a
 * single-quoted systemd argument, where a backslash escape stays literal and a
 * percent sign is read as a systemd specifier: `$(date +%s)` would arrive as
 * `$(date +%%s)` and quietly stop being arithmetic. Everything here is a
 * constant, so no user text ever reaches it.
 */
function ringCommand(): string {
	return (
		'while :; do ' +
		`if command -v canberra-gtk-play >/dev/null 2>&1; then canberra-gtk-play --id=${ALARM_SOUND_ID} || sleep 1; ` +
		`elif command -v pw-play >/dev/null 2>&1; then pw-play ${ALARM_SOUND_FILE} || sleep 1; ` +
		`elif command -v paplay >/dev/null 2>&1; then paplay ${ALARM_SOUND_FILE} || sleep 1; ` +
		'else sleep 1; fi; done'
	);
}

/**
 * The oneshot that records the delivery, shows the banner, and RINGS.
 *
 * Order is not cosmetic. The stamp goes first, because it is the only record
 * that this alarm reached the OS: if the ring is interrupted or the machine
 * sleeps mid-ring, reconcile still has to be able to say "this one fired".
 *
 * The stamp is also why `list-timers` is not enough. systemd keeps a one-shot
 * timer listed as `active (elapsed)` after it fires, so "the timer is still
 * there" cannot distinguish armed from already-rung. The stamp file can.
 */
export function buildServiceUnit({
	hash,
	title,
	home
}: {
	hash: string;
	title: string;
	home: string;
}): string {
	const stamp = escapeUnitArg(`${firedDir(home)}/${hash}`);
	const statePath = escapeUnitArg(`${home}/${STATE_DIR}/fired`);
	return `[Unit]
Description=Ikoro reminder

[Service]
Type=oneshot
# Ending the ring is the POINT, not a failure. timeout reports 124 when it
# stops the loop on time, and SIGTERM is what systemctl stop sends when the
# user cancels — with neither whitelisted, every alarm left a red "failed" unit
# in the journal. Measured: a plain stop logged "code=killed, status=15/TERM".
SuccessExitStatus=124 143 SIGTERM SIGKILL
ExecStart=/bin/sh -c 'mkdir -p ${statePath} && touch ${stamp}'
ExecStart=/usr/bin/notify-send --app-name=Ikoro --urgency=critical --expire-time=0 -h string:sound-name:${ALARM_SOUND_ID} -h string:x-canonical-private-synchronous:${UNIT_PREFIX}${hash} "Ikoro" "${escapeUnitArg(title)}"
ExecStart=/usr/bin/timeout ${RING_SECONDS} /bin/sh -c '${ringCommand()}'
`;
}

/**
 * The timer that decides when.
 *
 * `Persistent=true` is the catch-up: if the machine was asleep or off when the
 * moment passed, systemd runs the service shortly after the user manager starts.
 * That is the desktop equivalent of Android's BOOT_COMPLETED restore, and without
 * it a reminder silently dies the first time a laptop is closed.
 *
 * `AccuracySec=1s` because the product is about the minute. systemd's default
 * coalescing window would let a 09:30 reminder land at 09:31:30, and the user
 * would rightly call that broken.
 */
export function buildTimerUnit({ hash, at }: { hash: string; at: string }): string {
	return `[Unit]
Description=Ikoro reminder timer

[Timer]
OnCalendar=${at}
Persistent=true
AccuracySec=1s
Unit=${serviceUnitName(hash)}

[Install]
WantedBy=timers.target
`;
}

/** The `YYYY-MM-DD HH:MM:SS` form systemd's `OnCalendar=` wants, in LOCAL time. */
export function toOnCalendar(iso: string): string {
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, '0');
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

/** Copy the UI shows when it has to fall back. */
export const TIMER_MODE_WARNING = 'Ikoro must be running to remind you on this machine.';

export const SYSTEMD_MODE_DETAIL =
	'Alarms are scheduled by the system — they fire even when Ikoro is closed.';

export const LINGER_WARNING =
	'Alarms stop if you log out. Run `loginctl enable-linger $USER` once to keep them.';
