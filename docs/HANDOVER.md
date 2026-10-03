# HANDOVER — how to build Ikoro

You are the builder. This file is the contract. It applies to a human and to an AI agent equally, and it overrides your own defaults.

Read this file completely before touching anything.

---

## 1. What you are building

**Ikoro** — a local-first task/reminder app whose whole reason to exist is: **you set a time, and the notification fires at that time.** Not "usually". Not "when the app happens to be open". That promise is the product; everything else is supporting cast.

Three deployables, one repo:

| Workspace        | What it is                                                                 | Ships to |
| ---------------- | -------------------------------------------------------------------------- | -------- |
| `apps/app`       | The product. SvelteKit static SPA. Wrapped by **Capacitor** (Android) and **Tauri** (desktop). | APK + desktop installers (GitHub Releases) |
| `apps/landing`   | Marketing site. Static, zero trackers.                                      | Netlify (M9) |
| `apps/server`    | Optional self-hosted sync API (passkeys, SSE).                              | Fly.io (M10) |
| `packages/ui`    | shadcn-svelte components shared by app + landing.                           | — (M9) |
| `packages/sync`  | Wire protocol: Valibot schemas + LWW merge, shared by app + server.         | — (M10) |

**Phase A = M0–M8** (the app: Android + desktop + backup + QA). **Phase B = M9–M11** (landing → server → sync). Do not start Phase B before Phase A passes its QA gate.

---

## 2. Non-negotiable rules

These are the user's standing rules. Breaking one is a failed task, not a style nit.

### 2.1 Bun only

`bun` and `bunx`. Never `npm`, `npm install`, `npx`, `pnpm`, `yarn` — not in a command, not in a docs example, not in a generated lockfile. If a tutorial says `npx sv create`, you type `bunx sv create`. If a package's README says `npm install x`, you type `bun add x`.

### 2.2 Ask before anything expensive or stateful

**Ask the user first — do not just do it — before:**

- starting a dev server (`bun run dev`, `bun --hot`, `vite`) — the user usually already has one running on a known port; ask which port and reuse it;
- running any build that is not the one the current step requires (`bun run build`, `cargo build`, `./gradlew assemble*`, `bunx tauri build`);
- any deploy (Netlify, Fly.io, GitHub Release);
- any database migration against a non-local database;
- installing anything that pulls **more than 300 MB** (Rust toolchain, Android SDK images, large model/asset downloads) — state the expected size first and wait for a yes.

Under 300 MB: just run it, no announcement needed.

### 2.3 Never put real credentials into an automated browser

If a flow needs the user's Google/GitHub/email password, an OTP, or a passkey ceremony: **stop**, hand the flow over, let them do it in their own browser. Never type their credentials into a browser automation session, and never screenshot a page that could contain them.

### 2.4 Never fabricate

No invented screenshots, no invented test output, no "this should work" reported as "this works". If you did not run it, say you did not run it. If a test does not exist yet, say so. Where a step needs a human (a physical Android device, a real deploy, a DNS record), say so and stop — do not simulate it.

### 2.5 Svelte conventions (non-optional)

