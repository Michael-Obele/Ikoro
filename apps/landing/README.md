# landing

The Ikoro marketing site. Static HTML, prerendered at build time, no trackers, no
account, no cookie banner.

## Commands

```bash
bun run dev              # ask first — the dev server needs a port
bun run build            # → build/ (index.html, download.html, privacy.html, changelog.html)
bun run check            # svelte-check
bun run test             # the copy guards
bun run lint             # prettier + eslint
```

Deploying is a human action. Netlify builds this site from the config at the
repo root (`netlify.toml`): it builds the `landing` workspace and publishes
`apps/landing/build`. Creating the Netlify site, linking it to the repo, and
triggering deploys all stay with a person. This workspace only holds the config
the site needs to build.

## Where the copy lives

`src/lib/content.ts`, and nowhere else. Every claim the site makes — the platform
table, the privacy statements, the changelog, the route list — is a value in that
file, and `tests/content.test.ts` fails if one of them turns into something the
build cannot do (a platform marked released, a link to a route that does not
exist, a tracker smuggled into the markup).

Two fields are switched by hand, on purpose, so nobody ships a claim by accident.
Both are guarded by tests, so changing one without meaning it fails the build.

| Field                | What it means now                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `releaseNotice`      | states what the published release offers. Today that is v0.3.2 on GitHub Releases as an APK plus an AAB, with no Play Store listing. Update it when a release changes what is published |
| `platforms[].status` | marks which platforms have a real download. Android is `released` because v0.3.2 ships files. Linux stays `unreleased` until its bundles ship. Flip a row only when a platform gains or loses a real download |

## Adding a shadcn component

The `shadcn-svelte` CLI hangs in this environment (verified 2026-10-03), so
components are fetched from the public registry directly:

```bash
bun scripts/fetch-shadcn.ts button badge card
```

They land in `src/lib/components/ui/`, and this app owns that copy — there is no
shared UI package, because shadcn-svelte has no monorepo CLI routing, so a
central one bought only indirection. Add the component's name to
`src/lib/components/ui/index.ts` in the same commit.
