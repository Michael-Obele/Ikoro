# M3 — Today / Upcoming / Done / Settings

**Goal:** the four surfaces that make the lists usable — plus the pure time helpers they share.

**Prev:** [M2](./M2-crud-ui.md) — CRUD green and committed.
**Next:** [M4 — reminder engine](./M4-alarm-engine.md)

---

## Files

```
apps/app/src/lib/utils/time.ts
apps/app/src/routes/+page.svelte          redirect → /today
apps/app/src/routes/today/+page.svelte
apps/app/src/routes/upcoming/+page.svelte
apps/app/src/routes/done/+page.svelte
apps/app/src/routes/settings/+page.svelte
apps/app/tests/time.test.ts
```

---

## `utils/time.ts` — pure, fully tested

```ts
/** Local calendar day as YYYY-MM-DD. Never UTC — a task due "today" is due on
 *  the user's day, not Greenwich's. */
export function todayISO(): string;

/** YYYY-MM-DD for `days` before `from`. */
export function isoDaysAgo(from: Date, days: number): string;

/** True when a task has a dueDate strictly before today and is still open. */
export function isPastDue(task: Task, now?: Date): boolean;

/** ISO instant for a local date + time pair. Returns null if either is missing. */
export function atLocal(dateISO: string, timeHHmm: string): string | null;

/** Group tasks by dueDate, preserving order within a group. */
export function groupByDay(tasks: Task[]): Array<{ day: string; tasks: Task[] }>;

/** The oldest date Today will show — today minus PAST_WINDOW_DAYS. */
export function todayWindowStart(now?: Date): string;
```

Tests (`tests/time.test.ts`, no Dexie, no DOM):

- [ ] `todayISO()` matches `/^\d{4}-\d{2}-\d{2}$/` and equals the local day even when the UTC day differs.
- [ ] `isoDaysAgo(new Date('2026-03-01T12:00:00'), 1) === '2026-02-28'`.
- [ ] `atLocal('2026-03-01', '09:30')` returns an ISO instant that formats back to `09:30` local.
- [ ] `atLocal('2026-03-01', null)` and `atLocal(null, '09:30')` both return `null`.
- [ ] `isPastDue` true for yesterday-and-open, false for today, false for a completed task.
- [ ] `groupByDay` keeps tasks within a group in input order and groups in first-seen order.
- [ ] `todayWindowStart()` is exactly 365 days before today.

---

## Steps

### Step 1 — write `tests/time.test.ts` → implement `time.ts`

- [ ] Tests fail first, then pass.

### Step 2 — Today (`/today`)

Google-parity rules (see [`../design/google-tasks.md`](../design/google-tasks.md) §3):

- [ ] **Past** bucket first: open tasks dated before today, most overdue at the top.
- [ ] Then today's tasks.
- [ ] The window is the last **365 days** — an open task dated 400 days ago is not shown (`PAST_WINDOW_DAYS`, from M1).
- [ ] Completed tasks never appear.
- [ ] Group headers read `Today` and `Past` (not raw dates).
- [ ] Empty state: **"Nothing due — Ikoro is quiet."**
- [ ] Tapping a row opens the same `TaskSheet` as M2.

### Step 3 — Upcoming (`/upcoming`)

- [ ] Next **7 days**, grouped by day header (human labels: `Tomorrow`, `Wednesday`, then `Mar 14`).
- [ ] Uses `upcomingTasks(tomorrow, today + 7)`. Today is *not* duplicated here.
- [ ] Empty state names the range: **"Nothing in the next 7 days."**

### Step 4 — Done (`/done`)

- [ ] `doneTasks()`, newest completion first, grouped by completion day.
- [ ] A **Restore** button per row → `repo.toggleTask(id)`.
- [ ] Empty state: **"Nothing completed yet."**

### Step 5 — Settings (`/settings`)

Placeholder sections, honestly labelled — the real content lands in later milestones:

- [ ] **Notifications** — a placeholder that says health is reported in M4.
- [ ] **Backup** — a placeholder that says export/import arrives in M7.
- [ ] **About** — the name story, one short paragraph from [`../design/naming.md`](../design/naming.md), plus the app version.
- [ ] **Data** — the current counts (`N lists · M tasks · K completed`), read through `repo`.

### Step 6 — root redirect

- [ ] `routes/+page.svelte` calls `goto('/today')` in an `$effect` (Kit 3: `goto` from `$app/navigation`). No flash of empty content.

### Step 7 — verify and commit

```bash
cd ../.. && bun run check && bun run test
git add -A && git commit -m "feat: today/upcoming/done/settings views (M3)"
```

---

## Acceptance

- [ ] A task due yesterday appears under **Past** on `/today`; a task due today appears under **Today**.
- [ ] A task due in 3 days appears on `/upcoming` under the right day header and **not** on `/today`.
- [ ] Completing a task removes it from `/today` and `/upcoming` and adds it to `/done`; Restore reverses that.
- [ ] `/` lands on `/today`.
- [ ] `time.ts` has no imports from Dexie, Svelte, or Capacitor.
- [ ] All seven `time.ts` test cases pass.

## Findings

_(Append here if reality disagrees.)_

---

> **Prompt for the builder**
>
> _«Execute M3 of the Ikoro build plan. Read `docs/build/M3-views.md` and `docs/design/google-tasks.md` §3 first. `utils/time.ts` must stay pure — no Dexie, no DOM — and every helper needs a test before the implementation. Run `bun run check && bun run test` from the repo root before committing.»_
