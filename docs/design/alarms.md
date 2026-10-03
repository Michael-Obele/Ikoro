# Ikoro — Alarm feature design

> [!WARNING]
> **Partially superseded.** The desktop column is wrong: Tauri's official notification plugin **cannot schedule on desktop** (scheduling is mobile-only). Desktop v1 fires only while the app is running. See [`RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) F1 / D16. Android gained fail-loud exact-alarm flags in `@capacitor/local-notifications` 8.3+ — see D18.

Back to [README](./README.md).

The whole product promise lives here: **set a time → it fires**. Design split into tiers per [decisions.md](./decisions.md) §D1 (staged: notify → alarm).

## 1. Capability matrix

| Capability                       | Tier 1 — official plugin (v1)          | Tier 2 — custom Kotlin plugin (v2)      | Desktop — Tauri (M6)              |
| -------------------------------- | -------------------------------------- | --------------------------------------- | --------------------------------- |
| Exact fire time                  | ✅ `setExactAndAllowWhileIdle` + exact-permission | ✅ `setAlarmClock()`          | ❌ — in-process timer only (D16) |
| Fires with app killed            | ✅                                      | ✅                                       | ❌ — the app must be running (D16) |
| Survives Doze                    | ✅ (`allowWhileIdle: true`)             | ✅ (clock-alarm priority)                | n/a (no Doze on desktop)          |
| Survives reboot                  | ⚠️ plugin restore — **verify M4-S1**     | ✅ own `BOOT_COMPLETED` receiver         | ❌ — n/a, no OS scheduling |
| Full-screen over lock screen     | ❌                                      | ✅ `CATEGORY_ALARM` + FSI                | n/a (no lock-screen concept)      |
| Continuous ring / loud alarm     | ❌ one-shot sound                       | ✅ `STREAM_ALARM` + foreground service   | ❌ OS notification sound          |
| Snooze / dismiss actions         | ⚠️ notification actions only (post-launch) | ✅ designed-in (2/5/10/15 min)       | ❌ v2                              |
| Bypasses DND                     | ❌                                      | ✅ alarm channel can bypass DND          | ⚠️ OS focus/DND modes apply       |
| Works on Samsung (exact off by default) | ⚠️ must prompt user to enable     | ⚠️ same prompt                          | n/a                               |

**📌 v1 promise (ship this):** Android = Tier 1 + honest UX — a permission health banner that never lets a broken alarm state be invisible. Desktop = an **in-process timer while the app runs**, plus missed-detection on reopen — the official plugin cannot schedule on desktop at all (D16). **v2 promise:** Tier 2 for "wake me" alarms. Browser = dev-preview only (PWA dropped, D2).

## 2. Tier 1 — exact notifications (v1)

### 2.1 Schedule call (the one true path)

Every alarm goes through `src/lib/alarms/scheduler.ts` — never call the plugin anywhere else:

```ts
// src/lib/alarms/types.ts
export interface AlarmRequest {
  taskId: string;
  title: string;
  at: string; // ISO 8601, absolute time
}
export interface AlarmPermissionStatus {
  notifications: 'granted' | 'denied' | 'prompt';
  exact: 'granted' | 'denied' | 'unsupported'; // Android only; 'unsupported' on web
}
export interface AlarmScheduler {
  readonly platform: 'android' | 'web';
  ensureReady(): Promise<AlarmPermissionStatus>; // called on launch + resume
  schedule(alarm: AlarmRequest): Promise<string | null>; // returns platform id, null = refused
  cancel(platformId: string): Promise<void>;
  getPending(): Promise<Set<string>>; // platform ids still armed
}
```

Android implementation (sketch — exact plugin calls):

```ts
await LocalNotifications.schedule({
  notifications: [
    {
      id: Number(hashId(taskId)), // stable 32-bit id derived from taskId
      title: 'Ikoro',
      body: title,
      channelId: 'reminders', // created with IMPORTANCE_HIGH (§2.2)
      extra: { taskId },
      schedule: { at: dateFromISO(at), allowWhileIdle: true }, // → setExactAndAllowWhileIdle(RTC_WAKEUP)
    },
  ],
});
```

### 2.2 Channels

Create once on first launch via `LocalNotifications.createChannel({ id: 'reminders', name: 'Reminders', importance: 'high', sound: 'default', description: 'Task reminders' })`. High importance = heads-up banner while unlocked; the plugin's default channel uses `USAGE_ALARM` audio attributes (source analysis in [research.md](./research.md) §2).

### 2.3 Permission flow (state machine)

```
launch → POST_NOTIFICATIONS? (API 33+: request on first alarm set)
       → checkExactNotificationSetting()   [Android]
       ├─ granted → arm alarms, banner = OK
       └─ denied  → banner: "Exact timing is off — reminders may be late."
                    button → changeExactNotificationSetting() (system screen)
resume (App.appStateChange 'active') → re-check BOTH
       └─ if revoked after being granted → plugin has DELETED scheduled alarms (source-verified)
                                            → rescheduleAll() from Dexie + persistent banner
```

Rules:
- **✅ Never trust a previously granted exact setting.** Android 14 revocation restarts the app and wipes scheduled exact notifications (plugin README, [research.md](./research.md) §2).
- Sideload path additionally offers `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` deep-link ("Never kill my reminders") — offered once, dismissible, explained in one sentence (Brutus pattern). Play-store path (if ever): re-evaluate — Play restricts this permission ([decisions.md](./decisions.md) §R1).

