# Ikoro — Implementation milestones

> [!WARNING]
> **Superseded for execution.** This is the original task list. The M0/M6/M10 steps contain stale commands (SvelteKit 2 config file, Tauri desktop scheduling, Prisma 6) and M6's desktop acceptance criterion is unachievable. Execute [`build/`](../build/README.md) instead — it is M0–M11 rewritten against the current toolchain. Keep this file for the reasoning behind the ordering.

Back to [README](./README.md).

> **For agentic workers:** execute task-by-task with checkbox (`- [ ]`) tracking. Each milestone ends with an independently testable deliverable and a commit.

**Goal:** ship the v1 scope in [README](./README.md) — offline-first task lists whose Android reminders fire on time.

**Architecture:** Bun-workspaces monorepo — `apps/app` (SvelteKit static SPA: Svelte 5 + Tailwind + shadcn-svelte → Dexie → `AlarmScheduler` adapter) wrapped by **Capacitor** (Android, Tier-1 exact notifications) and **Tauri** (desktop), plus `apps/landing` (static → Netlify) and `apps/server` (sync API → Fly.io) built after the app. Full design: [architecture.md](./architecture.md), [alarms.md](./alarms.md).

## Global constraints (apply to every task)

- **Runtime/package manager:** Bun only (`bun`, `bunx`). TypeScript strict. Svelte 5 runes — no `export let`, no stores where runes suffice.
- **Monorepo:** Bun workspaces — every path below is repo-relative (`apps/app/...`). Commands run from repo root with `bun run --filter app <script>` or inside the target workspace; `packages/*` must never import `apps/*`. Shared packages are created lazily — `packages/ui` at M9 (first second consumer), `packages/sync` at M10, `packages/config` only if duplication actually hurts.
- **Dev servers & builds:** ask Michael which server/port is already running before touching a browser preview; never start a dev server on your own initiative. Ask before any build not required by a step.
- **Downloads:** state expected size before any command that pulls >10 MB (mobile data).
- **SSR off in apps/app:** `src/routes/+layout.ts` exports `ssr = false`; `adapter-static` with `fallback: 'index.html'` (landing uses prerender; server uses `adapter-node`).
- **Alarm rule:** UI/routes never import `@capacitor/local-notifications` or `@tauri-apps/plugin-notification` — only `apps/app/src/lib/alarms/*`.
- **DB rule:** routes never touch Dexie — only `apps/app/src/lib/db/repo.ts`.
- **Every** task ends with `bun run check && bun run test` green (once tests exist) and a commit.
- DRY · YAGNI · frequent commits. No new dependency without listing it in the commit body.

---

### Task M0: Monorepo scaffold (workspaces + apps/app)

**Files:** create root `package.json` (workspaces), root `tsconfig.base.json`; everything under `apps/app/`

- [ ] **Step 1:** fresh directory, copy this plan folder in as `docs/`, then:

```bash
git init
mkdir -p apps
```

Root `package.json`:

```json
{
  "name": "ikoro",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "check": "bun run --filter app check",
    "test": "bun run --filter app test"
  }
}
```

- [ ] **Step 2:** scaffold the product app (all remaining M0 commands run from `apps/app/`):

```bash
bunx sv create apps/app
# prompts: SvelteKit minimal → TypeScript → ESLint ✓ → Prettier ✓ → Playwright ✗ → Vitest ✗ → add-ons: none
cd apps/app && bunx sv add tailwindcss    # defaults (v4, no typography plugin)
```

- [ ] **Step 3:** static adapter: `bun add -D @sveltejs/adapter-static`; edit `svelte.config.js`: `adapter({ pages: 'build', assets: 'build', fallback: 'index.html', precompress: false, strict: true })`; create `src/routes/+layout.ts`:

```ts
export const ssr = false;
export const prerender = false;
```

- [ ] **Step 4:** shadcn-svelte (from `apps/app/`):

```bash
bunx shadcn-svelte@latest init     # neutral base color, CSS variables ✓
bunx shadcn-svelte@latest add button sheet dialog input textarea select badge switch label separator dropdown-menu
```

- [ ] **Step 5:** test toolchain (from `apps/app/`):

```bash
bun add -D vitest @testing-library/svelte jsdom fake-indexeddb @sveltejs/vite-plugin-svelte
```

Add to `apps/app/package.json` scripts: `"test": "vitest run"`. Add `test: { include: ['tests/**/*'] }` to `apps/app/vite.config.ts`. Set `"name": "app"` in `apps/app/package.json` (the `--filter app` target).

