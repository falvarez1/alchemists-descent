# Physics Objects — Implementation Plan

Interactive rigid-body gameplay: kickable/pushable crates, spell-reactive bodies,
material-driven behaviour (weight, fire, conduction, buoyancy), a crate dispenser,
and water splash. Builds on the Rapier2D rigid-body layer (`RigidBodies.ts`) and the
PHYSICS TEST ARENA (`physics-test` level).

## Where we are
- Rapier2D backs `RigidBodies` behind `RigidBodiesApi` (boxes + circles, terrain via
  per-body colliders). Stable resting/stacking/rolling; explosions eject bodies
  (tuned, crash-fixed). Console `crate`/`boulder`/`playground`; selectable
  `physics-test` arena with a water pool.
- **Missing:** bodies don't interact with the player or projectiles (you walk/shoot
  through them), have no material identity, don't float/sink, and nothing spawns them
  in-world except dev commands.

## The backbone (do these first — everything depends on them)

### B1. Body material layer
Give every body a **material** that drives its physics and reactions. One number —
density relative to water (=1) — drives **both** mass (kick/blast/inertia) and
buoyancy (float/sink).

```ts
export type BodyMaterial = 'wood' | 'metal' | 'stone';
interface BodyMaterialDef {
  density: number;     // mass = area×density; <1 floats, >1 sinks (water = 1)
  color: number;       // packed fill colour
  flammable: boolean;  // fire ignites/destroys it
  conductive: boolean; // lightning arcs through it
  gore: number | null; // cell type left when destroyed (Ash/Stone bits) or null
}
// wood:  density 0.6, brown,  flammable, leaves Ash      → FLOATS
// stone: density 1.5, grey,   leaves crumbled Stone bits → SINKS
// metal: density 2.6, steel,  conductive                 → SINKS
```

- New module `src/entities/bodyMaterials.ts` (the registry + helpers).
- `SpawnBodyOpts.material?: BodyMaterial`; `RigidBody.material?: BodyMaterial`
  (optional → additive, safe). `spawn()` resolves material → `density` + default
  `color` (caller colour still wins).
- Console `crate`/`boulder` gain a material arg (`crate 3 wood`); arena spawns a mix.
- **Verify:** unit-ish probe — wood crate has lower mass / higher buoyancy than metal.

### B2. Interaction couplings (make bodies *real*)
Two passive couplings the rest of the features need.

**B2a. Projectile → body.** In `Projectiles.ts`, each moving projectile tests the
(few) rigid bodies near its path; on hit: `applyImpulseAt` (mass-aware shove + spin)
at the contact, optional damage/material reaction, then consume/bounce per projectile
type. Query: iterate `ctx.rigidBodies.bodies` with a cheap distance/AABB test (tens of
bodies), or a Rapier ray/shape cast. Fixes "I shot it and nothing happened."

