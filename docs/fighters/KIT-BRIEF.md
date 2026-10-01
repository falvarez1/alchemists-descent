# Building a fighter's kit: the working brief

You are implementing ONE fighter's passive, tactical (Z) and ultimate (T) in the real game. Read, in order:
`CLAUDE.md`, `docs/FIGHTERS.md` (the contract and YOUR fighter's spec), `src/core/fighters.ts`,
`src/fighters/kit.ts`, `src/fighters/FighterSystem.ts`, `src/fighters/effects.ts`, and
`scripts/fighter-probe.mjs` + `scripts/verify-fighter-framework.mjs` (the pattern for your probe).

## What you deliver

1. `src/fighters/kits/<id>.ts` exporting `kit: FighterKitDef` (plus helper modules next to it if it needs
   them, named `<id>-*.ts` so the glob in `kits/index.ts` does not pick them up as kits: it only loads files
   named exactly `<id>.ts`, so helpers MUST have a different name).
2. Pure-logic tests in `tests/fighters-<name>.test.ts` (node-only vitest; jsdom is not installed): the maths of
   your passive's state machine, a cooldown/charge interaction, anything that can be tested without a browser.
3. A live probe `scripts/verify-fighter-<name>.mjs` using `scripts/fighter-probe.mjs`: REAL key presses (Z, T),
   paused deterministic ticks, asserting each ability's OBSERVABLE effect in the real engine (cells in the grid,
   a foe's hp/position/status, the player's position/hp, the view's cooldown/charge), not just that a flag was
   set. Include the negative cases (refused with no room, cooling down, bar not full).
4. LOOK at it: take `shot()` screenshots of each ability going off (the harness pauses the world, so you can hold
   the frame), open the PNGs with Read and judge them as a player would. This is a showcase game and the owner
   prizes micro-interaction polish: every ability needs a tell, a sound, a visible effect and a clear end. Fix what
   looks wrong before you report.
5. `docs/fighters/<id>.md`: the final numbers, how each ability maps onto the grid, the engine seams you added,
   what you measured, and anything you could not verify.

## Rules of the repo that bite

- Cell ids are append-only (do not add a material unless the spec truly needs one; prefer existing cells).
- `@/` aliases, `import type`, TS strict, no `any` / `@ts-ignore`; lint is `--max-warnings=0`
  (`npx eslint <your files>`). Gameplay randomness is `entityRandom()` (world/foes) or `fxRandom()` (cosmetic),
  from `@/core/simRandom`; `Math.random` is a lint error under `src/fighters/`.
- If the grid can't explain it, it doesn't ship: write real cells (`stampDisc`, `world.replaceCellAt`) and let the
  sim do the rest. Never write `world.types[]` directly; `world.swap` is the only move primitive.
- Fail-open: nothing you write may be able to seal a route or hard-lock progression.
- Foes outside the sim window (camera +-60) freeze; keep probe subjects in view. The player is 17 cells tall:
  teleport targets need >= 24 cells of headroom. The arena in `fighter-probe.mjs` is already carved for you.
- Foes spawned by the harness are awake but unaggressive until told otherwise; set `alerted` / put the player in
  range when you need them to fight. A floor's first seconds are an arrival grace (the harness clears it).
- Shared files are shared: other engineers are editing `Enemies.ts`, `Player.ts`, `Projectiles.ts`, `Lighting.ts`
  etc. for other fighters at the same time. If you MUST touch an engine file, make the edit small, additive and
  guarded (`ctx.fighters?.x`, a no-op for the classic Alchemist), put it behind a seam on `FighterApi` if it is a
  new question the engine must ask, and list every such edit in your report. Never reformat a file you edit.
  Do not edit `FighterSystem.ts`, `kit.ts` or `core/fighters.ts` casually: if you need a new capability from the
  system (a new modifier field, a new hook), add it minimally, say so, and keep every existing test green.
- Audio: reuse existing cues (`src/content/audio/sfxCues.ts`). Do NOT generate new sound (it is paid).
- Do not touch the fighters' LOOK (art), the roster screen, the HUD chips or the run plumbing: other tracks own them.
- Scratch scripts: write them with the Write tool (shell quoting with `node -e` is fragile on this Windows box;
  `python3` hangs; foreground `sleep` is blocked). Run probes ONE at a time.

## Your dev server and worktree

You work in your own git worktree on your own branch (the prompt names them); `node_modules` is a junction to
a sibling worktree, so do NOT run `npm install` / `npm ci`. Start your own Vite from PowerShell, detached:
`Start-Process node -ArgumentList 'node_modules\vite\bin\vite.js','--port','<yourport>','--strictPort' -WorkingDirectory '<your worktree>' -WindowStyle Hidden -PassThru`
and note the PID. Kill ONLY that PID when you finish. Other dev servers (5173 = the main checkout, 5190 = the
`fighters` worktree, 5191 = another engineer) are not yours: never touch them. Pass your URL to probes as argv[2]
(`http://localhost:<yourport>/`). Do not edit `src` while a probe is running (Vite hot-reloads the page under it).

## Done means

`npx tsc --noEmit` clean; `npx eslint` clean on your files; your tests green; the full `npx vitest run tests`
green; `node scripts/verify-fighter-framework.mjs <url>` still 22/22; your probe green and repeated 3x without a
flake; screenshots looked at. Commit on your branch with the prefix `KIT <name>:` and the trailer
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do NOT merge into any other branch and do NOT push.
Report (under 700 words): files, seams touched, what each ability does in the grid, measured results, deviations
from the spec and why, and anything unverified.
