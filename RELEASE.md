# Releasing Ikoro

How to set up signing and cut a release that uploads a signed APK + AAB and Linux desktop bundles to GitHub Releases.

The Android build lives in [.github/workflows/release-android.yml](.github/workflows/release-android.yml) and the desktop build in [.github/workflows/release-desktop.yml](.github/workflows/release-desktop.yml). Both trigger on any tag `v*` and assert the tag equals `apps/app/package.json`'s `version` before building — a release whose Settings screen and package manager disagree about the version is worse than no release.

The tag is not cut by hand: [release-please](https://github.com/googleapis/release-please) reads the commits, keeps a release PR open, and tags when you merge it (`.github/workflows/release-please.yml`, `release-please-config.json`).

> **BUN ONLY.** This repo never uses npm/npx/pnpm/yarn. `bunx` is the npx equivalent.

---

## 1. One-time keystore creation (local, never committed)

The keystore is the app's identity. Generate it once, on your machine:

```bash
keytool -genkeypair -v -keystore ikoro.keystore -alias ikoro \
  -keyalg RSA -keysize 2048 -validity 10000
```

It prompts for a **store password** and a **key password** (they can be the same). Remember both — they go into secrets next.

> **⚠️ Keep an offline copy of `ikoro.keystore`.** Lose it and the app can never be updated under `com.michaelobele.ikoro` again — Google Play and Android both reject an update signed by a different key. The file is gitignored; do not commit it.

## 2. Encode the keystore for GitHub

GitHub secrets hold text, so the binary keystore goes in base64:

```bash
base64 -w0 ikoro.keystore > ikoro.keystore.b64
```

(`-w0` disables line wrapping — the secret must be a single line.)

## 3. Set the four GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Create exactly these four:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | the full contents of `ikoro.keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password from step 1 |
| `ANDROID_KEY_ALIAS` | `ikoro` |
| `ANDROID_KEY_PASSWORD` | the key password from step 1 |

With the [`gh`](https://cli.github.com) CLI instead of the web UI:

```bash
gh secret set ANDROID_KEYSTORE_B64 < ikoro.keystore.b64
gh secret set ANDROID_KEYSTORE_PASSWORD   # prompts
gh secret set ANDROID_KEY_ALIAS           # prompts — enter: ikoro
gh secret set ANDROID_KEY_PASSWORD        # prompts
```

Verify they're set (values stay hidden):

```bash
gh secret list
```

No token secret is needed. release-please tags with the default `GITHUB_TOKEN`, and a tag pushed
that way cannot start another workflow — so `release-please.yml` starts the build with
`gh workflow run`, which is the one event `GITHUB_TOKEN` *is* allowed to trigger.

## 4. Which bump does my commit need? (commit → version)

**Every commit is a patch.** Only a `!` moves the number higher, and it moves it to a **minor**:

| Your commit says | Bump | Because |
| --- | --- | --- |
| anything conventional — `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `ci:`, `build:`, `test:`, `style:`, `revert:` | **patch** `0.3.1 → 0.3.2` | nothing an existing install relies on changed |
| `feat!: …` · `feat(x)!: …` · a `BREAKING CHANGE:` footer (any type) | **minor** `0.3.2 → 0.4.0` | it changes a data contract, the storage schema, or what an existing install has to do |
| — | **major** | not before 1.0.0 |

Before 1.0.0 a new feature is not yet a promise and a break is not yet a contract, so both live
inside a patch/minor. Two flags in `release-please-config.json` are what encode this:

- `bump-patch-for-minor-pre-major: true` — a `feat:` is a patch, not a minor.
- `bump-minor-pre-major: true` — a `!` is a minor, not a major.

The default is cheap on purpose: a patch claims only that nothing a user relies on changed. A bump
cannot be undone once it is on a store listing, so it is never guessed from the diff — it is taken
from what the commit says. That is also why the number is never typed by hand: release-please
derives it, and `apps/app/scripts/version.ts check` re-derives it independently at build time.

### What the build checks

On every `v*` tag, before anything is built, the run fails if:

- **the tag is smaller than its history claims** — a `!` commit since the previous tag needs a minor.
  A **bigger** bump is always allowed; only a smaller one is refused.
- **a commit since the previous tag does not parse** — release-please silently drops a message it
  cannot read, so such a commit would miss the bump and the changelog with no failure anywhere.
- **the tag and `apps/app/package.json` disagree**, i.e. one of them was edited by hand.
- **minor or patch passed 99** — the Android `versionCode` is `major*10000 + minor*100 + patch`, so
  `0.3.100` and `0.4.0` are both `400`. Play orders uploads by that number; a collision is a release
  that can never be published. Add a `feat!:` commit and let the next release PR raise the minor.

Run the same check locally: `bun apps/app/scripts/version.ts check`.

## 5. Cut a release

No tagging, no version editing. Push commits to `master`, then merge the PR release-please opens.

1. **Push work to `master`** with Conventional Commit messages. release-please wakes on every push
   and keeps a single open PR titled `chore(master): release <version>`.
2. **Read that PR.** It lists the commits and the version it computed. If the version is wrong the
   *commit message* is wrong — fix the message, not the PR.
3. **Merge the PR.** release-please then writes `apps/app/package.json` and the changelog, cuts tag
   `v<version>`, and publishes the GitHub Release. Its branch (`release-please--branches--master`) is
   deleted by a step in `release-please.yml` so the branch list stays clean.
4. **The builds start.** `release-please.yml` dispatches `release-android.yml` and `release-desktop.yml`
   at the new tag. Android signs and attaches `Ikoro-v<version>.apk` and `.aab`; desktop attaches
   `Ikoro-v<version>.deb` and `.AppImage` (plus `.rpm` when the runner can produce it).

> **Only commits that touch `apps/app` earn a release.** release-please filters by the package path,
> so a week of `.github/` and `docs/` work produces no PR — and no version. That is deliberate: a CI
> fix should not move the number a user sees. Work on `apps/landing`, `apps/server` or
> `packages/*` is likewise invisible to `apps/app`'s version until it is wired into its own package
> entry in `release-please-config.json`.

To preview the next version without merging anything: look at the release PR's title. That number is
what release-please computed from the commits in it.

To rebuild a release whose artifacts are missing, dispatch the builds by hand — they refuse a ref that
is not a version tag. Note that each runs the workflow **as that tag had it**, so a fix to a build
pipeline only takes effect from the next tag onward:

```bash
gh workflow run release-android.yml --ref v0.3.2
gh workflow run release-desktop.yml --ref v0.3.2
```

## Desktop builds (Linux .deb + .AppImage)

The same tag flow builds Linux desktop bundles via `release-desktop.yml`: the sync step copies
`apps/app/package.json`'s version into `src-tauri/Cargo.toml` (Tauri reads the version from there —
`tauri.conf.json` has no `version` key on purpose), then `bunx tauri build` produces the `.deb` and
`.AppImage`, plus the `.rpm` when the runner has `rpmbuild`. The `.rpm` is opportunistic: the run
copies it when present and never fails when it is missing. `deb` + `AppImage` are the promise.

No desktop secrets exist. Linux bundles are unsigned, so there is no keystore step — contrast with
Android's four secrets in step 3.

Windows and macOS are deliberately not built. D16 scoped OS-scheduled alarms to Linux systemd user
timers first; on the other two the app can only do timer-mode alarms (the app must stay open), which
breaks the product's central promise. Shipping those binaries would advertise a degraded promise as
a release. They are an M12 TODO, not a missing matrix entry.

Build locally from `apps/app` — `bunx tauri build` from the repo root fails with the misleading
"could not determine executable to run for package tauri":

```bash
cd apps/app
bunx tauri build
```

## 6. Rotating a secret

GitHub secrets are write-only — there is nothing to read back or "update in place". To change one, re-set it:

```bash
gh secret set ANDROID_KEYSTORE_PASSWORD   # prompts for the new value
```

The next release run picks it up. No workflow change needed.

---

## Troubleshooting

- **`tag X != package.json Y`** — the tag and `apps/app/package.json` disagree, which now only happens if one was edited by hand. Close the tag, let the next release PR set both.
- **A tag exists but no build ran** — `release-please.yml` dispatches the build, so check that run first. If the dispatch step failed, rebuild by hand: `gh workflow run release-android.yml --ref v<version>`.
- **`"master" is not a version tag`** — the build was dispatched at a branch. Dispatch it at the tag instead.
- **No release PR appears** — nothing releasable happened since the last tag, or the commits do not parse. Run `git log --oneline v<last>..HEAD` and check the messages.
- **`ANDROID_KEYSTORE_B64 is not set`** — step 3 was skipped or the secret name has a typo. Names must match exactly.
- **Verify artifacts are signed fails** — the signing block did not apply. Confirm all four keystore secrets are set; the block is env-gated and silently skips signing when `IKORO_KEYSTORE` is absent.
- **`minor/patch above 99 collides in the versionCode formula`** — 100 patches reached the same `versionCode` twice. Land a `feat!:` commit so the next release raises the minor.
