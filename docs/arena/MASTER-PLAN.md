# The arena programme: master plan

**Status: planning (2026-10-01).** This is the entry point. It states the vision, the phases with their exit criteria, the
dependencies and the risks. The detail lives in the documents it links; the checklist lives in `TASKS.md`; the reasons behind
choices live in `DECISIONS.md`.

## 1. Vision

> **A Super-Smash-Bros-style arena in a falling-sand world.** Ten fighters, each with its own *body* (weight, speed, traction,
> jump, gravity, levitation), its own *techniques* (a way of moving no one else has), its own *spells and weapons*, and its own
> *effects*, fight on destructible stages with real physics. Computer fighters play any of them well enough to be a
> worthwhile opponent *and* a balance instrument. Every fight can be recorded, reviewed, and analysed in bulk so the whole
> roster can be tuned until each fighter wins by being itself.

### Pillars

1. **Distinct.** Two fighters differ before they press an ability. (`ROSTER-IDENTITY.md`, `FIGHTER-PHYSICS.md`)
2. **Real.** The grid explains everything (CLAUDE.md): smoke is smoke, a barricade burns, a ring-out is a body leaving a box.
3. **Measured.** Nothing is balanced by feel alone; every number that matters is exposed, ranged and tuned from data.
   (`TELEMETRY-AND-BALANCE.md`)
4. **Fair to play against.** The AI uses the same inputs and the same senses as a person. (`AI-FIGHTERS.md`)
5. **Always finishes.** Every match has a stalemate answer. (`ARENA-RULES.md`)

## 2. What exists today (2026-10-01)

- Ten fighters on branch `bw/fighters`: looks, kits (a passive, Z, T), a roster screen, HUD chips, per-fighter probes, all
  verified against real foes; the **Proving Yard** (`world/fighterArena.ts`, level `fighter-test`): a test hall with seven
  stations, a panel that steps through the fighters and ticks off their moves, foe presets, tools. Fighters are *not* in the
  campaign (the arena mode is their home).
