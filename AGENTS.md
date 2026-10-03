# AGENTS.MD

> **THE SINGLE AGENT-INSTRUCTION FILE IN THIS REPO.**
> Do not create `CLAUDE.md`, `.cursorrules`, or `.github/copilot-instructions.md`. Not as a
> symlink, not as a copy. This file is the source of truth for every agent. If a tool wants a
> different filename, point it here.

---

## WHAT THIS REPO IS

**Ikoro** — a local-first task/reminder app. The whole reason it exists is one promise:

> **YOU SET A TIME, AND THE NOTIFICATION FIRES AT THAT TIME.**

Not "usually". Not "when the app happens to be open". If you cannot honour that, you have
broken the product. Everything else — lists, subtasks, priorities, the landing site, the sync
server — is supporting cast.

Bun-workspaces monorepo. `apps/app` is the product: a SvelteKit 3 **static SPA** wrapped by
Capacitor (Android) and Tauri (desktop). One build feeds both shells.

```
apps/app/       the product — SvelteKit 3 + Svelte 5 + Tailwind 4 + shadcn-svelte + svelte-idb
apps/landing/   marketing site (M9)         — scaffolded, NOT built
apps/server/    sync API (M10)              — scaffolded, NOT built
packages/ui/    shared components (M9)      — scaffolded, NOT built
packages/sync/  wire protocol (M10)         — scaffolded, NOT built
docs/           the full build plan — LOCAL ONLY, gitignored, NOT in a fresh clone
```

---

## WHERE THE PLAN LIVES, AND WHY THAT MATTERS HERE

The detailed plan — `docs/HANDOVER.md`, `docs/build/M0…M11`, `docs/design/decisions.md`,
`docs/VERSIONS.md`, `docs/RESEARCH-2026-10.md` — is **gitignored and local-only.** A fresh
clone has none of it.

**Consequence: this file carries every load-bearing rule inline.** Do not treat it as a
condensed README. The rules below are the ones that, if you do not know them, will cause you to
break something. Everything else you can read from the code.

If `docs/` happens to be present on this machine, read the milestone file for your task top to
bottom before editing. If it is absent, this file plus the code is enough — and say so rather
than guessing at a milestone's contents.

---

## CURRENT STATE — VERIFIED, NOT PLANNED

Read this from the repo, not from the plan — the plan's progress assumptions have been wrong
before. Checked 2026-10-03 against `git log`:

| Milestone | State |
| --- | --- |
| M0–M5, M7 | built and committed |
| M9 (landing + `packages/ui`) | built and committed — `b011f81` |
| **M6 (Tauri desktop)** | **in flight, uncommitted.** `apps/app/src-tauri/` exists (`alarms.rs`, `lib.rs`, `tauri.conf.json`), plus `src/lib/alarms/desktop-scheduler.ts` and `systemd.ts` implementing D16's per-alarm systemd user timers. |
| M8 (QA gate + release) | not started — blocked on M6 |
| M10, M11 | scaffolded only, not built |

**Two deviations from the plan's stated order**, recorded so the next agent does not "correct"
them by accident:

- **M9 shipped before M8.** The plan says Phase B must not start before the Phase A QA gate.
  It did. That is a done decision, not an oversight to revert — but M8 is now a larger gate than
  it was written to be, because it must cover work that skipped it.
- **M6 is the only uncommitted work in the tree.** Do not assume it is finished just because it
  is present; check `git status` before reasoning about what is done.

> **The M4-S1 device gate has NOT been cleared.** An exact alarm has never been observed firing
> on a physical device. `apps/app/src/routes/spike/+page.svelte` is **not** a throwaway route —
> it is the instrument that clears the gate, and it stays until someone runs it on hardware.
> Do not delete it, and do not report the alarm promise as verified.

---

## NON-NEGOTIABLE RULES

Breaking one of these is a failed task, not a style nit.

### 1. BUN ONLY

`bun`, `bunx`. **Never** `npm`, `npx`, `pnpm`, or `yarn` — not in a command you run, not in a
command you write into a doc, not in a lockfile. If a README says `npm install x`, you type
`bun add x`. If a tutorial says `npx sv create`, you type `bunx sv create`.

### 2. ASK BEFORE EXPENSIVE OR STATEFUL WORK

Stop and ask the user first:

- **starting a dev server** (`bun run dev`, `vite`, `bun --hot`) — one is usually already
  running on a known port; ask which and reuse it;
- **any build the current step does not require** (`bun run build`, `./gradlew assemble*`,
  `cargo build`, `bunx tauri build`);
- **any deploy** — Netlify, Fly.io, a GitHub Release;
- **any migration against a non-local database**;
- **any download over 300 MB** — state the expected size first and wait for a yes. (Rust
  toolchain, Android SDK images, large asset pulls.) Under 300 MB: just run it.

