# M7 — Backup export / import

**Goal:** the user can get their data out and back in. Plain JSON, validated on the way in, honest about what it contains.

**Prev:** [M3](./M3-views.md) (needs tasks and lists to exist). M4 is not required, but if it is done, `rescheduleAll()` must run after an import.
**Next:** [M8 — QA gate & release](./M8-qa-release.md)

---

## Files

```
apps/app/src/lib/utils/download.ts
apps/app/src/routes/settings/Backup.svelte
apps/app/tests/export.test.ts
```

The envelope schema (`exportSchema`) was defined in [M1](./M1-data-layer.md) and lives in `src/lib/valibot/task.ts`.

---

## The format

```json
{
  "app": "ikoro",
  "schemaVersion": 1,
  "exportedAt": "2026-10-03T00:00:00.000Z",
  "lists": [{ "id": "…", "name": "Tasks", "sortOrder": 0 }],
  "tasks": [
    {
      "id": "…",
      "listId": "…",
      "title": "…",
      "notes": null,
      "dueDate": "2026-10-05",
      "dueTime": "09:30",
      "priority": 2,
      "alarmAt": "2026-10-05T09:30:00.000Z"
    }
  ]
}
```

**Never exported:** `alarmId`, `alarmFiredAt` (device-scoped — the platform id from one device means nothing on another), `deletedAt`, `rev` (sync bookkeeping, not user data).

**Import rules, in order:**

1. Parse the file as JSON. Malformed → fail with the parse error.
2. Validate against `exportSchema`. Invalid → fail listing **every** field path that failed, not just the first.
3. Merge by `id`, keeping the **newer `updatedAt`** for each record. Records that exist only locally are untouched; records only in the file are added.
4. `listId` on a task that has no matching list in the merged set → create nothing, skip the task, and **report the count dropped**. Silently losing rows is the failure mode this whole milestone exists to prevent.
5. Clear `alarmId` and `alarmFiredAt` on every imported task.
6. Call `rescheduleAll()` so imported alarms are actually armed on this device.
7. Report: `Imported N lists · M tasks · K skipped`.

---

## Steps

### Step 1 — write the failing tests

`apps/app/tests/export.test.ts` (`import 'fake-indexeddb/auto'` first):

- [ ] `exportAll()` produces an object that `v.parse(exportSchema, …)` accepts.
- [ ] The export contains **no** `alarmId`, `alarmFiredAt`, `deletedAt`, or `rev` key anywhere — assert on the serialised string, not just the object.
- [ ] `importAll()` given the same record at two `updatedAt` values keeps the newer one.
- [ ] Local-only records survive an import unchanged.
- [ ] Imported tasks come back with `alarmId === null` and `alarmFiredAt === null`.
- [ ] A task referencing a missing list is skipped and counted in the result.
- [ ] `{ "app": "ikoro", "schemaVersion": 2, … }` is rejected, and the error names `schemaVersion`.
- [ ] `"not json"` is rejected with a readable message, not a stack trace leaking to the UI.
- [ ] Round-trip: export → wipe the database → import → every list and task is present with identical field values (except the device-scoped four).

```bash
cd apps/app && bun run test
```

- [ ] Fails for the right reason first.

### Step 2 — implement

- [ ] `utils/download.ts`:
  - `downloadJson(filename: string, data: unknown): void` — Blob + object URL, revoking the URL after the click.
  - `readJsonFile(file: File): Promise<unknown>` — throws a typed error on a JSON parse failure.
  - `fileNameFor(date: Date): string` → `ikoro-backup-YYYY-MM-DD.json`.
- [ ] Export/import functions live beside `repo.ts` (`db/backup.ts`) — they touch Dexie, so they must not live in a route or a generic util.
- [ ] `settings/Backup.svelte`:
  - **Export** button → `downloadJson(fileNameFor(new Date()), await exportAll())`.
  - **Import** — a file input (`accept="application/json"`); on select, validate, merge, reschedule, then show the result counts. Failures render the path list, not a generic "invalid file".
  - Import is destructive-ish: confirm before applying, and state that newer local edits win.
  - A one-line note that the file is plaintext and contains the user's task content.

```bash
bun run test
```

- [ ] All cases pass.

### Step 3 — the data-loss nudge

Risk R7 in [`../design/decisions.md`](../design/decisions.md) — IndexedDB can be evicted. Surface it, quietly:

- [ ] On the Settings page, if the newest export is older than **7 days** (track the last export instant in `localStorage`) and there is at least one task, show a dismissible line: *"Last backup: 12 days ago."*
- [ ] Never a modal. Never blocks anything.

### Step 4 — verify and commit

```bash
cd ../.. && bun run check && bun run test
git add -A
git commit -m "feat: JSON backup export/import (M7)"
```

---

## Acceptance

- [ ] Export → wipe site data → import restores every list and task, with an accurate count report.
- [ ] Export → import into the **same** database is idempotent (no duplicates, no field drift).
- [ ] An imported alarm is actually armed after import (verified on Android if M4 is done).
- [ ] An invalid file produces a message naming the specific failing fields.
- [ ] No device-scoped field appears in the exported JSON.
- [ ] A task whose list is missing is skipped **and reported**, never silently dropped.

## Findings

_(Append here if reality disagrees.)_

---

> **Prompt for the builder**
>
> _«Execute M7 of the Ikoro build plan. Read `docs/build/M7-backup.md` first. Write `tests/export.test.ts` with `import 'fake-indexeddb/auto'` as its first line, confirm it fails for the right reason, then implement. Export/import touches Dexie, so it belongs in `src/lib/db/`, not in a route. Run `bun run check && bun run test` from the repo root before committing.»_
