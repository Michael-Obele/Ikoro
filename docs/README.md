# Ikoro — documentation

Two trees: **`design/`** is _why it is this shape_ (the original plan, corrected where research proved it wrong). **`build/`** is _what to type next_ (a task-by-task handover plan with no room for interpretation).

## Read in this order

| # | Document                                            | Answers                                                                       |
| - | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 | [`HANDOVER.md`](./HANDOVER.md)                       | **Start here.** Operating rules, commands, boundaries, definition of done.     |
| 2 | [`RESEARCH-2026-10.md`](./RESEARCH-2026-10.md)       | What changed since the plan was written, and which decisions were revised.     |
| 3 | [`VERSIONS.md`](./VERSIONS.md)                       | Exactly which dependency versions to install — and the traps that break installs. |
| 4 | [`build/README.md`](./build/README.md)               | How the build plan is structured, and how to execute one milestone.            |
| 5 | [`build/00-conventions.md`](./build/00-conventions.md) | Cross-cutting contracts: boundaries, naming, the verification harness.        |
| 6 | [`design/README.md`](./design/README.md)             | The product case, goals, non-goals, success criteria.                          |

Then execute `build/M0-scaffold.md` → `build/M11-sync-client.md` **in order**.

## `design/` — the reasoning

| Document                              | What it answers                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| [`design/README.md`](./design/README.md)           | Product case, goals, non-goals, success criteria, document map |
| [`design/naming.md`](./design/naming.md)           | How "Ikoro" was chosen, scorecard, availability checks |
| [`design/research.md`](./design/research.md)       | Verified facts + sources: Android alarms, Doze, plugins, competitors, monorepo prior art |
| [`design/google-tasks.md`](./design/google-tasks.md) | Google Tasks feature inventory, v1 parity matrix, future import/sync design |
| [`design/alarms.md`](./design/alarms.md)           | Tier 1/Tier 2 alarm design, permission UX, platform matrix, the QA test procedure |
| [`design/architecture.md`](./design/architecture.md) | Monorepo shape, stack, data model, sync protocol, native shells, backup format |
| [`design/milestones.md`](./design/milestones.md)   | The original milestone list M0–M11 (superseded by `build/` for execution) |
| [`design/decisions.md`](./design/decisions.md)     | Decision log D1–D15, risks R1–R11, open questions, assumptions |

> [!IMPORTANT]
> `design/` is **historical context**, not the current instruction set. Where it disagrees with `build/`, `VERSIONS.md`, or `RESEARCH-2026-10.md`, the newer document wins. Every known disagreement is listed in `RESEARCH-2026-10.md` §Superseded statements.

## `build/` — the instruction set

One file per milestone. Each has: goal · prerequisites · files to create · exact commands · code contracts · acceptance tests · commit message · a paste-ready prompt block.

See [`build/README.md`](./build/README.md).

## Working copies

`/plan/` (git-ignored) holds the untouched original plan folder from the AI-Plans repo. `docs/design/` is the tracked copy with corrections applied.
