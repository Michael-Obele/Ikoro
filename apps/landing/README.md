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

Deploying is the user's call, and this workspace does not configure a host.

## Where the copy lives

`src/lib/content.ts`, and nowhere else. Every claim the site makes — the platform
table, the privacy statements, the changelog, the route list — is a value in that
file, and `tests/content.test.ts` fails if one of them turns into something the
build cannot do (a platform marked released, a link to a route that does not
exist, a tracker smuggled into the markup).

Two fields are switched by hand, on purpose, so nobody ships a claim by accident:

| Field                | When it changes                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `releaseNotice`      | delete it the day `v0.1.0` is published; it is the "nothing to download yet" notice on `/` and `/download`                                                       |
| `platforms[].status` | set the Android row to `released` when there is a file to download — the test that says "claims nothing is downloadable" then fails until you do it deliberately |

## Adding a shadcn component

The `shadcn-svelte` CLI hangs in this environment (verified 2026-10-03), so
components are fetched from the public registry directly:

```bash
bun scripts/fetch-shadcn.ts button badge card
```

They land in `packages/ui`, not here — the components belong to the package, and
this app only ever imports them from `@ikoro/ui`. Add the component's name to
`packages/ui/src/lib/index.ts` in the same commit.
