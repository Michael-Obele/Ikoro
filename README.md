# Ikoro

> The gong that calls you. Task lists whose reminders actually fire — even with the app closed, the screen off, and Doze mode on.

Local-first task/reminder app for **Android (Capacitor)** and **desktop (Tauri)**, in one **Bun-workspaces monorepo**, with a landing site and a self-hosted sync server.

**Status:** scaffolded, not yet built. The build is executed from the plan in `docs/` — **which is local-only and not tracked in this repository.**

> ⚠️ **The plan is not in this repository.** `docs/` and `plan/` are gitignored — they live on the machine that authored the project, not on GitHub. Cloning and building works without them; you only need them if you are the one *executing* the plan.

## Start here (local, untracked)

| If you are…                     | Read                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| **The builder (human or agent)**| `docs/HANDOVER.md` — operating rules, commands, definition of done    |
| Looking for the next task       | `docs/build/README.md` — M0 → M11, one file per milestone             |
| Asking "why is it built this way?" | `docs/design/README.md` — architecture, alarms, decisions, research |
| Checking a dependency version   | `docs/VERSIONS.md` — pinned versions + known drift traps             |
| Wondering what changed recently | `docs/RESEARCH-2026-10.md` — findings that revised the plan          |

## Shape

```
ikoro/
├── apps/
│   ├── app/       ⭐ the product — SvelteKit static SPA → Capacitor (Android) + Tauri (desktop)
│   ├── landing/   marketing site — SvelteKit static → Netlify            (M9)
│   └── server/    sync API — SvelteKit adapter-node on Bun → Fly.io       (M10)
├── packages/
│   ├── ui/        shadcn-svelte components shared by app + landing        (M9)
│   ├── sync/      wire protocol: Valibot schemas + LWW merge              (M10)
│   └── config/    shared tsconfig / eslint / prettier presets             (on demand)
├── docs/          the plan — LOCAL ONLY, gitignored (see above)
└── scripts/       repo tooling (scaffold.mjs)
```

## Quick commands

```bash
bun install          # install all workspaces
bun run scaffold     # create/repair the directory tree (idempotent)
bun run check        # svelte-check + tsc across every workspace
bun run test         # vitest across every workspace
bun run --filter app dev   # start the product app dev server — but ask first
```

## Ground rules

- **Bun only** — never `npm`, `pnpm`, or `yarn`, in any command or lockfile.
- **Ask before starting a dev server or running a build/deploy.**
- **The reminder promise is the product.** No UI work ships ahead of the device-verified alarm spike (M4-S1).
- Never fabricate screenshots, test results, or "it works" claims.
