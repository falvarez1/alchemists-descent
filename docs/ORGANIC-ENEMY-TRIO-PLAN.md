# Organic Enemy Trio Plan

Status: implemented with generated encounter-lair follow-up
Created: 2026-06-28

This plan adds three grid-native enemies in priority order:

1. `rootloper` - Tanglewrist Root Loper
2. `stonemaw` - Stone Maw
3. `rillback` - Rillback Silt Eel

The goal is not to add three more health bars. Each enemy must move like a living
thing, read the cave through real cells, write limited real changes back into the
world, and create situations the player can exploit.

## Design Constraints

- If the grid cannot explain it, it does not ship.
- Prefer existing cells. This wave uses no new material IDs.
- All terrain writes must be capped, local, and fail-open.
- Enemy behavior must survive the normal runtime contracts: enemies live in the
  shared mutable enemy array, systems communicate through `Ctx`, and generated
  per-level state must use `LevelRuntime` if it must survive leave-and-return.
- A generated structure may never become a progression dependency unless it
  passes findability and has a non-enemy fallback.
- Each enemy needs authored body language: anticipation, commitment, recovery,
  and a readable environmental tell.

## Implementation Surface

- `src/core/types.ts`
  - Append enemy kinds to `ENEMY_KINDS`.
  - Add optional per-kind animation/AI state fields to `Enemy`.
- `src/content/enemyDefs.ts`
  - Add HP, footprint, bounty, and gore material.
- `src/entities/Enemies.ts`
  - Add AI branches and any helper samplers.
  - Keep terrain writes bounded and frame-cadenced.
  - Do not reorder the main frame contract.
- `src/render/sprites/EnemySprites.ts`
  - Add procedural sprites with stateful animation where useful.
  - Sprite mutation is allowed here because it matches the current pattern.
- `src/world/biomeExtras.ts`
  - Add biome weights carefully; these enemies should be seasoning, not noise.
- `src/content/entityProfiles.ts`
  - Add Codex/profile copy so the registry remains complete.
- `tests/`
  - Add focused AI/cell-interaction tests where direct unit seams exist.
- `scripts/`
  - Add a browser probe for the trio or focused probes per enemy if needed.

## Enemy 1: Tanglewrist Root Loper

### Role

An overgrowth predator for Fungal Deep and Timberworks. It is the recommended
first implementation because it has the clearest movement fantasy and the
lowest new-systems burden.

### Body And Movement

The Root Loper has a narrow body suspended by six root-arms. It does not simply
walk. It plants tendrils into `Vines`, `Moss`, `Fungus`, `Grass`, `Wood`, and
solid ledges, stretches forward, then releases rear anchors late.

Readable movement beats:

- idle: tendrils search nearby growth and tap the ground;
- prepare: anchor cells pulse with vine/fungus particles;
- pull: body elongates and slides toward the best anchor;
- stumble: severed or burned anchors make it sag and lose speed;
- strike: front tendrils tense before a short lash.

### Grid Logic

The Root Loper samples a small box around its feet and hands for soft growth.
It prefers paths with `Vines`, `Moss`, `Fungus`, `Grass`, and `Wood`.

It may stamp a small number of soft-growth cells while calm or while stabilizing
itself:

- `Vines` on walls and ceilings;
- `Moss` or `Fungus` on open ledges;
- never `Wall`, `Stone`, `Metal`, or new materials;
- never in a player body box;
- capped per enemy lifetime and frame-cadenced.

### Combat And Counterplay

- short-range lash hit, not a full capture mechanic;
- burn/fire clears its anchors and briefly panics it;
- acid/toxic cells cut its anchor confidence;
- water and mossy terrain improve its footing;
- killing it leaves `Vines`/`Fungus`/`Blood` gore, not a permanent blocker.

### Level Mechanics

Root nurseries can be optional pockets with denser vines, fungus, and a small
reward. The enemy can grow useful ladders or bridges, but no progression route
may depend on it being alive.

### MVP

- One enemy kind `rootloper`.
- Growth-aware movement on normal walker physics.
- Local soft-growth stamping.
- Lash attack.
- Procedural tendril sprite.
- Fungal/Timber weights.
- Runtime probe: burn anchors, water/moss footing, lash telegraph, growth cap.

## Enemy 2: Stone Maw

### Role

A blind burrowing predator and living terrain tool. It is the most systemic
concept, but it has higher risk because it mutates terrain.

### Body And Movement

The Stone Maw is a thick segmented worm. Its head is heavy and blunt; its body
compresses before pushing through soft rock. It should feel like pressure moving
through the cave.

Readable movement beats:

- listen: head plants against stone and pauses;
- windup: mouth plates open, dust leaks from the target wall;
- chew: a short local tunnel brush opens cells in front of it;
- breach: it bursts into open air and recoils;
- stun: frozen, acid-hit, or overextended Maw curls defensively.

### Grid Logic

The Maw targets vibration sources:

- nearby player movement;
- explosions or projectile impacts if surfaced through existing event seams;
- fallback: player proximity and line-of-cave reach.

It may chew only a bounded set of cells in front of its mouth:

- allowed: `Wall`, `Stone`, `RawOre`, `Coal`, small amounts of `Sand`/`Ash`;
- converted output: mostly `Empty`, with a small spill of `Sand`, `Ash`, or ore;
- forbidden: `Metal`, `Glass`, mechanism-critical cells, well/waystone areas;
- cadence: low-frequency chew ticks, not per-frame excavation.

