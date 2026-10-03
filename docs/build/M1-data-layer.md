# M1 — Data layer (Dexie schema, repo, Valibot, tests)

**Goal:** one persistence seam. All application state lives in Dexie; every read and write goes through `repo.ts`; the record shapes match [`00-conventions.md`](./00-conventions.md) §3.1 verbatim.

**Prev:** [M0](./M0-scaffold.md) — scaffold green and committed.
**Next:** [M2 — Lists & task CRUD UI](./M2-crud-ui.md)

**Why this order:** the alarm engine (M4) and the sync client (M11) both depend on these exact shapes. Changing them later costs a Dexie migration *and* a protocol change.

---

## Files

```
apps/app/src/lib/utils/id.ts          hashId() — stable 32-bit notification id
apps/app/src/lib/db/schema.ts         IkoroDB + db  (verbatim, 00-conventions §3.1)
apps/app/src/lib/db/seed.ts           ensureSeeded()
apps/app/src/lib/db/repo.ts           every read/write the app performs
apps/app/src/lib/valibot/task.ts      taskSchema, TaskInput, exportSchema
apps/app/tests/repo.test.ts
apps/app/tests/valibot.test.ts
```

---

## Contracts

### `utils/id.ts`

```ts
/** FNV-1a 32-bit, forced positive. Stable for a given taskId so re-arming an
 *  alarm never leaves a duplicate notification behind. */
export function hashId(input: string): number;
```

### `db/schema.ts`

Paste **verbatim** from [`00-conventions.md`](./00-conventions.md) §3.1 — including `deletedAt` and `rev`. They are unused in Phase A and exist so M11 needs no migration.

### `db/repo.ts`

```ts
import type { Task, TaskList, Priority } from './schema';

export interface TaskInput {
  listId: string;
  title: string;
  notes?: string | null;
  dueDate?: string | null; // YYYY-MM-DD
  dueTime?: string | null; // HH:mm
  priority?: Priority;
}

// ── lists ────────────────────────────────────────────────────────────────────
export function createList(name: string): Promise<TaskList>;
export function renameList(id: string, name: string): Promise<void>;
export function deleteList(id: string): Promise<void>; // cascades to its tasks
export function getLists(): Promise<TaskList[]>;
export function reorderLists(ids: string[]): Promise<void>; // index becomes sortOrder

// ── tasks ────────────────────────────────────────────────────────────────────
export function createTask(input: TaskInput): Promise<Task>;
export function getTask(id: string): Promise<Task | undefined>;
export function updateTask(id: string, patch: Partial<Task>): Promise<void>;
export function toggleTask(id: string): Promise<void>;
export function deleteTask(id: string): Promise<void>; // hard delete; tombstones arrive in M11
export function tasksByList(listId: string): Promise<Task[]>;
export function todayOpenTasks(now?: Date): Promise<Task[]>;
export function upcomingTasks(from: Date, to: Date): Promise<Task[]>;
export function doneTasks(): Promise<Task[]>;
```

Rules the implementation must honour:

- `createList` / `createTask` set `createdAt` and `updatedAt` to the same fresh ISO string; `sortOrder` is `max(existing) + 1` within its parent (lists globally, tasks per list).
- `createTask` defaults: `notes: null`, `dueDate: null`, `dueTime: null`, `priority: 0`, `completedAt: null`, `alarmAt: null`, `alarmId: null`, `alarmFiredAt: null`, `parentId: null`, `repeat: null`, `deletedAt: null`, `rev: null`.
- **`updateTask` must bump `updatedAt`** to now, and must apply the patch as-given (a caller wanting to change `updatedAt` explicitly overrides it — the sync client relies on that in M11).
- `toggleTask` sets `completedAt` to now when completing and to `null` when un-completing. Completing must **not** clear `alarmAt` — cancellation of the platform alarm is M4's job, deliberately not the data layer's.
- `deleteList` deletes every task with that `listId`, in the same transaction.
- All multi-record operations use `db.transaction(...)`.
- `todayOpenTasks(now = new Date())` — Google-parity rule: open tasks (`completedAt === null`, `deletedAt === null`) with a non-null `dueDate` that is `<= today` **and not older than 365 days**. Sort: overdue first, ascending by `dueDate`, then by `dueTime` (nulls last), then by `sortOrder`. Export the window as a named constant so M3 can reference it:

  ```ts
  export const PAST_WINDOW_DAYS = 365;
  ```

- `upcomingTasks(from, to)` — open tasks with `dueDate` strictly after `from`'s day and `<= to`'s day; ascending.
- `doneTasks()` — completed, newest `completedAt` first.

### `valibot/task.ts`

