# Working on the arena programme

How to pick up a work package without breaking anything, in a session or as an agent. Written from what went wrong and right
on `bw/fighters` (the fighter roster, the title menu, the Proving Yard).

## 1. Where things live

- The long-lived integration branch is **`bw/fighters`**, checked out at
  `Y:\Projects\alchemists-descent-worktrees\fighters` (dev server `:5190`). The user's own checkout is
  `Y:\Projects\alchemists-descent` (`main`; another session may be editing it: never work there).
- A work package gets its **own worktree and branch**: `git worktree add Y:\Projects\alchemists-descent-worktrees\arena-<wp> -b
  bw/arena-<wp> bw/fighters`. Never loose in `Y:\Projects`. Remove merged ones.
- `node_modules` in a worktree: a junction to the `fighters` worktree's (`mklink /J`); remove the junction with
  `cmd //c rmdir <path>\node_modules` **before** `git worktree remove` (a plain delete follows the link and empties the real one).
- Each worktree runs its **own Vite server on its own port** (`npx vite --port 52NN --strictPort`; `:5190` is the
  integration branch). After an `npm install`/upgrade restart with `--force`.

## 2. The loop for one work package

1. Read the brief (`docs/arena/briefs/<id>.md`) and the documents it links. The brief names **the files you own**, the
   **contract you must keep** and **the probe you must pass**.
2. Work in your worktree. Match the surrounding code's comment density and naming (CLAUDE.md "Write code that reads like the
   surrounding code"). Cell ids are append-only; use `@/` aliases and `import type`; TypeScript strict with no `any` or
   `@ts-ignore`; **no `Math.random` in `src/fighters` or `src/arena`** (lint-enforced: use `entityRandom`/`fxRandom` or a
   seeded `Rng`); entity arrays are mutated in place.
3. Verify in the **real game**: `npx tsc --noEmit`, `npm run lint` (CI lints tests and scripts too), `npx vitest run`,
   `npm run build`, then your probe and the gates in `TEST-PLAN.md` 0. Look at screenshots; a green probe is not enough for
   anything visual.
4. Commit in small steps with the trailer
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Tick the task ids in `TASKS.md` in the same commit.
5. Merge into `bw/fighters` **one package at a time**, rebase or merge `bw/fighters` into your branch first, rerun the gates.
   Resolve conflicts by keeping both sides' intent (the usual conflicts: `types.ts`, `Player.ts`, `Game.ts`, the title).
6. Write what you learned into the memory notes or the docs (`docs/arena/DECISIONS.md` for a decision; the package's own doc
   for numbers and measurements), including **what is not verified**.

## 3. Hard rules

- **Never** merge to `main` or push without the user's explicit go-ahead (a push to `main` deploys the public game).
- **Never** edit `builder.html` by hand (`npm run gen:builder-html`); never renumber or reuse cell ids.
- **Kill only your own processes.** Another session's dev server is not yours. (The user may ask you to kill all of them:
  then do it, after listing them.)
- **Memory:** at most 3-4 agents at once (D-008). A background probe batch can be stopped by system memory pressure; if it
  is, do not start it again on your own; report it.
- Probes run **sequentially** and never while `src` is being edited in that worktree (HMR reloads the page).
- The shell on this box is Git Bash + PowerShell: write scripts with the Write tool (quoting `node -e` and heredocs with
  backslashes or apostrophes is fragile); `python3` hangs (Store stub); foreground `sleep` is blocked (use a background
  command that waits).
- Repo files are CRLF in the working tree: use a CRLF-aware patch helper for multi-line edits.

## 4. Brief template (`docs/arena/briefs/<id>.md`)

```
# <id>: <title>
Goal (one sentence, visible result):
Read first: <docs and files>
You own (create/edit): <files>
You may touch (small, named seams only): <file:function>
You must not touch: <files>
Contract to keep: <interfaces, invariants, "the classic Alchemist stays byte-identical">
Steps: 1... 2... 3...
Done when: <the probe, the test, the screenshot, the numbers>
Report back: <what to tell the integrator: files, decisions, what is NOT verified>
```

## 5. Integration order (to avoid conflict hell)

P1a (the `Player.ts` body seam) -> P2, P3, P4-v0 in parallel (different files) -> P1b -> P5 -> P6 -> P7. If two packages must
touch the same file, one of them owns it and the other sends a patch request in its report.