- [ ] **Step 6:** verify + commit:

```bash
cd ../.. && bun install && bun run check && bun run test
git add -A && git commit -m "chore: monorepo scaffold — Bun workspaces + apps/app (SvelteKit static, Tailwind, shadcn-svelte, vitest)"
```

Expected: `bun run check` → 0 errors; `vitest` → 0 tests / pass.

---

### Task M1: Data layer (Dexie schema, repo, tests)

**Files:** create `apps/app/src/lib/db/schema.ts`, `apps/app/src/lib/db/repo.ts`, `apps/app/src/lib/db/seed.ts`, `apps/app/src/lib/valibot/task.ts`, `apps/app/tests/repo.test.ts`, `apps/app/tests/valibot.test.ts`

**Interfaces (produce):**
- `export class IkoroDB` + `export const db` — schema **verbatim from [architecture.md §4](./architecture.md)** (paste as-is; includes the `deletedAt`/`rev` sync fields — do not redesign).
- `createList(name): Promise<TaskList>`, `renameList(id, name)`, `deleteList(id)` (cascades tasks), `getLists(): Promise<TaskList[]>`, `reorderLists(ids: string[])`
- `createTask(input: TaskInput): Promise<Task>`, `updateTask(id, patch: Partial<Task>)`, `toggleTask(id)`, `deleteTask(id)`, `tasksByList(listId)`, `todayOpenTasks(now)`, `upcomingTasks(from, to)`, `doneTasks()`
- `taskSchema` (Valibot: title ≤1024 required, notes ≤8192 nullable, `dueDate` `YYYY-MM-DD`, `dueTime` `HH:mm`, priority enum `[0,1,2,3]`)

- [ ] **Step 1:** write failing tests (`tests/repo.test.ts`): `import 'fake-indexeddb/auto'` first. Cases: create list → seed gives default "Tasks" list; create task defaults (`priority: 0`, `completedAt: null`); toggle sets/clears `completedAt`; `deleteList` removes its tasks; `todayOpenTasks` returns past-dated + due-today, excludes completed; `updateTask` bumps `updatedAt`.
- [ ] **Step 2:** run → FAIL (module not found): `bun run test`
- [ ] **Step 3:** implement `schema.ts` (from architecture.md §4) + `repo.ts` + `seed.ts` (first open: create list "Tasks" if `lists.count() === 0`).
- [ ] **Step 4:** `bun run test` → PASS. Write `tests/valibot.test.ts` for `taskSchema` (rejects title >1024, bad dates, priority 4; accepts boundary values) → implement `apps/app/src/lib/valibot/task.ts` → PASS.
- [ ] **Step 5:** `bun run check && bun run test && git add -A && git commit -m "feat: Dexie data layer + repo + valibot schemas (M1)"`

---

### Task M2: Lists & task CRUD UI

**Files:** create `apps/app/src/lib/components/lists/ListSidebar.svelte`, `ListDialog.svelte`, `apps/app/src/lib/components/task/TaskRow.svelte`, `TaskSheet.svelte`, `DuePicker.svelte`, `PriorityPicker.svelte`, `apps/app/src/routes/lists/[id]/+page.svelte`, `apps/app/src/lib/stores/view.ts`

- [ ] **Step 1:** `ListSidebar` — live list of lists (Dexie liveQuery → `$state`), create/rename/delete via `ListDialog`, nav to `/lists/[id]`, links to Today/Upcoming/Done. Active state from `$page`.
- [ ] **Step 2:** `lists/[id]/+page.svelte` — `tasksByList`, add-task inline input (Enter → `createTask`), `TaskRow` (checkbox toggles `toggleTask`, title click → `TaskSheet`), sort by `sortOrder` with `bun add svelte-dnd-action` drag reorder (persist via `updateTask({ sortOrder })`).
- [ ] **Step 3:** `TaskSheet` (shadcn Sheet) — title, notes textarea (autosave debounce 400 ms), `DuePicker` (date input + optional time), `PriorityPicker` (4-state badge: none/low/med/high), delete. All writes through `repo`.
- [ ] **Step 4:** component test (`@testing-library/svelte`): render row from fixture → click checkbox → `toggleTask` called.
- [ ] **Step 5:** `bun run check && bun run test && git commit -m "feat: lists + task CRUD UI (M2)"`

**Acceptance:** create list → add task → tick → edit → delete; all persist across reload; no Dexie import outside `repo.ts`.