- **Runes only.** `$state`, `$derived`, `$props`, `$effect`. No `export let`, no `svelte/store` where a rune will do.
- **`onclick`, not `on:click`.** Svelte 5 event attributes.
- **Reach for [runed](https://runed.dev) before hand-rolling a utility.** `PersistedState`, `PressedKeys`, `useEventListener`, `watch`, … If you are about to write a debounce, a media query, a keydown switch, or a localStorage sync, check runed first. Add it as a **direct** dependency (`bun add runed`), never rely on a transitive copy. Get its docs rather than guessing.
- **Prefer remote `form` over `command`** for mutations with form inputs; `command` only for input-less actions (bare buttons, dialog confirms, toggles).
- **The Svelte inspector stays on.** Put exactly one block in the file that holds the adapter/kit options:

  ```ts
  // vite.config.ts — SvelteKit 3 puts kit config inside the sveltekit() plugin
  sveltekit({
    inspector: {
      toggleKeyCombo: 'alt-x',
      showToggleButton: 'active',
      toggleButtonPos: 'bottom-left',
    },
    // …adapter, alias, etc.
  });
  ```

  (Under SvelteKit 2 that block would be `vitePlugin: { inspector: {…} }`; under 3 the `vitePlugin` key was removed and its options move up one level. Never set it in both files.)

- **sv-agentation stays installed and mounted** — UI annotations become markdown context for AI agents. `bun add sv-agentation`, mounted in `apps/app/src/routes/+layout.svelte` beside `{@render children()}`, gated `{#if browser && dev}`, with `toolbarPosition="bottom-right"`, `outputMode="forensic"`, `pauseAnimations`, `clearOnCopy`, `includeComponentContext={false}`, `includeComputedStyles={false}`.

### 2.6 Architectural boundaries (enforced in review, not by tooling)

| Rule                                                                    | Why |
| ----------------------------------------------------------------------- | --- |
| Routes never import Dexie — only `src/lib/db/repo.ts` does.              | One seam for persistence; makes the sync rewrite local. |
| Only `src/lib/alarms/*` imports `@capacitor/local-notifications` or `@tauri-apps/plugin-notification`. | Platform quirks live in one place per platform. |
| Only `src/lib/sync/*` talks to `/api/v1`, and only through `packages/sync` schemas. | The wire contract is shared with the server, so it cannot drift. |
| Only `apps/server/*` imports Prisma.                                     | One process owns the database. |
| `packages/*` never imports from `apps/*`.                                | Otherwise the dependency graph becomes a cycle. |
| One LWW merge implementation, in `packages/sync`, used by both sides.     | Two implementations of conflict resolution is two behaviours. |

---

## 3. Environment on this machine

Verified 2026-10-03:

| Tool        | Version present | Needed for |
| ----------- | --------------- | ---------- |
| Node        | v24.12.0        | SvelteKit 3 requires ≥ 22.17 ✔ |
| Bun         | 1.4.0           | everything |
| rustc/cargo | 1.97.1          | Tauri (M6) — **already installed**, no multi-GB rustup download |
| Java        | OpenJDK 21      | Capacitor / Gradle (M4, M5) |
| adb         | 1.0.41          | on-device alarm tests (M4-S1, M8) |
| git         | 2.43.0          | — |

Remotes: `origin` → `https://github.com/Michael-Obele/Ikoro.git`.

---

## 4. The workflow for every single task

1. **Read the milestone file** (`docs/build/M<n>-*.md`) top to bottom — including its prerequisites.
2. **Announce the plan** in one or two sentences before editing.
3. **Write the failing test first** wherever the milestone specifies tests. Run it. Confirm it fails *for the expected reason* (not a typo, not a missing import).
4. **Implement** until the test passes.
5. **Run the full harness** (§5). All of it, from the repo root.
6. **Commit** with the message the milestone specifies.
7. **Tick the milestone's acceptance checklist** — and only claim a box you actually observed.

Never batch two milestones into one commit. Never move on with a red harness.

---

## 5. The verification harness

Run from the repo root:

```bash
bun install                 # never npm/pnpm/yarn
bun run check               # svelte-check + tsc across every workspace
bun run test                # vitest across every workspace
```

Plus, per milestone, the extra gate it names — for example the *on-device* alarm matrix (M4-S1, M8) or an `adb` command. "0 errors, N passed" is the only acceptable output.

> [!WARNING]
> **A green run that executed nothing is worse than a red run.** Before trusting `bun run test`, confirm the test count is not `0` and that the files you expected actually ran. A `.gitignore` rule or a wrong `include` glob can silently produce "0 tests, exit 0". Check the count every time.

---

## 6. Definition of done

A task is done only when **all** of these are true:

- [ ] Every file listed in the milestone exists at the stated path.
- [ ] The milestone's own acceptance checks were observed, not assumed.
- [ ] `bun run check` → 0 errors.
- [ ] `bun run test` → all pass, with a non-zero test count.
- [ ] Architectural boundaries (§2.6) still hold.
- [ ] No new dependency was added silently — new deps are named in the commit body.
- [ ] The commit message matches the milestone.
- [ ] Any human-only step (device test, deploy, DNS) is reported as **pending**, with what you did instead.

---

## 7. Commit convention

Conventional Commits, one milestone per commit, exactly the message the milestone file gives:

```
feat: Dexie data layer + repo + valibot schemas (M1)
```

Body lists any new dependency and any deviation from the plan, with the reason.

---

## 8. When you are blocked

Being blocked is normal; pretending is not. Order of operations:

1. **Re-read the milestone.** Most "blocked" moments are a missed prerequisite.
2. **Check `RESEARCH-2026-10.md` and `VERSIONS.md`.** Version and API drift is the most likely cause of a surprise.
3. **Some steps have an explicit `⚠️ GATE`.** Stop there. Report what you observed (exact command, exact output) and wait. Do not improvise past a gate — especially M4-S1.
4. **If the plan is genuinely wrong**, write the finding in the milestone file under a `## Findings` heading, state the corrected approach, and keep going only if the new approach does not change the product's promise. If it does, stop and ask.

Report blocks as: *what I ran · what I expected · what I got (verbatim) · what I tried · what I need.*
