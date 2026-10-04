# apps/app

The product. One SvelteKit 3 static SPA that ships two shells from a single build:

- **Android**, wrapped by Capacitor 8
- **desktop**, wrapped by Tauri v2

Everything else in the monorepo supports this app. See the [root README](../../README.md) for the product story, the requirements, and how to build and install the APK.

## What this app owns

- **Storage.** [svelte-idb](https://github.com/Michael-Obele/svelte-idb), dogfooded. One `createReactiveDB()` instance, no transaction API, so the schema is declared complete at `version: 1`. `src/lib/db/repo.ts` is the only seam for persistence.
- **Alarms.** `src/lib/alarms/` is the only code that talks to a platform alarm or notification API. `plugin.ts` is the only file that names the native `IkoroAlarm` plugin.
- **Sync.** `src/lib/sync/` is the only code that talks to `/api/v1`, and only through `@ikoro/sync` schemas.

## Commands

Everything is `bun`. `npm`, `npx`, `pnpm` and `yarn` are not used anywhere in this repository.

```bash
bun run dev          # dev server (ask first: one is often already running)
bun run test         # vitest run
bun run test:watch   # while iterating on one file
bun run check        # svelte-kit sync && svelte-check
bun run build        # vite build -> build/ (the static SPA)
```

## Layout

```
src/
├── lib/
│   ├── alarms/      the only platform-alarm code
│   ├── components/
│   │   ├── lists/   sidebar and list dialogs
│   │   ├── task/    task rows, the alarm sheet, the priority picker
│   │   ├── theme/   the System/Light/Dark toggle
│   │   └── ui/      shadcn-svelte output, plus hand-written app panels
│   ├── db/          schema, repo (the persistence seam), seed, backup
│   ├── stores/      view.ts (the reactivity seam)
│   ├── sync/        client, transport, config
│   ├── theme/       the theme store and the resolution rule
│   └── utils/       ids, time helpers, download
├── routes/          /today /upcoming /done /lists/[id] /settings, plus /spike
└── app.html         the pre-paint theme script lives inline here, on purpose
```

## Three things that will bite you

**`/spike` is not scaffolding.** It is the instrument that cleared the M4-S1 device gate, it found a real bug that made half of all reminders unschedulable, and it is how a device result gets reproduced. Do not delete it.

**`src/lib/components/ui/**` is generated.** Hand edits there are lost the next time a component is added. Add components with `bun scripts/fetch-shadcn.ts <name>`; the shadcn CLI hangs in this environment.

**The inline theme script in `app.html` duplicates the store.** The storage key, the JSON shape and the resolution rule are written down twice on purpose, because the class has to be on `<html>` before the first paint. `tests/theme-store.test.ts` guards the two against drifting apart. Do not "de-duplicate" it into a module.