---

### Task M3: Today / Upcoming / Done / Settings views

**Files:** create `apps/app/src/routes/today/+page.svelte`, `upcoming/+page.svelte`, `done/+page.svelte`, `settings/+page.svelte`, `apps/app/src/routes/+page.svelte` (redirect), `apps/app/src/lib/utils/time.ts`

- [ ] **Step 1:** `time.ts`: `todayISO()`, `isPastDue(task)`, `groupByDay(tasks)`, `last365FromISO()` — unit-tested in `tests/time.test.ts`.
- [ ] **Step 2:** **Today** — Google-parity rules ([google-tasks.md §3](./google-tasks.md)): "Past" bucket first (open tasks dated before today, most overdue on top), then today's; includes open tasks due within the last **365 days**. Empty state: "Nothing due — Ikoro is quiet."
- [ ] **Step 3:** **Upcoming** — next 7 days grouped by day header; **Done** — completed archive, restore button. `+page.svelte` → `goto('/today')`.
- [ ] **Step 4:** `settings/+page.svelte` placeholder sections: Notifications health (M4), Backup (M7), About (name story from [naming.md](./naming.md)).
- [ ] **Step 5:** `bun run check && bun run test && git commit -m "feat: today/upcoming/done/settings views (M3)"`

---

### Task M4: Reminder engine ⭐ (spike first!)

**Files:** create `apps/app/src/lib/alarms/{types,scheduler,android-scheduler,browser-scheduler,reconcile}.ts` (`desktop-scheduler.ts` arrives in M6), `apps/app/src/lib/components/task/AlarmSheet.svelte`, `apps/app/src/lib/components/ui/PermissionBanner.svelte`; modify `apps/app/src/routes/settings/+page.svelte`; tests `apps/app/tests/reconcile.test.ts`

**Depends on:** M1–M3. Installs: `bun add @capacitor/core @capacitor/app @capacitor/local-notifications` (~2 MB).

#### 🔬 M4-S1 SPIKE (make-or-break — before any UI)

- [ ] **Step 1:** throwaway route `apps/app/src/routes/spike/+page.svelte` with a button: schedule a notification **2 minutes out** with `schedule({ notifications: [{ id: 999, title: 'Ikoro spike', body: 'test', schedule: { at: new Date(Date.now() + 120_000), allowWhileIdle: true } }] })`, plus `checkExactNotificationSetting()` output on screen.
- [ ] **Step 2:** `bun run build && bunx cap init … && bunx cap add android` (config per [architecture.md §9](./architecture.md)), add `SCHEDULE_EXACT_ALARM` + `POST_NOTIFICATIONS` to `AndroidManifest.xml`, install on a **physical device**: `adb install apps/app/android/app/build/outputs/apk/debug/app-debug.apk`.
- [ ] **Step 3:** run the [alarms.md §4](./alarms.md) core test: kill app → `adb shell dumpsys deviceidle force-idle` → notification must arrive at the scheduled minute.
- [ ] **Step 4:** ⚠️ **Gate:** if it does not fire, STOP — return to planning (Pólya phase 2): collect `adb logcat -s Capacitor/LocalNotification`, check `canScheduleExactAlarms()`, compare against plugin source notes in [research.md §2](./research.md). Only after a device-verified workaround do you proceed.

#### Engine

- [ ] **Step 5:** write `tests/reconcile.test.ts` (mock `AlarmScheduler`): schedule drift → `rescheduleAll` re-arms; past + still pending → flagged missed; past + absent → `alarmFiredAt` set; completed → cancelled. Run → FAIL.
- [ ] **Step 6:** implement `types.ts` (verbatim from [alarms.md §2.1](./alarms.md)), `android-scheduler.ts` (ensureReady: POST_NOTIFICATIONS request + `checkExactNotificationSetting`, schedule/cancel/getPending via stable `hashId(taskId)`), `browser-scheduler.ts` (dev-preview: in-page `Notification` + capped `setTimeout`, returns `null` platform id), `scheduler.ts` (selects via `detectPlatform()` from `platform.ts`), `reconcile.ts` (missed-detection + `rescheduleAll`). → tests PASS.
- [ ] **Step 7:** `PermissionBanner` (settings-derived: exact denied / notifications denied) with buttons → `changeExactNotificationSetting()` / `requestPermissions()`; wire `App.addListener('appStateChange')` → `ensureReady()` + `rescheduleAll()` in `+layout.ts` native branch.
- [ ] **Step 8:** `AlarmSheet` in `TaskSheet` — toggle "Remind me", time picker (defaults dueTime or +1h), saves `alarmAt`/`alarmId` via scheduler; browser-only limitation copy ([alarms.md §2.6](./alarms.md), "install the Android/desktop app for alarms that fire when closed"). Settings → Notifications health panel (same status, reschedule-all button).
- [ ] **Step 9:** delete `spike/` route; `bun run check && bun run test && git commit -m "feat: reminder engine — exact notifications + permission UX (M4)"`

