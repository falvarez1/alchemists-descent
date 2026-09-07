---
name: deploy-game
description: Publish a branch of Alchemist's Descent to the public Cloudflare Pages site (https://alchemists-descent.pages.dev). Use when asked to deploy, publish, ship, or push a branch/commit live, or to check what the live site is running. Encodes the account, the wrangler that actually works, the clean-build recipe, and the hosted verification.
---

# Deploy the game to Cloudflare Pages

The public build is Cloudflare Pages project `alchemists-descent`, served at
https://alchemists-descent.pages.dev. The pages.dev root always serves the latest
deployment of the **production branch**, which is `main` on the Pages side — so
publishing ANY git ref means: build that ref, then deploy `dist` with
`--branch main`. The git branch name never reaches Cloudflare.

## Facts that cost real time to learn (read first)

1. **The project lives on the user's PERSONAL Cloudflare login**
   (frankishere@gmail.com), account **"Ajar Red"**,
   id `55c36c9de5247e3c193b45cdf43bb054`. The work login
   (falvarez@wsits.com, Advanta Health accounts) authenticates fine but CANNOT
   see the project — `wrangler pages project list` shows other projects or
   "Project not found". Always pass `CLOUDFLARE_ACCOUNT_ID` explicitly; the token
   spans several accounts and wrangler will otherwise ask interactively (and this
   shell has no stdin).
2. **Do not use the repo-local wrangler** (`npm run game:deploy`, wrangler 4.114).
   It crashes with `Host version "0.28.1" does not match binary version "0.25.12"`
   — its nested esbuild collides with vite's. Use the standalone one:
   `npx -y -p wrangler@4.129.0 wrangler ...` (npx caches it after the first run).
   If you must run it from the repo, still use `-p wrangler@4.129.0`.
3. **`wrangler login` needs the browser signed into the RIGHT Cloudflare account
   before you start it.** The OAuth page auto-approves for whoever the browser is
   logged in as. If `wrangler whoami` shows the wrong email: `wrangler logout`,
   ask the user to switch accounts in the browser, THEN start a fresh login (an
   auth page opened before the switch still carries the old identity).
   - Run login detached and poll its log; NEVER pipe it through `tail`
     (buffers the URL until exit) — see the helper below.
   - The callback listens on `localhost:8976`. A stale login process holds the
     port ("could not bind to localhost:8976"): find it with
     `netstat -ano | grep ':8976.*LISTENING'` and `taskkill //F //PID <pid>`.
   - Credentials persist in `%APPDATA%\xdg.config\.wrangler\config\default.toml`;
     once logged in as the right account, later deploys skip all of this.
4. **Publish the COMMITTED ref, from a clean checkout.** Branch worktrees are
   often dirty with WIP (`Y:\source\alchemists-descent-worktrees\<branch>`).
   Build in a detached worktree in the scratchpad; junction `node_modules` from
   the main checkout when `package.json`/`package-lock.json` are unchanged
   between refs (`git diff main <ref> --stat -- package.json package-lock.json`
   empty), otherwise `npm ci` there. Tell the user which commit shipped and
   whether uncommitted changes were left behind.
5. **Build with NO AuthorLink env.** `VITE_AUTHORLINK_RELAY` / `VITE_AUTHORLINK_TOKEN`
   are baked in at build time; a public build carrying them hands every visitor
   write access to the tuning room. The hosted probe asserts their absence.
6. **Verify the DEPLOYED site with `scripts/verify-hosted-game.mjs <url>`**, not the
   dev server — `window.__game` does not exist in production. It plays through the
   real UI and reads pixels. The probe handles both start flows (mode bar `PLAY` →
   run launcher, and the `living-descent` expedition-entry screen's
   `[data-entry="begin"]`); if a branch adds a new cold-load screen, extend the
   probe rather than skipping the check. Expect 13/13.

## Procedure

```bash
# 0. Identity (skip to step 1 if this already prints frankishere@gmail.com)
npx -y -p wrangler@4.129.0 wrangler whoami
#    wrong/none → node .claude/skills/deploy-game/login.mjs   (see login notes above)

# 1–4. Build the ref clean, run tests, deploy, verify — one helper does it all:
node .claude/skills/deploy-game/deploy.mjs <ref>          # e.g. feat/living-descent, main, a SHA
node .claude/skills/deploy-game/deploy.mjs <ref> --skip-tests   # when the suite already ran on that ref
```

What `deploy.mjs` does, in order (each step is also fine to run by hand):

1. `git worktree add --detach <scratchpad>/deploy-<sha> <ref>`; junction or `npm ci` node_modules.
2. `npm run build` with the AuthorLink env vars unset (tsc strict + vite build).
3. `npx vitest run` (unless `--skip-tests`).
4. `CLOUDFLARE_ACCOUNT_ID=55c3… npx -y -p wrangler@4.129.0 wrangler pages deploy dist --project-name alchemists-descent --branch main --commit-dirty=true`
5. Confirms https://alchemists-descent.pages.dev/ references the freshly built `assets/index-<hash>.js`
   (Pages is live within seconds; a mismatch means the wrong account or a preview branch).
   The hash differs on EVERY build of the same commit — `vite.config.ts` bakes a
   minute-stamped `__BUILD_STAMP__` in — so compare against your own build output, never
   against a hash from an earlier deploy. To learn what the live site runs, read the
   stamp (`git sha + time`) out of the served index chunk rather than matching hashes.
6. `node scripts/verify-hosted-game.mjs https://alchemists-descent.pages.dev` from the CURRENT
   checkout (not the shipped worktree — an older branch's probe may not know the newest
   cold-load flow; main's copy knows both).
7. Removes the junction (`cmd /c rmdir`, never `rm -rf` — it must not follow into the real node_modules) and the worktree.

## Reporting

Report: the commit that shipped (sha + subject), the three verification results
(build, tests, hosted probe N/N), and anything left out — uncommitted WIP not
published, a probe step you had to adapt. If `wrangler login` was needed, the
user had to click Allow; say which account ended up logged in.
