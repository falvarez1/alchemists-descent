# Equipment and habitat interaction fixes

September 5, 2026 · `feat/living-descent`. This follows the earlier fidelity,
waterfall and articulated-limb work at `156256b`. Generation and cell IDs are
unchanged. The larger cinematic combat request is a
[design proposal](plans/2026-09-05-cinematic-trickshots.md), not part of these fixes.

## One weapon in the wizard's hands

Equipping a Weaver leg stows the wand, its spell hotbar, trajectory and beam.
LMB/F whips, RMB throws and G drops; melee/carry remaps update the hints.
Controller equivalents are RT/RB/LB while equipped. Release restores the wand's
inventory, mana and deck position, requiring a fresh fire press to cast.

A dropped or thrown leg is one recoverable pickup with a three-point physical
rig, inherited player/limb momentum, swept terrain contact and a free knee.
Throws cause one 24-damage hit and spend one use. Owner and remaining uses survive
recovery and saves; a final-use hit splinters the leg. Walking away before
recollection prevents a discarded leg from snapping straight back into a hand.

## Ice restrains the whole Rillback

The previous solver assigned the head directly from AI movement and never sent
tail contact back to that head. Ice could pin a tail while the AI pulled the body
longer every tick. Aquatic constraints now propagate in both directions, transfer
blocked corrections to the other joint, and feed the resolved head position and
reaction impulse back to the entity. An infeasible contact keeps the last valid
pose and discards its stretching impulse. Valid links stay within 6% of their
four-cell rest length, including sustained swimming against a frozen tail.
Removing the ice releases the same body. Each node still samples its own water
immersion and current; exposed segments retain gravity. Stone Maw behavior is
unchanged by the aquatic solver.

## Foliage has contact, fuel and persistence

F kicks apply the existing directional gust to ground fronds, producing a spring
impulse and loose leaf motes. Hanging vines retain their gust response. Walking
through a root remains continuous, without a direction flip.

Visible stems and leaves catch fire from grid fire, embers, lava, burning oil,
flying fire/embers and fiery projectiles. Swept particle traces catch fast sparks
between ticks; cosmetic light alone cannot ignite plants. Drawing and ground
crown heat contact share the same leaf geometry. Water and nitrogen extinguish
burning foliage. Native fire, smoke, embers and ash make the reaction visible
and allow it to spread through actual material contact.

Ground crowns retain their position when a root or timber support disappears,
fall and turn under gravity, and respond to liquid drag/current. A crown has a
finite 210-tick fuel budget; extinguished damage remains. Living expedition saves
retain damaged, falling and spent crowns. Lifted vines burn per node, lose leaves
and sever after 140 burning ticks; their lower sections fall with surviving
foliage. Burned held vine material serializes as ember/ash residue instead of
regrowing as fresh vines during save or level transitions.

Heat checks use a shared spatial index of swept particles and a terrain-region
cache invalidated by the existing activity versions. Unchanged cold regions
reuse their result; exact geometry still decides contact. No detail is removed.

## Reproduce and inspect

```text
node scripts/verify-weaver-equipment.mjs http://127.0.0.1:5182/
node scripts/verify-habitat-interactions.mjs http://127.0.0.1:5182/
node scripts/verify-fidelity-performance.mjs http://127.0.0.1:5182/ interactions-optimized 30 sluice
```

The browser probes launch disposable runs through the canonical console API.
Equipment uses one disclosed severed-leg pickup and a spawned golem, followed by
real LMB/RMB/G and walking. Habitat uses actual F plus disclosed ember, water,
burning-support and frozen-tail fixtures. After the initial creature pose, live
AI/constraints own its movement; there are no per-frame position overrides.
Automated controller button mapping is not physical controller qualification.

Screenshots, WebM clips, gallery entries and raw JSON reports are generated into
ignored `screenshots/` and `verify-out/living-descent/`. Open
`screenshots/living-descent/index.html` and search for **equipment**, **foliage** or
**Rillback**. The test fixtures and old captures remain clearly labeled.

## Timing and validation

The final source passed **106 test files / 1,166 tests**, ESLint, strict TypeScript
checking and the Vite production build. Tests include equipment ownership and
mana/deck preservation, hinge lengths, swept thrown contact, frozen-tail reaction
and release, foliage ignition/quenches, spring continuity, cache invalidation,
burned-vine save material and crown-state round trips.

The shipping UI probe also passed real autosave/Continue with crown records in
the IndexedDB checkpoint, persisted experiment preferences, and no debug game
handle or page errors. This covers real checkpoint encoding plus the unit-level
restore of damaged/spent plants; it is not a manual playthrough of every plant.

The same seed-777 sluice scene was measured serially for 30 seconds before the
habitat/body changes and after optimization. Both use the same half-cell
presentation (1280 × 720), world view and WebGL2 backend, with headless Edge 153
on Windows and an RTX 3080 Ti through ANGLE/D3D11. These are CPU wall-clock
measurements, not GPU timestamps or cross-hardware qualification.

| CPU measurement | Before | Final |
| --- | ---: | ---: |
| Frame p95 | 10.9 ms | 11.0 ms |
| Composition p95 | 6.0 ms | 6.1 ms |
| Material simulation p95 | 3.0 ms | 3.0 ms |
| Complete simulation tick p95 | 3.7 ms | 3.9 ms |
| Other gameplay mean | 0.45 ms | 0.51 ms |
| Simulation cadence | 60.05 Hz | 60.01 Hz |
| Discarded simulation time | 0 ms | 0 ms |

The first implementation reached 12.2 ms frame p95 and 1.50 ms other-gameplay
mean because it rescanned cold foliage regions. Mutation-version caching and a
compact thermal classification lookup reduced those figures to 11.0 and 0.51 ms
without changing contact cadence or visual fidelity. Final frame p95 is about
0.9% above baseline. This is one bounded scenario; it does not establish a speedup
in every room. Raw records are `interactions-before.json`,
`interactions-after.json`, `interactions-optimized.json` and `interactions-final.json`.

The final habitat browser probe reports no page errors, confirms the native vine
burns through, and measures a maximum Rillback link length of 4.2398 cells both
while trapped and after release (4-cell rest length, 4.24-cell cap). The equipment
probe confirms one 24-damage thrown hit, recovery with one fewer use, a stowed wand
and a fresh ordinary cast after dropping the leg. Unit regressions also exercise
cold-cache invalidation, burning oil, water quenching and saved plant damage.

## Five next ideas for more interactive levels

1. **Debris dams:** floating crates and broken planks collect at a drain, raising
   the water behind them. Kick, burn or blast the blockage to release a surge and
   open a route. Keep flow and blockage visible before asking the player to act.
2. **Counterweight gardens:** living vines hold baskets, gates and suspended
   bridges. Cut or load a particular strand to change their balance; surviving
   strands visibly tighten and creak before a failure.
3. **Breathing furnaces:** valve-controlled drafts carry embers and spores through
   rooms. A kick redirects a small burst; shutters and wet vegetation can stop a
   spreading fire. Wind direction has readable leaf, dust and sound cues.
4. **Remembered territory:** residents recognize repeated feeding, nest damage
   and stolen limbs. A fed creature tolerates a passage; a disturbed nest changes
   patrols and calls nearby kin. Communicate the change with behavior, not menus.
5. **Botanical secrets:** watering a dormant colony reveals a glow trail, freezing
   its sap makes a temporary foothold, and burning it reveals a buried cache.
   Give each approach a different reward while preserving another route onward.

These five are proposals, not implemented mechanics in this update.
