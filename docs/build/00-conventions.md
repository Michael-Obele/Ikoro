# 00 — Conventions and contracts

Cross-cutting rules. Everything here is binding for every milestone. If a milestone contradicts this file, this file wins unless the milestone explicitly says "per RESEARCH §…".

---

## 1. Toolchain and style

- **Bun only.** `bun`, `bunx`. Never `npm`, `npx`, `pnpm`, `yarn` — in commands, in docs, in lockfiles.
- **TypeScript strict.** `tsconfig.base.json` at the repo root is the base; every workspace extends it.
- **Svelte 5 runes only.** `$state` / `$derived` / `$props` / `$effect`. No `export let`. No `svelte/store` where a rune will do.
- **Event attributes.** `onclick`, `oninput`, `onsubmit`. Never `on:click`.
- **[runed](https://runed.dev) before hand-rolling.** Debounce, media query, keydown handling, localStorage persistence, element size — runed has it. Add it as a direct dependency. Read its docs; do not guess the API.
- **Prefer remote `form` over `command`** for anything with form inputs. `command` is for input-less actions (bare button, dialog confirm, toggle).
- **Svelte inspector on** (one block, in the file holding the kit options — `vite.config.ts` under Kit 3). **sv-agentation installed and mounted** in `+layout.svelte`, gated `{#if browser && dev}`. Exact settings: [`../HANDOVER.md`](../HANDOVER.md) §2.5.
- Formatting: tab indent, single quotes, semicolons via the `sv create --add prettier` defaults. Don't hand-format; run `bun run format`.

---

## 2. Naming

| Thing | Convention | Example |
| ----- | ---------- | ------- |
| Directories | `kebab-case` | `src/lib/components/task/` |
| Svelte components | `PascalCase.svelte` | `TaskRow.svelte`, `AlarmSheet.svelte` |
| Modules | `kebab-case.ts` | `android-scheduler.ts` |
| Functions / variables | `camelCase` | `rescheduleAll()`, `todayOpenTasks()` |
| Types / interfaces | `PascalCase` | `AlarmRequest`, `ChangeOp` |
| Dexie tables | plural, `camelCase` | `lists`, `tasks`, `outbox` |
| Tests | `*.test.ts` under `tests/` | `tests/reconcile.test.ts` |

---

## 3. Canonical data contracts

These names and shapes are **fixed**. M1, M4, M10 and M11 all reference them. Do not rename, do not add fields casually, do not "improve" the shape.

### 3.1 Dexie records (`apps/app/src/lib/db/schema.ts`)

Copy **verbatim** — including the sync fields, which exist from day one so M11 needs no migration.

```ts
import Dexie, { type Table } from 'dexie';

export type Priority = 0 | 1 | 2 | 3; // 0 none · 1 low · 2 medium · 3 high

export interface TaskList {
  id: string; // crypto.randomUUID()
  name: string;
  sortOrder: number; // "My order"
  createdAt: string; // ISO 8601
  updatedAt: string;
  deletedAt: string | null; // tombstone until the server acks (M11)
  rev: number | null; // server revision of last sync (null = never synced)
  googleTaskId?: string; // reserved for the v2 import path
}

export interface Task {
  id: string;
  listId: string;
  title: string; // ≤ 1024 (Google parity)
  notes: string | null; // ≤ 8192
  dueDate: string | null; // YYYY-MM-DD (the Google-syncable part)
  dueTime: string | null; // HH:mm — LOCAL ONLY (Google's API discards time)
  priority: Priority;
  parentId: string | null; // subtasks reserved (v1.1)
  repeat: null | 'daily' | 'weekdays' | 'weekly' | 'monthly'; // reserved (v1.1)
  completedAt: string | null;
  alarmAt: string | null; // ISO — the instant the alarm should fire
  alarmId: string | null; // platform id returned by the scheduler
  alarmFiredAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null; // tombstone (M11)
  rev: number | null; // server cursor for this row (M11)
  googleTaskId?: string;
}

export class IkoroDB extends Dexie {
  lists!: Table<TaskList, string>;
  tasks!: Table<Task, string>;

  constructor() {
    super('ikoro');
    this.version(1).stores({
      lists: 'id, sortOrder, updatedAt',
      tasks: 'id, listId, completedAt, dueDate, alarmAt, updatedAt, parentId',
    });
  }
}

export const db = new IkoroDB();
```

**Never synced:** `alarmId`, `alarmFiredAt` (device-scoped; re-derived by `rescheduleAll()` after every pull).
**Synced with full fidelity:** `dueTime`, `priority`, `repeat`, `alarmAt`.

Migration policy: Dexie `version(n)` only. **Never edit an applied version.** M11 adds `version(2)` with the `outbox` table.

### 3.2 The scheduler interface (`apps/app/src/lib/alarms/types.ts`)

Every alarm goes through this interface. Nothing else in the codebase imports a notification API.

```ts
export interface AlarmRequest {
  taskId: string;
  title: string;
  at: string; // ISO 8601, absolute
}

export interface AlarmPermissionStatus {
  notifications: 'granted' | 'denied' | 'prompt';
  exact: 'granted' | 'denied' | 'unsupported';
}

export interface AlarmScheduler {
  readonly platform: 'android' | 'desktop' | 'browser';
  ensureReady(): Promise<AlarmPermissionStatus>;
  schedule(alarm: AlarmRequest): Promise<ScheduleOutcome>;
  cancel(platformId: string): Promise<void>;
  getPending(): Promise<Set<string>>;
  /** Resolves when a notification is tapped; yields the taskId. */
  onAction(handler: (taskId: string) => void): void;
}

/** How the schedule attempt actually went — never just a boolean. */
export type ScheduleOutcome =
  | { ok: true; platformId: string; exact: true }
  | { ok: true; platformId: string; exact: false; warning: string } // degraded, must surface
  | { ok: false; reason: 'permission' | 'unsupported' | 'invalid' };
```

> `ScheduleOutcome` is a **deviation from the original plan**, which returned `string | null`. It exists because Capacitor can report a degraded (inexact) schedule via `ScheduleResult.warning`, and the product promise is exact timing — a degraded alarm must never look like a success. See [`../RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) F3 / D18.

### 3.3 The wire protocol (`packages/sync/src/lib/index.ts`, M10)

```ts
export type EntityKind = 'list' | 'task';

export interface ChangeOp {
  id: string; // client-generated op id (idempotency)
  kind: EntityKind;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: unknown; // validated per-kind by a Valibot schema
  updatedAt: string; // client clock — the LWW input
}

export interface ChangeRow {
  kind: EntityKind;
  entityId: string;
  payload: unknown;
  updatedAt: string;
  rev: number; // server-assigned, monotonic
  deletedAt: string | null;
}

export interface ChangesResponse {
  changes: ChangeRow[];
  nextRev: number;
}

export declare function mergeRow<T extends { updatedAt: string }>(
  local: T | undefined,
  remote: T,
): T; // server wins ties
```

---

## 4. Time and identity

- All timestamps are **ISO 8601 strings** (`new Date().toISOString()`), always UTC. Never `Date` objects in the database, never epoch numbers.
- Calendar-only fields are local strings: `dueDate` = `YYYY-MM-DD`, `dueTime` = `HH:mm`. Never store a `dueAt` datetime — the split is deliberate (Google's API drops the time part).
- IDs come from `crypto.randomUUID()`.
- Alarm notification ids are a **stable 32-bit hash of the taskId** (`utils/id.ts::hashId`), so re-scheduling never leaks duplicate notifications.
- `alarmAt` is derived: when a task has both `dueDate` and `dueTime` and the alarm is on, `alarmAt = new Date(\`${dueDate}T${dueTime}\`).toISOString()` in local time. Treat `alarmAt` as the single source of truth for arming; never re-derive it at fire time.

---

## 5. Testing

- Vitest. Tests live in each workspace's `tests/` directory and are named `*.test.ts`.
- Register the include glob explicitly in the workspace's `vite.config.ts`:
  ```ts
  /// <reference types="vitest" />
  export default defineConfig({
    plugins: [sveltekit({ … })],
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  });
  ```
  Use `environment: 'jsdom'` for component tests (M2+) — set it per file with a `// @vitest-environment jsdom` docblock rather than globally, so pure-logic tests stay fast.
- **Any test that touches Dexie must start with `import 'fake-indexeddb/auto';` as its first line**, before importing anything that imports Dexie. Otherwise the module resolves against a missing IndexedDB and the suite dies.
- Logic first, components second. `repo.ts`, `reconcile.ts`, `mergeRow`, `time.ts` and the Valibot schemas are pure-ish and must be covered before any component test.
- Component tests use `@testing-library/svelte`; render from a fixture, assert on what the user sees, never on internal state.
- **Check the test count.** A suite that found zero files exits 0 and looks green. Confirm the number went up in the step you just wrote.

---

## 6. The verification harness

From the repo root, after every step that changes code:

```bash
bun run check   # svelte-check + tsc, every workspace
bun run test    # vitest, every workspace
```

Both must be clean, with a non-zero test count, before you commit. Milestones add their own gate on top (a build, an `adb` check, an on-device matrix) — those are additional, not alternative.

---

## 7. Commits

Conventional Commits, one milestone per commit, the message the milestone specifies:

```
feat: reminder engine — exact notifications + permission UX (M4)
```

Body: new dependencies (name + why), and any deviation from the plan (what + why). If you took a documented fallback branch — the M0 aliasing path, or the Drizzle `relations-v2` adapter — say so.

---

## 8. When reality disagrees with the plan

The plan was written from research, not from a running build. When something does not behave as described:

1. Check [`VERSIONS.md`](../VERSIONS.md) — version/API drift is the most likely cause, and it lists the known traps.
2. If it is a documented open question ([`RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) §4), take the stated fallback and record it.
3. Otherwise: write a `## Findings` section in the milestone file with the verbatim command and output, state what you did instead, and continue **only if** the product's promise is unaffected. If the promise is affected (an alarm that will not fire on time, a platform that cannot work), **stop and escalate**.
