# P4-ai-v0-v1: a computer fighter that fights in the Proving Yard

**Goal (visible result).** In the Proving Yard, press **Bots** in the panel, pick a brain and a level, and watch the fighter
you are holding play itself against foes: it walks to a good range, aims with lead, fires its wand, kicks when adjacent,
jumps a slab to reach a foe, and uses Z and T when they make sense. Same inputs and same senses as a person. Works for
all ten fighters (the shared v1 behaviour; per-fighter playbooks come later).

**Worktree.** `Y:\Projects\alchemists-descent-worktrees\arena-ai` (branch `bw/arena-ai`, from `bw/fighters`). Dev server:
`npx vite --port 5202 --strictPort` from your worktree. Do not touch other worktrees or kill processes you did not start. Run
probes sequentially and never while editing `src`.

**Read first.** `docs/arena/AI-FIGHTERS.md` (your spec), `docs/arena/MASTER-PLAN.md` 3 (P4), `docs/arena/TASKS.md`
(B4.1-B4.4, B4.7, B4.9), `docs/arena/ARCHITECTURE.md` 4 (what a slot's input is), `docs/arena/WORKFLOW.md`,
`docs/arena/TEST-PLAN.md`, `CLAUDE.md`, `src/core/types.ts` (`InputState`, `PlayerState`), `src/input/InputManager.ts`,
`src/entities/Player.ts` (how input is read: `ctx.input` keys/mouse and `player.firing`, `aimAngle`), `src/fighters/FighterSystem.ts`
(`press`, `view`), `src/ui/FighterArenaPanel.ts`, `src/world/fighterArena.ts`, `src/content/fighterArena.ts`,
`scripts/verify-fighter-arena.mjs`.

## You own (create)

- `src/arena/ai/brain.ts` (the `Brain` interface: `think(ctx, self, tick): void` writes into an `InputState`; `BrainId`),
  `worldView.ts`, `control.ts`, `execution.ts` (reaction delay, aim error, decision interval, mistakes: seeded `Rng`),
  `intent.ts` (a small utility chooser: `approach`, `retreat`, `zone`, `pressure`, `reposition`), `nav.ts` (`StageNav` for the
  Yard: nodes and links with walk/jump/levitate edges, hand-authored from `YARD` constants), `brains/dummy.ts` (v0),
  `brains/basic.ts` (v1), `index.ts` (registry), `driver.ts` (installs a brain on a slot: for now slot 0 = the player)
- `src/config/aiTiers.ts` (the five skill levels of AI-FIGHTERS.md 2, live-tunable data with ranges)
- `src/ui/ArenaBotsPanel.ts` (the Bots section: brain, level, an `intent -> target, rule` line) mounted into the panel with a
  3-line hook
- the console command `ai <off|dummy|basic> [level]` in `src/game/console/ai.ts` (+ registration)
- `tests/ai-*.test.ts`, `scripts/verify-ai-basic.mjs`
- `docs/arena/AI-FIGHTERS.md` updates (what you built, what differs from the design, the measured quality numbers)

## You may touch (small, named seams only)

- `src/input/InputManager.ts`: an `externalControl` flag so the keyboard and pad **stop writing** `ctx.input` and the player
  while a brain drives slot 0 (and a clean hand-back); Escape/pause and the panel keys `[`/`]` keep working
- `src/ui/FighterArenaPanel.ts`: only the 3-line mount of `ArenaBotsPanel` (another package edits this file: keep your edit tiny)
- `src/game/Game.ts`: one call that runs the driver each fixed tick before `playerCtl.update` (a hook, not logic)

## Must not touch

`src/arena/ArenaSlots.ts` and any other `src/arena/*.ts` except `src/arena/ai/**` (the duel package owns them),
`src/entities/Enemies.ts`, `src/entities/Player.ts`, `src/combat/**`, `src/fighters/kits/**`, the title.

## Contract to keep

- **No cheating.** A brain writes keys, the mouse (world x,y), `firing` and the press edges for Z/T/kick/flask, exactly as the
  input layer does; it never sets `player.x/vx`, never reads hidden state a person cannot see. Perception goes through the
  game's own concealment/visibility rules where they exist (`Enemies.ts` `observedPlayer` for what *foes* see; for what a *bot*
  sees of foes, foes are visible unless `sleeping` and out of line of sight: keep it simple in v1, document it).
- Deterministic: its own `new Rng(hashSeed(seed,'bot',slot))`; never `entityRandom`; no wall clock; no `Math.random`
  (lint-enforced in `src/arena`: add `src/arena/**` to the ban in `eslint.config.mjs` if it is not there).
- The classic Alchemist, the campaign and all existing probes stay green; with no brain installed nothing changes.
- Presses are edges with the engine's `pressWindow` (8 ticks): press and release like a hand.
- `ctx.input` for slot 0 must be handed back to the keyboard cleanly when the brain is switched off or the level changes.

## Steps

1. `Brain`, `InputState` writing, `driver`, `externalControl` (B4.1). 2. v0 dummy + the Bots panel + `ai` command (B4.2): stands,
   presses Z/T on a timer, aims at the nearest foe. 3. WorldView, Control (steering **with traction awareness**: heavy and
   slidey bodies brake differently, so brake by predicted stop distance from the live velocity; aim with lead), Execution noise,
   tiers (B4.3). 4. v1 (B4.4): preferred-range approach/retreat from per-brain archetype weights, wand fire when aligned, kick
   when adjacent, jump over a slab or levitate onto a ledge using `StageNav`, Z/T heuristics by simple rules (Z when a foe is
   within the fighter's tip range, T when 3+ foes or health is low); a stuck detector (same place 3 s while the goal says move)
   that picks a new waypoint. 5. The overlay (B4.7): draw the intent label and aim line in the panel/world (a small
   `FighterDrawable`-style overlay or DOM, your choice). 6. Tests and the probe (B4.9).

## Done when

- `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` clean.
- `node scripts/verify-ai-basic.mjs <url>`: for **each of the ten fighters** a level-3 `basic` brain, with the keyboard
  detached, clears a 2-slime + 1-golem ring wave within 40 s on 3 seeds (report the clear rate; target >= 80%), never idles
  more than 2 s with foes alive, uses its tactical at least once, and hands the keyboard back cleanly.
- Level 5 clears faster than level 1 (median time) for at least 8 of 10 fighters.
- You watched at least one fight in screenshots across time (a contact sheet) and the movement is not jittery.

## Report back

Files; the measured clear rates and times per fighter; what was hard (the fighters that fight badly under `basic` and why);
the `Brain`/`driver` API another package (the duel and the telemetry batch runner) must use; what is not verified.
