# Spell, Potion, and Modifier Expansion Plan

Status: proposal, not implemented.

Scope: play-mode wand/card modifiers, potion support, and cauldron/brewing
extensions. Build-mode tactical spells remain a separate sandbox surface unless
explicitly called out.

## Purpose

The current game has the right foundations for Noita-like magic, but the card
modifier surface is still thin. The goal of this plan is to add spell variety
without creating abstract stat soup: every new effect must either read real
cells, write real cells, or pay for a temporary exception through a potion timer
that the status system owns.

The first expansion should prioritize five modifier families:

1. Trail modifiers.
2. Elemental and status modifiers.
3. Critical-hit modifiers.
4. Homing modifiers.
5. Path modifiers.

Damage, speed, bounce, duplication, utility, lifetime, and power-conversion
modifiers are still useful, but they are not the first gap to fill. The current
game already has some coverage for speed, damage, bounce, trigger payloads,
multicast, and flask-fed trails. The highest return now is to deepen the
material/status grammar around those systems.

## Current Baseline

The repo already has the core pieces this plan should build on:

- `src/combat/wands/cards.ts` defines projectile cards, modifier cards, and
  multicast cards.
- `src/combat/wands/compiler.ts` compiles cards left-to-right into
  `CastAction` groups. Existing action fields are `speedMul`, `dmgMul`,
  `spreadAdd`, `infused`, `bounces`, and `triggered`.
- `src/combat/wands/WandSystem.ts` executes compiled actions and marks
  projectiles with side-channel `WeakMap`s for bounce, infuser, and trigger
  payloads.
- `src/combat/Projectiles.ts` owns projectile steering, per-type gravity,
  enemy impact, terrain impact, bounce consumption, trigger release, and the
  existing infuser trail.
- `src/entities/status.ts` samples real cells touching a body and owns `wet`,
  `oiled`, `burning`, `frozen`, and `electrified`, plus potion timers.
- `src/combat/Flask.ts` stores real cells, pours real cells, throws real cells,
  and already protects material conservation.
- `src/game/Brewing.ts` reads real cells inside the cauldron and transmutes
  them into elixir cells.
- `src/game/Pickups.ts` already has instant potion pickups tied to
  `EntityStatus`.
- `src/sim/CellType.ts` currently uses append-only cell ids through
  `Cell.Catalyst = 35` and `CELL_COUNT = 36`; the next free cell id is 36.

## Design Rules

1. Grid first. A modifier must have a visible material/status explanation.
2. Compiler stays deterministic. Card order and clamps remain inspectable in
   `compileWand`.
3. Scarce materials stay scarce. Flask-fed material effects conserve stored
   cells; fixed trail cards must not mint high-value cells.
4. No new input verbs. New cards and potions use the existing wand, bench,
   pickup, flask, and cauldron flows.
5. Projectiles remain transient. Modifier runtime state can live in `WeakMap`s
   keyed by projectile objects and does not need save support.
6. Runtime effects need visible cues. Projectiles with new behavior need
   readable pixels, light seeds when emissive, and distinct procedural audio.
7. Performance is a feature. Homing, path, and trail logic must run on cadence
   and budgets, not unconstrained per-projectile scans.
8. Trigger payloads must share the same semantics as normal casts. A payload
   cast should not silently lose new modifier behavior.

## Builder And Asset Management Compatibility

This plan owns runtime behavior. The Builder integration is governed by
`docs/SPELL-POTION-MODIFIER-BUILDER-ADDENDUM.md` and the shared Asset Database
in `docs/BUILDER-ENHANCEMENT-IMPLEMENTATION-PLAN.md`.

Runtime work should expose enough metadata for Builder without creating a
second editor asset system:

- New repo-defined cards, modifiers, potion pickups, elixir recipes, wand
  frames, review loadouts, and built-in scenarios must be discoverable through
  `ContentRegistry` adapters. Local/project scenarios remain `AssetStore`
  records indexed by `AssetDatabase`.
- `ContentRegistry` is a read-only provider into the Builder `AssetDatabase`.
  The Builder Content Browser is an Asset Browser mode, not a separate storage
  or dependency framework.
- Runtime IDs remain code contracts such as `CardId` and potion IDs. Builder
  documents and tools should use scoped typed refs such as
  `{ kind: 'card', id: 'critwet', origin: 'builtIn' }`; compact keys like
  `card:critwet`, `potion:swift`, and `wandLoadout:wet-crit-review` are useful
  display/search shorthand for built-in content.
- Runtime modules should not import Builder asset code. The dependency direction
  is one way: Builder/content adapters read runtime definitions and add
  metadata, validation, previews, and review status.
- Visual assets remain optional presentation data. A missing icon or sprite is a
  validation/cook issue, not a reason to hide the grid-first runtime behavior.