- **Missing, in priority order of the vision:** a body per fighter (every fighter has the Alchemist's physics); unique
  techniques; a second combatant (the engine has one player, `ctx.player` is read from 134 files); AI fighters; match
  rules; telemetry; signature weapons.

## 3. The phases

Each phase ends in something the user can *see in the Arena* and a probe that proves it. Letters are tracks that can run in
parallel; arrows are dependencies.

```
P0  Plan & docs  ---------------------------------------------------------------- (this folder)
P1  Bodies         P1a BodyProfile seam + ten bodies + Body card/movement lab      -> visible: fighters MOVE differently
                   P1b ten movement techniques (Glide, Hover, Wall-run, Dash, ...)  -> visible: each has a way of moving
P2  Telemetry      recorder, instrumentation, paramOverride, batch runner,          -> visible: a report from 200 gauntlet fights
                   analyser (on fighter-vs-foe gauntlets; PvP-ready schema)
P3  Combatants     D1: slots + proxy enemies + duel stage + second fighter          -> visible: two fighters hurt each other
                   (human on a second input, or scripted)                             depends on P1a (the Player.ts seam)
P4  AI             v0 dummy -> v1 approach/attack -> v2 playbooks -> (v3 stocks)    -> visible: bots fight in the Arena
                   v0-v1 can start before P3 (drive slot 0 against foes)              depends on P3 for bot-vs-bot
P5  Match rules    health duel -> volatility, DI, blast zones, stocks, respawn,     -> visible: a Smash-feel match with ring-outs
                   collapse; multi-target camera; sim-window union; stage 2          depends on P3
P6  Movesets v2    signature loadouts, signature primaries (Brann, Rusk first),     -> visible: each fighter ATTACKS differently
                   direction variants, universal defence (decision D-006)             depends on P1, P3
P7  Balance        matchup matrix, the tuner (`fight-tune`), baseline reports,       -> visible: a roster inside 42-58%
                   the fight-review overlay, Node HeadlessGame (optional)             depends on P2, P3, P4
```

### P1: bodies (the next thing to build)

- **P1a** (`FIGHTER-PHYSICS.md`): the `BodyProfile`, the ten bodies as data, the `Player.ts` reads (about 35 lines), `dealt` and
  `mass` seams, the Body card and the movement readout in the panel, the hall's height ruler and run lane, a test and a
  probe that orders the roster by measured speed, apex, fall and knockback.
- **P1b** (`FIGHTER-PHYSICS.md` 3, `ROSTER-IDENTITY.md`): each fighter's movement technique, built from `FighterMod` +
  `startMove`, with a probe per technique.
- **Exit:** in the Yard, switching fighters with `[` and `]` changes how the body feels, the numbers confirm it, and the
  Alchemist control is byte-identical to today.

### P2: telemetry (independent of P3; start in parallel with P1)

- Instrumentation at four sites, the recorder, `paramOverride`, the batch runner on gauntlets, the analyser, the dev endpoint
  (`TELEMETRY-AND-BALANCE.md` 3).
- **Exit:** `node scripts/fight-batch.mjs --gauntlet --fights 200` writes a run directory and
  `node scripts/fight-analyse.mjs <run>` prints a report that shows, per fighter, damage per second, time-to-kill, ability
  uptime and a movement profile; the replay-match rate and ticks-per-second are *measured* and written in the report header.

### P3: combatants (the long pole; D-001)

- Contracts, `ArenaSlots`, the `Game` loop, the `Enemies` redirect, `Projectiles` owner stamps, `Player.ts` arena
  kill/respawn, render and camera, the duel stage (`ARCHITECTURE.md` 3).
- **Exit:** in the Yard, two fighters (keyboard for one, a scripted input for the other) each hurt the other with spells,
  kicks, explosions and their kit; damage is exactly-once (a probe fires every damage path and counts); a fight ends on a
  knockout and reports the winner; the single-fighter game and every existing probe are unchanged.

### P4: AI

- v0 (the dummy) and v1 (approach, aim with lead, fire, kick, jump a slab) on slot 0 against foes; v2 playbooks and skill
  tiers; v3 stocks (recovery, edge-guard). (`AI-FIGHTERS.md` 7)
- **Exit:** two bots, any two fighters, fight to a result in the Yard with a result card; a bot level 5 beats level 1
  >= 85% of the time; no stuck bot in a 1,000-fight soak.

### P5: match rules

- The health duel first (needed by P4's first bot fights and P2's first PvP data), then volatility, DI, blast zones, stocks,
  respawn platforms, the collapse, the multi-target camera. (`ARENA-RULES.md`)
- **Exit:** a stock match plays start to finish; sudden death ends every stalemate; a mirror test (swap the sides) changes
  nothing beyond noise.

### P6: movesets v2 (`MOVESETS-V2.md`), P7: balance (`TELEMETRY-AND-BALANCE.md` 3.6-3.8)

- **Exit (P7):** a 200-fights-per-pair batch puts every fighter between 42% and 58% overall and every matchup inside 30-70%,
  each fighter's fingerprint (`ROSTER-IDENTITY.md`) shows up in the data, and a person watching two bots with the HUD off can tell
  the fighters apart by movement.

## 4. How the work is organised

- One long-lived branch `bw/fighters` (this one), **short-lived worktrees per work package** under
  `Y:\Projects\alchemists-descent-worktrees\` (`WORKFLOW.md`), merged back one at a time with the full checks.
- **Parallelism is capped at 3-4 agents at once**: the machine has already been stopped once by memory pressure while
  running probes. Each agent runs its own Vite server on its own port and runs probes **sequentially**.
- Each work package has a **brief** in `docs/arena/briefs/` (scope, the files it owns, the contract it must keep, the probe it
  must pass) so any agent, or any session, can pick it up cold.
- The merge order that avoids conflicts: P1a first (a small `Player.ts` seam everything else reads), then P2 and P3 and P4-v0
  in parallel (they touch different files), then P1b, then P5, P6, P7.

## 5. Risks (the top ones; the full lists are in the linked documents)

| # | Risk | Mitigation |
|---|---|---|
| 1 | The slot swap breaks a shared system (the event bus double-fires; the enemy index goes stale; a module singleton leaks) | scoped registrations from day one; the "every damage path, exactly once" probe; the single-player probes stay green at every merge (`ARCHITECTURE.md` 5, 9) |
| 2 | Whole-tick replay is not exact | statistics, not replays; measure the match rate first (`TELEMETRY-AND-BALANCE.md` 2) |
| 3 | The bot is the instrument: weak bots make strong fighters look weak | report per brain and level; compare against hand-recorded human fights; expert scripts for the hard kits |
| 4 | The fixed 640x360 view limits a duel's spread | a leash and a smaller duel stage first; renderer zoom is its own project |
| 5 | Hitbox variation is a 70-site, 24-file change with a fixed rig | not promised; bodies carry the identity (weight, speed, jump, levitation); halfW later |
| 6 | Balance numbers drift from live play (paused-step vs the real loop) | a live validation sample in every balance pass |
| 7 | Scope: ten fighters x five layers is a lot | the order above, ruthless cuts (direction variants and universal defence are optional), every phase ends in something visible |
| 8 | A merge to main deploys the game | nothing here merges to main without an explicit go-ahead; arena content is authoring-only until then |

## 6. Definition of done for the programme

- Ten bodies and ten techniques, verified by probe.
- Two fighters fight in the Yard, human or bot, with exactly-once damage, ring-outs and stocks.
- A bot plays every fighter in its style at five skill levels.
- Every fight can be recorded; a report ranks the roster; the tuner emits a patch; the roster sits inside the balance targets.
- Every claim above has a test or a probe; `docs/arena/TASKS.md` is fully ticked or explicitly cut with a reason in
  `DECISIONS.md`.

## 7. Documents

| File | What |
|---|---|
| `README.md` | the index |
| `MASTER-PLAN.md` | this |
| `TASKS.md` | the checklist, by phase, with ids |
| `DECISIONS.md` | the decision log (D-001...) |
| `ARCHITECTURE.md` | two fighters in one world (slots + proxies) |
| `FIGHTER-PHYSICS.md` | the `BodyProfile`, the bodies, the movement lab |
| `ROSTER-IDENTITY.md` | what makes each fighter different; fingerprints; the distinctness checklist |
| `MOVESETS-V2.md` | signature loadouts, weapons, techniques, variants |
| `AI-FIGHTERS.md` | the bot: layers, tiers, playbooks, milestones |
| `ARENA-RULES.md` | health duel, stock match, volatility, collapse, stages |
| `TELEMETRY-AND-BALANCE.md` | recording, batch fights, analysis, the tuner, review |
| `TEST-PLAN.md` | the probes and tests per phase |
| `WORKFLOW.md` | how to work on it (worktrees, ports, probes, merges) |
| `briefs/` | one self-contained brief per work package |