**Acceptance:** [alarms.md §4](./alarms.md) matrix passes for foreground/background/killed/Doze/saver (reboot item verified in M8).

---

### Task M5: Android packaging, icons & alarm channel

**Files:** `apps/app/capacitor.config.ts`, `apps/app/android/app/src/main/AndroidManifest.xml`, `apps/app/scripts/make-icons.ts`, `apps/app/static/icons/*`

- [ ] **Step 1 (icons):** `bun add -D @resvg/resvg-js` (~5 MB — flag size before installing). `scripts/make-icons.ts`: inline SVG (gong glyph: filled rounded rect + striker circle) → render **1024 master** + 192 + 512 + maskable PNGs into `static/icons/` → `bun scripts/make-icons.ts`. Keep the 1024 master for Tauri in M6.
- [ ] **Step 2:** `bun run build && bunx cap sync android` (init/add already done in M4-S2; if skipped: `bunx cap init ikoro com.michaelobele.ikoro --web-dir build && bunx cap add android`).
- [ ] **Step 3:** Manifest (per [architecture.md §9](./architecture.md)): `SCHEDULE_EXACT_ALARM`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`; app label `Ikoro`, versionName from `package.json`; wire generated icons as launcher mipmaps (adaptive icon: 192/512 foreground + background color).
- [ ] **Step 4:** first-launch channel creation (`reminders`, `IMPORTANCE_HIGH` — [alarms.md §2.2](./alarms.md)) from `+layout.ts` native branch; verify: `adb shell dumpsys notification_manager | grep reminders`.
- [ ] **Step 5:** `./gradlew assembleDebug` → `adb install -r …/app-debug.apk` → smoke: create task + alarm, kill app, observe fire.
- [ ] **Step 6:** `git commit -m "feat: Android packaging, app icons, alarm channel (M5)"`

---

### Task M6: Tauri desktop shell + desktop scheduler

**Files:** `apps/app/src-tauri/*` (tauri.conf.json, capabilities/, Cargo.toml), `apps/app/src/lib/alarms/desktop-scheduler.ts`, `apps/app/src/lib/platform.ts`, `apps/app/tests/desktop-scheduler.test.ts`

- [ ] **Step 0:** ⚠️ Rust toolchain — if missing, `rustup` downloads **~300–800 MB**: state the size and get Michael's go-ahead first (mobile-data rule). Same for `bunx tauri build` first-run crate compile.
- [ ] **Step 1:** `bun add @tauri-apps/api @tauri-apps/plugin-notification` + `bun add -D @tauri-apps/cli`; from `apps/app/`: `bunx tauri init` (frontendDist `../build`, devUrl `http://localhost:5173`, identifier `com.michaelobele.ikoro`).
- [ ] **Step 2:** icons: `bunx tauri icon static/icons/icon-1024.png` (M5 master → all desktop sizes).
- [ ] **Step 3:** capabilities (`src-tauri/capabilities/default.json`): `notification:default` (+ allow-* permissions for request/status); macOS notification usage description in `tauri.conf.json`.
- [ ] **Step 4:** `desktop-scheduler.ts` implementing `AlarmScheduler`: `send({ schedule: { at: { date, allowWhileIdle: false, repeating: false } }, extra: { taskId } })` + cancel-by-id. **Verify the plugin's pending-query API at build** (state from the reference: schedule/cancel exist; enumeration TBD) — if none exists, reconcile falls back to "past + not fired → mark `alarmFiredAt` (desktop = fired-unverified)". Unit tests with mocked plugin (arm → past-due → reconcile behavior).
- [ ] **Step 5:** in-process backstop: on launch/focus arm a `setTimeout` for the next `alarmAt` while the app runs (primary path on Linux; safety net on Win/macOS); wire window `onFocusChanged` → `ensureReady()` + reconcile; notification `onClick`/`onAction` → open task (mirror of Android tap handling).
- [ ] **Step 6:** `bun run build && bunx tauri build` → run installer → verify desktop rows of [alarms.md §4](./alarms.md): OS-scheduled fire with app closed (Win/macOS), timer fire while open (Linux), tap → task.
- [ ] **Step 7:** `bun run check && bun run test && git commit -m "feat: Tauri desktop shell + desktop alarm scheduler (M6)"`

**Acceptance:** desktop matrix rows pass on at least one OS with the app closed.

---

### Task M7: Backup export / import

**Files:** create `apps/app/src/lib/utils/download.ts`, `apps/app/src/routes/settings/Backup.svelte`, `apps/app/tests/export.test.ts`

- [ ] **Step 1:** failing tests: export JSON shape matches [architecture.md §10](./architecture.md) (`exportSchema` valid); import merge keeps newest `updatedAt` per id; strips `alarmId`/`alarmFiredAt`; invalid file → `VALIBOT_ERROR` with path list.
- [ ] **Step 2:** implement export (Blob download `ikoro-backup-YYYY-MM-DD.json`) + import (file input → validate → merge → `rescheduleAll()` → toast "Imported N tasks").
- [ ] **Step 3:** `bun run check && bun run test && git commit -m "feat: JSON backup export/import (M7)"`

---

### Task M8: QA gate & release

**Files:** `docs/QA.md` (copy of results), tags `v0.1.0`

- [ ] **Step 1:** full [alarms.md §4](./alarms.md) matrix on physical device (reboot + revocation + missed-detection rows), **plus desktop rows** (Windows/macOS: OS-scheduled fire with app closed; Linux: timer-while-open + tap→task); record results.
- [ ] **Step 2:** parity walkthrough vs [google-tasks.md §3](./google-tasks.md) matrix — every ✅ demonstrably works.
- [ ] **Step 3:** `bun run check && bun run lint && bun run test` all green; `git tag v0.1.0`.
- [ ] **Step 4:** [decisions.md](./decisions.md) open-question sweep — re-check name availability ([naming.md](./naming.md)) before sharing publicly.

---

### Task M9: Landing site (`apps/landing`) + extract `packages/ui`

**Files:** `packages/ui/*` (svelte-package library), `apps/landing/*` (SvelteKit, `adapter-static`, prerender)

- [ ] **Step 1:** extract `packages/ui` — first real second consumer justifies the package (lazy rule in constraints): move `apps/app/src/lib/components/ui/*` → `packages/ui/src/lib`, build with `svelte-package`, app imports `@ikoro/ui`. **Gate:** `bun run check` + tests green in app before touching landing. Watch the `svelte-package` dist/`package.json` quirk ([research.md §8](./research.md)).
- [ ] **Step 2:** `bunx sv create apps/landing` (SvelteKit minimal, TS) + tailwindcss add-on; pages: `/` (name story + value props from [README](./README.md) + [naming.md](./naming.md)), `/download` (APK via GitHub Releases + desktop installers), `/privacy`, `/changelog`. Screenshots: ask Michael for real captures — **never fabricate**.
- [ ] **Step 3:** `bun run --filter landing build` → prerendered static output; verify locally (ask which port is free before previewing).
- [ ] **Step 4:** deploy to **Netlify** (git-connected or `netlify-cli`) — **ask Michael before deploying**; domain/URL decision is his.
- [ ] **Step 5:** `git commit -m "feat: landing site + shared @ikoro/ui package (M9)"`

---

### Task M10: Sync server (`apps/server` — auth + API + SSE)

**Files:** `packages/sync/*` (protocol), `apps/server/*` (SvelteKit `adapter-node`, `prisma/schema.prisma`, `/api/auth/[...all]`, `/api/v1/*`)

- [ ] **Step 1:** `packages/sync` first (pure logic, fully testable): Valibot `changeOpSchema`, `ChangeOp` types, LWW `mergeRow(local, remote)` + tombstone rules per [architecture.md §6](./architecture.md) → `tests/merge.test.ts` (server wins tie; newer `updatedAt` wins; device fields preserved) → implement → PASS.
- [ ] **Step 2:** `bunx sv create apps/server` (SvelteKit minimal, TS; `adapter-node`, no UI — 404 page only; name `"server"` for `--filter`).
- [ ] **Step 3:** Prisma v6 + Neon: `bun add -D prisma@6 && bun add @prisma/client@6 && bun add -D @prisma/adapter-neon` (repo standard), `prisma init`; schema: Better Auth tables (`user`, `session`, `account`, `authenticator`, `backupCode`) + `list` + `task` (`id` uuid PK client-generated, `userId`, payload, `updatedAt`, `rev BIGSERIAL`, `deletedAt`); `prisma migrate dev` against a Neon dev branch (**❓ needs a Neon account/DB — ask Michael for `DATABASE_URL` before this step**).
- [ ] **Step 4:** Better Auth: `bun add better-auth`; passkey plugin + backup codes; handler at `/api/auth/[...all]`. **Verify passkey-first sign-up exists** (open question in [decisions.md](./decisions.md)) — fallback: username + passkey (no email infra). Minimal auth status endpoint for the app.
- [ ] **Step 5:** `/api/v1/changes` GET/POST using `packages/sync` (Bearer session guard, Valibot body, per-IP in-memory rate limit), `/api/v1/stream` (SSE, keepalive 25 s, per-user subscriber set), `/api/v1/health` (no auth). Unit-test route validation + LWW with mocked Prisma.
- [ ] **Step 6:** deploy **Fly.io** (Bun + `adapter-node`, one always-on machine, `auto_stop_machines = false`): secrets `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_ORIGIN` — **ask Michael before deploying**; smoke: `curl /api/v1/health`.
- [ ] **Step 7:** `bun run check && bun run test && git commit -m "feat: sync server — Better Auth passkeys, changes API, SSE (M10)"`

---

### Task M11: Sync client (outbox + pull/push + live updates)

**Files:** `apps/app/src/lib/sync/{outbox,client,stream}.ts`, `apps/app/src/routes/settings/Account.svelte`, `apps/app/tests/sync.test.ts`; Dexie `version(2)` (add `outbox` table)

- [ ] **Step 1:** failing tests: enqueue on repo write → flush success clears outbox; server-newer conflict → server row wins, **local `alarmId`/`alarmFiredAt` preserved** and `rescheduleAll()` re-arms if `alarmAt` changed; pull applies tombstones (delete propagates); flush retries with backoff on network error.
- [ ] **Step 2:** implement `outbox.ts` (table + enqueue inside `repo` writes) + `client.ts` (flush on launch/resume/`online`; pull `since=cursor`; merge via `packages/sync`; persist `rev`).
- [ ] **Step 3:** `Account.svelte` in settings — sign in / create account (passkey), show + download backup codes, sign out, sync **off by default** (zero network until enabled).
- [ ] **Step 4:** `stream.ts` — `EventSource` on `/api/v1/stream` after sign-in; `change` event → debounced pull; reconnect with backoff; surface connection state in settings (Synced / Syncing / Offline).
- [ ] **Step 5:** manual E2E on real devices against Fly.io: phone creates → desktop updates live (SSE); airplane-mode edits both sides → reconnect → converge LWW-deterministically; tombstone delete propagates; alarm still fires on the device that owns it after pull.
- [ ] **Step 6:** `bun run check && bun run test && git commit -m "feat: sync client — outbox, LWW merge, SSE live updates (M11)"`

**Acceptance:** two signed-in devices converge; no data loss on conflict (LWW rules hold in tests); sync disabled = zero network calls.

---

### M12: Backlog (NOT scheduled — specs exist)

- Tier-2 full alarm plugin → [alarms.md §3](./alarms.md)
- Google Tasks **import/export** (OAuth, lossy field mapping) → [google-tasks.md §4](./google-tasks.md)
- Recurring tasks + subtasks (fields reserved in schema) → parity with [google-tasks.md §1](./google-tasks.md)
- iOS evaluation (64-notification cap) → [research.md §7](./research.md)
- ICS export, home-screen widget, Play Store publication (policy items §R1)
- Web app (public browser build) if ever wanted — currently dev-preview only
- Redis / multi-instance only if the server ever scales past one instance

---

Self-review (writing-plans skill): spec coverage — README goals → M0–M8 (app: Android + desktop + backup + QA) and M9–M11 (monorepo extras: landing, server, sync) ✅; Google parity → M2/M3 + google-tasks.md ✅; alarm promise → M4 spike gate + M8 matrix (mobile **and** desktop) ✅; no "TBD" steps (the two honest `verify at build` items — desktop pending-query API, Better Auth passkey bootstrap — are flagged as open questions, not placeholders); interfaces defined in M1/M4/M10 before use. Type consistency: `TaskList/Task/AlarmScheduler/ChangeOp` names match [architecture.md](./architecture.md), [alarms.md](./alarms.md), and `packages/sync`.

---

Back to [README](./README.md)
