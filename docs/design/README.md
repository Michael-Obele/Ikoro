---
title: Ikoro — task lists with alarms that actually fire
status: draft
owner: Michael-Obele
tags:
  [sveltekit, svelte5, capacitor, tauri, monorepo, android, desktop, tailwind, shadcn-svelte, svelte-idb, offline-first, notifications, tasks, neon, drizzle, better-auth]
estimated_time: 3-4 weeks (evenings)
prototype: false
---

# Ikoro

> [!WARNING]
> **Partially superseded.** Written 2026-09-25/26. Several statements below were later proven wrong or have drifted — notably desktop alarm scheduling, the SvelteKit / Capacitor versions, the server's data layer (**Drizzle**, not Prisma), and the storage layer (**`svelte-idb`**, not Dexie: read every "Dexie" below as "`svelte-idb`"), plus the passkey-bootstrap question, which is now answered. Before acting on this document, read [`RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) §3 (Superseded statements) and use [`VERSIONS.md`](../VERSIONS.md) for versions. For execution, [`build/`](../build/README.md) is authoritative.

> The gong that calls you. Task lists whose reminders actually fire — even with the app closed, the screen off, and Doze mode on.

Ikoro is a local-first task/reminder app for **Android (Capacitor) + desktop (Tauri)**, in one **Bun-workspaces monorepo** — with a landing site and a self-hosted sync server (Bun + Neon, optional) built after the app. It exists because Google Tasks has solid lists and tick-off, but its alarm/reminder side is weak — and every mainstream alternative (Todoist, TickTick) delivers reminders as push notifications that Android OEMs silently kill. Ikoro's core promise is different: **when you set a time, the notification fires at that time** — verified in Doze, on a killed app, after a reboot.

All decisions were confirmed with Michael on 2026-09-25/26 (see [decisions.md](./decisions.md) — D11–D15 cover the monorepo, two-app server split, stack, sync protocol, and the Svelte Native verdict).

## The name

**Ikoro** (ih-KOR-oh) — Ịbani (Ijaw) word for the large _slit-gong used for announcements and to call assemblies_ (Blench, _A Dictionary of Ịbani_). In the Niger Delta, the ikoro's sound told the whole town **it is time** — no one was excused from hearing it. This app does the same for your tasks. Same heritage universe as Aghara, the town crier in the sibling project: *Aghara announces your posts to the world; Ikoro calls you when it's time.* Full process, scorecard, and availability checks in [naming.md](./naming.md).

## Why this exists

Research (2026-09-25, full sources in [research.md](./research.md)):

- Reminder apps that schedule with `WorkManager`/inexact jobs get **silently deferred** in Doze mode and by OEM battery killers (Samsung/Xiaomi/OnePlus). The reminder never fires and nothing shows in logs.
- The reliable ladder on Android is `set()` < `setExact()` < `setExactAndAllowWhileIdle()` < `setAlarmClock()`. The official `@capacitor/local-notifications` supports the middle two — enough for Tier 1. `setAlarmClock()` + full-screen intent is Tier 2 (v2, custom Kotlin plugin). Details in [alarms.md](./alarms.md).
- Competitor gap: Google Tasks = weak reminders; Todoist/TickTick = OEM-killed push; Play Store's "To Do Reminder with Alarm" and "Alarms: Notes & Task List" prove demand but aren't modern offline-first apps.

## Goals (v1)

1. Multiple task lists; tasks with title, notes, due date+time, priority, complete/uncomplete.
2. **A per-task alarm that fires at the exact time with the app killed** (Android, verified via adb Doze test).
3. Three surfaces from one codebase: **Android APK** (Capacitor) + **desktop app** (Tauri: Windows/macOS/Linux), both fully offline; landing + optional sync server follow (M9–M11).
4. Offline-first with zero accounts by default: everything in IndexedDB (`svelte-idb`) on device, JSON export/import backup. Optional self-hosted sync (passkeys + SSE) is opt-in, phase B.
5. Quality gate: `bun run check` clean, Vitest green, alarm QA checklist passed on mobile **and** desktop.

## Non-goals (v1)

- iOS, Google two-way sync (import only — its API can't carry times), recurring tasks (field reserved, UI hidden), snooze/full-screen alarms (Tier 2 / v2), subtasks, tags, collaboration, widget, public browser web app, telemetry (see [decisions.md](./decisions.md) out-of-scope).

## Success criteria

- [ ] Create a list → add a task → set an alarm → kill the app → notification arrives **at the scheduled second** with the device in Doze (`adb shell dumpsys deviceidle force-idle`).
- [ ] Reboot the device → pending alarms still fire (plugin boot-restore verified in spike M4-S1).
- [ ] Exact-alarm permission revoked in system settings → app shows the recovery banner on next resume and does not silently lose alarms.
- [ ] Desktop: a scheduled notification fires while the app is **running** (window minimised is fine); an alarm that passed while the app was closed surfaces as a **missed** banner on next open. ⚠️ "Fires with the app closed" is not achievable on desktop — see RESEARCH F1 / D16.
- [ ] Export → wipe → import restores all lists/tasks/alarms.
- [ ] (Phase B) Two signed-in devices converge via sync (LWW rules hold); landing live on Netlify; `GET /api/v1/health` green on Fly.io.

## Document map

| Document                                                             | What it answers                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [naming.md](./naming.md)                                             | How the name was chosen, scorecard, availability checks, alternatives     |
| [research.md](./research.md)                                         | Verified facts + sources: alarms, permissions, plugins, competitors       |
| [google-tasks.md](./google-tasks.md)                                 | Google Tasks feature inventory, v1 parity matrix, future sync design      |
| [alarms.md](./alarms.md)                                             | Tier 1/Tier 2 alarm design, permission UX, platform matrix, test procedure |
| [architecture.md](./architecture.md)                                 | Monorepo shape, stack, data model, sync protocol, native shells, backup   |
| [milestones.md](./milestones.md)                                     | Bite-sized tasks M0–M11 (app → desktop → landing → server → sync) + backlog |
| [decisions.md](./decisions.md)                                       | Decision log, alternatives, risks, out-of-scope, open questions           |

## Next steps

1. Read [milestones.md](./milestones.md) and start **M0 (monorepo scaffold)** — all commands are copy-paste ready.
2. **Phase A = M0–M8** (the app: Android + desktop + backup + QA) · **Phase B = M9–M11** (landing → server → sync), sequenced exactly as Michael chose (2026-09-26).
3. M4-S1 is the make-or-break spike: prove exact alarms on a real device before building the UI around them.
4. When ready to build for real, copy this folder to a new repository (per AI-Plans convention).

---

Back to [AI-Plans README](../../README.md).
