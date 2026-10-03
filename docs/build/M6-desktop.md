# M6 — Desktop (Tauri) shell + OS-native alarms, Linux first

> ## ⚠️ This milestone was revised twice. Read this box first.
>
> **1. Tauri's official notification plugin cannot schedule on desktop.** Its reference says, verbatim: *"Scheduling is only supported on mobile; desktop notifications are always shown immediately."* `pending()` is mobile-only and there is no cancel API. Upstream issue [plugins-workspace#2141](https://github.com/tauri-apps/plugins-workspace/issues/2141) has been open since 2022. So the plugin can only *show* a notification immediately — it is not a scheduler. See [`../RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) F1.
>
> **2. The user chose OS-native scheduling, Linux first** (2026-10-03). D16: Linux gets real OS-level scheduling via **systemd user timers**; Windows and macOS are an explicit **M12 TODO**, not silently dropped; the in-process timer stays as the fallback where no user systemd session exists.
>
> Primitives verified present on this machine (RESEARCH F13): systemd **255**, a running user instance, `/usr/bin/notify-send` working against the session bus, `/usr/bin/systemd-run`, and `~/.config/systemd/user/`. **`at`/`atd` are absent** — do not reach for them.

**Goal:** a desktop app whose alarms actually fire on Linux with the app closed, and that falls back honestly (never silently) everywhere else.

**Prev:** [M4](./M4-alarm-engine.md) — the scheduler interface and reconcile exist.
**Next:** [M7 — backup](./M7-backup.md)

---

## Files

```
apps/app/src-tauri/src/lib.rs                    register the alarm commands
apps/app/src-tauri/src/alarms.rs                 ← the Linux scheduler, in Rust
apps/app/src-tauri/capabilities/default.json
apps/app/src/lib/alarms/desktop-scheduler.ts     AlarmScheduler over invoke()
apps/app/src/lib/alarms/desktop-mode.ts          probe → which mode is active
apps/app/src/lib/alarms/reconcile.ts             ← extended: stamp-based missed detection
apps/app/tests/desktop-scheduler.test.ts
apps/app/tests/systemd-units.test.ts             pure unit-file generation + escaping
```

> **Rust toolchain is already installed** (rustc/cargo 1.97.1, verified 2026-10-03). No `rustup` download. If you land on a machine without it, **ask** — it is a multi-hundred-MB install.

---

## Design

Two modes, chosen by a runtime probe. The UI must say which one is active; there is no third, silent mode.

### Mode A — `systemd` (preferred, Linux)

One **transient pair of user units per alarm**, written to `~/.config/systemd/user/`:

`ikoro-<hash>.service` — oneshot, two `ExecStart` lines:

```ini
[Unit]
Description=Ikoro reminder
[Service]
Type=oneshot
ExecStart=/usr/bin/notify-send --app-name=Ikoro --urgency=critical --expire-time=0 "Ikoro" "<escaped title>"
ExecStart=/usr/bin/touch %h/.local/state/ikoro/fired/<hash>
```

`ikoro-<hash>.timer`:

```ini
[Unit]
Description=Ikoro reminder timer
[Timer]
OnCalendar=<YYYY-MM-DD HH:MM:SS>
Persistent=true
AccuracySec=1s
Unit=ikoro-<hash>.service
[Install]
WantedBy=timers.target
```

Why it works:

- **`Persistent=true`** is the catch-up: if the activation time passed while the machine was off, systemd runs the service shortly after the user manager starts. That is the desktop equivalent of Android's boot-restore.
- **The `touch` stamp** is what makes missed-detection possible. `list-timers` forgets a timer once it elapses, so "the timer is gone" is ambiguous. The stamp file is not.
- The units live in the **user** manager, so no root and no polkit prompt.

### Escaping — get this exactly right

Systemd unit files are not shell, and two characters bite:

| Character | Rule |
| --------- | ---- |
| `%` | **Must be doubled** → `%%`. Systemd expands `%h`, `%t`, `%n`, … anything else `%X` is an error and the unit will not load. |
| `"` | Escape as `\"` inside the quoted argument. |
| `\` | Escape as `\\`. |
| newline / CR | Strip. A multi-line title breaks the unit file. |

Write this as a **pure function** (`escapeUnitArg`) with its own tests. A task titled `50% done "final"` must not break the timer.

### Mode B — `timer` (fallback)

Used when the probe cannot find a usable user systemd session (a container, a non-systemd distro, a broken bus). It is the in-process scheduler:

- A `setTimeout` capped at **one hour** and re-armed on every wake, because `setTimeout` overflows past ~24.8 days (2³¹−1 ms).
- `sendNotification()` from `@tauri-apps/plugin-notification` — immediate delivery, which is exactly what that plugin does support.
- `schedule()` returns `{ ok: true, exact: false, warning: 'Ikoro must be running to remind you.' }`. Degraded is stated, never hidden.

### Missed detection (both modes)

Persist a heartbeat (`desktop-last-seen.ts`, `localStorage`, every 30 s and on exit). On launch:

- declare an alarm **missed** when `alarmAt` is past, the task is open, **and** neither a stamp file exists **nor** a timer is listed;
- declare an alarm **fired** when a stamp exists — set `alarmFiredAt`.

---

## Steps

### Step 0 — confirm the toolchain

```bash
rustc --version && cargo --version
```

- [ ] Both present.

### Step 1 — initialise the shell

```bash
cd apps/app
bun add @tauri-apps/api @tauri-apps/plugin-notification
bun add -D @tauri-apps/cli
bunx tauri init
```

Answers: name `Ikoro`, window title `Ikoro`, frontend dist `../build`, dev URL `http://localhost:5173`, dev command `bun run dev`, build command `bun run build`, identifier `com.michaelobele.ikoro`.