```ts
import * as v from 'valibot';

export const taskSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(1024)),
  notes: v.nullable(v.pipe(v.string(), v.maxLength(8192))),
  dueDate: v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
  dueTime: v.nullable(v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/))),
  priority: v.picklist([0, 1, 2, 3]),
});

export type TaskInput = v.InferInput<typeof taskSchema>;

/** Backup envelope — M7 consumes this; defining it now keeps the shape agreed. */
export const exportSchema = v.object({
  app: v.literal('ikoro'),
  schemaVersion: v.literal(1),
  exportedAt: v.pipe(v.string(), v.isoTimestamp()),
  lists: v.array(v.object({
    id: v.string(),
    name: v.pipe(v.string(), v.minLength(1)),
    sortOrder: v.number(),
  })),
  tasks: v.array(v.object({
    id: v.string(),
    listId: v.string(),
    title: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
    notes: v.nullable(v.string()),
    dueDate: v.nullable(v.string()),
    dueTime: v.nullable(v.string()),
    priority: v.picklist([0, 1, 2, 3]),
    alarmAt: v.nullable(v.string()),
  })),
});
```

Build the input schema as a **partial** for `createTask` (title required, the rest optional) — do not make callers pass every field.

---

## Steps

### Step 1 — write the failing tests

`apps/app/tests/repo.test.ts`:

```ts
import 'fake-indexeddb/auto'; // MUST be the first import, before anything touches Dexie
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/db/schema';
import { ensureSeeded } from '../src/lib/db/seed';
import * as repo from '../src/lib/db/repo';
```

Cases to write:

- [ ] `ensureSeeded()` on an empty database creates exactly one list named `Tasks`; calling it twice does not create a second.
- [ ] `repo.createTask({ listId, title: 'x' })` returns a task with `priority === 0`, `completedAt === null`, `alarmAt === null`, `createdAt === updatedAt`, and `sortOrder === 0` for the first task in a list.
- [ ] `toggleTask` sets a non-null `completedAt`; toggling again returns it to `null`.
- [ ] Completing a task leaves `alarmAt` untouched.
- [ ] `deleteList` removes the list **and** every task that referenced it.
- [ ] `todayOpenTasks()` returns a past-dated open task and a due-today task, and excludes a completed one and one dated 400 days ago.
- [ ] `updateTask(id, { title: 'y' })` changes the title and produces a **later** `updatedAt`.
- [ ] `reorderLists(['b','a'])` makes `b.sortOrder === 0` and `a.sortOrder === 1`.

`beforeEach` clears the tables (`await db.tasks.clear(); await db.lists.clear();`).

```bash
cd apps/app && bun run test
```

- [ ] The suite **fails** for the expected reason — the modules do not exist yet. A failure for a different reason (a typo, a bad import path) does not count.

### Step 2 — implement `id.ts`, `schema.ts`, `seed.ts`, `repo.ts`

- [ ] `ensureSeeded()` when `lists.count() === 0` creates `{ name: 'Tasks' }`.
- [ ] Every repo function is a thin, typed wrapper over Dexie. No business logic that belongs in a view.

```bash
bun run test
```

- [ ] All repo cases pass.

### Step 3 — `valibot.test.ts` → `valibot/task.ts`

- [ ] Rejects a 1025-character title; **accepts** 1024.
- [ ] Rejects `notes` longer than 8192; accepts exactly 8192; accepts `null`.
- [ ] Rejects `dueDate: '2026-13-99'` and `'2026-1-1'`; accepts `'2026-01-01'`.
- [ ] Rejects `dueTime: '24:00'` and `'9:05'`; accepts `'09:05'` and `'23:59'`.
- [ ] Rejects `priority: 4`; accepts `0` and `3`.
- [ ] `exportSchema` accepts a minimal valid envelope and rejects `schemaVersion: 2`.

```bash
bun run test
```

- [ ] Both suites pass; count is non-zero.

### Step 4 — verify and commit

```bash
cd ../.. && bun run check && bun run test
```

- [ ] 0 check errors, all tests pass.
- [ ] Boundaries hold: `grep -rn "from 'dexie'" apps/app/src --include=*.ts --include=*.svelte` shows **only** files under `src/lib/db/`.

```bash
git add -A
git commit -m "feat: Dexie data layer + repo + valibot schemas (M1)"
```

---

## Acceptance

- [ ] `repo.ts` is the only module importing Dexie outside `src/lib/db/`.
- [ ] The schema matches `00-conventions.md` §3.1 character for character, sync fields included.
- [ ] Every listed repo function exists with the stated signature and is covered by at least one test.
- [ ] `todayOpenTasks` implements the 365-day window and the "overdue first" ordering.
- [ ] `updateTask` bumps `updatedAt`.
- [ ] No Dexie `version(n)` beyond 1.

## Findings

_(Append here if reality disagrees.)_

---

> **Prompt for the builder**
>
> _«Execute M1 of the Ikoro build plan. Read `docs/build/M1-data-layer.md` and `docs/build/00-conventions.md` §3 first. Write `tests/repo.test.ts` and confirm it fails before implementing. `import 'fake-indexeddb/auto'` must be the first line of any test that touches Dexie. Run `bun run check && bun run test` from the repo root and confirm the test count is non-zero before committing with the message in the milestone.»_
