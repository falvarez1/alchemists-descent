# Physics Joy — Implementation Plan

A second wave of physics features, all recombining the layer we already shipped
(`docs/PHYSICS-OBJECTS-PLAN.md`): Rapier rigid bodies + materials, the kick, spell
reactions (fire/frost/lightning/dig), the dispenser+lever, water buoyancy/splash,
and the Verlet `VineStrands`. Every idea stays grid-truthful ("if the grid can't
explain it, it doesn't ship") and leans on existing systems so each is a small,
verified increment.

**Legend:** 🔨 building now · ⭐ recommended next · ◻ backlog.

---

## 🔨 Building now (this pass): #1 grab-&-throw, #2 vine-swing, #4 player ragdoll

### #1 Grab & throw — objects as tools/weapons  🔨
Hold a key (G) near a body → it snaps to the wizard's hands (tracks a hold point in
front of him along the aim); release → it flies along the aim with his run momentum.
- **Where:** `RigidBodies` owns a `held` ref. `grab(ctx)` finds the nearest dynamic
  body in an aim cone within reach below a mass cap; `release(ctx)` throws it
  (`applyMomentumAt` along aim + player velocity). `update()` velocity-tracks the held
  body to the hold point each frame (stays dynamic, so it still bumps things). Input:
  G keydown→grab, keyup→throw (`InputManager`).
- **Verify:** probe — grab a crate (it follows the wizard), throw it (flies along aim,
  hits/shoves a target); too-heavy bodies can't be grabbed.

### #2 Vine swing — momentum traversal  🔨
Grab a hanging vine and swing as a pendulum; release at the apex to launch.
- **Where:** `PlayerControl` gains a `swinging` state. On grab near a persistent
  `VineStrands` vine, anchor = the vine's pinned top, ropeLen = clamp(dist(player,
  anchor), …, vineLength). While swinging: gravity + a rigid rope constraint (project
  out radial velocity, keep tangential), left/right pumps the swing, jump/release
  detaches keeping the tangential launch velocity. `VineStrands` drives the grabbed
  strand taut to the player's hands for the visual.
- **Verify:** probe — grab a vine, the player pendulums (x oscillates), pumping grows
  the arc, release launches with the swing velocity.

### #4 Player ragdoll death (the headline)  🔨
**Replace the death screen with an in-world death:** on death the wizard becomes a
tumbling ragdoll body flung with his death momentum; once it settles a **tombstone**
rises above it; the respawn UI is deferred until then.
- **Where:** `PlayerControl.kill()` spawns a corpse rigid body (tag `player-corpse`)
  with the player's velocity + an upward pop + spin. `PlayerControl.update` (before the
  dead-return) watches it; when it sleeps (or after a timeout) it sets settled + emits
  `playerCorpseSettled`. `FrameComposer` draws a limp wizard (robe + hat) rotated on the
  corpse and a tombstone above once settled. `Hud` preps the gameover text on
  `playerDied` but only reveals the overlay on `playerCorpseSettled`. `respawn()`
  removes the corpse + tombstone.
- **Verify:** probe — on death a `player-corpse` body spawns and is flung, the live
  player sprite is gone, the body settles, the settled flag/tombstone + deferred
  overlay fire; respawn clears it.

---

## ⭐ Recommended next

### Explosive barrels & payload bodies  ⭐
A body with **contents** that release on break/fire/blast: gunpowder → explosion, oil →
flammable puddle, water → douse. Kick or shoot one into a crowd → chain reactions.
- **Fit:** `bodyMaterials` gains a `payload` (none | explode | spill cell + radius);
  `RigidBodies.shatterBody`/a destroy hook fires it. Reuses shatter + explosions + fire.

### Force push / telekinesis spell  ⭐
A cone shove that flings bodies + enemies and recoils the caster.
- **Fit:** new spell card; `applyRadialImpulse`/`applyMomentumAt` in a cone; reuses kick math.

### Fill-and-float puzzles  ⭐
Flood water → a heavy wood crate rises with the surface → a bridge; sink metal to dam a
sluice. A whole puzzle vocabulary from the P5 buoyancy + the buoy/sluice mechanisms.
- **Fit:** content/level design on existing systems; maybe a "water level" sensor.

---

## ◻ Backlog by theme

**Traversal**
- **Grappling-hook spell** — a card that plants a Verlet rope anywhere (then swing via #2).
- **Rideable / kinematic platforms** — bodies that carry the player (B2b stand-on + Phase-3
  kinematic platforms); ride a boulder down a ramp; a wood raft floats riders across the pool.
- **Freeze-to-platform** — frost a body mid-air → a static frozen stepping-stone (reuses P2 frost).

**Destruction & chaos**
- **Structural collapse** — stack with the dispenser, blast the base → realistic topple (Rapier stacking).
- **Avalanche** — dispense a stream of boulders down a slope → a rolling, crushing cascade.
- **Material-morph bodies** — an ice crate melts to a puddle near fire; a sandbag bursts into sand cells.

**Contraption kit** (the dispenser was the seed; wire to lever/plate)
- **Catapult / trebuchet** — lever-armed launcher flings bodies at a target.
- **Fan / wind vent** — directional force field pushing bodies *and* the player (updraft traversal).
- **Crusher / piston** — kinematic block that slams and squashes/launches.
- **Conveyor belt** — a surface that carries bodies and riders sideways.
- **Seesaw / hinged plank** — drop a heavy body one end → launch a crate off the other (needs a hinge joint).

**Spells × physics**
- **Magnet spell** — attract/repel conductive metal bodies (we track conductivity).
- **Gravity well / low-grav zone** — locally bend Rapier gravity (cousin of the black hole).
- **Glue / weld spell** — bind bodies into a compound (needs joints).

**Creatures & comedy**
- **Ragdoll enemies** — enemies become rigid-body corpses on death that flop and can be kicked
  across the room (the #4 corpse generalized to enemies; deluxe = jointed limbs via Rapier joints).
- **Physics enemies** — a boulder-golem that *is* a rolling rigid body.

**Water**
- **Rafts / boats** — a wide wood body floats as a rideable platform (buoyancy + stand-on).
- **Water wheel** — flowing water spins a hinged wheel that drives a mechanism (needs a joint).
- **Splash combat** — kicking a body into water shoves a wave of displaced water at enemies.

---

## Cross-cutting
- **Invariants:** talk through the `Ctx` interface; bodies/corpses stay transient (cleared on
  `levelChanged`); no new cell IDs (reuse Water/Ash/Fire/etc.); Rapier gameplay isn't in golden hashes.
- **Joints:** several backlog items (seesaw, weld, water wheel, jointed ragdolls) want Rapier
  revolute/fixed joints — a small `RigidBodiesApi` addition, landed when the first joint feature ships.
- **Feel:** every mechanic needs visible/audible feedback (grab snap, throw whoosh, swing creak,
  ragdoll squelch + tombstone); this user prioritizes micro-interaction polish.
- **Verification:** one headless probe per feature (`scripts/verify-*.mjs`, frame-accurate via
  `window.__game.tick()`), plus the `tsc`/`vitest`/`build` gate.

## Build order (this pass)
**#4 player ragdoll → #1 grab-&-throw → #2 vine-swing**, each a verified increment.
