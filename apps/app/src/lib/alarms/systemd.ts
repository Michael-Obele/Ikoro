/** Linux desktop alarms via systemd user timers. Units are generated here in TS so the escaping has one implementation, not two. */

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
	/** False means alarms stop when the user logs out. */
	linger: boolean;
	/** One sentence, shown verbatim in Settings. */
	detail: string;
	/** Absolute home dir from Rust -- JS needs a real path and must not smuggle systemd's `%h` through escaping. */
	home: string;
}

/**
 * Escape a quoted systemd unit argument. `%` MUST be doubled -- any other `%X` fails to load with no
 * error; newlines are stripped so a title cannot inject another unit directive.
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

/** freedesktop event id, so the sound comes from whatever theme the user has. */
export const ALARM_SOUND_ID = 'alarm-clock-elapsed';

/** Fallback file when `canberra-gtk-play` is missing; the generated command checks it exists first. */
export const ALARM_SOUND_FILE =
	'/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga';

/** How long the alarm rings -- a chime is not an alarm. A duration, so the sound file's length never matters here. */
export const RING_SECONDS = 30;

/** The ring loop. Free of `$`, `%` and `"`: inside a single-quoted systemd argument, `%` is read as a specifier. */
function ringCommand(): string {
	return (
		'while :; do ' +
		`if command -v canberra-gtk-play >/dev/null 2>&1; then canberra-gtk-play --id=${ALARM_SOUND_ID} || sleep 1; ` +
		`elif command -v pw-play >/dev/null 2>&1; then pw-play ${ALARM_SOUND_FILE} || sleep 1; ` +
		`elif command -v paplay >/dev/null 2>&1; then paplay ${ALARM_SOUND_FILE} || sleep 1; ` +
		'else sleep 1; fi; done'
	);
}

/** The oneshot that stamps, notifies and rings. The stamp goes first: it is the only record that the alarm reached the OS. */
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

/** The timer. `Persistent=true` catches up after sleep; `AccuracySec=1s` so a 09:30 reminder is not coalesced to 09:31:30. */
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
