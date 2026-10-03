# M4 — Reminder engine ⭐ (spike first)

**Goal:** the product. A task with an alarm fires on time with the app killed, on Android, in Doze. Everything else in the app supports this milestone.

**Prev:** [M3](./M3-views.md) — views green and committed.
**Next:** [M5 — Android packaging](./M5-android-packaging.md)

**Read first:** [`../design/alarms.md`](../design/alarms.md) (all of it) · [`../RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) F3 / F10 / D18 · [`../VERSIONS.md`](../VERSIONS.md) §2.3.

---

## Files

```
apps/app/src/lib/alarms/types.ts                AlarmScheduler + ScheduleOutcome (00-conventions §3.2)
apps/app/src/lib/alarms/scheduler.ts            selects an implementation by platform
apps/app/src/lib/alarms/android-scheduler.ts    @capacitor/local-notifications  ← the only place it is imported
apps/app/src/lib/alarms/browser-scheduler.ts    dev preview only
apps/app/src/lib/alarms/reconcile.ts            missed detection + rescheduleAll
apps/app/src/lib/platform.ts                    detectPlatform()
apps/app/src/lib/components/task/AlarmSheet.svelte
apps/app/src/lib/components/ui/PermissionBanner.svelte
apps/app/src/routes/spike/+page.svelte          throwaway — deleted at the end of this milestone
apps/app/tests/reconcile.test.ts
apps/app/tests/android-scheduler.test.ts
```

Installs: `bun add @capacitor/core @capacitor/app @capacitor/local-notifications` (~2 MB).

> **Deviation from the original plan:** `schedule()` returns `ScheduleOutcome`, not `string | null`, because Capacitor reports a degraded (inexact) schedule through `ScheduleResult.warning`. A degraded alarm must be visible, never silently accepted. See [`00-conventions.md`](./00-conventions.md) §3.2.

---

## M4-S1 — 🔬 the make-or-break spike

**Do not write engine code, UI, or tests until this passes on a physical device.** If it fails, the entire product premise needs re-planning (Pólya phase 2), not a workaround.

### Step 1 — throwaway route

`apps/app/src/routes/spike/+page.svelte`:

- A button that schedules a notification **2 minutes out**:
  `LocalNotifications.schedule({ notifications: [{ id: 999, title: 'Ikoro spike', body: 'test', schedule: { at: new Date(Date.now() + 120_000), allowWhileIdle: true, isExactNotification: true, isExactMandatory: true } }] })`
- On the same page, display the raw output of `checkExactNotificationSetting()` and `checkPermissions()`.
- Catch and render the error verbatim if `schedule()` rejects.

### Step 2 — build and install

```bash
cd apps/app
bun run build
bunx cap init ikoro com.michaelobele.ikoro --web-dir build
bunx cap add android
```

- [ ] Add to `android/app/src/main/AndroidManifest.xml`:
      `<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />`
      `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`
- [ ] `bunx cap sync android && cd android && ./gradlew assembleDebug`
- [ ] `adb install -r app/build/outputs/apk/debug/app-debug.apk`

### Step 3 — the core test

Follow [`../design/alarms.md`](../design/alarms.md) §4:

```bash
# schedule the alarm from the spike screen first, then:
adb shell am force-stop com.michaelobele.ikoro   # kill the app
adb shell dumpsys deviceidle force-idle          # enter Doze
# wait past the alarm time
```

- [ ] The notification arrives **at the scheduled minute** (± 60 s), with the app killed, in Doze.
- [ ] Tap opens the app.

### Step 4 — ⚠️ GATE

- [ ] **If it fired:** record the observed behaviour (device model, Android version, whether `checkExactNotificationSetting()` reported granted, whether the schedule call returned a `warning`) in this file under `## Findings`. Continue to the engine.
- [ ] **If it did not fire: STOP. Do not continue.** Collect evidence and report:
      `adb logcat -s Capacitor/LocalNotification AndroidRuntime`, the value of `isExactNotification` / `isExactMandatory`, and whether the fallback path was taken (`ScheduleResult.warning`). Return to planning — do not improvise a fix that the plan has not sanctioned.

---

## The engine

### Step 5 — write the failing reconcile tests

`apps/app/tests/reconcile.test.ts` — mock `AlarmScheduler`, no Capacitor:

```ts
import { describe, it, expect, vi } from 'vitest';
// a hand-written fake implementing AlarmScheduler, so the tests never touch a device
```

Cases:

- [ ] Drift: the store says task A is armed for the future, `getPending()` does not contain its id → `rescheduleAll()` calls `schedule()` for A and persists the returned `platformId`.
- [ ] Past + still pending: `alarmAt < now` and `getPending()` contains the id → reported as **missed**, and clearly distinguishable from a success.
- [ ] Past + absent: `alarmAt < now` and the id is absent from `getPending()` → `alarmFiredAt` is set to the alarm's instant.
- [ ] Completed: `completedAt !== null` → the alarm is cancelled and never re-armed.
- [ ] No alarm: `alarmAt === null` → untouched.
- [ ] Degraded: `schedule()` returns `{ ok: true, exact: false, warning }` → the outcome is recorded as degraded, **not** as success.

```bash
cd apps/app && bun run test
```

- [ ] Fails for the right reason before implementation.

### Step 6 — implement

- [ ] `types.ts` — verbatim from [`00-conventions.md`](./00-conventions.md) §3.2.
- [ ] `platform.ts`:
  ```ts
  export type Platform = 'android' | 'desktop' | 'browser';
  export function detectPlatform(): Platform {
    if (Capacitor.isNativePlatform()) return 'android';
    if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return 'desktop';
    return 'browser';
  }
  ```
- [ ] `android-scheduler.ts`:
  - `ensureReady()` → `checkPermissions()` for notifications (request if `prompt`), then `checkExactNotificationSetting()`; map both into `AlarmPermissionStatus`.
  - `schedule(alarm)` → `LocalNotifications.schedule({ notifications: [{ id: hashId(alarm.taskId), title: 'Ikoro', body: alarm.title, channelId: 'reminders', extra: { taskId: alarm.taskId }, schedule: { at: new Date(alarm.at), allowWhileIdle: true, isExactNotification: true, isExactMandatory: true } }] })`.
    Inspect the returned result for a `warning` on the notification. Present → `{ ok: true, platformId, exact: false, warning }`. Absent → `{ ok: true, platformId, exact: true }`. A rejection carrying a permission error → `{ ok: false, reason: 'permission' }`.
  - `cancel(platformId)`, `getPending()` via `LocalNotifications.getPending()`.
  - `onAction()` → `LocalNotifications.addListener('localNotificationActionPerformed', …)`, extracting `extra.taskId`.
  - Also listen for `localNotificationReceived` while the app is open and stamp `alarmFiredAt`.
- [ ] `browser-scheduler.ts` — dev preview only: in-page `Notification` plus a capped `setTimeout`, re-armed on wake; `schedule()` returns `{ ok: true, platformId: 'browser', exact: false, warning: 'Browser reminders require the app to be open.' }`.
- [ ] `scheduler.ts` — returns the implementation for `detectPlatform()`. This is the **only** module other code imports.
- [ ] `reconcile.ts`:
  - `rescheduleAll()` — diff the store (`alarmAt > now && completedAt === null && deletedAt === null`) against `getPending()`; cancel orphans; arm missing; persist `alarmId`; surface degraded outcomes. Use `where('byAlarm')` rather than `getAll()` — the index holds only rows that actually have an alarm.
  - `detectMissed()` — per Step 5.
  - Export `PAST_WINDOW`-style named constants rather than magic numbers.

```bash
bun run test
```

- [ ] Reconcile and scheduler tests pass.

### Step 7 — permission UX

- [ ] `PermissionBanner.svelte` — renders when `exact === 'denied'` or `notifications === 'denied'`. One sentence each, plus a button: `changeExactNotificationSetting()` or `requestPermissions()`.
  - exact denied → *"Exact timing is off — reminders may be late."*
  - notifications denied → *"Notifications are off — Ikoro can't reach you."*
- [ ] Wire resume: in the native branch of `+layout.svelte`, `App.addListener('appStateChange', …)` → on `active`, re-run `ensureReady()` and `rescheduleAll()`. Revocation silently deletes armed alarms, so this is not optional.
- [ ] Settings → **Notifications health**: current status, the count of armed alarms, and a **Reschedule all** button.

### Step 8 — the alarm control

- [ ] `AlarmSheet.svelte`, mounted inside `TaskSheet`: a **Remind me** switch plus a time input defaulting to `dueTime`, or `now + 1h` when there is none.
  - On → `alarmAt = atLocal(dueDate, chosenTime)`, then `scheduler.schedule(...)`; store `alarmId`.
  - Off → `scheduler.cancel(task.alarmId)`, clear `alarmId` and `alarmAt`.
  - Editing the time while armed → cancel then re-schedule.
  - **Show the outcome.** `exact: false` renders the warning inline. `ok: false` renders the reason and leaves the switch off.
- [ ] Browser-only copy when `detectPlatform() === 'browser'`: *"Reminders need Ikoro open in the browser — install the Android or desktop app for alarms that fire when closed."*

### Step 9 — clean up, verify, commit

```bash
rm -rf apps/app/src/routes/spike
cd ../.. && bun run check && bun run test
git add -A
git commit -m "feat: reminder engine — exact notifications + permission UX (M4)"
```

---

## Acceptance

- [ ] **The M4-S1 device result is recorded** in `## Findings`, including device model and Android version.
- [ ] Scheduling uses `isExactNotification: true` **and** `isExactMandatory: true`; a degraded result is never reported as success.
- [ ] Killing the app, entering Doze (`adb shell dumpsys deviceidle force-idle`), and waiting still fires the reminder at the scheduled minute.
- [ ] Revoking the exact-alarm setting in system settings → on next resume the banner appears and `rescheduleAll()` re-arms from the store.
- [ ] A missed alarm is visible to the user, never silently lost.
- [ ] `grep -rn "@capacitor/local-notifications" apps/app/src --include=*.svelte` → no results. Only `src/lib/alarms/` imports it.
- [ ] `grep -rn "svelte-idb" apps/app/src/lib/alarms` → no results.
- [ ] `spike/` is gone.

## Findings

_(Record the M4-S1 device result here: device model · Android version · exact-alarm setting · did it fire · ± seconds · any `warning` from the schedule call.)_

---

> **Prompt for the builder**
>
> _«Execute M4 of the Ikoro build plan. Read `docs/build/M4-alarm-engine.md`, `docs/design/alarms.md` and `docs/VERSIONS.md` §2.3 completely first. Start with the M4-S1 spike and STOP at the ⚠️ GATE — report the verbatim device result and do not write engine code until a physical device has proven the alarm fires with the app killed in Doze mode. `src/lib/alarms/` is the only place that may import a notification API. Write `tests/reconcile.test.ts` against a mocked scheduler before implementing. Ask before any build. Run `bun run check && bun run test` from the repo root before committing.»_
