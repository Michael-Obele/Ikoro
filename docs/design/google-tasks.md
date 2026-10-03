# Ikoro — Google Tasks: feature parity & future sync

Back to [README](./README.md).

Two jobs for this document: (1) inventory what Google Tasks does so Ikoro's v1 parity is deliberate, not accidental; (2) pre-design the optional Google Tasks sync (v2) so v1's data model doesn't paint us into a corner. Sources verified 2026-09-26: [product page](https://workspace.google.com/products/tasks/), help center ([repeating tasks](https://support.google.com/tasks/answer/12132599), [organize tasks](https://support.google.com/tasks/answer/7675629)), and the live [Tasks API discovery document](https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest).

## 1. Google Tasks feature inventory (verified)

**Lists & organization**

- Multiple task lists; drag-reorder of lists and tasks; move a task between lists (drag-drop).
- Sort a list by: **My order · Date · Deadline · Starred recently · Title**.
- "Past" bucket: tasks past their date float to the top; the Today surface includes all uncompleted tasks from the last **365 days**.
- API caps: **2,000 lists**, **20,000 non-hidden tasks per list**, **100,000 tasks total**.

**Tasks**

- Title ≤ 1,024 chars, notes ≤ 8,192 chars, due **date** (app UI also offers time — but see API constraint below), completed/hidden flags, subtasks via `parent`, manual order via `position`.
- Recurring tasks: presets (every day/week/month/year) + Custom frequency + end date.
  Constraints: shared tasks & subtasks can't repeat; recurring tasks can't move lists; stopping a series is permanent (can't restart it); completing an instance reveals the next one.
- Completed tasks are hidden from lists (retrievable with `showCompleted` + `showHidden`); `clear` purges completed from a list.

**Ecosystem (not our scope)**

- Gmail / Calendar / Docs / Chat side panels, assigned tasks (`assignmentInfo`), keyboard shortcuts, mobile + web apps.

**What Google Tasks deliberately does NOT have**

- No priority field. No tags. No custom reminders/alarms (the gap Ikoro exists for). No export/backup. No offline-first guarantee.

## 2. API constraints that shape our sync (verified from discovery doc)

| Constraint | Consequence for Ikoro |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `due`: *"Only date information is recorded; the time portion is discarded… It isn't possible to read or write the time a task is scheduled for using the API."* | **Due TIMES never round-trip.** Alarm times must stay local. |
| No `repeat`/recurrence field on `Task` | Recurrence is local-only (also true for Google's own app via this API). |
| No priority, no reminder/alarm fields | Priority + alarms are local-only by design. |
| `parent`, `position` are **output-only** — reordering/nesting goes through `move(task, parent?, previous?, destinationTasklist?)` | Sync writes must use `move`, never `patch`. |
| Pagination: `pageToken`, `maxResults` ≤ 100; incremental via `updatedMin`; filters `completedMin/Max`, `dueMin/Max` | Incremental sync = `updatedMin` + page loop. |
| `showCompleted` requires `showHidden=true`; `clear` is destructive | Never call `clear` during sync. |
| Scopes: `…/auth/tasks` (rw) · `…/auth/tasks.readonly` | Request read-only first; upgrade to rw only if user enables two-way. |

## 3. Parity matrix — Ikoro v1 vs Google Tasks

| Google Tasks feature           | Ikoro v1                    | Notes |
| ------------------------------ | --------------------------- | ----- |
| Multiple lists + reorder       | ✅ M2                       | |
| Title + notes                  | ✅ M2                       | |
| Due date                       | ✅ M2                       | |
| Due time                       | ✅ M2 (**Google's API can't**) | Our add |
| Priority                       | ✅ M2 (**Google has none**) | Our add |
| Complete + completed view      | ✅ M2                       | |
| Manual sort ("My order")       | ✅ M2                       | |
| Today / Past bucket            | ✅ M3 — adopt Google's rule: Today shows open tasks from the last 365 days, past-dated on top |
| Upcoming view                  | ✅ M3 (next 7 days)         | Google's version lives in Calendar |
| Subtasks                       | ⏭ v1.1 (schema reserved: `parentId`) | Google: one UI level — ❓ verify depth at sync build |
| Recurring tasks                | ⏭ v1.1 (`repeat` field reserved) | Model ours on Google's presets + custom + end date |
| Starred                        | ❌ won't do (priority covers it) | |
| Assigned tasks / Docs / Chat   | ❌ never                     | |
| Calendar / Gmail integration   | ❌ v2 maybe (ICS export first) | |
| **Alarms that fire**           | ✅✅ **M4 — the differentiator** | See [alarms.md](./alarms.md) |
| **Backup export/import (JSON)**| ✅ M7 (**Google has none**) | Our add |
| Offline-first                  | ✅ throughout (**Google no**) | Our add |

## 4. Google sync design (OPTIONAL import path — primary sync is our own server: [architecture.md §6](./architecture.md))

**Flow:** OAuth 2.0 (PKCE — Capacitor Browser / Tauri / browser redirect) → scope `https://www.googleapis.com/auth/tasks` → endpoints:

```
GET  /tasks/v1/users/@me/lists                      → tasklists (pageToken loop)
GET  /tasks/v1/lists/{id}/tasks?showCompleted=true
       &showHidden=true&showDeleted=false&maxResults=100
       &updatedMin=<lastSync>&pageToken=…            → incremental pull
POST /tasks/v1/lists/{listId}/tasks                  → insert (title, notes, due[date])
PATCH /tasks/v1/lists/{listId}/tasks/{taskId}        → patch (title, notes, due, status)
POST /tasks/v1/lists/{listId}/tasks/{id}/move        → reorder / reparent / move list
DELETE /tasks/v1/lists/{listId}/tasks/{taskId}       → delete
```

**Field mapping** (local → Google): `title→title`, `notes→notes`, `dueAt→due` (**date part only, UTC-normalized**), `completedAt→status=completed+completed`, `listId→tasklist`, `googleTaskId` stored locally. **Local-only:** `priority`, `alarmAt`, `alarmId`, `alarmFiredAt`, `repeat`, `dueTime` (keep a separate `dueDate` column if/when sync lands so the date maps cleanly — schema note for M1).

**Sync algorithm (v2 sketch):** pull `updatedMin` → upsert into Dexie with `updatedAt` comparison (last-writer-wins per task, Google wins on tie) → queue local mutations in an outbox (`op`, `taskId`, `at`) → flush with retry → reschedule alarms for any task whose `alarmAt` survived (unchanged, alarms never leave the device). Conflict rule: never delete a task locally because Google returned 404 mid-flap — mark `syncState: orphaned` and surface it.

**Costs/quotas:** ❓ re-check quota + assignee-field behavior at build time (discovery doc does not state per-day quota). Pricing: free within Google APIs services quota.

## 5. Open questions (re-verify at sync build)

- [ ] Does the app UI's due **time** have any API representation at all (the discovery doc says no — confirm against current client behavior; there may be a Calendar-side encoding).
- [ ] Subtask depth limit (UI appears to be one level; API allows `parent` chains).
- [ ] "Starred recently" — where stars live (not in the API schema).
- [ ] Assigned tasks (`assignmentInfo`) — skip entirely? (Yes, unless a real need appears.)

---

Back to [README](./README.md) · Related: [research.md](./research.md) · [architecture.md](./architecture.md) · [decisions.md](./decisions.md)
