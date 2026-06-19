# Weaver Spider Implementation Plan

## Intent

Add a large spider-like enemy, the Weaver, that sells its personality through
eight long inverse-kinematics legs, realistic foot planting, and grid-readable
lair control. The creature is a Fungal Deep and Timberworks elite: it prefers
growth-covered terrain, lays real vine webbing, and becomes vulnerable when the
player burns or cuts away its footing.

The first shippable version should be a finite placed enemy, not a required
campaign boss. The encounter can later grow into a dedicated lair prefab,
mid-boss, reward chain, and a new silk material only if existing cells fail to
carry the mechanics.

## Design Contract

- The grid must explain the encounter. The Weaver's webbing is real `Vines`
  first, with `Fungus`, `Moss`, `Slime`, and `Glowshroom` supporting the lair.
- The IK legs are the read. A planted foot is safe movement for the creature, a
  lifted leg is an attack or reposition tell, and destroyed footing causes
  visible correction.
- The player counters it with existing verbs: burn growth, dig anchors, freeze
  footing, route water or electricity, and use flask materials.
- The first implementation must not add a `Silk` cell. Cell IDs are append-only
  save contracts, so a new material is a later decision with its own checklist.
- The creature must remain findable and finite. It belongs in biome population
  and local lair dressing, not an endless director.

## First Implementation Slice

1. Add `weaver` to `EnemyKind` and `ENEMY_DEFS`.
2. Add a ground-based AI branch in `Enemies.update`:
   - slow pursuit with short retreat when too close;
   - preferred footing sampled from nearby growth cells;
   - `Needle Step` melee windup using existing `windup`;
   - `Thread Spit` using existing `blink` as a telegraph.
3. Make `Thread Spit` write short, ragged `Vines` lines through open cells near
   the player so webbing is persistent, burnable, climbable, and saved.
4. Add a procedural sprite branch:
   - eight legs;
   - two-bone IK from hip to foot target;
   - transient renderer-owned leg targets;
   - lifted foreleg during Needle Step;
   - body tilt and eye glow tied to alert/combat state.
5. Add subtle living light for the eyes so the silhouette is readable in dark
   caves without making the whole creature emissive.
6. Add sparse biome placement:
   - Fungal Deep as the primary home;
   - Timberworks as a rare secondary home.
7. Stamp local lair dressing around seeded Weaver spawns:
   - `Vines` curtains and floor threads;
   - a few `Fungus`, `Moss`, and `Glowshroom` cells;
   - no new rooms or mandatory gates in the first slice.
8. Add a dedicated `weaver-test` playground level for tuning and regression:
   - sleeping alcove with hanging vine anchors;
   - uneven growth shelves for IK gait and foot-planting checks;
   - glowshroom prey pen for feeding behavior;
   - open attack lane for Thread Spit and Needle Step;
   - existing material counterplay patches for burn, freeze, water, and charge.

## Mechanics

### Preferred Footing

Every few frames, sample cells under and around the body. `Vines`, `Fungus`,
`Moss`, `Slime`, and `Glowshroom` increase confidence. Fire, lava, and acid are
dangerous. Good footing slightly improves movement and attack cadence; burning
or cut-away lairs make the creature slower and less stable.

### Needle Step

At close range, one foreleg lifts for a clear windup. On release, it stabs near
the player, damaging on contact and kicking up dirt/blood particles. The sprite
must make this leg visibly separate from the normal gait.

### Thread Spit

At mid range, the Weaver pauses and spits a strand. The attack paints `Vines`
through open cells along a short line near the player. It should shape routes,
not hard-root the player. Vines are soft growth, so they do not block bodies,
but they persist, burn, and interact with existing vine strand systems.

### Lair Dressing

The local lair is not a sealed arena in the first slice. It is a reachable
cluster around the spawn that teaches the encounter:

- hanging vines imply ceiling and wall contact;
- glowshrooms reveal the silhouette;
- fungus and moss suggest preferred footing;
- slime/tangled floor patches make the player notice material state.

