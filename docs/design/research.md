# Ikoro — Research

> [!WARNING]
> **Partially superseded.** §8's claim that Tauri schedules desktop notifications "for real" is **wrong** — the official plugin schedules on mobile only. Versions named here have also drifted. See [`RESEARCH-2026-10.md`](../RESEARCH-2026-10.md), which supersedes this document where they disagree.

Back to [README](./README.md).

Verified 2026-09-25/26 via live sources. Format: **✅ verified fact** (with source) / **📌 recommendation** (our call) / **❓ open question** (re-check at build time).

## 1. Why reminder apps silently fail on Android

- **✅** Most reminder apps schedule with `WorkManager` / `Handler.postDelayed()` / scheduled jobs. In Doze mode, with battery saver on, or under OEM proprietary battery management (Samsung, Xiaomi, OnePlus), Android **defers or skips them entirely**. The task shows as overdue with no notification ever sent — and it never appears in crash logs. Source: [Why Your Android Reminder App Is Silently Failing You](https://dev.to/amit_raz_4280cb3a49bb4086/why-your-android-reminder-app-is-silently-failing-you-and-how-to-fix-it-2ff2) (2026-04).
- **✅** The reliability ladder on Android (same source + [developer.android.com — Schedule alarms](https://developer.android.com/develop/background-work/services/alarms)):

  | API                                    | Behavior                                                          |
  | ---------------------------------------- | ----------------------------------------------------------------- |
  | `set(RTC, …)`                          | Inexact — Android batches and delays. Never for alarms.           |
  | `setExact(RTC, …)`                     | Exact wall-clock, but can still be deferred in Doze.              |
  | `setExactAndAllowWhileIdle(RTC_WAKEUP)`| Exact **and** fires during Doze (once per 9 min per app in Doze). |
  | `setAlarmClock(…)`                     | **Clock-alarm priority**: fires in Doze, alarm icon in status bar, treated like the built-in clock app. Highest tier. |

- **✅** Official docs confirm: "Alarms set with `setAlarmClock()` continue to fire normally" during Doze. Source: [Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby).
- **✅** Alarms do **not** survive reboot — a `BOOT_COMPLETED` receiver must re-register every pending alarm, or the user silently loses all reminders. Sources: dev.to article; Brutus repo.
- **✅** Testing without waiting in real time:
  ```bash
  adb shell dumpsys deviceidle force-idle   # enter Doze now
  adb shell dumpsys deviceidle              # check Doze state
  adb shell settings put global low_power 1 # battery saver on
  adb shell settings put global low_power 0 # off
  adb shell dumpsys deviceidle step         # step Doze states
  ```

## 2. What `@capacitor/local-notifications` actually does (source-code analysis)

Read directly from `ionic-team/capacitor-plugins` → `local-notifications/android/.../LocalNotificationManager.java` (2026-09-25).

- **✅** `setExactIfPossible()` logic:
  - exact allowed + `schedule.allowWhileIdle: true` → `setExactAndAllowWhileIdle(RTC_WAKEUP, …)` ✅ the Tier-1 sweet spot
  - exact allowed + no `allowWhileIdle` → `setExact(RTC, …)` (exact but not wakeup — weaker with screen off)
  - exact **not** allowed → falls back to `setAndAllowWhileIdle(RTC_WAKEUP)` or plain `set(RTC)` and logs *"Exact alarms not allowed in user settings"*
- **✅** JS API v6+: `checkExactNotificationSetting()` and `changeExactNotificationSetting()` (opens the system screen). If the user revokes the setting, **the app restarts and all exact-scheduled notifications are deleted** → must re-check on every resume. Source: plugin README + `LocalNotificationsPlugin.java`.
- **✅** The plugin restores scheduled notifications after boot (`LocalNotificationRestoreReceiver`) — **❓ open question: verify on-device in spike M4-S1** (OEM quick-boot `LOCKED_BOOT_COMPLETED` not guaranteed).
- **✅** Gaps: source contains `// TODO support different AlarmManager.RTC modes depending on priority`. It does **not** use `setAlarmClock()`, has **no full-screen intent**, no continuous alarm sound, no snooze. Repeating `at` schedules use `setRepeating()` (inexact). → Tier 2 needs a custom plugin, see [alarms.md](./alarms.md).
- **✅** Manifest needs `<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>` added manually (not automatic).

## 3. Android permissions & Play policy (the rules of the game)

- **✅** Android 12 (API 31): `SCHEDULE_EXACT_ALARM` required for exact alarms; check `alarmManager.canScheduleExactAlarms()` and deep-link `ACTION_REQUEST_SCHEDULE_EXACT_ALARM`.
- **✅** Android 14+: `SCHEDULE_EXACT_ALARM` is **denied by default for newly installed apps**. Sources: [Schedule exact alarms are denied by default](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms), [Behavior changes](https://developer.android.com/about/versions/14/behavior-changes-all).
- **✅** `USE_EXACT_ALARM` is restricted by Play policy to calendar/alarm-clock apps — don't use it unless we ship on Play as an alarm app.
- **✅** `USE_FULL_SCREEN_INTENT`: from **2025-01-22, for apps targeting Android 14+, only apps with calling or alarm functionality get it by default**; others have it auto-revoked at install. Check at runtime with `NotificationManager.canUseFullScreenIntent()`, deep-link `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`. Sources: [Play Console — FSI requirements](https://support.google.com/googleplay/android-developer/answer/13392821), [AOSP — Full-screen intent limits](https://source.android.com/docs/core/permissions/fsi-limits).
- **✅** `POST_NOTIFICATIONS` runtime permission required on API 33+.
- **📌** Sideloaded APK (our v1 distribution) is not bound by Play's *store* rules, but **device-level** enforcement (FSI default grant, user revocations) still applies.
- **✅** Samsung on Android 12+ ships with exact alarms disabled by default for many apps — handle `canScheduleExactAlarms() == false` as a **normal state**, not an error (Brutus v1.3.0 notes).

## 4. Field manual: what a real alarm app must do (Brutus)

Lessons from [pepperonas/brutus](https://github.com/pepperonas/brutus) (Killer alarm clock for Android) — the Tier-2 checklist:

| Concern               | Mechanism                                                                       |
| --------------------- | ------------------------------------------------------------------------------- |
| Exact time            | `AlarmManager.setAlarmClock()` + status-bar alarm icon                          |
| Full-screen over lock | Notification with `CATEGORY_ALARM` + `setFullScreenIntent()`                    |
| Sound with screen off | Foreground service (`mediaPlayback` type) + `PARTIAL_WAKE_LOCK` (10-min timeout)|
| Silent/DND bypass     | `STREAM_ALARM` at max volume while ringing (restore volume on dismiss)          |
| Reboot                | Persist alarms + `BOOT_COMPLETED`/`LOCKED_BOOT_COMPLETED` receiver, `goAsync()`  |
| App kill              | `START_STICKY` service; re-schedule before firing                               |
| Android 14 FSI        | `canUseFullScreenIntent()` check + banner → `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` |
| Exact disabled        | `canScheduleExactAlarms()` → `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` deep-link    |
| Snooze                | 2/5/10/15 min (default 5); follow-up alarms scheduled from dismiss              |
| Volume-key capture    | Scoped strictly to the ringing window only                                      |

Permissions table (Brutus): `SCHEDULE_EXACT_ALARM`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `USE_FULL_SCREEN_INTENT`, `VIBRATE`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (banner deep-link; dialog opt-in per device).

## 5. Google Tasks — feature inventory & API

Full analysis + parity matrix + future sync design in **[google-tasks.md](./google-tasks.md)**. Headlines:

- **✅** Features: multiple lists (API cap: 2,000 lists, 20,000 tasks/list, 100,000 total), title (≤1024), notes (≤8192), due date, subtasks (`parent`), complete/hidden, drag reorder (`position` + `move`), sort by My order/Date/Deadline/Starred recently/Title, recurring tasks (day/week/month/year/custom + end date), Today view showing 365 days of open tasks.
- **✅** **The API cannot store a due TIME** ("Only date information is recorded; the time portion is discarded") and has **no recurrence field, no priority field, no reminder field**. → Times, priorities, recurrences, and alarms are permanently local data (see [google-tasks.md](./google-tasks.md) §Sync field split).
- **✅** Google Tasks has no configurable alarms — weak/no reminders is the exact gap this app exists for.

## 6. Competitor landscape

| App                       | What it proves                                                        | Weakness we exploit                       |
| ------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Google Tasks              | Lists + tick-off are enough for millions                             | No priorities, no alarms, API drops times  |
| Todoist / TickTick        | Mature task managers                                                  | Reminders = push; OEMs kill them           |
| [To Do Reminder with Alarm](https://play.google.com/store/apps/details?id=com.ToDoReminder.gen) | Demand for task+alarm in one | Dated UI, no offline-first design          |
| [Alarms: Notes & Task List](https://play.google.com/store/apps/details?id=com.fulminesoftware.alarms) | Same demand | Unusual UX (alarms-as-notes)               |
| Alarmy / ReAlarm          | People crave reliable wake-ups                                        | No task management at all                 |

- **✅** Reddit (r/PKMS, 2025-02): users work around the gap by labeling **alarm-clock alarms with task names** — direct evidence of unmet demand.

## 7. iOS (out of scope for v1 — kept for later)

- **✅** Max **64 pending** local notifications per app — a hard cap that forces scheduling windows (schedule the next N, re-arm as they fire).
- **✅** "Time-Sensitive" interruption level works without Apple approval; "Critical alerts" require Apple's entitlement (not getting it).
- **📌** v1 ships Android + PWA per [decisions.md](./decisions.md) §D2; iOS re-evaluated at v2.

## 8. Desktop, monorepo & Svelte Native (researched 2026-09-26)

- **✅ Tauri v2 notification plugin schedules for real:** `send({ schedule: { at: { date, allowWhileIdle, repeating } } })` plus `channelId`, `extra` payload, 32-bit ids — deliberately mirrors Capacitor's API (source: [v2.tauri.app JS reference](https://v2.tauri.app/reference/javascript/notification/)). Windows/macOS = OS-scheduled (delivers with app closed); **Linux = notify-rust requires a D-Bus notification daemon and scheduling is daemon-dependent** → in-process timer backstop (desktop apps are long-running — see [milestones M6](./milestones.md)).
- **✅ Svelte Native verdict = no** ([decisions.md §D15](./decisions.md)): official docs disclaimer ("not an officially supported product of either the NativeScript or Svelte projects"); `halfnelson/svelte-native` archived → `nativescript-community` fork; npm publish gaps (~2 yrs / 9 months); [Mainmatter, 2025-05](https://mainmatter.com/blog/2025/05/22/native-apps-with-svelte/): NativeScript "doesn't work with the latest version of Svelte and currently there's no way to render both for web AND for native"; Svelte 5's custom-renderer API only just landed (sveltejs/svelte PR #15538) as groundwork. Would force a full NativeScript-XML rewrite — no Tailwind, no shadcn-svelte, zero sharing (kills the monorepo premise).
- **✅ Monorepo prior art:** [Turborepo's SvelteKit guide](https://turborepo.dev/docs/guides/frameworks/sveltekit); "Monolith → Monorepo with Turborepo, pnpm & Capacitor" (dev.to); community practice = workspaces + intentionally small shared packages; known quirk: `svelte-package` dist/`package.json` import path (sveltejs/kit discussion #7559). **Bun workspaces + `bun run --filter` is sufficient — no Turborepo until build time hurts.**
- **✅ Sync pattern:** outbox + per-record last-writer-wins + tombstones + monotonic cursor is the standard local-first recipe for low-contention data; CRDTs (ElectricSQL, Yjs, …) solve *high-concurrency* editing — overkill for a single-user, two-device task app ([decisions.md §D14](./decisions.md)). Redis likewise unnecessary at one instance (no pub/sub fanout, SSE in-process).

## Sources

- developer.android.com — Schedule alarms / Doze / Android 14 changes (3 pages above)
- dev.to — Amit Raz, reminder-app reliability (2026-04)
- github.com/ionic-team/capacitor-plugins — `@capacitor/local-notifications` source + README
- support.google.com/googleplay/android-developer/answer/13392821 — Play FSI rules (2025-01-22)
- source.android.com/docs/core/permissions/fsi-limits
- github.com/pepperonas/brutus — alarm app implementation notes
- workspace.google.com/products/tasks, support.google.com/tasks/answers 12132599 & 7675629
- googleapis.com/discovery/v1/apis/tasks/v1/rest — Tasks API discovery document (fetched 2026-09-26)
- web.archive.org — Blench, _A Dictionary of Ịbani_ (for the [name](./naming.md))
- v2.tauri.app — Tauri notification plugin JS reference + docs (schedule API)
- svelte.nativescript.org · github.com/nativescript-community/svelte-native · github.com/halfnelson/svelte-native (archived) — Svelte Native status
- mainmatter.com/blog/2025/05/22/native-apps-with-svelte/ — Svelte 5 custom renderer / NativeScript compatibility
- turborepo.dev/docs/guides/frameworks/sveltekit · dev.to (Turborepo+pnpm+Capacitor) · github.com/sveltejs/kit/discussions/7559 — monorepo prior art
- codingpancake.com (offline-first sync engines) · dev.to (CRDTs local-first) — sync pattern landscape

---

Back to [README](./README.md) · Next: [alarms.md](./alarms.md) · [milestones.md](./milestones.md)
