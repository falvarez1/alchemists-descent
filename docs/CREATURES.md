# Creatures — the Rain World layer

The enemy roster is drawn and animated by a physical body layer, not sprites.
Gameplay still owns every creature through its AABB (`e.x/e.y`, `ENEMY_DEFS`
halfW/h) and the per-kind AI in `entities/Enemies.ts`; hits, collision, damage
and saves are unchanged by anything here. What changed is what that body
*looks like* and how the world answers it.

## Art direction

- **Silhouette first, dark bodies, one loud accent.** Like Rain World's lizards:
  a charcoal body you half-see in the gloom and a signature colour you always
  see (the spitter's acid head, the weaver's silk-green sigil, the leviathan's
  lure). Accents are emissive and feed bloom and the light field.
- **Smooth volumes, not scribbles.** Bodies are tapered tubes, ellipsoids and
  pillowed polygons with blended joins; detail is painted *into* the volume
  (tone, glow stamps), never drawn as loose lines on top.
- **Lit by the room.** The key light's direction comes from the real light
  field around the body, so a creature beside the wizard's wand is rim-lit
  from the wand side. Self-lit species (`selfLit`) read the field with their
  own glow's hue muted.
- **Glass where it should be.** Gel, jelly bells, wing and fin membranes are
  translucent (premultiplied alpha through the compose shaders); emissive glass
  keeps its own light.

## Motion principles

- **Physics chunks.** Rig points are verlet with cell collision, liquid drag
  and buoyancy (`creatures/rig/physics.ts`). They ride the gameplay body on
  springs, so they lag, overshoot, sag and drape — the hitbox never moves.
- **Legs grip real ground.** `rig/limb.ts`: a foot stays welded to its grip
  until the hip outruns it, then arcs to a freshly searched grip. Gait falls out
  of reach + "don't lift while the partner is up".
- **Chains carry momentum.** Tails, tentacles, cloth, wicks, lures
  (`rig/chain.ts`, follow-the-leader verlet with bending and curl; FABRIK
  `reachChain` for grabbing roots and lashes).
- **Gel is gel.** `rig/softbody.ts`: pressurised ring with shape matching —
  squash on landing, stretch in flight, dent where it is hit.
- **Anticipation from the attack clock.** Tells read existing AI state
  (`attackCd`, `windup`, `recoil`, `blink`, `fusing`…) — no AI change needed
  for a spitter to rear and swell its throat before it spits.
- **Blows land on the body.** `species/index.ts answerHit`: every chunk takes
  the knockback impulse; chains whip; gel dents.

## Where things live

| Module | Owns |
| --- | --- |
| `creatures/rig/*` | Physics primitives (points, chains, legs, soft bodies) and the `CreatureRig` container on `Enemy.rig` |
| `creatures/species/*` | One body plan per file: build + tick-rate step. `index.ts` is the registry `tickCreaturePose` calls |
| `creatures/worldTouch.ts` | Footfalls by surface (dust, spores, leaf flecks, splashes, snow prints, sand flicks, blood tracks, kicked debris, step sounds), surface splashes for any rig part, ploughed powder, gel tracks |
| `creatures/corpses.ts` | Physical remains: limp rig falls/drapes/floats, lights gutter, flies arrive, remains melt into their gore material and leave kickable bones |
| `render/creatures/raster.ts` | The rasterizer (primitives, `shade`/`glowStamp`/`stamp` painting, lighting, sel-out, glass, `blitFine`) |
| `render/creatures/<species>.ts` | Art per body plan: materials (OKLab ramps) and primitives from the rig |
| `render/creatures/lights.ts` | Light seeds from rig positions (lure tips, sacs, cores), corpses included |
| `render/creatures/eyeshine.ts` | Light wave: eyeshine at the eyes species mark (`anatomy.markEye`), glow markings (Weaver leg tips, Rillback lateral line, slime cores, Stone Maw jaw seams) and the dithered reveal in designed darkness (FEEL §10) |
| `creatures/lightResponse.ts` | Light wave: the lit fix, photophobes (Weaver flinch/habituate, bat roost scatter), the Root Loper lurker, slime phototaxis; `playerVisibility` for sight |

The Weaver keeps its own surface-crawler locomotion (`entities/weaverLocomotion`);
its rig is a stub and its art reads `e.weaverLoco`. The Rillback and Stone Maw
keep their gameplay-bearing chain (`creatures/body`, `e.body`). Only a
*swimming* Rillback is a water-coupled chain whose tethered head can hold its
box back, and only where the box fits (`entityFree`); beached, the box falls
and hops under ordinary collision and the chain drapes behind it. Any walker
whose box stays inside terrain for 12 ticks is lifted to the nearest spot it
fits (`Enemies.unembed`) — a box written into rock can never move again.
A chain spine never stretches past 1.5× its link: a node welded into terrain
(chew spoil or sand settling on it, ice or a door closing on it) is dragged out
by its taut link rather than pinning the spine, and a new spine is laid along
open ground (`createChainIn`), never into the wall behind a spawn. Weaver remains
collide as their drawn silhouette (`weaverAnatomy` `WEAVER_SILHOUETTE`) in
sub-cell sweeps, only ever work up or sideways out of terrain, then kick onto
their back with the knees buckling upward.

The Stone Maw is blind but feels a body within 64 cells (lit or dark, facing
or not — never through rock), hears footsteps through the rock and wading
through water, and surges once it has you (`perception.ts`, `Enemies.ts`).

Other systems that now see creatures, not just the wizard: vine strands and
webs are shoved by creature body parts (`VineStrands.gatherPushers`); critters
flee creatures, fish bolt from eels, moths drift to living lights
(`game/Critters.ts`).

## Invariants

- The rig is presentation-physics: never saved, rebuilt from the body on load,
  consumes no `entity` randomness (cosmetic particles use the `fx` stream; the
  few grid writes — a snow print, a flicked sand grain, a track stain — draw
  no randomness).
- Every enemy kind must have species art (`tests/creature-art.test.ts`).
- Species art marks every OPEN eye it paints with `markEye` (the shared `eye()`
  helper does it for you) so eyeshine sits on the real anchor; closed eyes are
  never marked. A blind species marks none.
- Renderers never step rigs; `tickRig` runs once per tick per creature.

## Tools

- `node scripts/creature-studio.mjs --kind spitter --scenes idle,walk,aim,spit`
  — real rig + art in a staged mini-world (floor, ledge, wall, pool, lamp),
  frame strips at zoom. Scenes: idle, walk, run, turn, alert, aim, spit, hurt,
  fall, swim, swimhunt, swimlunge, sleep, hop, fuse, fly, dart, roost, tumble,
  cast, punch, throw, slam, telek, chew, charge, lash, die (the remains fall,
  settle and curl), buried (sand pours over the body; the spine must follow).
- `node scripts/shot-enemies.mjs` — the roster in-game (physics-test arena).
- `node scripts/probe-corpses.mjs`, `node scripts/probe-alive.mjs` — remains and
  world interaction in-game.
- `node scripts/probe-corpse-rest.mjs` (remains on thick floors, thin planks,
  a crater, against a wall, after a blast), `node scripts/probe-chain-stretch.mjs`
  (a live spine buried by sand / in a pit), `node scripts/probe-undertow-remains.mjs`
  (D1's real Stone Maw hunting, then Weaver + Maw remains) — fail on remains
  inside terrain or a spine link past 1.5×.
- `node scripts/bench-creatures.mjs`, `node scripts/perf-creatures-live.mjs` —
  per-kind step/draw cost and live draw cost.