### 3. NEVER FABRICATE

No invented screenshots. No invented test output. No "this should work" reported as "this
works." If you did not run it, say you did not run it. If a test does not exist, say so.

Where a step needs a human — a physical Android device, a real passkey ceremony, a deploy, a
DNS record — **do it yourself, stop, and report it as pending**, along with what you did
instead. Do not simulate it and do not infer the result.

### 4. NEVER PUT REAL CREDENTIALS INTO AN AUTOMATED BROWSER

If a flow needs the user's password, an OTP, or a passkey ceremony: **stop and hand it over.**
Never type their credentials into a browser-automation session, and never screenshot a page
that could contain them.

---

## SVELTE + SVELTEKIT RULES

- **Runes only.** `$state`, `$derived`, `$props`, `$effect`. No `export let`. No
  `svelte/store` where a rune does the job.
- **Event attributes, not directives.** `onclick`, `oninput`, `onsubmit`. Never `on:click`.
- **`<script lang="ts">` in every component.**
- **[runed](https://runed.dev) before hand-rolling.** Debounce, media query, keydown handling,
  localStorage persistence, element sizing — runed has it. Add it as a **direct** dependency
  (`bun add runed`); never rely on a transitive copy. Read its docs, do not guess the API.
- **Prefer remote `form` over `command`** for any mutation with form inputs. `command` is for
  input-less actions: bare buttons, dialog confirms, toggles.
- **The Svelte inspector stays on.** Exactly one block, in `vite.config.ts` inside
  `sveltekit({…})`. Under Kit 3 the `vitePlugin` key was removed and its options moved up one
  level — never set it in both files, and never put it in a `svelte.config.js`, which this
  project does not have.
- **sv-agentation stays mounted** in `apps/app/src/routes/+layout.svelte`, dev-gated. UI
  annotations become markdown context for agents.

---

## THE IMPORT ALIAS — `#lib` IN TESTS, `$lib` IN SHADCN-GENERATED CODE

This is the single most fragile wiring in the repo. It is declared in **three** places and all
three are required:

| Where | Declares | Why |
| --- | --- | --- |
| `apps/app/package.json` `imports` | `"#lib/*": "./src/lib/*"` | what Vite and Vitest read |
| `apps/app/vite.config.ts` `resolve.alias` | `$lib` → `./src/lib` | shadcn-svelte's generated imports |
| `apps/app/tsconfig.json` `paths` | `$lib`, `$lib/*`, `#lib`, `#lib/*` | `tsc`, `svelte-check`, and the shadcn CLI preflight |

**RULES:**

- **Tests import app code as `#lib/...`.** Never `$lib/...`, never a relative
  `../../src/lib/...` path.
- **The `tsconfig` `paths` entry for `#lib` is not optional.** `package.json#imports` alone
  resolves in Vite/Vitest and **fails `tsc`** — it maps `#lib/db/schema` to the literal path
  `./src/lib/db/schema` with no extension or index resolution. You will get a green test run
  and a red `bun run check`, which is the worst combination available.
- **`tests` must be listed in `tsconfig.json` `include`.** Without it `bun run check` never
  type-checks the suite at all.
- **`$lib` is not deprecated here** — it survives because shadcn-svelte 1.7.0 emits it. Do not
  mass-rewrite generated components. Do not add new hand-written source files using it.
- `tests/alias.test.ts` is the regression guard. It fails if either alias stops resolving.

---

## STORAGE — svelte-idb (THE USER'S OWN PACKAGE)

Storage is **[svelte-idb](https://github.com/Michael-Obele/svelte-idb)**, dogfooded — not Dexie,
not SQLite. When a project needs something the user has already built, use his package; that is
the point of dogfooding it.

**Three properties of svelte-idb that shape the whole data layer:**

1. **There is NO transaction API.** `transaction` does not exist in the published bundle. Never
   write two records and treat them as atomic. The workarounds in use are single-record writes,
   soft deletes (`deletedAt`), and a dirty-flag queue (`dirty: 0 | 1`).
2. **Change events do not cross connections.** Use exactly **one** `createReactiveDB()`
   instance for both mutations and subscriptions. A second instance opens a second connection
   that never sees the first one's writes. This is why `db` lives in `db/schema.ts` and is
   re-exported — one instance, one event bus.
3. **Live queries are not index-aware.** Only `liveAll` / `liveGet` / `liveCount` are reactive.
   `where()` is core-only. Filtered views use `liveAll()` plus `$derived`.

Because `onUpgrade` is a raw IDB hook with unfinished migration sugar, the schema is declared
**complete at `version: 1`** so no migration is ever needed.

**TESTING ANYTHING THAT TOUCHES THE DB:** the test file must start with
`// @vitest-environment jsdom`, and `import 'fake-indexeddb/auto';` must come **before** the
module under test. `schema.ts` calls `createReactiveDB()` at module scope, so IndexedDB has to
already exist by the time that runs or the import throws.

---

## ARCHITECTURAL BOUNDARIES

Enforced in review, not by tooling. Check these before you finish.

- Routes and components never import `svelte-idb`. Only `src/lib/db/repo.ts` and
  `src/lib/stores/view.ts` do — one seam for persistence, one for reactivity.
- Only `src/lib/alarms/*` imports `@capacitor/local-notifications` or
  `@tauri-apps/plugin-notification`. Platform quirks live in one place per platform.
- Only `src/lib/sync/*` talks to `/api/v1`, and only through `packages/sync` schemas.
- Only `apps/server/*` imports the server ORM.
- `packages/*` never imports from `apps/*`. That would make the dependency graph a cycle.
- Exactly one LWW merge implementation, in `packages/sync`, used by both sides. Two
  implementations of conflict resolution is two behaviours.

---

## COMMANDS

Run from the **repo root** unless stated otherwise.

```bash
bun install                  # install every workspace — never npm/pnpm/yarn
bun run check                # svelte-check + tsc across every workspace
bun run test                 # vitest across every workspace
bun run format               # prettier --write
bun run scaffold             # create/repair the dir tree (idempotent)
```

In `apps/app` specifically:

```bash
cd apps/app
bun run test                 # vitest run
bun run check                # svelte-kit sync && svelte-check
bun run test:watch           # while iterating on one file
```

> **`bun run test` currently fails on Prettier, and that is pre-existing** — `bun run lint`
> reports style issues across ~300 files because the repo has not been formatted. Do **not**
> "fix" this by running `bun run format` across the repo as a side effect of an unrelated
> change. Formatting belongs in its own commit, and it is the user's call.

> **A workspace with no tests must not advertise a `test` script.** `bun run --filter '*'`
> runs every workspace, so one that declares `vitest run` with zero `*.test.ts` fails the whole
> root harness with "No test files found" — the mirror of the trap below, and harder to read
> because the real results still print green above it. (`apps/landing` had exactly this problem
> until M9 gave it a test.)

---

## THE VERIFICATION HARNESS — AND THE GREEN-RUN TRAP

`bun run check` → 0 errors, and `bun run test` → all pass with a **non-zero test count**. Both
or it is not done.

> **A green run that executed nothing is worse than a red run.** Before trusting
> `bun run test`, confirm the count is not `0` and that the files you expected actually ran. A
> wrong `include` glob or a `.gitignore` rule produces "0 tests, exit 0" and looks perfect.
> Check the count every time.

Current baseline: **`apps/app` 10 test files, 137 tests**; `apps/landing` 1 file, 14 tests. Root
`bun run test` is green.

### WRITING TESTS HERE

- Vitest. `tests/*.test.ts`, glob registered in `vite.config.ts`.
- **Default environment is `node`.** Pure logic (`time`, `valibot`) stays there and runs in
  milliseconds. Opt into jsdom **per file** with a `// @vitest-environment jsdom` docblock —
  never globally.
- **Logic first, components second.** `repo.ts`, `reconcile.ts`, `mergeRow`, `time.ts` and the
  Valibot schemas must be covered before any component test.
- Component tests use `@testing-library/svelte`: render a fixture, assert on what the user sees,
  never on internal state.
- **Assert error paths on their MESSAGE, not just their type.** The message is what the user
  reads when something fails.
- Write the failing test first where the task calls for it, run it, and confirm it fails **for
  the expected reason** — not a typo, not a missing import.
- Document the test file with a comment explaining what it is *for* and what class of bug it
  catches. The existing files model this well; follow them.

---

## DATA CONTRACTS — FIXED, DO NOT "IMPROVE"

These shapes are referenced across milestones. Renaming or reshaping one silently breaks a
milestone that has not been built yet.

- Timestamps are **ISO 8601 strings in UTC** (`new Date().toISOString()`). Never a `Date` object
  in the database, never an epoch number.
- Calendar fields are **local strings**: `dueDate` is `YYYY-MM-DD`, `dueTime` is `HH:mm`. Never
  a combined `dueAt` — Google's API discards the time, so the split is deliberate and is what
  makes a future sync mapping lossless for dates and honest about times.
- Ids come from `crypto.randomUUID()`.
- **Alarm notification ids are a stable 32-bit hash of the taskId** (`utils/id.ts::hashId`), so
  re-scheduling can never leak a duplicate notification.
- `alarmAt` is **derived once**, when the alarm is switched on:
  `new Date(\`${dueDate}T${dueTime}\`).toISOString()` in local time. Treat `alarmAt` as the single
  source of truth for arming. Never re-derive it at fire time.
- **Deletes are ALWAYS soft** — set `deletedAt`. A tombstone is how a sync peer learns about a
  delete, so it must survive until the peer has seen it.
- **Device-scoped fields never leave the device.** `alarmId`, `alarmFiredAt`, `deletedAt` and
  `rev` are stripped from any export — they are meaningless on another device. `tests/export.test.ts`
  asserts this against the **serialised string**, not the object, because a nested leak is
  invisible to a shallow key check.

---

## ALARMS — THE PART THAT ACTUALLY BREAKS

- Schedule with **`isExactNotification: true` AND `isExactMandatory: true`**. Assert both
  explicitly. If either ever flips to false, the app quietly starts accepting inexact alarms and
  the product's central promise becomes a suggestion.
- **Treat any `ScheduleResult.warning` as a broken promise** and show it to the user. A silent
  degradation is indistinguishable from a working alarm until it fails in front of them.
- Reconciliation ("the store says this is armed but the platform does not have it") is where the
  real breakage lives. That is why the `AlarmScheduler` interface exists: it makes the logic
  testable with a hand-written fake, anywhere, with no device.

---

## NAMING

| Thing | Convention | Example |
| --- | --- | --- |
| Directories | `kebab-case` | `src/lib/components/task/` |
| Svelte components | `PascalCase.svelte` | `TaskRow.svelte`, `AlarmSheet.svelte` |
| Modules | `kebab-case.ts` | `android-scheduler.ts` |
| Functions / variables | `camelCase` | `rescheduleAll()`, `todayOpenTasks()` |
| Types / interfaces | `PascalCase` | `AlarmRequest`, `ChangeOp` |
| Stores | plural `camelCase` | `lists`, `tasks`, `meta` |

Formatting: tabs, single quotes, semicolons. Don't hand-format — run `bun run format`.

---

## COMMITS

Conventional Commits, **one milestone per commit**, never two milestones batched together, never
committed on a red harness. The body lists any new dependency (name + why) and any deviation from
the plan (what + why).

```
feat: svelte-idb data layer + repo + valibot schemas (M1)
```

---

## DON'T TOUCH

| Path | Why |
| --- | --- |
| `apps/app/src/lib/components/ui/**` | generated by shadcn-svelte. Hand-edits are lost on the next `add`. |
| `apps/app/android/**` | Capacitor-generated, except `build.gradle` / `variables.gradle`. |
| `apps/app/build/**` | build output, gitignored (via `apps/app/.gitignore`), regenerated by `bun run build`. |
| `docs/`, `plan/` | gitignored by deliberate decision. They are local, never committed. |
| `bun.lock` | never hand-edited. |

`apps/app/src/routes/spike/+page.svelte` looks like throwaway scaffolding and **is not**. See
Current State above.

---

## KNOWN INCONSISTENCIES IN THE PLAN — TRUST THE CODE

The plan has been wrong before and was caught by reading the repo, not the docs. Where the two
disagree, the code wins. Known cases as of 2026-10-03:

- **The server ORM is Drizzle, not Prisma** (D19). `docs/design/decisions.md` D19 and
  `docs/RESEARCH-2026-10.md` D19 briefly meant *opposite things* — one said "Prisma 7.10.0,
  pinned", the other "Drizzle + Neon" — because the number was reused. Both now say Drizzle.
  If you find another decision number used twice, that is the failure mode, not a typo: a
  decision log is read as authoritative, so a stale row there outranks the prose that corrects
  it.
- The plan's D13 history says "Prisma v6" then "Prisma 7.10.0, pinned", then D13 was revised to
  Drizzle entirely. Read the current decision row, not the superseded statement.
- `docs/design/decisions.md` carries a banner marking parts of it superseded. The table is not
  uniformly trustworthy; the dated D16–D23 rows at the bottom are.

---

## WHEN YOU ARE BLOCKED

Being blocked is normal; pretending is not.

1. **Re-read the code.** The plan has been stale more than once; the repo is the source of truth.
2. **If `docs/` exists, check `VERSIONS.md` and `RESEARCH-2026-10.md`** — version and API drift
   is the most likely cause of a surprise.
3. **Respect every explicit `⚠️ GATE`.** Stop there. Report the exact command and the exact
   output, and wait. Do not improvise past a gate, especially M4-S1.
4. **If the plan is genuinely wrong**, write the finding into the milestone file under a
   `## Findings` heading, state the corrected approach, and continue **only** if it does not
   change the product's promise. If it does change the promise, stop and ask.

Report a block as: **what I ran · what I expected · what I got (verbatim) · what I tried · what
I need.**