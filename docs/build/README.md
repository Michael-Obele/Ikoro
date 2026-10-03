# BUILD PLAN — the instruction set

One file per milestone. Execute **in order**, M0 → M11. Do not skip, do not reorder, do not merge two into one commit.

Prerequisites for the reader: [`../HANDOVER.md`](../HANDOVER.md) (rules + harness) and [`../VERSIONS.md`](../VERSIONS.md) (exact versions + traps). Both are binding.

---

## How to execute one milestone

```
1. Read the whole milestone file, plus 00-conventions.md if the contracts are new to you.
2. Read the Prev line — if it is not already green and committed, stop.
3. Announce in one or two sentences what you are about to do.
4. For each step, in order:
     a. write the failing test (if the step names one) and RUN it — confirm it fails for the right reason
     b. implement
     c. run the step's own command
5. Run the full harness from the repo root: bun run check && bun run test
   → confirm a NON-ZERO test count. "0 tests, exit 0" is a failure, not a pass.
6. Walk the acceptance checklist and tick only what you observed.
7. Commit with the message the milestone gives.
```

At every `⚠️ GATE` marker: stop, report the verbatim command and output, wait for a human.

---

## Milestone index

| #   | Milestone | Delivers | Depends on | Phase |
| --- | --------- | -------- | ---------- | ----- |
| [M0](./M0-scaffold.md)  | Monorepo scaffold | Bun workspaces + `apps/app` (SvelteKit 3 static SPA, Tailwind 4, shadcn-svelte, Vitest) | — | A |
| [M1](./M1-data-layer.md) | Data layer | `svelte-idb` schema + `repo.ts` + Valibot schemas + tests | M0 | A |
| [M2](./M2-crud-ui.md) | Lists & task CRUD UI | Sidebar, task rows, task sheet, drag-reorder | M1 | A |
| [M3](./M3-views.md) | Today / Upcoming / Done / Settings | Views + `utils/time.ts` | M2 | A |
| [M4](./M4-alarm-engine.md) | **Reminder engine** ⭐ | Capacitor exact notifications, scheduler adapter, reconcile, permission UX — **with the device spike gate first** | M3 | A |
| [M5](./M5-android-packaging.md) | Android packaging | Icons, manifest, notification channel, APK | M4 | A |
| [M6](./M6-desktop.md) | Desktop (Tauri) + OS-native alarms | Tauri shell + **Linux systemd user timers** so alarms fire with the app closed (revised twice — see D16) | M4 | A |
| [M7](./M7-backup.md) | Backup export/import | Valibot-validated JSON round-trip | M3 | A |
| [M8](./M8-qa-release.md) | QA gate & release | Full alarm matrix on device + desktop, parity walkthrough, `v0.1.0` | M5, M6, M7 | A |
| [M9](./M9-landing.md)  | Landing + `packages/ui` | Static site, shared component package | M8 | B |
| [M10](./M10-server.md) | Sync server | Better Auth passkeys, `/api/v1` changes API, SSE | M8 | B |
| [M11](./M11-sync-client.md) | Sync client | Outbox, LWW merge, live updates | M10 | B |

M12 (backlog) is **not** scheduled — see [`design/decisions.md`](../design/decisions.md) "Out of scope" and [`../RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) §2.

Phase A (M0–M8) must pass its QA gate before any Phase B work starts.

---

## The prompt block

Each milestone ends with a block like:

> **Prompt for the builder**
>
> _«Execute M4 of the Ikoro build plan. Read `docs/build/M4-alarm-engine.md`, `docs/HANDOVER.md`, and `docs/VERSIONS.md` first. Work step by step, write the failing test before the implementation, and stop at every ⚠️ GATE and report the verbatim output. Run `bun run check && bun run test` before committing, and confirm the test count is non-zero. Commit with the message in the milestone.»_

Paste that, swapping the milestone id. Do not summarise the milestone for the model — let it read the file, which is the point of writing it down.

---

## Invariants that hold across every milestone

- Bun only. No npm/pnpm/yarn, ever.
- Ask before starting a dev server or running a build/deploy that the step does not require.
- The alarm promise is the product: no UI ships ahead of the device-verified spike (M4-S1).
- Routes never touch `svelte-idb`; only `src/lib/alarms/*` touches notification APIs; only `src/lib/sync/*` talks to `/api/v1`; only `packages/sync` defines the wire format; `packages/*` never imports `apps/*`.
- Every new dependency is named in the commit body.
- Never fabricate a result. A pending human step stays pending.
