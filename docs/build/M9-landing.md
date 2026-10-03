# M9 — Landing site + `packages/ui`

**Goal:** a public page that explains the app and links to the downloads, and the first reason for the shared component package to exist.

**Prev:** [M8](./M8-qa-release.md) — Phase A QA passed and tagged.
**Next:** [M10 — sync server](./M10-server.md)

---

## Step 1 — extract `packages/ui`

The lazy-package rule from [`../design/architecture.md`](../design/architecture.md) §1 says: extract on the **second** consumer, not before. The landing page is that second consumer. Do this first, gate it, then build the site.

**Gate:** the app must be green *before* the extraction and *after* it. `bun run check && bun run test` in `apps/app` at both points.

- [ ] Move the shadcn-svelte components from `apps/app/src/lib/components/ui/**` to `packages/ui/src/lib/components/ui/**`.
- [ ] Move `cn()` and friends to `packages/ui/src/lib/utils/`.
- [ ] Add `packages/ui/src/lib/index.ts` re-exporting the components the app actually uses. Export named components, not `export *` — an explicit surface is the thing that makes this package a seam rather than a folder.
- [ ] Point the app at it: add `"@ikoro/ui": "workspace:*"` to `apps/app/package.json` and rewrite the imports.
- [ ] `bun install`, then `bun run --filter app check && bun run --filter app test` — green.

### ⚠️ How to consume the package — decide here, do not guess

`@sveltejs/package` is at 3.0.0 and SvelteKit 3 removed `svelte.config.js`; the classic `svelte-package` → `dist/` flow has a long-standing `dist/package.json` import quirk (risk **R11**). Two options:

| Option | What it means | Cost |
| ------ | ------------- | ---- |
| **A — source package (recommended)** | `packages/ui` exports `.svelte` **source**. Both consumers are Vite/SvelteKit, which compile it directly. No build step, no `dist/`, no quirk. | The package cannot be published or consumed by a non-Vite tool. Irrelevant here. |
| **B — built package** | `svelte-package` emits `dist/` with `exports` pointing at the built files. | A build step between edit and see; the `dist/package.json` resolution quirk R11; needs `prepack`/watch wiring. |

- [ ] **Default to Option A.** In `packages/ui/package.json`:
      `"exports": { ".": "./src/lib/index.ts", "./*": "./src/lib/*" }` and no `build` script.
- [ ] Write the choice into [`../design/decisions.md`](../design/decisions.md) as D21 with the reason.
- [ ] Only take Option B if Option A actually fails to resolve — and record the failure verbatim.

## Step 2 — scaffold the landing app

```bash
rm -rf apps/landing
bunx sv create apps/landing --template minimal --types ts --add tailwindcss eslint prettier
bun run scaffold
bun install
```

- [ ] Name it `landing` in `package.json`.
- [ ] `adapter-static` with `prerender = true` (there is no dynamic route) and **no** `ssr = false` — this site is prerendered HTML, which is the whole point.
- [ ] Add `"@ikoro/ui": "workspace:*"` and the same Tailwind setup as the app, so the components render identically.
- [ ] Add the same inspector + sv-agentation dev tooling as the app (HANDOVER §2.5).

## Step 3 — pages

| Route | Content |
| ----- | ------- |
| `/` | The name story (Ịbani slit-gong — [`../design/naming.md`](../design/naming.md)), the value proposition in the user's own words: *when you set a time, it fires*. Then the three differentiators: offline-first, no account by default, exact Android alarms. |
| `/download` | APK from GitHub Releases, desktop installers, and an honest platform table — including **"desktop: Ikoro must be running"** (D16). |
| `/privacy` | Local-first statement: no account required, no telemetry, no third-party calls, data lives in IndexedDB, sync optional and self-hosted. |
| `/changelog` | `v0.1.0` and what it contains. |

- [ ] Copy in plain, everyday words. Short sentences. No clever metaphors, no punchy one-word endings, no writerly rhythm.
- [ ] **Screenshots come from the user.** Ask for real captures of the shipped build. Never fabricate a screenshot, never mock one up and present it as the app.
- [ ] No trackers, no analytics, no cookie banner (there is nothing to consent to).
- [ ] Nothing on the page claims a platform capability that M8 did not observe. In particular: no "reminders even when closed" for desktop.

## Step 4 — verify and commit

```bash
bun run --filter landing build
```

- [ ] Prerendered output lands in `apps/landing/build/`. Every route has real HTML with content in it — check by reading `build/index.html`, not by looking at a browser.
- [ ] `bun run check && bun run test` at the root: green.

```bash
git add -A
git commit -m "feat: landing site + shared @ikoro/ui package (M9)"
```

## Step 5 — deploy ⚠️

- [ ] **Ask the user first.** They own the Netlify account, the site name, and the domain.
- [ ] Deploy only after the build is verified locally. Verify with `bunx serve apps/landing/build` or an equivalent static server — **ask which port is free** before starting anything.

---

## Acceptance

- [ ] `apps/landing` builds to static HTML with prerendered content.
- [ ] `packages/ui` is consumed by both apps, with the consumption strategy (A or B) recorded as D21.
- [ ] The app is still green after the extraction.
- [ ] Every claim on the site matches the M8 QA results.
- [ ] No fabricated screenshots; real captures requested from the user.
- [ ] Nothing deployed without explicit approval.

## Findings

_(Append here if reality disagrees — especially if Option A failed.)_

---

> **Prompt for the builder**
>
> _«Execute M9 of the Ikoro build plan. Read `docs/build/M9-landing.md` first, in particular the ⚠️ package-consumption decision — default to Option A (source package) and record the choice as D21. The landing copy must be plain everyday words with no metaphors or clever phrasing, and must not claim any capability the M8 QA results did not observe. Ask me for real screenshots — never fabricate one. Ask before any deploy or before starting a static server.»_