## Target Player Outcome

The player should start thinking in "spell sentences":

- `Homing + Oil Trail + Spark` marks a moving target and paints a fuse behind it.
- `Critical on Wet + Electric Charge + Bolt` rewards flooding the room first.
- `Slithering Path + Gunpowder Wake + Fire Charge` snakes an explosive line
  through a tunnel.
- `Boomerang + Frost Charge + Ice Lance` returns through a water pocket and
  freezes a second route.
- `Bloodseeker + Shatter Frozen + Frost Shard` turns enemy gore and terrain prep
  into a targeting and damage grammar.

The cards are not just higher numbers; they change how the player reads rooms.

## Implementation Strategy

### Phase 0: Modifier Runtime Foundation

Add a shared projectile modifier state instead of growing many unrelated
`WeakMap`s.

Recommended new file:

- `src/combat/wands/modState.ts`

Recommended shape:

```ts
import type { Projectile } from '@/core/types';
import type { Cell } from '@/sim/CellType';

export interface TrailModState {
  cell: Cell;
  cellsPerTick: number;
  cadence: number;
  budget: number;
  life: number;
  charge: number;
  skipPlayerFrames: number;
}

export interface StatusModState {
  status: 'wet' | 'oiled' | 'burning' | 'frozen' | 'electrified';
  frames: number;
  radius: number;
  terrainRadius: number;
  charge: number;
}

export interface CritModState {
  condition: CritCondition;
  multiplier: number;
  probeRadius: number;
  consumeStatus: boolean;
}

export interface HomingModState {
  range: number;
  accel: number;
  maxSpeed: number;
  startAge: number;
  retargetCadence: number;
  target: HomingTargetRule;
  lineOfSight: boolean;
}

export interface PathModState {
  kind: 'slither' | 'spiral' | 'boomerang' | 'pingpong';
  amplitude: number;
  frequency: number;
  turnRate: number;
  returnAge: number;
  damping: number;
  originX: number;
  originY: number;
  baseVx: number;
  baseVy: number;
  phase: number;
}

export interface ProjectileModState {
  trail?: TrailModState;
  statuses?: StatusModState[];
  crits?: CritModState[];
  homing?: HomingModState;
  path?: PathModState;
  lifeAdd?: number;
  lifeMul?: number;
}

export const PROJECTILE_MODS = new WeakMap<Projectile, ProjectileModState>();
```

Keep the existing `BOUNCE_COUNTS`, `INFUSED`, and `TRIGGERED` maps in the first
implementation pass to reduce churn. Once the new state is stable, move them
into the aggregate object as a cleanup task.

### Phase 0 Compiler Changes

Extend `CastAction` in `src/combat/wands/compiler.ts`:

- `trail: TrailCastSpec | null`
- `statuses: StatusCastSpec[]`
- `crits: CritCastSpec[]`
- `homing: HomingCastSpec | null`
- `path: PathCastSpec | null`
- `lifeAdd: number`
- `lifeMul: number`

Extend `ModPack` with the same fields.

Rules:

- Multiple status modifiers may stack on one projectile.
- Multiple crit modifiers may stack only by condition; duplicate condition keeps
  the highest multiplier.
- One homing modifier per projectile; a stronger homing card replaces weaker
  homing.
- One path modifier per projectile; later path card replaces earlier path card.
- Trail modifiers replace each other unless explicitly marked as compatible.
- All damage remains clamped by the existing x4 compiler cap before potion and
  perk modifiers are applied.

### Phase 0 Execution Changes

In `WandSystem.markProjectile`:

- Convert action specs into a `ProjectileModState`.
- Write `PROJECTILE_MODS.set(p, state)` if any new mod exists.
- Continue writing current bounce/infuser/trigger maps until the migration is
  complete.

In `Projectiles.update`:

- Read `const mods = PROJECTILE_MODS.get(p)`.
- Apply homing and path steering before substep movement.
- Apply trail deposition before or after movement depending on card type.
- Apply crit and status logic through a shared damage helper instead of
  duplicating enemy-hit code per projectile type.
- Clean up budgets by mutating `mods` in place; when empty, delete the map entry.

### Phase 0 Trigger Payload Fix

`Projectiles.ts` currently has a local trigger payload helper that only handles
simple payload cards. Before adding new modifier families, make trigger payloads
route through the same execution path as normal wand casts.

Preferred contract:

- Add `castActionAt(ctx, action, x, y, angle)` to `WandsApi` in
  `src/core/types.ts`.
- Move the existing public `WandSystem.castActionAt` behind that interface.
- Replace the local helper in `Projectiles.ts` with `ctx.wands.castActionAt`.

This is important because otherwise a triggered projectile could lose homing,
trail, path, crit, or status semantics.

## Priority 1: Trail Modifiers