- [ ] `src-tauri/tauri.conf.json` has `frontendDist: "../build"`, `devUrl: "http://localhost:5173"`, and `version` matching `apps/app/package.json`.
- [ ] Register the notification plugin in `src-tauri/src/lib.rs`.

### Step 2 — icons

```bash
bunx tauri icon static/icons/icon-1024.png
```

- [ ] All desktop sizes land in `src-tauri/icons/`. The master came from M5.

### Step 3 — the Rust side (`src-tauri/src/alarms.rs`)

Five commands, each a thin wrapper over `std::process::Command`:

| Command | Behaviour |
| ------- | --------- |
| `alarm_probe()` | Returns `{ systemd: boolean, notifySend: boolean, linger: boolean, mode: 'systemd' \| 'timer', detail: string }`. Check `systemctl --user is-system-running` (accept `running` and `degraded`), the existence of `/usr/bin/notify-send`, and `loginctl show-user $USER` for `Linger=`. |
| `alarm_arm({ taskId, title, at })` | Write both units with the **escaped** title, `systemctl --user daemon-reload`, `systemctl --user start ikoro-<hash>.timer`. Returns `{ ok: true, platformId: 'systemd:<hash>' }` or a structured error. |
| `alarm_cancel({ taskId })` | `systemctl --user stop`, `disable`, delete both unit files, `daemon-reload`. Idempotent — cancelling a missing alarm succeeds. |
| `alarm_list()` | `systemctl --user list-timers --all --output=json`, filtered to units named `ikoro-*`. Returns the task hashes. |
| `alarm_stamps()` | List `~/.local/state/ikoro/fired/*`, returning hashes, for missed detection. |

- [ ] `hashId` lives in **one** place. Rust must compute the same 32-bit FNV-1a hash as `apps/app/src/lib/utils/id.ts` — the unit filename depends on it. Add a Rust unit test with the same fixed input/expected value as the TypeScript test, or the two implementations will drift and alarms will be cancelled that were never armed.
- [ ] Escape via `escapeUnitArg` (pure, unit-tested): `%` → `%%`, `"` → `\"`, `\` → `\\`, CR/LF stripped.
- [ ] Register all five in `tauri::generate_handler![…]`.
- [ ] ⚠️ **Verify** whether app-defined commands need an entry in `src-tauri/capabilities/default.json`. In Tauri v2, capabilities gate **plugin** commands; app commands are usually permitted by registration alone. Test it — call `alarm_probe()` from the webview and see. Record the answer in `## Findings` either way, since it is a five-minute trap for the next person.
- [ ] Add `notification:default` to the capabilities for the plugin, and nothing else. No wildcard.

### Step 4 — write the failing tests

`apps/app/tests/systemd-units.test.ts` — pure, no Rust, no Tauri:

- [ ] `escapeUnitArg('50% done')` → `'50%% done'`.
- [ ] `escapeUnitArg('say "hi"')` → `'say \\"hi\\"'`.
- [ ] `escapeUnitArg('a\\b')` → `'a\\\\b'`.
- [ ] `escapeUnitArg('line1\nline2')` → `'line1line2'`.
- [ ] `buildTimerUnit({ hash, at })` contains `OnCalendar=`, `Persistent=true`, `AccuracySec=1s`, and the `Unit=` line.
- [ ] `buildServiceUnit({ hash, title })` has exactly two `ExecStart=` lines, the second touching the stamp path.

`apps/app/tests/desktop-scheduler.test.ts` — mock `invoke` from `@tauri-apps/api/core`:

- [ ] With `alarm_probe` reporting `mode: 'systemd'`, `schedule()` invokes `alarm_arm` and returns `exact: true`.
- [ ] With `mode: 'timer'`, `schedule()` arms an in-process timer for `min(alarmAt, now + 1h)` and returns `exact: false` with a warning — never a bare success.
- [ ] `cancel()` invokes `alarm_cancel` and clears any local timer.
- [ ] `getPending()` reflects `alarm_list`.
- [ ] A past `alarmAt` **with** a stamp → treated as fired, `alarmFiredAt` set.
- [ ] A past `alarmAt` **without** a stamp and not listed → reported as missed.
- [ ] A `systemctl` failure (non-zero exit) → probe falls back to `mode: 'timer'` rather than throwing.

```bash
cd apps/app && bun run test
```

- [ ] Fails for the right reason first.

### Step 5 — implement the TypeScript side

- [ ] `desktop-mode.ts` — call `alarm_probe()` once at startup, cache the result, expose `mode` plus a human-readable `detail`.
- [ ] `desktop-scheduler.ts` — `AlarmScheduler` with `platform: 'desktop'`, dispatching on the probe.
- [ ] Wire it into `scheduler.ts` so `detectPlatform() === 'desktop'` returns it.
- [ ] Extend `reconcile.ts` with the stamp-based rules above.
- [ ] `+layout.svelte` desktop branch: on mount and on window focus → re-probe, re-arm, detect missed.
- [ ] Notification click (timer mode only): focus the window and open the task. **In systemd mode there is no click-through** — `notify-send` cannot route back into the app. Say so in the UI rather than implying otherwise; a click-through version is M12 (it needs the service to invoke the app binary with a flag).

### Step 6 — honest copy

- [ ] Settings → Notifications shows the active mode:
  - systemd → *"Alarms are scheduled by the system — they fire even when Ikoro is closed."*
  - timer → *"Ikoro must be running to remind you. Alarms are not scheduled by the system on this machine."*
- [ ] If `linger === false`, add one line: *"Alarms stop if you log out. Run `loginctl enable-linger $USER` once to keep them."* — present it as information, not a button; enabling linger may need polkit approval and is the user's call.
- [ ] The alarm sheet reflects the active mode.
- [ ] No claim anywhere that Windows/macOS fire with the app closed.

### Step 7 — build and verify

```bash
bun run build
bunx tauri build          # ask first — the first run compiles the whole Rust dependency tree
```

Verify, in this order:

- [ ] `alarm_probe()` reports `mode: 'systemd'` on this machine.
- [ ] Arm an alarm 2 minutes out → `systemctl --user list-timers --all | grep ikoro` shows it with the right time.
- [ ] **Quit the app** → the notification still fires at the scheduled minute. This is the whole point of the milestone.
- [ ] `ls ~/.local/state/ikoro/fired/` gains a stamp for that alarm.
- [ ] Arm an alarm, then `systemctl --user stop ikoro-<hash>.timer` and let the time pass, reopen the app → it is reported as **missed**, not silently dropped.
- [ ] A task titled `50% done "urgent"` arms successfully — proof the escaping works on real input, not just in the unit test.
- [ ] Delete the app's alarm → the unit files are gone and no timer remains.

### Step 8 — verify and commit

```bash
cd ../.. && bun run check && bun run test
git add -A
git commit -m "feat: Tauri desktop shell + Linux systemd alarm scheduler (M6)"
```

---

## Acceptance

- [ ] The desktop app builds and launches with the correct icon, name and identifier.
- [ ] **On Linux, an alarm fires with the app closed** — verified by observation, not inferred from the unit file existing.
- [ ] A task title containing `%`, `"`, `\` or a newline arms without breaking the unit.
- [ ] A missed alarm is surfaced as missed on next open.
- [ ] Mode B is taken automatically when systemd is unusable, and the UI says which mode is active.
- [ ] The Rust and TypeScript `hashId` implementations agree — proven by a shared fixed-vector test.
- [ ] Only `src/lib/alarms/` imports `@tauri-apps/plugin-notification` or calls `invoke()`.
- [ ] `capabilities/default.json` grants plugin notification permissions only, with no wildcard.
- [ ] Windows/macOS behaviour is documented as unsupported, in the UI and in `docs/design/decisions.md`.

## Findings

_(Record: OS and desktop environment · probe result · did the alarm fire with the app closed · seconds of drift · whether app-defined commands needed a capability entry · whether `linger` was false and what you did.)_

---

> **Prompt for the builder**
>
> _«Execute M6 of the Ikoro build plan. Read the ⚠️ revision box at the top of `docs/build/M6-desktop.md`, plus `docs/RESEARCH-2026-10.md` F1/F13, before anything else. Tauri's official plugin cannot schedule on desktop, so Linux alarms are scheduled with per-alarm systemd user timers written by Rust commands — `at`/`atd` are not installed on this machine. Get the systemd escaping exactly right: `%` must be doubled or the unit will not load. The Alpine/Rust hashes in `utils/id.ts` and `alarms.rs` must agree. Ask before `tauri build` — the first run compiles the whole Rust tree. Write the pure unit-generation tests first.»_
