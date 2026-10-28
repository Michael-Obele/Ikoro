# Releasing Ikoro (Android)

How to set up signing and cut a release that uploads a signed APK + AAB to GitHub Releases.

The build lives in [.github/workflows/release-android.yml](.github/workflows/release-android.yml). It triggers on any tag `v*` and asserts the tag equals `apps/app/package.json`'s `version` before building — a release whose Settings screen and package manager disagree about the version is worse than no release.

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

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Create exactly these five:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | the full contents of `ikoro.keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password from step 1 |
| `ANDROID_KEY_ALIAS` | `ikoro` |
| `ANDROID_KEY_PASSWORD` | the key password from step 1 |
| `RELEASE_PLEASE_TOKEN` | a personal access token — see below |

With the [`gh`](https://cli.github.com) CLI instead of the web UI:

```bash
gh secret set ANDROID_KEYSTORE_B64 < ikoro.keystore.b64
gh secret set ANDROID_KEYSTORE_PASSWORD   # prompts
gh secret set ANDROID_KEY_ALIAS           # prompts — enter: ikoro
gh secret set ANDROID_KEY_PASSWORD        # prompts
gh secret set RELEASE_PLEASE_TOKEN        # prompts — paste the PAT
```

Verify they're set (values stay hidden):

```bash
gh secret list
```

### Why `RELEASE_PLEASE_TOKEN` is not optional

**Events raised by the default `GITHUB_TOKEN` do not create workflow runs.** With it, release-please would cut the tag and report success, and `release-android.yml` would never start — a release on the Releases tab with no artifacts, and no failure anywhere to explain it. That is a deliberate GitHub rule, not a bug.

So give the action a token of its own: a fine-grained PAT scoped to this repository with **Contents: read and write** and **Pull requests: read and write**. The workflow asserts the secret exists and fails loudly if it does not, so this can only be misconfigured once, visibly.

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
4. **The tag starts the build.** `release-android.yml` builds, signs, and attaches `Ikoro-v<version>.apk`
   and `.aab` to the release.

To preview the next version without merging anything: look at the release PR's title. That number is
what release-please computed from the commits in it.

## 6. Rotating a secret

GitHub secrets are write-only — there is nothing to read back or "update in place". To change one, re-set it:

```bash
gh secret set ANDROID_KEYSTORE_PASSWORD   # prompts for the new value
```

The next release run picks it up. No workflow change needed.

---

## Troubleshooting

- **`tag X != package.json Y`** — the tag and `apps/app/package.json` disagree, which now only happens if one was edited by hand. Close the tag, let the next release PR set both.
- **A tag exists but no build ran** — `RELEASE_PLEASE_TOKEN` is unset or expired, so release-please tagged with `GITHUB_TOKEN` and the push could not trigger a workflow. Re-set the secret (step 3) and re-run the release: `gh release delete v<version>` and delete the tag, then re-run the Release Please workflow.
- **No release PR appears** — nothing releasable happened since the last tag, or the commits do not parse. Run `git log --oneline v<last>..HEAD` and check the messages.
- **`ANDROID_KEYSTORE_B64 is not set`** — step 3 was skipped or the secret name has a typo. Names must match exactly.
- **Verify artifacts are signed fails** — the signing block did not apply. Confirm all four keystore secrets are set; the block is env-gated and silently skips signing when `IKORO_KEYSTORE` is absent.
- **`minor/patch above 99 collides in the versionCode formula`** — 100 patches reached the same `versionCode` twice. Land a `feat!:` commit so the next release raises the minor.