### Why First

Trail modifiers are the strongest fit for this game because they make spells
leave real evidence in the world. A trail is a spell, a puzzle tool, a hazard,
and a memory of the fight at the same time.

The existing `Infuser` proves the pattern but should become a more explicit
system with conservation rules, per-material budgets, and named variants.

### Implementation

Generalize the current infuser block in `Projectiles.ts` into a helper:

```ts
function applyTrail(ctx: Ctx, p: Projectile, mods: ProjectileModState): void
```

Deposition rules:

- Run only when `p.age % trail.cadence === 0`.
- Deposit up to `cellsPerTick`, never exceeding `budget`.
- Deposit only into `Cell.Empty` or gas cells unless a card explicitly says it
  can paint over liquids.
- Use `COLOR_FN[trail.cell]`.
- Set `life` for temporary cells such as fire, ember, steam, smoke, or ice
  rime.
- Set `charge` when the card is electrical.
- Skip cells inside the player-safe box for the first `skipPlayerFrames`.
- Never mint `Cell.Gold`, `Cell.Catalyst`, high-value elixirs, or future rare
  materials from mana alone.

Material conservation:

- `Infuser` remains flask-fed and spends stored material.
- Fixed trail cards may create only low-economy or temporary material.
- Named high-value trails should require flask material or a rare card with a
  strict budget.

### Attributes

Each trail card should define:

- `cell`: real `Cell` id deposited.
- `cellsPerTick`: cells attempted per cadence.
- `cadence`: frame interval.
- `budget`: max cells per projectile.
- `flaskCost`: optional stored-cell cost paid on cast.
- `life`: life value for temporary cells.
- `charge`: charge value written to deposited cells.
- `placeMask`: empty, gas, liquid, or surface-adjacent.
- `skipPlayerFrames`: self-safety window.
- `manaCost`: card cost.

### Initial Cards

| Card id | Name | Source | Attributes | Reason |
| --- | --- | --- | --- | --- |
| `watertrail` | Water Trail | fixed | Water, 1 cell every 2 frames, budget 18, mana 5 | Teaches trails safely; enables wet/crit/electric combos. |
| `oiltrail` | Oil Wick | fixed or flask-fed | Oil, 1 cell every 3 frames, budget 14, mana 7 | Creates readable fire routing without huge pools. |
| `gunpowdertrail` | Powder Wake | flask-fed preferred | Gunpowder, 1 cell every 4 frames, budget 10, mana 9 | High danger and high payoff; should not be free early. |
| `firetrail` | Fire Trail | fixed | Fire, 1 cell every 2 frames, life 20-35, budget 20, mana 8 | Classic offensive trail; temporary but dangerous. |
| `frostwake` | Frost Wake | fixed | Ice rime surface-adjacent only, budget 16, mana 8 | Traversal and water-control utility without making free walls. |
| `acidtrail` | Acid Trail | flask-fed only | Acid, 1 cell every 4 frames, budget from flask, mana 10 | Strong terrain delete; must conserve acid. |

### Acceptance Criteria

- Trail cards leave visible real cells in the world.
- Trails never write over solid gate materials unless explicitly intended.
- Flask-fed trails decrement flask count and clear the flask at zero.
- Trails do not deposit inside the player during the safety window.
- `Water Trail + Electric Charge` creates readable wet/electric combos.
- `Oil Wick + Fire Charge` creates a fuse without spawning an uncontrollable
  screen-wide fire.

## Priority 2: Elemental and Status Modifiers

### Why Second

The status engine is already one of the game's most important foundations. New
status modifiers let any projectile become a setup tool, not just a damage
packet.

### Implementation

Add status mods to the enemy-hit and terrain-impact paths:

```ts
function applyStatusModsToEnemy(ctx: Ctx, p: Projectile, enemy: Enemy): void
function applyStatusModsToTerrain(ctx: Ctx, p: Projectile, gx: number, gy: number): void
```

Enemy rules:

- Set `e.status[status] = Math.max(e.status[status], frames)`.
- Respect existing enemy immunities where status sampling already does.
- Let damage remain separate so `Frost Charge` can be useful on low-damage
  projectile cards.

Terrain rules:

- `wet`: splash water in a small disc or damp cells.
- `oiled`: place a few oil cells only if the card is oil-themed and budgeted.
- `burning`: place fire/ember cells with life.
- `frozen`: call a small `freezeSplash` or a reduced rime function.
- `electrified`: add `world.charge` to hit conductors and nearby water/metal.

### Attributes

Each status card should define:

- `status`: wet, oiled, burning, frozen, or electrified.
- `frames`: status duration on entities.
- `radius`: enemy impact radius for splash application.
- `terrainRadius`: cell impact radius.
- `charge`: charge written to terrain, if electrical.
- `damageMulAdd`: optional small damage bump.
- `immuneBehavior`: skip, convert, or visual-only.
- `manaCost`: card cost.