### 2.4 Arm / re-arm algorithm (source of truth = Dexie)

- Task saved with `alarmAt` → `scheduler.schedule()` → store returned platform id in `task.alarmId`.
- Task edited/completed/deleted → `cancel(oldId)` → re-schedule if still armed.
- **`rescheduleAll()`** runs on: app launch, resume-after-revocation, import, and (Tier 2) boot. It diffs Dexie `alarmAt > now && !completedAt` against `scheduler.getPending()` and fixes drift — this makes reboot-restore bugs self-healing whenever the app opens.

### 2.5 Firing & missed-detection

- Firing (app open): plugin emits `localNotificationReceived` → mark `alarmFiredAt`.
- Firing (app tapped): `localNotificationActionPerformed` carries `extra.taskId` → `goto('/today?task=<id>')` opens the task.
- **Missed detection** (how we keep the promise honest): on every launch, `getPending()` vs Dexie — an alarm with `alarmAt < now`, not completed, still **pending** means it did **not** fire (exact permission lost / device off) → surface "⚠ N reminders missed while Ikoro was closed" banner with one-tap fix (`changeExactNotificationSetting()` + `rescheduleAll()`). If it's **absent** from pending → mark `alarmFiredAt = alarmAt`.

### 2.6 Browser (dev-preview) & desktop schedulers

- **Browser (dev only):** in-page `new Notification(...)` + `setTimeout` (re-armed on every wake, cap 24 h). Closed tab → missed-detection path §2.5 on next open. Alarm-sheet copy when `platform === 'browser'`: *"Reminders need Ikoro open in the browser — install the Android or desktop app for alarms that fire when closed."*
- **Desktop (`desktop-scheduler.ts`, M6):** `@tauri-apps/plugin-notification` is used for **immediate** delivery only — its `send({ schedule: { at: … } })` is ignored on desktop, and `pending()` is mobile-only (RESEARCH F1). So the desktop scheduler arms an **in-process `setTimeout`** capped at one hour and re-armed on wake, persists a **last-seen heartbeat** to `localStorage` so an alarm that passed while the app was closed is detected as *missed* on next open, and shares the reconcile logic in §2.4–2.5. Copy is explicit: *"Ikoro must be running to remind you on desktop."*

## 3. Tier 2 — full alarm mode (v2 spike, spec now)

Custom Capacitor plugin `ikoro-exact-alarm` (Kotlin), modeled on [Brutus](https://github.com/pepperonas/brutus) (field-manual table in [research.md](./research.md) §4):

- **Scheduling:** `AlarmManager.setAlarmClock(AlarmClockInfo(trigger, showIntent), pendingIntent)` — status-bar alarm icon, fires in Doze, unaffected by battery optimization.
- **Presentation:** full-screen `AlarmActivity` over the lock screen: `CATEGORY_ALARM` + `setFullScreenIntent()`; guard with `canUseFullScreenIntent()` (Android 14+ default-grant only for alarm apps — deep-link `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` if off).
- **Audio:** foreground service (`mediaPlayback` type) + `PARTIAL_WAKE_LOCK` (10-min timeout) + `STREAM_ALARM` at max volume while ringing (restore on dismiss) + `VIBRATE` pattern.
- **Snooze/dismiss:** snooze 2/5/10/15 min (default 5) re-arms `setAlarmClock` from dismiss; dismiss marks task done-in-app via plugin event.
- **Persistence:** plugin keeps a JSON mirror of armed alarms in `SharedPreferences`; `BOOT_COMPLETED` + `LOCKED_BOOT_COMPLETED` receiver re-registers (`goAsync()`), expired entries purged. JS-side `rescheduleAll()` (§2.4) remains the backstop.
- **Manifest (v2):** `SCHEDULE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`.
- **Upgrade trigger:** ship Tier 2 when either (a) a "wake me up" use case is prioritized, or (b) Tier-1 missed-rate testing shows OEM kills we can't close with the battery-optimization prompt.

## 4. Test procedure (the alarm QA gate — runs in M8)

```bash
adb shell dumpsys deviceidle force-idle      # Doze now
# expected: reminder fires at exact time (±1 min), even with app killed:
adb shell am force-stop com.ikoro.app
adb shell settings put global low_power 1    # battery saver
# expected: fires again for a second scheduled task
adb reboot && <wait>                          # reboot survival (plugin restore)
```

Manual matrix (each = fire on time, correct title, tap opens task):

- [ ] app foreground / background / killed
- [ ] screen on / screen off / Doze forced / battery saver
- [ ] exact permission granted / revoked mid-session (banner + auto-reschedule)
- [ ] reboot with pending alarm
- [ ] notification posted → `getPending()` empty → missed-detection marks `alarmFiredAt`
- [ ] **desktop:** the notification fires while the app is **running** (window minimised is fine) · an alarm that passed while the app was closed is surfaced as *missed* on next open · tap/click → task opens. Do **not** test for an app-closed delivery — the official plugin cannot schedule on desktop (D16).

Pass = **all** fire within ±60 s of target on at least one physical device **and** one OEM skin (Samsung if available).

---

Back to [README](./README.md) · Next: [architecture.md](./architecture.md) · [milestones.md](./milestones.md)