### Weaver Test Lair

The `WEAVER TEST LAIR` is a test-mode level, selectable from the launcher and
available to console runs as `run test --level weaver-test --world campaign-level`.
It wipes generated terrain the same way `physics-test` does, then builds a
controlled fungal lab. The intent is to make tuning obvious:

- a sleeper starts in a webbed alcove and wakes from proximity or harm;
- a wounded feeder starts near moths, flies, beetles, and fireflies so feeding
  can be observed and measured;
- a sentinel starts in a clear lane so thread spit, needle windup, and contact
  pressure are easy to trigger;
- adjacent shelves vary by four cells or less, so the body can traverse them
  while the eight IK legs visibly replant;
- all webbing and support are real `Vines`, `Moss`, `Fungus`, and `Glowshroom`
  cells, so burning or destroying the footing changes the creature's confidence.

### Sleep Disturbance

A sleeping Weaver wakes from more than proximity. It also hears nearby player
body impacts and nearby structure strikes:

- dive slams, hard landings, and dive-stomps emit `groundImpact`;
- kicked/thrown rigid bodies emit `groundImpact` when they slam into terrain;
- wand hits and explosions already emit `structureStrike`;
- if either lands near a sleeping Weaver, it wakes cranky, targets the player,
  and gets a short pursuit bump instead of returning to prey behavior.

## Expert Polish Pass

The follow-up pass treats the Weaver as an encounter system, not only an enemy
sprite:

- Gait: legs use planted foot targets with alternating tetrapod groups. Feet
  stay anchored until a swing phase or overreach starts a real step, then snap
  back into a planted state with a small contact flash.
- Attack readability: `Needle Step` locks its target when the windup begins.
  The raised foreleg, particle flecks, and damage all reference that committed
  point, so sidestepping the tell is possible.
- Footing failure: when support drops too low, the Weaver prioritizes finding
  nearby growth anchors or spinning short foot-trail vines. It defers new
  attacks while unstable and shows a web pulse/recoil stumble.
- Lair disturbance: stomps, structure hits, and rigid-body impacts wake the
  sleeper cranky, tug nearby hanging vines, scatter cave life, shake the screen,
  and write a fresh sense-thread toward the noise source.
- Playground coverage: the `weaver-test` arena includes a sleeping alcove with
  kickable props, an uneven gait lane with a patrolling Weaver, a feeding pen,
  a natural attack lane, and a bare-stone support-loss strip.
- Authoring coverage: Builder enemy placement and patrol tooling include
  `weaver`, and the gallery previews sleeping, gait, Thread Spit, Needle Step,
  and footing-loss states.
- Runtime verification: the browser probe validates natural Thread Spit and
  Needle Step selection, IK leg count, feeding, stomp/strike/body-impact wakeup,
  support-loss recovery, and bounded local vine growth.

## Future Extensions

- Dedicated `Weaver Lair` prefab through the prefab placement pipeline, with a
  visible wrapped reward and explicit minimap landmark.
- Leg-aware stagger: track support loss when feet fail to find surfaces, then
  drop the body into a vulnerable crouch.
- Egg-sac integration: low health can wake nearby `eggs` or bat roosts.
- Reward: `Threadline` spell card or `Spinneret Gland` relic.
- Optional `Silk` material only if `Vines` cannot express the final mechanics.

## Validation

- `npm run typecheck`
- focused Vitest for population/definitions if touched
- `npm test` when practical
- `npm run build`
- `node scripts/verify-weaver.mjs http://127.0.0.1:<port>/`
- Runtime probe or manual console spawn:
  `spawn weaver 1 <x> <y>` in a Fungal/Timberworks-like area, then verify the
  creature moves, telegraphs, paints real `Vines`, takes status damage, and the
  IK sprite remains readable in dark caves.
- Dedicated playground pass:
  `run test --level weaver-test --world campaign-level`, then observe sleeping,
  stomp/impact wake-up, feeding, uneven gait, thread writing, and the attack
  lane.