### Initial Cards

| Card id | Name | Status | Attributes | Reason |
| --- | --- | --- | --- | --- |
| `frostcharge` | Frost Charge | frozen | 120 frames, terrain r4 freeze/rime, mana 8 | Turns existing freeze tech into a generic modifier. |
| `sparkcharge` | Electric Charge | electrified | 45 frames, charge 8 on conductors, mana 9 | Makes wet rooms and metal veins tactical. |
| `pyrocharge` | Pyro Charge | burning | 90 frames, fire life 25, mana 7 | Small, readable, pairs with oil. |
| `soakcharge` | Soaking Charge | wet | 120 frames, water splash r2, mana 5 | Setup card for crits and lightning. |
| `oilcharge` | Oil Charge | oiled | 420 frames, tiny oil splash, mana 7 | Delayed-combo card for fire crits. |

### Acceptance Criteria

- Status cards update `EntityStatus` rather than parallel fields.
- Visual feedback appears on both enemy sprites and terrain.
- Status effects interact with existing `sampleAndTickStatus` rules.
- Electrical effects use `world.charge` and conductor predicates, not a hidden
  damage-only flag.

## Priority 3: Critical-Hit Modifiers

### Why Third

Random crits would make the game noisier. Conditional crits make the player
plan around materials: wet, oiled, burning, frozen, bloody, or standing in a
specific cell context.

This is the best way to make potions, trails, flask throws, and room prep feel
like combat tools.

### Implementation

Add a pure helper near projectile damage logic:

```ts
function resolveCritMultiplier(
  ctx: Ctx,
  p: Projectile,
  enemy: Enemy,
  baseDamage: number,
  mods: ProjectileModState,
): CritResult
```

Condition sources:

- Enemy status timers: `wet`, `oiled`, `burning`, `frozen`, `electrified`.
- Nearby cells around impact: Water, Oil, Blood, Fire, Ice/Nitrogen, Acid.
- Enemy kind or gore family only if already represented by cells or status.

Rules:

- Crit modifiers are deterministic.
- Multiple satisfied crit cards multiply only up to a crit cap, recommended
  `x3.0` before the existing action `dmgMul` cap is reconsidered.
- Crits should emit a distinct hit flash and audio tick.
- Do not consume statuses in v1; add `consumeStatus` later for rarer cards.

### Attributes

Each crit card should define:

- `condition`: status or material predicate.
- `probeRadius`: cell sample radius.
- `multiplier`: usually x1.5 to x2.0.
- `consumeStatus`: false in v1.
- `bonusEffect`: optional shatter, steam, ignite, or charge burst.
- `manaCost`: card cost.

### Initial Cards

| Card id | Name | Condition | Attributes | Reason |
| --- | --- | --- | --- | --- |
| `critwet` | Critical on Wet | target wet or touching water | x1.8, probe r4, mana 6 | Rewards flooding, Water Trail, and Soaking Charge. |
| `critoiled` | Critical on Oiled | target oiled or touching oil | x2.0, mana 7 | Pairs with Oil Wick and fire setup. |
| `shattercrit` | Shatter Frozen | target frozen or in ice/nitrogen | x2.0 plus small ice burst, mana 8 | Gives freeze a kill payoff. |
| `critburning` | Critical on Burning | target burning or touching fire | x1.6, mana 5 | Rewards fire hazards without replacing fire damage. |
| `bloodmark` | Blood Mark | blood cells near impact | x1.7, probe r5, mana 6 | Makes enemy gore matter and supports bloodseekers. |

### Acceptance Criteria

- `Water Trail + Critical on Wet + Spark` visibly outperforms dry Spark.
- `Frost Charge + Shatter Frozen` is stronger than either card alone.
- Crits do not trigger from invisible state; a player can inspect the room and
  understand why a crit happened.
- Damage numbers remain bounded and do not bypass the compiler's intent.

## Priority 4: Homing Modifiers

### Why Fourth

The existing `wisp` projectile already proves homing is fun and technically
available. Generalizing it as a modifier makes slower projectiles, trigger
payloads, and status setups more reliable.

Homing also helps make complex spell sentences usable on moving enemies without
forcing every player to become a precision shooter.

### Implementation

Extract the current `wisp` steering into a generic helper:

```ts
function applyHoming(ctx: Ctx, p: Projectile, homing: HomingModState): void
```

Rules:

- Retarget every `retargetCadence` frames, not every frame.
- Scan `ctx.enemies` in place; do not allocate arrays.
- Skip targets outside `range`.
- Optional line-of-sight check should use cheap stepped sampling through
  `blocksEntity` or be deferred.