### Combat And Counterplay

- dangerous bite at the mouth only;
- body bumps but is not a constant contact blender;
- metal plates stop it;
- freeze or acid stuns it;
- thrown explosives/noise can bait it into opening shortcuts;
- if it dies inside stone, it opens a small pocket rather than sealing a route.

### Level Mechanics

Maw nursery pockets can place one Maw near ore-rich walls. These are optional.
The enemy should never be required to open the critical path. If it opens a
hazard, that is acceptable; if it destroys a lock, the lock must fail open by
the existing mechanism rules.

### MVP

- One enemy kind `stonemaw`.
- Normal entity movement plus a short burrow/chew state.
- Local terrain brush with forbidden-cell guards.
- Vibration approximation from player distance and recent damage/noise if easy.
- Earthen/Crystal/Volcanic sparse weights.
- Tests for "never eats Metal" and bounded terrain mutation.

## Enemy 3: Rillback Silt Eel

### Role

A smaller, non-boss aquatic predator. It should not compete with the Leviathan.
It is a pool ecology enemy: scary in connected liquid, clumsy when beached, and
useful when exploited as a living conductor.

### Body And Movement

The Rillback is a chain-bodied eel. Its head aims, body segments follow with
lag, and the tail over-corrects. In water it swims as an S-curve. On soaked
ground it peristaltic-crawls. On dry ground it flops and loses threat.

Readable movement beats:

- submerged idle: bubbles and a dark coil under the surface;
- hunt: head tracks vibration while the body ripples behind;
- lunge: head locks to a shore/wall for a suction snap;
- beached: frantic low hops with poor steering;
- shock: water around it flashes before its charge pulse.

### Grid Logic

The Rillback samples liquid around its body:

- strong in `Water`, `Blood`, `Slime`, and shallow mixed pools;
- hurt or repelled by `Lava`, `Acid`, and deep `Toxic`;
- weak on dry cells;
- can briefly add charge to adjacent conductive liquid, but the charge decays.

It may disturb soft pool boundaries:

- occasional sand/silt dislodges at pool edges;
- no freeform tunneling;
- no required circuit may depend on the eel.

### Combat And Counterplay

- bite/lunge while wet;
- weak flop damage on land;
- drain, freeze, beach, or electrify the pool;
- bait it into powering optional charge latches;
- metal cups, dry trenches, and stone barriers are reliable player tools.

### Level Mechanics

Rillback pools can appear in Flooded Caverns and rare fungal sump rooms. A pool
may include optional charge-latch loot, but there must be a fallback spark or
player-powered solution.

### MVP

- One enemy kind `rillback`.
- Reuse or adapt Leviathan water sampling without boss behavior.
- Segment-follow animation state for the sprite.
- Short charge pulse in adjacent liquid.
- Flooded sparse weights.
- Probe for wet strength, dry weakness, and charged-water interaction.

## Verification Plan

Static validation:

- `npm run typecheck`
- `npm test`
- `npm run build`

Targeted tests:

- enemy definitions and registry completeness;
- Root Loper soft-growth cap and fire/acid counterplay;
- Stone Maw forbidden-cell guard, especially `Metal`;
- Rillback wet/dry behavior and charge pulse bounds.

Runtime probes:

- spawn all three enemies in controlled arenas through `window.__game.ctx`;
- paint exact cells around them and poll across frames;
- verify rendered body is nonblank and state changes are visible;
- verify no probe relies on single-frame liquid/fire behavior;
- run the normal findability audit if any generated structure is added.

## Generated Encounter Lairs

The shipped follow-up adds one optional real-cell lair on signature depths:

- `rootloper` grove in `fungal` and `timber` levels;
- `rillback` pool in `flooded` levels;
- `stonemaw` seam in `crystal` and `volcanic` levels.

The lair pass runs inside `generateLevel` after mineral-vug fill. It uses the
shared `PlacementLedger`, rejects `Metal`, avoids spawn/exit/reserved regions,
connects the stamped pocket to the main cave graph with `connectToCaves`, and
recomputes graph/fit data before downstream generation consumers. Each lair
adds a deferred prefab enemy record plus a `placedPrefabs` footprint for tests,
runtime inspection, and probes.

Validation coverage:

- `tests/gen-level-golden.test.ts` locks the new full-level hashes and checks
  every signature depth across seeds `1`, `42`, and `1337`;
- `scripts/verify-encounter-lairs.mjs` enters campaign levels in browser,
  checks the live footprint, resident enemy, habitat cells, no-Metal guard, and
  shared findability errors across seeds `1`, `5`, `1337`, and `42`;
- `npm run verify:runtime` includes the encounter-lair probe.

## Rollout Order

1. Add docs and enemy contract entries.
2. Implement Root Loper fully.
3. Implement Stone Maw with conservative terrain writes.
4. Implement Rillback as a small aquatic enemy, not a boss.
5. Add tests and browser probes.
6. Run static and runtime validation.

## Explicit Non-Goals

- No new material IDs in this wave.
- No player capture/rope physics for Root Loper MVP.
- No unrestricted tunneling for Stone Maw.
- No required eel-powered circuit.
- No endless enemy spawners.
