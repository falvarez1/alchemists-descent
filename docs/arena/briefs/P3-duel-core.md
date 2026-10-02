# P3-duel-core: two fighters in one world

**Goal (visible result).** In the Proving Yard, press **Add rival** in the panel (pick a fighter), and a second fighter, with
its own kit, wands, flask and look, stands in the hall. It is hurt by your spells, kicks, explosions, flames and kit effects
and it hurts you with its own; either of you can win a knockout. The rival is driven for now by a scripted input (a pluggable
`driver`), a second-keyboard scheme, or the probe; the AI package plugs its brains into the same seam.

**Worktree.** `Y:\Projects\alchemists-descent-worktrees\arena-duel` (branch `bw/arena-duel`, from `bw/fighters`). Dev
server: `npx vite --port 5203 --strictPort` from your worktree. Do not touch other worktrees or kill processes you did not
start. Run probes sequentially and never while editing `src`.

**Read first (all of it; it is a decision, not a suggestion).** `docs/arena/ARCHITECTURE.md` (decision D-001: slot swap +
proxy Enemy, the invariant "all proxies are visible except the bound slot's own", the seams in order, the risks),
`docs/arena/DECISIONS.md` D-001/D-004, `docs/arena/MASTER-PLAN.md` 3 (P3), `docs/arena/TASKS.md` (A3.1-A3.11),
`docs/arena/ARENA-RULES.md` 1 (the health duel), `docs/arena/WORKFLOW.md`, `docs/arena/TEST-PLAN.md`, `CLAUDE.md`,
`src/game/Game.ts` (ctx construction ~:218-352, the tick order ~:786-950), `src/entities/Player.ts`, `src/entities/Enemies.ts`,
`src/combat/Projectiles.ts`, `src/combat/wands/WandSystem.ts`, `src/fighters/FighterSystem.ts` and two kits, `src/render/FrameComposer.ts`,
`src/world/Camera.ts` (or wherever `Camera` lives), `src/world/fighterArena.ts`, `src/ui/FighterArenaPanel.ts`.

## You own (create)

- `src/arena/ArenaSlots.ts` (+ small files beside it: `slot.ts`, `proxy.ts`, `scopedBus.ts`, `rivalDriver.ts`)
- `src/world/duelStage.ts` or a `duel` mode in `fighterArena.ts` (a symmetric duel layout: two spawns facing each other, equal
  heights, the two potions mid-stage; see ARENA-RULES 1)
- `src/ui/ArenaRivalPanel.ts` (the Add rival / remove rival controls and a second health bar; mounted into the panel with a
  3-line hook)
- `tests/arena-slots.test.ts`, `scripts/verify-arena-duel.mjs`
- `docs/arena/ARCHITECTURE.md` updates (what you built; every deviation from the design and why; the risks you hit)

## You may touch (the seams of ARCHITECTURE.md 3, nothing else)

`src/core/types.ts` (the contracts, A3.1), `src/core/fighters.ts`, `src/content/enemyDefs`-style files for the `'fighter'` kind
(the only exhaustive `Record<EnemyKind,...>` maps), `src/game/Game.ts` (the rival loop, the sim-bounds union, camera targets),
`src/entities/Enemies.ts` (the redirect in `damage/kill/gustShove/splashHazard`, the AI-loop skip, `noteEnemyHurt`),
`src/combat/Projectiles.ts` and `WandSystem.markProjectile` (the `owner` stamp, per-projectile bind, enemy-index
invalidation, `interceptProjectile`), `src/entities/Player.ts` (**only** arena `kill`/`respawn` branches, `stunT`,
`STOMP_IMMUNE`; another package adds body-profile reads at the top of `update`: keep your edits away from those lines),
`src/fighters/FighterSystem.ts` (+ kits: a scoped `sys.on(...)`, `adopt()` under bind, Mara's hostile predicate),
`src/render/FrameComposer.ts`, the camera, `src/ui/FighterArenaPanel.ts` (the 3-line mount only), the files that scan
`ctx.enemies` (to skip or handle proxies: A3.11).

## Must not touch

The body-profile reads (another package), the AI (`src/arena/ai/**`), the telemetry (`src/fighters/telemetry/**`), the title menu.

## Contract to keep

- **Single-player must be byte-identical when no rival exists.** With one slot, `bind` is never called and the new branches
  are never taken. Every existing probe and the whole unit suite stay green at every commit. Prove it with
  `verify-fighter-framework`, `verify-fighter-run`, `verify-fighter-arena`, a normal campaign start.
- **Exactly-once damage.** The invariant of ARCHITECTURE 2. Your probe fires every damage path at the rival and at yourself
  and counts: spell projectile (spark, bomb, lightning, flame, frostshard), kick, explosion (bomb, the keg), fire and lava
  contact, a liquid (acid), a rigid body, Rusk's ram, Mara's chime, Ilyra's crucible, Sable's tether, Brann's plate eating a
  shot, Edda's prism. Each lands once, never on the caster, with the right knockback direction.
- No `Math.random` in `src/arena` or `src/fighters` (lint-enforced); keep `ctx.params.player` untouched (never write per-slot
  values into the shared `PLAYER_PARAMS`).
- Kit `create()` is asynchronous: `adopt()` must run under `bind(slot)`; every subscription of a per-slot object goes through
  the scoped bus so a rival's `flaskUsed`/`cardCast` never feeds the other fighter's passive.
- Respawn/death for slot >= 1 never writes gold, a checkpoint, a ragdoll or a `playerDied` event; slot 0 keeps campaign
  behaviour outside an arena match.
- Rotate which slot resolves first by tick parity (ARCHITECTURE 8).

## Steps (order matters; commit after each)

1. A3.1 contracts. 2. A3.2 `ArenaSlots` (slot record; `bind/with` that installs/restores player, playerCtl, input, wands,
   flask, fighters, chill and shows/hides own-slot proxies; proxy factory + sync + knock bridge; victim-side slow/stun).
   Unit-test it with fakes before touching the game (`tests/arena-slots.test.ts`). 3. A3.3 the scoped bus. 4. A3.5 the
   `Enemies` redirect and the AI-loop skip. 5. A3.6 projectile `owner` and per-projectile bind. 6. A3.7 the `Player` branches.
   7. A3.4 the `Game` loop and the sim-bounds union. 8. A3.8 render and camera (a leash: the 640x360 view must keep both
   fighters on screen; clamp the rival's spawn and the camera, not the view). 9. A3.9 the duel stage, the panel hook and the
   rival driver (a scripted rival: stand, turn to face, press Z/T on a timer, jump now and then; a `setRivalDriver(fn)` seam
   the AI package will call). 10. A3.10 the exactly-once probe and the full regression battery. 11. A3.11 the audit of the
   enemy scanners.

## Done when

- `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` clean.
- `node scripts/verify-arena-duel.mjs <url>` passes: add a rival, both fighters hurt each other through every path above,
  exactly once; a knockout ends the fight with a winner; removing the rival returns the single-fighter game to its previous
  state (no leaked proxies, listeners or bound state: assert the enemy count, the bus listener counts and `ctx.player`
  identity).
- You looked at screenshots of two fighters fighting (a contact sheet over time), with both visible, both animated, both with
  their own HUD feedback.
- The full battery of existing probes in TEST-PLAN 0 is green.

## Report back

Files; every deviation from ARCHITECTURE.md and why; the seams other packages must use (`bindSlot`, the rival driver seam,
the proxy API); the measured cost per tick of a second slot; what is not verified; the leaks you found in the enemy scanners.