- Clamp velocity to `maxSpeed`.
- Start after `startAge` so projectiles leave the wand visibly before turning.

### Attributes

Each homing card should define:

- `range`: search radius in pixels.
- `accel`: steering acceleration per frame.
- `maxSpeed`: velocity cap.
- `startAge`: frames before steering starts.
- `retargetCadence`: frames between scans.
- `target`: nearest, wounded, wet, burning, bloody, conductive, or boss.
- `lineOfSight`: whether blocking cells prevent targeting.
- `manaCost`: card cost.

### Initial Cards

| Card id | Name | Target rule | Attributes | Reason |
| --- | --- | --- | --- | --- |
| `homing` | Homing Charm | nearest hostile | range 220, accel 0.22, max speed +20%, mana 10 | General-purpose, moderate power. |
| `shorthoming` | Short Homing | nearest hostile | range 110, accel 0.36, start age 4, mana 6 | Cheap correction, not a fire-and-forget card. |
| `bloodseeker` | Bloodseeker | wounded or blood-nearby enemy | range 260, accel 0.30, mana 9 | Ties targeting to gore and combat state. |
| `conductorseek` | Conductive Homing | wet/electrified enemies | range 260, accel 0.34, mana 9 | Rewards water/electric setup. |

### Acceptance Criteria

- Homing works on normal projectile cards without requiring a new projectile
  type.
- Homing and path modifiers compose in a deterministic order: path first, homing
  second, then velocity clamp.
- CPU cost remains bounded with many enemies and projectiles.
- Homing projectiles still collide with terrain and can miss when the room
  layout explains the miss.

## Priority 5: Path Modifiers

### Why Fifth

Path modifiers create the most visible spell variety and are especially strong
when combined with trails. A projectile that snakes, spirals, or returns is not
just a damage carrier; it draws a material shape through the cave.

### Implementation

Path modifiers should alter velocity before substep movement. They should not
teleport projectiles or bypass collision.

Recommended helper:

```ts
function applyPath(ctx: Ctx, p: Projectile, path: PathModState): void
```

Rules:

- Store launch origin and base velocity when the projectile is spawned.
- Use `p.age` for deterministic phase.
- Mutate `p.vx` and `p.vy` gently so collision substeps remain valid.
- Keep path offsets bounded.
- Do not let path modifiers steer black holes unless deliberately enabled.

### Attributes

Each path card should define:

- `kind`: slither, spiral, boomerang, or pingpong.
- `amplitude`: steering strength or offset.
- `frequency`: oscillation rate.
- `phase`: random or deterministic offset.
- `turnRate`: max steering per frame.
- `returnAge`: age when boomerang begins returning.
- `damping`: velocity retained per frame.
- `lifeAdd`: optional extra lifetime.
- `manaCost`: card cost.

### Initial Cards

| Card id | Name | Path | Attributes | Reason |
| --- | --- | --- | --- | --- |
| `slitherpath` | Slithering Path | sine lateral drift | amplitude 0.42, frequency 0.22, mana 6 | Strong readability in tunnels and with trails. |
| `spiralpath` | Spiral Arc | rotating lateral pull | amplitude 0.30, frequency 0.18, mana 7 | Good with status splashes and slow projectiles. |
| `boomerang` | Boomerang | returns after age 34 | return accel 0.30, life +45, mana 9 | Skillful self-crossing path; great with frost/fire. |
| `pingpongpath` | Ping-Pong Path | bounce-like steering | wall ricochet plus life +30, mana 8 | Distinct from existing bounce; more spell-shaped. |

### Acceptance Criteria

- Path projectiles remain collision-honest.
- Trails drawn by path projectiles match the visible projectile motion.
- `Boomerang` does not hit the player unless a later explicit risk card allows
  friendly fire.
- `Slithering Path` and `Spiral Arc` are readable in screenshots without debug
  overlays.

## Supporting Lifetime Fields

Lifetime is not a top-five family for the first content drop, but it should be
implemented as support infrastructure because homing, path, and trail cards need
it.

Add fields:

- `lifeAdd`: flat frames.
- `lifeMul`: multiplier applied once at spawn.
- `expireEffect`: none, fizzle, puff, small splash, or payload trigger.

Initial usage:

- `Boomerang`: `lifeAdd = 45`.
- `Ping-Pong Path`: `lifeAdd = 30`.
- `Water Trail`: no lifetime bonus.
- `Homing`: no lifetime bonus in v1.

Delay standalone cards such as `Increase Lifetime`, `Reduce Lifetime`, and
`Nolla` until the new modifier grammar is stable.

## Potion and Brewing Integration

The spell-card expansion should not leave potions behind. Potions should support
modifier builds without becoming separate UI complexity.

### Existing Potion Baseline

Current instant potion pickups:

- `vigor` -> `regen`
- `levity` -> `levity`
- `stoneskin` -> `stoneskin`
- `swift` -> `swift`
- `torch` -> `torch`

Current brewed elixir cells:

- `Cell.ElixirLife`
- `Cell.ElixirLevity`
- `Cell.ElixirStone`

### V1 Potion Additions Without New Cells

These can ship as pickup-only potion definitions first:

| Potion id | Name | Status field | Effect | Reason |
| --- | --- | --- | --- | --- |
| `berserk` | Berserker Draught | `berserk` | spell damage x1.35, player damage taken x1.15 | Gives offensive potion builds a clear risk. |
| `conductance` | Conductive Tonic | `conductance` | electric modifiers write +50% charge; shock damage to player reduced | Supports wet/electric card packages. |
| `trailbinder` | Trailbinder Draught | `trailbinder` | flask-fed trails spend 1 fewer cell per cadence, min 1; fixed trails gain +25% budget | Supports material-trail builds. |

Required code if pickup-only:

- Extend `EntityStatus` in `src/core/types.ts`.
- Initialize the fields in `createDefaultStatus`.
- Tick the fields in `sampleAndTickStatus`.
- Add pickup definitions to `POTION_DEFS`.
- Add status HUD/sprite cues where appropriate.
- Apply `berserk` in `WandSystem.castActionAt` near the existing `might` perk.
- Apply `conductance` when resolving electric status modifiers.
- Apply `trailbinder` when building `TrailModState`.

### V2 Brewed Elixir Cells

If these potions should become real brewed liquids instead of pickup-only
effects, append new cells:

- `Cell.ElixirBerserk = 36`
- `Cell.ElixirConductance = 37`
- `Cell.ElixirTrailbinder = 38`

Required cell work:

- Append to `Cell` and update `CELL_COUNT`.
- Add `isLiquid` membership.
- Add `MATERIAL_PARAMS`.
- Add color factories and `COLOR_FN` entries.
- Add material info.
- Add build palette support if they are paintable in build mode.
- Add cauldron recipes in `Brewing.ts`.
- Add drink handling in `Player.drink`.

Do not add these cells unless the brewed-liquid version is part of the same
milestone. Pickup-only potions give most of the gameplay value with much less
save-format churn.

### Suggested Brew Recipes

Recipe counts must fit the current small cauldron bowl.

| Brew | Suggested ingredients | Notes |
| --- | --- | --- |
| Berserker Draught | Blood 8 + Coal 4 + Water 2 | Blood explains force; coal/fire explains volatility. |
| Conductive Tonic | Water 8 + Crystal 2 + Blood 2 | Crystal is already a mana/electric signifier. |
| Trailbinder Draught | Slime 7 + Gold 3 + Water 3 | Slime explains material cohesion; gold gives a cost. |

## Card Catalogue Additions

### New Card Ids

Add these to `CardId`:

Trail:

- `watertrail`
- `oiltrail`
- `gunpowdertrail`
- `firetrail`
- `frostwake`
- `acidtrail`

Elemental/status:

- `frostcharge`
- `sparkcharge`
- `pyrocharge`
- `soakcharge`
- `oilcharge`

Critical:

- `critwet`
- `critoiled`
- `shattercrit`
- `critburning`
- `bloodmark`

Homing:

- `homing`
- `shorthoming`
- `bloodseeker`
- `conductorseek`

Path:

- `slitherpath`
- `spiralpath`
- `boomerang`
- `pingpongpath`

Do not put all of them in the live drop pool immediately.

### Recommended Drop Pool Staging

Stage 1, safer core:

- `watertrail`
- `firetrail`
- `frostcharge`
- `sparkcharge`
- `critwet`
- `homing`
- `slitherpath`

Stage 2, combo depth:

- `oiltrail`
- `oilcharge`
- `pyrocharge`
- `shattercrit`
- `shorthoming`
- `boomerang`
- `spiralpath`

Stage 3, volatile/rare:

- `gunpowdertrail`
- `acidtrail`
- `bloodmark`
- `critoiled`
- `critburning`
- `bloodseeker`
- `conductorseek`
- `pingpongpath`

### Mana Cost Bands

- Setup modifier: 5-7 mana.
- Strong status modifier: 8-10 mana.
- Homing modifier: 6-10 mana depending on range.
- Path modifier: 6-9 mana.
- Dangerous material trail: 9-12 mana plus flask or budget constraints.

## UI and Feedback

### Card Data

For each new card:

- Add to `CARD_DEFS`.
- Add a one-line `blurb` that names the real cell/status behavior.
- Add icon support in `src/ui/icons.ts`.
- Add to `MOD_POOL` only when ready for live drops.
- Add to review loadout so it can be tested quickly.

### Visuals

Projectile visuals should show modifiers before impact:

- Trail cards: colored wake already does most of the work.
- Status cards: small orbiting motes on the projectile.
- Crit cards: no projectile effect required, but hit flash must be distinct.
- Homing cards: faint steering glint or curved particle wake.
- Path cards: the motion itself must be readable.

### Audio

Use procedural audio sparingly:

- Trail deposition: low-volume material hiss, cadence-throttled.
- Status impact: short element-specific tick.
- Crit: bright, brief accent.
- Homing lock: optional soft chirp on first target acquisition.
- Path cards: no constant sound unless needed.

## Runtime File Map

Core contracts:

- `src/core/types.ts`
  - Add `CardId` values.
  - Add `CastAction`-reachable status/potion fields if exposed through shared
    interfaces.
  - Add optional new `EntityStatus` fields for potion support.

Card catalogue and compiler:

- `src/combat/wands/cards.ts`
  - Add `CARD_DEFS` entries.
- `src/combat/wands/compiler.ts`
  - Extend `CastAction` and `ModPack`.
  - Apply modifier card ids to new action fields.
  - Add compiler tests for stacking/replacement.
- `src/combat/wands/modState.ts`
  - New projectile mod state and `WeakMap`.
- `src/combat/wands/WandSystem.ts`
  - Build projectile mod states in `markProjectile`.
  - Apply potion/perk damage multipliers consistently.
  - Update `MOD_POOL` and review loadout.

Projectile runtime:

- `src/combat/Projectiles.ts`
  - Route trigger payloads through `ctx.wands.castActionAt`.
  - Add homing helper.
  - Add path helper.
  - Add trail helper.
  - Add status/crit damage helper.
  - Keep entity arrays mutated in place.

Status and potions:

- `src/entities/status.ts`
  - Add new potion timers.
  - Tick and apply side effects.
- `src/entities/Player.ts`
  - Apply new drink effects if new elixir cells ship.
- `src/game/Pickups.ts`
  - Add pickup-only potion definitions.
- `src/game/Brewing.ts`
  - Add recipes only if brewed versions ship.

Rendering and UI:

- `src/render/Lighting.ts`
  - Add light seeds for emissive modified projectiles where needed.
- `src/render/FrameComposer.ts`
  - Add projectile pixel cues if existing projectile sprites are insufficient.
- `src/ui/icons.ts`
  - Add card icons.
- `src/ui/WandBench.ts`
  - Review tools should expose the new cards/potions.
- `src/content/registry.ts` and content adapters
  - Expose new cards, potions, recipes, loadouts, scenarios, icons, validation
    status, and probe coverage to the Builder Asset Database provider.
  - Do not duplicate runtime behavior in content metadata.

Tests and probes:

- `tests/wands.test.ts`
  - Compiler packing, replacement, mana, and trigger behavior.
- New `tests/projectile-mods.test.ts` if helper logic can be isolated.
- New runtime probe script, recommended:
  - `scripts/verify-modifier-cards.mjs`

## Verification Plan

### Static Tests

Minimum targeted tests:

- `npx vitest run tests/wands.test.ts`
- `npx vitest run tests/projectile-mods.test.ts`
- `npm run typecheck`

Before merge:

- `npm test`
- `npm run build`
- `npx vitest run tests/content-registry.test.ts` once Builder metadata adapters
  are added for the new content.

### Runtime Probe

Add `scripts/verify-modifier-cards.mjs` using the existing Playwright pattern.
The probe should:

1. Start from play mode with review loadout.
2. Spawn a stationary enemy in an empty test pocket.
3. Cast `Water Trail + Critical on Wet + Spark`.
4. Assert water cells are deposited and the enemy takes crit-scaled damage.
5. Cast `Frost Charge + Shatter Frozen + Spark`.
6. Assert enemy status becomes frozen and follow-up damage is higher.
7. Cast `Homing + Spark` at an off-angle target.
8. Assert projectile velocity changes toward the enemy.
9. Cast `Slithering Path + Fire Trail`.
10. Assert projectile path is non-linear and real fire cells appear.
11. Cast `Oil Wick + Pyro Charge`.
12. Assert oil/fire interaction is visible but bounded.

Use contained metal or stone cups for liquids and fire in the probe. Do not
single-sample liquids after one frame; poll across several frames because the
simulation is supposed to move them.

### Manual Review Checklist

- Can the player see why the modifier worked?
- Did the spell leave or read real cells?
- Does the card tooltip name the real effect?
- Does the effect stay inside performance budgets with 20 active projectiles?
- Does it behave under trigger payloads?
- Does it behave under multicast?
- Does it behave with `heavy`, `speed`, `spread`, `bounce`, and `infuser`?
- Does it avoid minting valuable materials?
- Does the Builder content registry expose the new card/potion with a typed ref,
  icon/preview status, dependency summary, and review/probe status?
