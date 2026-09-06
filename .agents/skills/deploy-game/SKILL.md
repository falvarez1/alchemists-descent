---
name: deploy-game
description: Publish a committed branch or revision of Alchemist's Descent to its public Cloudflare Pages site, or inspect which build is live. Use when asked to deploy, publish, ship a ref, or check the live game at alchemists-descent.pages.dev.
---

# Deploy the game to Cloudflare Pages

Imported from `.claude/skills/deploy-game/`; the Claude skill remains available.
Run the commands below from the repository root. The bundled helpers target
Windows with Node.js, Git, npm, and the browser required by
`scripts/verify-hosted-game.mjs`.

## Target and operating constraints

- The public project is `alchemists-descent` at
  https://alchemists-descent.pages.dev. Its Pages production branch is `main`.
  To publish any Git ref to that root, build the ref and deploy with
  `--branch main`; using the ref's branch name could create a preview instead.
- The source workflow identifies the personal Cloudflare login
  `frankishere@gmail.com`, account **Ajar Red**, ID
  `55c36c9de5247e3c193b45cdf43bb054`. The work login `falvarez@wsits.com` can
  authenticate but does not own this project. Verify account access with
  `whoami`; always set `CLOUDFLARE_ACCOUNT_ID` for deployment to avoid an
  interactive account prompt.
- Use `npx -y -p wrangler@4.129.0 wrangler`. The source workflow pins this
  standalone version because repo-local Wrangler 4.114 failed with an esbuild
  host/binary version mismatch (`0.28.1` versus `0.25.12`). Preserve that working
  path unless intentionally troubleshooting the toolchain.
- Publish the committed ref from a clean detached worktree. Preserve dirty
  branch worktrees and report any uncommitted work excluded from the release.
- Build without `VITE_AUTHORLINK_RELAY` or `VITE_AUTHORLINK_TOKEN`: Vite embeds
  them in the client bundle. The helper clears inherited values; check that the
  chosen ref does not set public credentials in tracked `.env` files. Keep
  `VITE_INCLUDE_BUILDER` and `GH_PAGES` unset for the public Cloudflare play build.
- A request to inspect the live build is read-only. Run the deployment helper
  when the user has requested publication of the selected ref; existing
  publication authorization does not need another confirmation.

## Authentication when needed

```powershell
npx -y -p wrangler@4.129.0 wrangler whoami
```

If the owning account is visible, continue. Otherwise have the user sign the
browser into the personal Cloudflare login before starting a fresh OAuth flow:

```powershell
node .agents/skills/deploy-game/login.mjs
```

The browser's identity controls OAuth; switching accounts after an authorization
page opens does not update that page. The helper logs out a wrong CLI identity,
starts login detached, writes output to a temporary log, waits up to ten minutes
for Allow, and checks account access. Read its log while waiting instead of piping
login through a buffering filter. Stop after a failed attempt and resolve the
reported identity or callback issue before retrying.

OAuth uses `localhost:8976`. If occupied, the imported helper reports the listener
PIDs and stops. Inspect the owning process before stopping a stale Wrangler login;
do not kill an unidentified listener. Wrangler credentials remain outside the
repository in `%APPDATA%\xdg.config\.wrangler\config\default.toml`.

## Publish a committed ref

```powershell
node .agents/skills/deploy-game/deploy.mjs <ref>
# Only skip tests when passing results already cover this exact commit:
node .agents/skills/deploy-game/deploy.mjs <ref> --skip-tests
# Preserve the temporary build worktree for investigation:
node .agents/skills/deploy-game/deploy.mjs <ref> --keep
```

The helper performs these steps:

1. Verify Cloudflare account access and resolve the requested commit.
2. Create a unique detached worktree below the OS temporary directory, or below
   `DEPLOY_GAME_SCRATCHPAD` if set. Reuse the current checkout's `node_modules`
   through a junction only when the dependency manifests match; otherwise run
   `npm ci` in the worktree.
3. Run `npm run build` (strict typecheck and Vite build), then `npx vitest run`
   unless tests were explicitly skipped. Reject output containing `builder.html`
   or missing the entry chunk.
4. Deploy `dist` with the explicit account, project, and `--branch main` using
   the pinned standalone Wrangler.
5. Confirm the public root references the entry chunk from this build. A mismatch
   can mean propagation delay or the wrong target. Recheck the root before
   considering another deployment; a failed verification can occur after upload.
6. Run `node scripts/verify-hosted-game.mjs https://alchemists-descent.pages.dev`
   from the current checkout, whose probe may support newer cold-load flows than
   the shipped ref's probe. It plays through the actual UI, checks pixels and
   absent AuthorLink credentials, and does not rely on dev-only `window.__game`.
   Extend the probe if a new entry flow needs support; report its actual pass
   count rather than assuming the source workflow's historical 13/13.
7. Remove the dependency junction and the temporary worktree unless `--keep` was
   supplied. For manual cleanup, verify absolute paths remain inside this run's
   scratch directory and remove only the junction itself before removing the
   worktree; never recursively delete through the shared `node_modules` link.

Build, test, or upload failure stops the sequence. A hosted verification failure
does not roll back a successful upload; report the deployment and failed check
separately.

## Inspect the live build

Fetch the public root, resolve its `assets/index-<hash>.js` URL, and read the build
stamp from that served chunk. `vite.config.ts` embeds the Git short SHA plus UTC
time in `__BUILD_STAMP__`; compare that SHA with local Git history when available.
The timestamp can change chunk hashes for repeat builds of the same commit, so
do not identify a live commit by comparing against a previous deployment's hash.
Run the hosted probe if the user also requests a live health check.

## Report

Report the shipped SHA and subject, public URL, build result, test result (or why
skipped), and hosted probe result. Identify excluded uncommitted work, any probe
adaptation, and a retained worktree. If login was needed, report the verified
identity/account access. For inspection-only requests, report the observed live
stamp and any uncertainty without deploying.