**B2b. Player ↔ body.** The player is a custom controller (not a Rapier body), so add
an *additive predicate* to its movement: when the player's swept AABB would overlap a
body, either (a) **block** (stand on / can't walk through), or (b) **push** light
bodies by applying an impulse and letting them move. Heuristic: push if the body's
mass is below a threshold and the push direction is mostly horizontal; otherwise block
(stand on big/heavy crates). Implemented as a query in `Player.tryMoveEntity`-adjacent
code or a post-move resolve step in `RigidBodies` against `ctx.player`.
- **Verify:** player stands on a big crate (blocked), shoves a small one (it moves),
  doesn't fall through.

## Feature phases

### P1. Kick (item 1)
- New input key (`kick`, e.g. `F`) in `InputState.keys` + InputManager binding.
- `PlayerControl`: on kick (with cooldown), find bodies/enemies in a short arc toward
  `aimAngle`/`facing`; `applyImpulseAt` (force-based → light flies, heavy resists) +
  spin; small **self-recoil** via `player.applyImpulse` (enables kick-jumping off heavy
  objects); kick animation (`kickT`) + sfx. Kicked bodies that hit enemies deal contact
  damage (stretch, needs body→enemy).
- Tunables in `params.player` (kickImpulse, kickRange, kickSelfRecoil, kickCooldown).
- **Verify:** probe — kick launches a light crate, barely moves a heavy one, recoils the
  player; kick-jump off an immovable body.

### P2. Spell / material reactions (item 2)
Blast→eject already works. Add:
- **Direct hit** (via B2a): spark/icelance/etc. shove the body they strike.
- **Fire** (flamethrower / fire cells / burning): flammable (wood) bodies ignite → after
  a burn timer, the body is removed and replaced with fire/ash cells (grid-truth).
- **Lightning:** arcs to/through conductive (metal) bodies, chaining to nearby conductors.
- **Frost:** freezes a body briefly (dampen velocity; optional "frozen" tint).
- **Dig ray:** pushes bodies aside.
- **Verify:** probe per reaction (wood crate burns away; metal crate takes an arc; spark
  shoves a crate).

### P3. Larger crates + size×material variety (item 3)
- Add a size tier to spawns (small ~3.5, large ~7 half-extent). Mass scales with area×
  density → large-metal ≈ immovable, small-wood ≈ kickable. Console/arena mix sizes.
- Optional: large crate shattered by a bomb spawns 2–4 small crates + rubble (cascade).
- **Verify:** probe — large crate resists kick/blast far more than small; sizes coexist.

### P4. Dispenser entity + switch (item 4)
- A reusable **Dispenser** mechanism (chute/hopper) that, on trigger (lever/plate),
  emits a rigid body of random size/material at its mouth, with a cooldown and a
  **max-active cap** (despawn oldest) so it can't flood the sim.
- Integrate with the existing `Mechanisms` (lever/plate → action) system; the dispenser
  is a placed entity with a visible sprite. Add one to the arena, wired to a lever.
- This is a reusable level-design primitive (foundation for conveyors/crushers/fans/
  magnets later).
- **Verify:** probe — pulling the lever spawns a body at the chute; cap holds; cooldown.

### P5. Water buoyancy + splash (item 6)
- Each tick, sample a body's footprint for `Cell.Water` → submerged fraction. Apply
  **buoyancy** (upward force ∝ submerged volume × water density) and **drag** (damp
  linear+angular) via Rapier forces. Material density vs water → wood floats/bobs,
  metal/stone sink.
- **Splash on entry:** crossing the surface with downward speed ejects `Cell.Water`
  particles (which re-deposit as water) + displaces surface cells, scaled by impact
  speed and size.
- **Verify:** probe — wood crate floats at the surface, metal/stone sink to the basin
  floor; dropping a body in spawns water particles (cell count rises then settles).

## Cross-cutting
- **Invariants:** systems talk through the `Ctx` interface; bodies stay transient
  (cleared on `levelChanged`); no new cell IDs unless a new material cell is needed
  (none planned — reuse Ash/Stone/Water); Rapier gameplay isn't hashed so golden tests
  are unaffected.
- **Determinism:** Rapier sim is gameplay-only (not in `world.types` golden hashes).
- **Perf:** body counts are tens; projectile/player/kick queries are O(bodies) with
  cheap rejects. Terrain-collider churn already de-risked (velocity margin + deferred
  removal).
- **Tuning:** new knobs live in `config/params.ts` (`player` kick fields; a `physics`
  block for buoyancy/blast if it grows).
- **Verification:** one headless probe per phase (the `scripts/verify-*.mjs` pattern,
  frame-accurate via `window.__game.tick()`), plus `tsc`/`vitest`/`build` gate.

## Build order
**B1 material → B2 couplings → P1 kick → P2 spell reactions → P3 big crates →
P4 dispenser → P5 water.** Each lands as a verified increment.

### Progress
- **B1 material — DONE** (`bodyMaterials.ts`; blasts mass-scaled). `verify-materials.mjs`.
- **B2 couplings — DONE.** B2a: player shots strike bodies via `RigidBodiesApi.hitTest`
  + mass-aware `applyMomentumAt` (in `Projectiles.ts impactBody`; pierce/bounce/detonate
  per type). B2b: `RigidBodies.resolvePlayer` (post-step) — the player stands on / jumps
  off bodies, shoves light ones, is blocked by heavy ones, never tunnels (min-penetration
  side resolve). `verify-couplings.mjs` (8/8).
- **P1 kick — DONE.** `PlayerControlApi.kick` (bound to **F**; RMB still throws the flask):
  mass-aware cone shove of bodies + enemy knockback/damage, self-recoil off solid hits
  (kick-jump), cooldown. Tunables in `params.player` (kick*). `verify-kick.mjs` (7/7).
- **P2 spell/material reactions — DONE.** `RigidBodies.reactBodies` (per tick): flammable
  (wood) bodies ignite from hot cells → burn (flames/smoke, shed fire) → consumed into real
  ash cells (`burnT`); frost (ice contact or a frost shot via `Projectiles.impactBody`)
  sets `frozenT` → velocity damped; the dig beam shoves bodies in its path (`digPush`).
  Lightning conducts into conductive (metal) bodies in `Lightning.cast` (bolt terminates +
  charges/zaps) but passes a non-conductive one. Burning/frozen tint in
  `FrameComposer.drawRigidBodies`. `verify-reactions.mjs` (9/9).
- **NEXT: P3** larger crates + size×material variety (then P4 dispenser, P5 water).

## Ropes / vines — DONE (separate Verlet system, not Rapier)
Handled by `VineStrands`, not the rigid bodies. `VineStrands.addHanging(x, y, length,
{thickness, color})` makes a PERSISTENT strand pinned at the top that sways, collides
with terrain, and reacts to the player, with thickness-aware rendering; the arena hangs
ropes + thick vines from ceiling beams. (Reviewed the strand sim — gravity + distance
constraints + terrain collision + player push, bounded by MAX_ACTIVE_STRANDS — sound and
efficient; the detached-cluster path drapes cut vines then re-settles them to cells.)
A hanging strand checks its anchor each frame (`anchorSupported`: load-bearing cell at or
directly above the top node); when the terrain/object it hangs from is destroyed it
un-pins (`persistent = false`) and falls + settles like a cut vine — no mid-air hovering.
(Follow-up: severing a strand mid-span on projectile/dig contact needs a `cut(x,y)` hook +
caller — not wired yet since nothing currently passes *through* a strand.)

## Out of scope (future)
Ragdolls, vehicles (the Rapier-constraint tier), conveyors/crushers/fans/magnets (the
wider machine vocabulary), lava interactions (material reuse of the water/fire logic).