- Does it avoid self-trapping the player by default?

## Balance Guardrails

### Material Economy

- Gold, Catalyst, rare elixirs, and future relic materials are never fixed
  trail outputs.
- Acid and gunpowder trails should be flask-fed or rare with strict budgets.
- Water, fire, and ice can be cheaper because they are common world verbs.
- Oil is stronger than it looks because it chains with fire; keep its budget
  low.

### Damage Economy

- Conditional crits should be the primary damage expansion, not raw damage
  stacking.
- Keep the compiler x4 action damage clamp.
- Add a separate crit cap so `heavy + crit + potion + might` cannot become an
  unbounded boss delete.
- Make `berserk` a risk potion if it ships.

### CPU Budget

- Homing retargets on cadence.
- Trails deposit on cadence and budget.
- Path math is cheap and allocation-free.
- Crit material probes use small fixed-radius loops.
- Runtime probes should include a stress scene with many active projectiles.

### Player Safety

- Trail deposition skips the player AABB briefly after firing.
- Boomerang defaults to no friendly fire.
- Fire and acid trails remain dangerous after they exist in the world; the
  safety rule only prevents immediate muzzle accidents.
- Terrain-changing modifiers must not seal the exit well or progression locks
  in a way the existing fail-open/excavate rules cannot recover from.

## Milestone Plan

### Milestone 1: Runtime Foundation

Deliver:

- `PROJECTILE_MODS` state.
- Extended compiler action fields.
- Trigger payload routing through `ctx.wands.castActionAt`.
- Tests for compiler semantics.

No new live cards yet except hidden review-only entries if useful.

Acceptance:

- Existing wand tests still pass.
- Existing cards behave the same.
- Trigger payloads can cast any supported action through the unified path.

### Milestone 2: Trail and Status Cards

Deliver:

- Trail helper.
- Status helper.
- Cards: `watertrail`, `firetrail`, `frostcharge`, `sparkcharge`,
  `soakcharge`.
- Icons and review loadout entries.
- Runtime probe covering cell deposition and status application.

Acceptance:

- Real cells are written.
- Statuses use `EntityStatus`.
- No high-value materials are minted.

### Milestone 3: Conditional Crits

Deliver:

- Crit helper.
- Cards: `critwet`, `shattercrit`, `critburning`.
- Hit flash/audio feedback.
- Tests or probe assertions for damage increase under condition only.

Acceptance:

- Dry targets do not crit.
- Prepared targets crit reliably.
- Crit cap works.

### Milestone 4: Homing and Path

Deliver:

- Generic homing helper.
- Generic path helper.
- Cards: `homing`, `shorthoming`, `slitherpath`, `boomerang`.
- Stress probe for many projectiles.

Acceptance:

- Steering is readable.
- Collision remains honest.
- No frame spikes in the probe.

### Milestone 5: Potion Support

Deliver:

- Pickup-only `berserk`, `conductance`, and `trailbinder` potions.
- Status fields and HUD/sprite cues.
- Potion/card interaction tests where feasible.

Acceptance:

- Potions support modifier builds without adding new cell ids.
- Effects are capped and tick down through the shared status system.

### Milestone 6: Brewed Elixir Upgrade

Only do this if potion pickups prove valuable.

Deliver:

- Append elixir cells starting at id 36.
- Add cauldron recipes.
- Add drink handling.
- Add material info and icons.

Acceptance:

- Cell ABI is updated append-only.
- Brewed potions are real liquids.
- The cauldron remains small-bowl balanced.

## Open Decisions

1. Should `Water Trail`, `Oil Wick`, and `Gunpowder Wake` be fixed cards, or
   should all material trails except fire/frost require flask material?
2. Should crit modifiers consume the setup status in rare cases, or should all
   v1 crits be non-consuming?
3. Should homing require line of sight in v1, or is terrain collision enough?
4. Should `spark` continue using the "heavy creates extra bolts" behavior, or
   should all projectile damage move to `p.mul` for cleaner crit math?
5. Should new potion pickups ship before new brewed elixir cells?
6. Should path modifiers apply to bombs and black holes, or only fast projectile
   cards?
7. Should card unlocks be staged by depth/biome so elemental cards appear near
   matching materials?

## Recommended First Commit Slice

The safest first implementation slice is:

1. Add `PROJECTILE_MODS`.
2. Add compiler fields for `trail`, `statuses`, `crits`, `homing`, and `path`.
3. Add only review-only cards:
   - `watertrail`
   - `frostcharge`
   - `critwet`
   - `homing`
   - `slitherpath`
4. Add runtime helpers for those five cards.
5. Add tests and `scripts/verify-modifier-cards.mjs`.
6. After validation, add the cards to `MOD_POOL`.

This proves every recommended modifier family with the smallest live-balance
surface.
