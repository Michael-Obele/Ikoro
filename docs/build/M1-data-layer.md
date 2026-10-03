# M1 — Data layer (`svelte-idb` schema, repo, Valibot, tests)

**Goal:** one persistence seam. All application state lives in IndexedDB via **`svelte-idb`** — the user's own package, dogfooded — and every read and write goes through `repo.ts`.

**Prev:** [M0](./M0-scaffold.md) — scaffold green and committed.
**Next:** [M2 — Lists & task CRUD UI](./M2-crud-ui.md)

**Read first:** [`00-conventions.md`](./00-conventions.md) §3.1 (the canonical records — copy them verbatim) · [`../VERSIONS.md`](../VERSIONS.md) §2.6 (`svelte-idb`'s API and its gaps) · [`../RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) F14 / D23.

> **This is not Dexie.** Three svelte-idb facts drive the whole design, and all three are consequences of it having **no transaction API**:
> 1. every mutation is a **single-record `put()`**;
> 2. deletes are **soft** (`deletedAt`), so an interrupted cascade is recoverable;
> 3. the sync queue is a **`dirty` flag on the record**, not a second store (which matters at M11).
>
> And one more, which is easy to get wrong: **there is exactly one database instance.** It comes from `createReactiveDB`, not `createDB`, and both `repo.ts` and the views use it — svelte-idb's change notifications do not cross connections, so a second instance would silently never see the first one's writes.

---

## Install

```bash
cd apps/app
bun add svelte-idb@0.1.6     # peerDependencies: svelte ^5 — already satisfied
```

---

## Files

```
apps/app/src/lib/utils/id.ts          hashId() — stable 32-bit notification id
apps/app/src/lib/db/schema.ts         createReactiveDB({ name, version: 1, stores })  ← 00-conventions §3.1
apps/app/src/lib/db/seed.ts           ensureSeeded()
apps/app/src/lib/db/repo.ts           every read/write the app performs — the ONLY importer of svelte-idb
apps/app/src/lib/valibot/task.ts      taskSchema, TaskInput, exportSchema
apps/app/tests/repo.test.ts
apps/app/tests/valibot.test.ts
```

**Why the schema lives at `version: 1` with the sync fields already in it:** svelte-idb's `onUpgrade` is a raw IndexedDB hook — you write the upgrade yourself, and "migration sugar" is unfinished upstream. Declaring the complete shape now means Phase A never upgrades the database at all.

---

## Contracts

### `utils/id.ts`

```ts
/** FNV-1a 32-bit, forced positive. Stable per taskId, so re-arming an alarm
 *  never leaves a duplicate notification behind. M6's Rust scheduler must
 *  compute the identical value from the identical input. */
export function hashId(input: string): number;
```

### `db/schema.ts`

Paste **verbatim** from [`00-conventions.md`](./00-conventions.md) §3.1. The index set is deliberate — `byList`, `byDue`, `byAlarm`, `byCompleted`, `byUpdatedAt`, `byParent`, `byDirty` on `tasks`; `bySortOrder`, `byUpdatedAt`, `byDirty` on `lists`.

### `db/repo.ts`

```ts
import type { Task, TaskList, TaskInput, Priority } from './schema';

// ── lists ────────────────────────────────────────────────────────────────────
export function createList(name: string): Promise<TaskList>;
export function renameList(id: string, name: string): Promise<void>;
export function deleteList(id: string): Promise<void>; // SOFT, cascades to its tasks
export function getLists(): Promise<TaskList[]>;
export function reorderLists(ids: string[]): Promise<void>; // index becomes sortOrder

// ── tasks ────────────────────────────────────────────────────────────────────
export function createTask(input: TaskInput): Promise<Task>;
export function getTask(id: string): Promise<Task | undefined>;
export function updateTask(id: string, patch: Partial<Task>): Promise<void>;
export function toggleTask(id: string): Promise<void>;
export function deleteTask(id: string): Promise<void>; // SOFT
export function tasksByList(listId: string): Promise<Task[]>;
export function todayOpenTasks(now?: Date): Promise<Task[]>;
export function upcomingTasks(from: Date, to: Date): Promise<Task[]>;
export function doneTasks(): Promise<Task[]>;

// ── sync plumbing (used from M11, defined now so nothing migrates later) ─────
export function markAllDirty(): Promise<void>; // call when the user first enables sync
export function purgeDeleted(): Promise<number>; // the ONLY hard delete in the app
```

Rules the implementation must honour:

- **`createList` / `createTask` use `add()`**, not `put()` — a duplicate id becomes a loud `IDBConstraintError` instead of a silent overwrite. Every other write uses `put()`.
- **Every read filters `deletedAt === null`.** Do it in one private helper, not at twenty call sites — a forgotten filter is a deleted task reappearing.
- **Every write sets `dirty: 1`** and a fresh `updatedAt`. `dirty` is only *consumed* at M11, but setting it from day one means M11 needs no schema change and no backfill. `purgeDeleted()` and the sync client's ack path are the only things that ever clear it.
- `createTask` defaults: `notes: null`, `dueDate: null`, `dueTime: null`, `priority: 0`, `completedAt: null`, `alarmAt: null`, `alarmId: null`, `alarmFiredAt: null`, `parentId: null`, `repeat: null`, `deletedAt: null`, `rev: null`, `dirty: 1`.
- `toggleTask` sets `completedAt` to now or to `null`. Completing must **not** touch `alarmAt` — cancelling the platform alarm is M4's job, deliberately not the data layer's.
- **`deleteList` is a sequential, idempotent cascade, not a transaction.** Soft-delete each of its tasks first, then the list. If it is interrupted, the worst case is a list whose tasks are already gone — visible and re-runnable — instead of a half-applied atomic failure.
- `reorderLists(ids)` / reordering tasks: one `put()` per record, in order. Not atomic; idempotent, so re-running is safe.
- **`todayOpenTasks(now = new Date())`** — the index only contains rows with a non-null `dueDate`, which is exactly the set we want:
  ```ts
  const rows = await db.tasks.where('byDue').belowOrEqual(todayISO(now)).toArray();
  // then filter deletedAt === null && completedAt === null && dueDate >= windowStart
  // then sort: overdue first (ascending dueDate), then dueTime (nulls last), then sortOrder
  ```
  Export the window as a named constant so M3 can reference it: `export const PAST_WINDOW_DAYS = 365;`
- `upcomingTasks(from, to)` — `where('byDue').between(fromISO, toISO)`, then filter, then sort ascending.
- `tasksByList(listId)` — `where('byList').equals(listId)`, filter, sort by `sortOrder`.
- `doneTasks()` — `getAllFromIndex('byCompleted')` (the index holds only completed rows), filter `deletedAt`, sort by `completedAt` **descending**.

### `valibot/task.ts`

Unchanged from the original design:

```ts
export const taskSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(1024)),
  notes: v.nullable(v.pipe(v.string(), v.maxLength(8192))),
  dueDate: v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
  dueTime: v.nullable(v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/))),
  priority: v.picklist([0, 1, 2, 3]),
});

export const exportSchema = v.object({
  app: v.literal('ikoro'),
  schemaVersion: v.literal(1),
  exportedAt: v.pipe(v.string(), v.isoTimestamp()),
  lists: v.array(v.object({ id: v.string(), name: v.pipe(v.string(), v.minLength(1)), sortOrder: v.number() })),
  tasks: v.array(v.object({
    id: v.string(), listId: v.string(),
    title: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
    notes: v.nullable(v.string()),
    dueDate: v.nullable(v.string()), dueTime: v.nullable(v.string()),
    priority: v.picklist([0, 1, 2, 3]),
    alarmAt: v.nullable(v.string()),
  })),
});
```

Build the `createTask` input schema as a **partial** — title required, the rest optional.

---

## Steps

### Step 1 — write the failing tests

`apps/app/tests/repo.test.ts`:

```ts
// @vitest-environment jsdom
import 'fake-indexeddb/auto'; // MUST come before the module under test
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/db/schema';
import { ensureSeeded } from '../src/lib/db/seed';
import * as repo from '../src/lib/db/repo';
```

> **Why jsdom:** `schema.ts` imports `svelte-idb/svelte` (runes) — and it has to, because mutating through one instance and reading through another means the UI never updates. If runes misbehave under jsdom, switch this file to Vitest browser mode rather than splitting the database in two.
>
> `repo.ts` still holds every read and write; `liveAll()` and friends belong in M2's `stores/view.ts`, not in the repo.

Because `createDB()` runs once at module scope, clear the stores between cases:

```ts
beforeEach(async () => {
  await db.tasks.clear();
  await db.lists.clear();
});
```

Cases:

- [ ] `ensureSeeded()` on an empty database creates exactly one list named `Tasks`; calling it twice does not create a second.
- [ ] `createTask({ listId, title: 'x' })` returns a task with `priority === 0`, `completedAt === null`, `alarmAt === null`, `dirty === 1`, `deletedAt === null`, and `createdAt === updatedAt`.
- [ ] `createTask` with a duplicate id throws (proves `add()` is used, not `put()`).
- [ ] `toggleTask` sets a non-null `completedAt`; toggling again returns it to `null`; neither call changes `alarmAt`.
- [ ] `deleteTask` sets `deletedAt` and the task disappears from `tasksByList` and `todayOpenTasks` — but `getTask` still returns the row (soft, not gone).
- [ ] `deleteList` soft-deletes the list **and** every task that referenced it; the tasks are absent from `tasksByList`.
- [ ] `deleteList` run twice does not throw (idempotent).
- [ ] `todayOpenTasks()` returns a past-dated open task and a due-today task, excludes a completed one, and excludes one dated **400 days** ago.
- [ ] `todayOpenTasks()` returns the **most overdue first**.
- [ ] A task with `dueDate: null` never appears in `todayOpenTasks()` or `upcomingTasks()` — it is not in the index at all.
- [ ] `updateTask(id, { title: 'y' })` changes the title, produces a **later** `updatedAt`, and leaves `dirty === 1`.
- [ ] `reorderLists(['b', 'a'])` makes `b.sortOrder === 0` and `a.sortOrder === 1`.
- [ ] `purgeDeleted()` hard-removes soft-deleted rows and returns the count; live rows are untouched.

```bash
cd apps/app && bun run test
```

- [ ] The suite **fails** for the expected reason — the modules do not exist yet. A failure for a different reason does not count.

### Step 2 — implement `id.ts`, `schema.ts`, `seed.ts`, `repo.ts`

- [ ] `schema.ts` matches [`00-conventions.md`](./00-conventions.md) §3.1 character for character.
- [ ] `ensureSeeded()` when `await db.lists.count() === 0`.
- [ ] `repo.ts` is a thin, typed layer. **No business logic that belongs in a view, and no `db.transaction` anywhere — the API does not exist.**

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

- [ ] Both suites pass; the count is non-zero.

### Step 4 — verify and commit

```bash
cd ../.. && bun run check && bun run test
```

- [ ] 0 check errors, all tests pass, count non-zero.
- [ ] Boundaries hold — `svelte-idb` appears in exactly one directory:
      `grep -rln "svelte-idb" apps/app/src` → only `src/lib/db/`.
- [ ] No Dexie anywhere: `grep -rn "dexie" apps/ packages/ --include=*.ts --include=*.svelte --include=*.json | grep -v node_modules` → no results.
- [ ] No transactions claimed anywhere: `grep -rn "transaction" apps/app/src` → no results.

```bash
git add -A
git commit -m "feat: svelte-idb data layer + repo + valibot schemas (M1)"
```

---

## Acceptance

- [ ] `src/lib/db/` is the only place `svelte-idb` is imported.
- [ ] The schema matches `00-conventions.md` §3.1 exactly, and is declared at `version: 1` with the sync fields already present.
- [ ] Every listed repo function exists, and every one filters `deletedAt === null`.
- [ ] Every mutating function writes exactly **one** record and sets `dirty: 1`.
- [ ] `deleteList` / `deleteTask` are soft and idempotent.
- [ ] `todayOpenTasks` implements the 365-day window and overdue-first ordering, and its comment explains that the index excludes `dueDate: null`.
- [ ] `updateTask` bumps `updatedAt`.
- [ ] No `db.transaction`, no `Table<>`, no `liveQuery` anywhere.
- [ ] Tests pass with a non-zero count, and `tests/repo.test.ts` declares `// @vitest-environment jsdom` (it reaches `schema.ts`, which is runes-based).

## Findings

_(Append here if svelte-idb behaves differently from its published `.d.ts` — especially around index behaviour with `null` keys, or `add()`'s duplicate-key error.)_

---

> **Prompt for the builder**
>
> _«Execute M1 of the Ikoro build plan. Read `docs/build/M1-data-layer.md` and `docs/build/00-conventions.md` §3.1 first — the storage layer is `svelte-idb` 0.1.6, the user's own package, NOT Dexie. It has no transaction API, which is why every mutation is a single-record `put()` and why deletes are soft. There is exactly ONE database instance, from `createReactiveDB`, shared by `repo.ts` and the views — a second instance would never see the first one's writes. Copy the schema verbatim; do not redesign it. Any test touching the database needs `// @vitest-environment jsdom` and `import 'fake-indexeddb/auto'` before the module under test. Write `tests/repo.test.ts`, confirm it fails for the right reason, then implement. Run `bun run check && bun run test` from the repo root and confirm the test count is non-zero before committing.»_
