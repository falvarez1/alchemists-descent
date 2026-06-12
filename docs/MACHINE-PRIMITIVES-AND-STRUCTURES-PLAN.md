# Machine Primitives and Chain-Reaction Structures Plan

## Purpose

Add a reusable machine vocabulary for generated Rube-Goldberg-style structures:
real cells, real materials, and explicit mechanism links that make one trigger
start a readable chain reaction. The goal is not to script set pieces frame by
frame. The grid should explain why every stage fired, failed, jammed, or opened.

This plan covers:

- New machine primitives: valves, breakable plugs, sensors, counterweights,
  one-shot relays, wire/link visualization, and failure-safe bypass rules.
- Four generated structure families: Powder Mill, Alchemy Clock, Kiln Elevator,
  and Crystal Relay Vault.
- Runtime contracts, Builder support, worldgen placement, tests, and validation.

## Review Amendments (2026-06-12, pre-implementation audit)

The plan was audited against the post-prefab-program codebase (commits through
8127d79). The architecture and save-compatibility analysis hold. The following
corrections are folded into the sections below:

1. **One output convention, not two.** Relays do not need `outputTargetId` —
   every mechanism already has exactly one output (`targetId`). The model
   generalizes to: *actuators* (door, valve, relay) aggregate their inputs
   with the existing `logic` field ('and'/'or'/'sequence'); everything else
   (plate, lever, brazier, scale, buoy, chargelatch, sensor, plug,
   counterweight, **and a fired relay**) is a trigger with one `targetId`.
   `EditorLink.kind` stays `'triggerDoor'` (schema-stable; its meaning widens
   to "trigger drives actuator").
2. **Plugs break by material, not by cause lists.** `breakBy` arrays would
   require cause attribution hooks all over the sim — and they are redundant:
   the material IS the break profile (wood burns, glass shatters from blast,
   stone resists fire, metal resists everything). A plug is recorded body
   cells + `breakFrac` (default 0.5): when that fraction of its cells is
   destroyed or transformed — by anything — it fires once. Grid-honest and
   far simpler.
3. **No `sluice` kind.** A sluice is a wide valve. One `valve` kind with
   w/h/material/oneShot/autoClose params (resolves Open Question 1).
4. **No `pressure` sensor type.** `plate` already reads entity+cell pressure;
   `weight` covers cells. Sensor types: heat, liquid, weight, charge, material.
5. **Structure families ship as builtin prefabs**, not a bespoke
   `MachineStructureDef` code path (resolves Open Question 2). The existing
   pipeline (`world/prefabs/registry.ts` → `place.ts`: seeded site search,
   ledger, anchor tunneling via connectToCaves, instantiation through
   `game/instantiate.ts`, earnability fixpoint tests, findability audit)
   already provides every placement helper Phase 4 asked for. Families are
   authored by `scripts/gen-machine-prefabs.mjs` into
   `src/world/prefabs/builtin/`, gated per biome by a `machines` budget in
   `config/gen.ts`, placed by a second `placePrefabs` call on a forked
   stream (`hashSeed(seed, 'machines')`).
6. **File map fixes.** `src/game/runtime.ts` is only the LevelRuntime
   constructor — untouched. Mechanism persistence lives in `game/Levels.ts`
   level blobs (whole `Mechanism[]` JSON), so new optional fields serialize
   for free. The critical integration file the plan omitted is
   **`src/game/instantiate.ts`** — the ONE shared object/link instantiation
   pass for Builder playtest and worldgen prefabs; wiring new kinds there
   makes them work in both worlds. `src/sim/CellType.ts` / `colors.ts` need
   NO changes: Glass (31), Ash (32), Coal (28) already exist, and adding cell
   ids is an append-only ABI event this plan does not need.
7. **GEN_VERSION bumps to 3.** The machine placement pass changes generated
   worlds, so expedition saves from v2 retire honestly via the existing
   genVersion guard ("THE DEPTHS HAVE SHIFTED"). The earthen golden hashes
   stay green: machine placement uses a forked RNG stream after cave
   generation.
8. **Relays are one-shot in v1.** `relayMode: 'repeat'` is deferred;
   `delayFrames` is a plain field, not a mode.

## Current Baseline

The current runtime already has a strong foundation:

- `src/game/Mechanisms.ts` owns real-cell doors and sensors.
- `MechanismKind` currently supports `door`, `plate`, `lever`, `brazier`,
  `scale`, `buoy`, and `chargelatch`.
- Doors aggregate linked triggers with `and`, `or`, and `sequence` logic.
- Mechanisms can record structural body cells and fail open if damaged.
- `structureStrike` lets explosions, projectile impacts, and dig hits interact
  with levers and rune vaults without direct cross-module calls.
- Builder documents already model objects, links, lights, hazard emitters, and
  mechanism compile steps.
- `world/structures.ts` already places generated landmarks, vaults, pickups,
  mechanisms, and rune vaults after cave generation.
- The prefab library can capture reusable cells, objects, links, and lights.
- `src/game/instantiate.ts` is the single shared instantiation pass: Builder
  playtest compiles and worldgen prefab placement both turn
  EditorObject/EditorLink records into live mechanisms through it.
- `src/world/prefabs/` already places builtin PrefabDef chunks into generated
  levels: seeded site search with progressive relaxation, PlacementLedger
  reservation, anchor tunneling via connectToCaves, sealed-anchor resealing.
- Mechanisms persist wholesale (`Mechanism[]` JSON in level blobs), so new
  optional fields survive save/resume with zero migration.

The next step should extend this vocabulary instead of adding a separate
script/event graph system.

## Design Rules

1. **The grid explains it**
   A valve opens because a link fired. A plug breaks because fire, blast, acid,
   impact, pressure, or charge changed real cells. A counterweight moves because
   material mass entered or left a zone.

2. **Contraptions are inspectable**
   Builder, debug overlays, and generated structures must expose trigger zones,
   links, thresholds, and current readings.

3. **Generated machines must be fail-safe**
   A destroyed or jammed chain should degrade into a bypass, a delayed broken
   gate, a diggable route, or alternate reward tier. It must not hard-lock the
   level.

4. **Runtime scans stay bounded**
   Sensors should scan small zones, preferably at fixed cadences when possible.
   Avoid broad per-frame searches over the whole world. This matters because
   simulation, frame composition, lighting, and render upload are already the
   dominant frame costs.

5. **Builder and worldgen share primitives**
   Generated machine rooms should be made from the same object/link schema that
   Builder can author and validate.

## Machine Primitives

### 1. Valves and Sluice Gates

**Problem**

Liquids and powders need a reliable, visible way to be held back and released.
Doors are too large and semantic for this role; a valve should be a small
material gate embedded in a channel.

**Runtime model**

Add one `MechanismKind` variant:

- `valve`: a small material gate that blocks a channel until opened. A
  *sluice* is simply a wide valve (no separate kind — Open Question 1
  resolved).

Fields on `Mechanism`:

```ts
material?: number;          // Cell type used when closed: Metal, Stone, Wood, Glass
oneShot?: boolean;          // stays open once fired
autoCloseFrames?: number;   // optional timed valve (ignored when oneShot)
```

**Behavior**

- A valve is an ACTUATOR: it aggregates its linked triggers exactly like a
  door (`logic` 'and'/'or'/'sequence' reused verbatim).
- Closed valve stamps real cells into the world; opening retracts them over
  several frames (the door dissolve pattern, smaller).
- Optional auto-close restamps cells only if doing so would not crush the
  player or enemies (the setDoorCells occupancy check, reused).
- Valve fail-open is PHYSICAL: destroyed valve cells are an open channel —
  no body-watch metadata needed; the grid already explains it.

**Builder support**

- Add a `valve` object kind (slab-style, centered on click like doors).
- Author controls: width, height, material, one-shot, auto-close frames.
- Link any sensor, plug, counterweight, relay, lever, plate, etc. to the
  valve through the LINK tool.
- Show valve footprint in the editor canvas.

**Tests**

- Unit: closed valve blocks liquid/powder; open valve releases it.
- Safety: auto-close refuses to crush entities.
- Persistence: valve state survives level save/resume.

### 2. Breakable Plugs

**Problem**

Generated chain reactions need predictable weak links: wood fuses, ash plugs,
glass membranes, coal seals, stone blast plugs, and metal safety shutters.

**Runtime model**

Add `MechanismKind`:

- `plug`

Fields:

```ts
material?: number;   // plug cell type (shares the valve field)
breakFrac?: number;  // fraction of body cells gone/transformed -> break (default 0.5)
```

**Behavior**

- A plug is real cells plus metadata that watches its recorded body.
- It breaks (fires once, `state = 1`) when `breakFrac` of its recorded cells
  are gone or transformed — BY ANY CAUSE. No `breakBy` lists: the material
  IS the break profile, because the sim already implements it (amendment 2).
- Broken plugs remain broken; they are never restored by door logic, and the
  generic groan/fail-open body-watch skips them (breaking is their job).
- A relay with `outputAction: 'break'` can detonate a plug directly: its
  cells shatter into debris particles and the plug fires.

**Material profiles (emergent, not configured)**

- Wood plug: burns from Fire, Lava, Ember.
- Ash/Sand plug: collapses under disturbance, blast, or liquid flow.
- Glass plug: shatters from blast, acid, projectile dig.
- Coal plug: ignites and becomes part of a fire chain.
- Stone plug: breaks from explosion, black hole, meteor, or dig.
- Metal plug: effectively unbreakable; opens only through relay 'break'.

**Builder support**

- Add a plug object with a material select (wood/ash/glass/coal/stone/metal).
- Link plug break output to valves, doors, or relays (one `targetId` out).
- Popover shows material and live intact-cell fraction.

**Tests**

- Fire destroys a wood plug; the break output fires exactly once.
- Clearing cells below breakFrac does NOT fire; crossing it does.
- A relay 'break' action destroys the plug's cells and fires it.
- Metal plug survives a standard explosion radius.

### 3. Generic Sensors

**Problem**

Existing `plate`, `scale`, `buoy`, `brazier`, and `chargelatch` are useful, but
generated machines need a consistent sensor contract so templates can ask for
"heat", "liquid", "charge", "weight", or "pressure" without bespoke code per
structure.

**Runtime model**

Keep existing specialized mechanisms for readability, but add a generic layer:

- `sensor`

Suggested fields:

```ts
sensorType?: 'heat' | 'liquid' | 'weight' | 'charge' | 'material';
materialFilter?: number[];
threshold?: number;
zone?: { x0: number; y0: number; x1: number; y1: number };  // already exists
latch?: 'momentary' | 'timed' | 'permanent';
latchFrames?: number;  // 'timed' hold (default 420, the plate convention)
```

(`'pressure'` dropped — `plate` already reads entity+cell pressure and
`weight` covers cells; amendment 4.)

**Mapping to existing mechanisms**

- `plate` remains the visible pressure plate.
- `scale` remains the visible weight pan.
- `buoy` remains the visible liquid basin.
- `brazier` remains the visible heat latch.
- `chargelatch` remains the visible charge latch.
- Generic `sensor` supports hidden/generated checks and future templates.

**Sensor semantics**

- Heat: Fire, Lava, Ember cells in zone.
- Liquid: any `isLiquid` cell, optionally filtered to Water, Acid, Healium, etc.
- Weight: non-empty, non-gas, non-fire cells in zone (the scale's read).
- Charge: any `world.charge[i] > 0` (the chargelatch's read, latch-mode aware).
- Material: exact `materialFilter` count, useful for "fill with sand" or
  "acid reached here" conditions.

Zone scans run on a 4-frame cadence staggered by mechanism id; the latch
covers the latency. Sanitizers clamp zones (~40x40 hard cap) so a malformed
prefab cannot create giant scans.

**Builder support**

- Placeable visible sensors remain preferred.
- Add an "advanced sensor" object for hidden/generated logic.
- Popover shows live reading, threshold, latch mode, and linked outputs.

**Tests**

- Sensor readings are deterministic for a fixed world state.
- Momentary/timed/permanent latch modes behave independently.
- Charge sensors latch from chain lightning and electrified water.

### 4. Counterweights

**Problem**

Rube-Goldberg machines need a physical-looking bridge between material motion
and mechanism motion. A counterweight lets falling sand, gold, stone, or water
explain why a gate or platform moved.

**Runtime model**

Add `MechanismKind`:

- `counterweight`

Suggested fields:

```ts
zone?: { x0: number; y0: number; x1: number; y1: number };
threshold?: number;
axis?: 'vertical' | 'horizontal';
travel?: number;
state?: number;     // progress or latch
reading?: number;   // current material mass
```

**Behavior**

- Reads mass in its pan or bucket zone.
- When threshold is reached, it latches and emits output.
- Optional visual effect: a small metal/stone block lowers or raises along a
  short rail by clearing/stamping real cells or by renderer overlay.
- It should not move large chunks of terrain in v1. Use it primarily as a
  readable trigger.

**Builder support**

- Place object with pan zone and output link.
- Show pan zone and threshold.
- Optional preset: sand bucket, gold bucket, stone bucket, water bucket.

**Tests**

- Material mass triggers once threshold is met.
- Removing material before threshold prevents activation.
- Counterweight links work in `and`, `or`, and `sequence` door logic.

### 5. One-Shot Relays

**Problem**

Complex machines need reliable event handoff: "when this plug breaks, open that
valve, ignite this fuse, then latch this output". Doing that with only doors
and sensors makes templates fragile.

**Runtime model**

Add `MechanismKind`:

- `relay`

Fields:

```ts
delayFrames?: number;   // wait between inputs-satisfied and firing (default 0)
outputAction?: 'activate' | 'ignite' | 'break' | 'strike';  // default 'activate'
```

**Behavior**

- A relay is BOTH an actuator and a trigger: it aggregates its inputs like a
  door (things whose `targetId` points at it), and once fired it counts as a
  satisfied trigger for its own single output (`targetId` — no separate
  `outputTargetId`; amendment 1).
- On inputs-satisfied it waits `delayFrames`, then fires ONCE and latches
  (`state = 1`); v1 relays never re-fire (amendment 8).
- `outputAction` adds a world effect at the target's position on fire:
  'activate' = none (pure logic handoff), 'ignite' = seed real Fire cells,
  'break' = detonate a target plug, 'strike' = emit `structureStrike`.
- Relay state is plain numeric fields — saved with the mechanism list.
- A relay body (small footing, like a lever's) follows the standard
  fail-open watch: a destroyed relay eventually counts as fired.

**Builder support**

- Place relay nodes with delay and output action.
- Draw a small rune/gear node with link lines.
- Popover shows queued/fired state.

**Tests**

- One-shot fires once.
- Delay persists through save/resume.
- Relay output can open a valve, ignite a cell, and activate a door trigger.

### 6. Link Visualization and Debugging

**Problem**

As machines become more complex, invisible links become the main debugging risk.

**Runtime / Builder support**

- Builder already has links. Extend visualization with:
  - color by link type: sensor, valve, relay, plug, door.
  - animated pulse when a trigger fires.
  - live labels: reading / threshold, fired, latched, broken, jammed.
- Debug god mode can add a future console command:
  - `machine.trace`
  - `machine.fire <id>`
  - `machine.reset <id>`
  - `machine.dump`

**Tests**

- Browser verification checks that selected mechanisms show link paths and
  popovers without native browser tooltips where custom popovers exist.

### 7. Failure-Safe Bypass Rules

**Problem**

A generated contraption can fail because the player destroyed a channel, burned
the wrong support, drained a reservoir, or killed a sensor.

**Rules**

- Every generated machine has a `criticalPath` list.
- Any critical trigger destroyed enters a timed fail-open path.
- Any reward vault has at least one physical bypass: diggable stone, blast plug,
  alternate shaft, or delayed broken gate.
- Progression-critical machines should never use metal-only locks without a
  non-metal bypass.
- Structure generator must validate reachability before accepting placement.

**Runtime support**

Use the existing `body` / `broken` mechanism fields for most failure handling.
Add `critical?: boolean` and `failOpenTargetId?: number` if generated machines
need stricter routing.

**Tests**

- Destroy every trigger in each generated structure family; final route opens
  or remains physically breachable.
- Findability audits include machine-room entrances, exits, and reward cells.

## Structure Families

**Implementation note (amendment 5):** each family ships as one or more
builtin prefabs (`src/world/prefabs/builtin/machine-*.json`) authored by
`scripts/gen-machine-prefabs.mjs` — cells built programmatically, objects and
links using the new primitive kinds, anchors marking the entrance(s). The
"Generation algorithm" lists below describe the prefab's internal layout; the
site search / reservation / connection steps are the existing `placePrefabs`
pipeline and are NOT reimplemented per family. Variants are separate prefab
files sharing the generator's helpers.

### 1. Powder Mill

**Theme**

An old powder-processing room with wood fuse tracks, coal/ash pockets, sand
hoppers, gunpowder magazines, metal safety doors, and a stone reward chamber.

**Primary trigger**

Player lights a brazier, burns a fuse, or throws fire into the ignition slot.

**Chain**

1. Fire travels through a wood/coal fuse.
2. Fuse burns a wooden plug.
3. Plug releases gunpowder or exposes a gunpowder vein.
4. Blast breaks an ash/stone plug.
5. Sand hopper releases material onto a scale/counterweight.
6. Counterweight opens a safety valve or door.
7. Water/Healium spill douses the fire and reveals the final reward.

**Primitives used**

- Wood/coal plugs.
- Heat sensor or brazier.
- Blast-sensitive plug.
- Sluice gate for sand hopper.
- Counterweight.
- Door or valve.
- Fail-open body on every critical trigger.

**Generation algorithm**

1. Pick a side-region pocket away from spawn and portal.
2. Stamp a rectangular mill chamber with two to four vertical compartments.
3. Place fuse route from entrance to powder magazine.
4. Place sand hopper above a scale/counterweight.
5. Place blast plug between powder magazine and hopper release.
6. Place water douse basin at the end to keep the aftermath playable.
7. Connect entrance to main cave path.
8. Validate entrance, trigger, and reward reachability.

**Variants**

- Dry mill: more gunpowder, less water, higher explosion risk.
- Snow-damp mill: snow/ice slows fire, safer but more puzzle-like.
- Coal furnace mill: coal must ignite before gunpowder is exposed.
- Broken mill: one valve already jammed, requiring alternate dig/blast route.

**Rewards**

- Card tome, gold, potion pickup, or flask material cache.

**Tests**

- Deterministic layout for fixed seed.
- Triggered chain opens final chamber within frame budget.
- Destroying fuse or scale fail-opens final path.

### 2. Alchemy Clock

**Theme**

A vertical glass-and-stone apparatus that routes liquids through basins, valves,
material filters, and timed overflow paths.

**Primary trigger**

Player pours a liquid into the top intake or breaks an intake plug.

**Chain**

1. Top reservoir fills.
2. Liquid sensor opens first valve.
3. Liquid drains into a second basin.
4. Acid or water dissolves/breaks a material-specific plug.
5. Released sand/gold fills a counterweight pan.
6. Counterweight rotates flow into a final channel.
7. Correct final liquid opens the reward chamber or fills a usable flask pool.

**Primitives used**

- Liquid/material sensors.
- Glass sluice gates.
- Acid-sensitive and water-sensitive plugs.
- Counterweight.
- One-shot relay for valve sequencing.
- Optional timed auto-close valve.

**Generation algorithm**

1. Place a tall room near a vertical cave pocket.
2. Build three stacked basins with glass/stone walls.
3. Use narrow one-cell or two-cell channels to control flow.
4. Insert valves between basins.
5. Place counterweight and final door beside bottom basin.
6. Connect entrance near top or middle, reward near bottom.
7. Include overflow drains so liquids do not flood the level indefinitely.

**Variants**

- Water clock: simple fill/drain sequence.
- Acid clock: corrosive stage opens a side route.
- Healium clock: reward is safe healing pool after sequence completes.
- Teleportium clock: final chamber offers shortcut but can disorient.

**Rewards**

- Potion cluster, elixir basin, safe cauldron, or hidden card.

**Tests**

- Basin thresholds read correct liquid counts.
- Overflow drains keep worst-case liquid volume bounded.
- Wrong material produces alternate but non-locking outcome.

### 3. Kiln Elevator

**Theme**

A furnace-powered traversal machine that uses coal, lava, water, steam, and
falling ballast to open an ascent/descent route.

**Primary trigger**

Player ignites coal, opens a lava sluice, or feeds water into the boiler.

**Chain**

1. Coal or lava heats a kiln chamber.
2. Heat sensor latches furnace state.
3. Valve releases water onto hot material.
4. Steam/fire breaks weak ash plugs.
5. Sand or stone ballast drops into counterweight bucket.
6. Counterweight opens a vertical gate or bridge.
7. Player gains access to a high platform, lower shaft, or side vault.

**Primitives used**

- Heat sensor.
- Valve for lava/water.
- Ash plug.
- Counterweight.
- Relay delay to avoid immediate all-at-once release.
- Door or platform gate.

**Generation algorithm**

1. Pick a vertical region with headroom.
2. Stamp furnace at bottom and lift/shaft at side.
3. Put coal/lava in a shielded chamber.
4. Place water reservoir above or beside furnace.
5. Place ballast hopper above counterweight.
6. Connect output to a traversal reward: bridge, shaft, or elevated tome.
7. Add cooling/dousing material so the structure remains playable after firing.

**Variants**

- Coal-start: player supplies fire.
- Lava-start: player opens lava valve and must avoid hazard.
- Water-start: player pours water into boiler.
- Broken elevator: lift does not move, but counterweight opens a maintenance
  crawlspace.

**Rewards**

- Traversal shortcut, elevated treasure, or route around a dangerous cave.

**Tests**

- Heat sensor fires from Fire/Lava/Ember.
- Counterweight output opens final path.
- Lava and water volume remain bounded after activation.

### 4. Crystal Relay Vault

**Theme**

A magical circuit vault made of crystal nodes, metal/water conductors, glass
insulators, charge latches, and rune-style relay doors.

**Primary trigger**

Player hits the first crystal node with Spark Bolt, Chain Lightning, or another
charge source.

**Chain**

1. First crystal/metal node receives charge.
2. Charge latch opens a small valve.
3. Water flows into a conductor channel.
4. Conductive path energizes second latch.
5. Relay fires a rune strike or opens a second door.
6. Final relay detonates a small plug, opens vault, or powers portal cache.

**Primitives used**

- Charge sensor / charge latch.
- Material sensor for water-filled conductor channels.
- One-shot relay.
- Glass/stone plugs.
- Rune-door style dissolving barrier.
- Link visualization with violet/green state language.

**Generation algorithm**

1. Pick a side room with enough width for three nodes.
2. Stamp crystal nodes in visible sequence.
3. Place water reservoirs separated by valves.
4. Use glass walls to prevent accidental flooding.
5. Link charge latch to valve, valve to liquid sensor, liquid sensor to relay.
6. Put reward behind final rune/stone door.
7. Validate that at least one player spell can trigger the first node.

**Variants**

- Dry circuit: player must pour water or break reservoir.
- Wet circuit: player only needs spark/charge.
- Broken insulator: accidental water leak partially solves the chain.
- Overcharged circuit: wrong blast opens bypass but destroys some reward.

**Rewards**

- Rare card, upgraded wand frame, gold cache, or teleportium shortcut.

**Tests**

- Charge latches activate through water/metal paths.
- Relay sequence completes once and persists through save/resume.
- If the circuit is destroyed, final chamber becomes physically breachable.

## Runtime Implementation Plan

### Phase 1: Data Contracts and Serialization

Files:

- `src/core/types.ts`
- `src/builder/document.ts`
- `src/game/instantiate.ts` (the shared instantiation pass — wiring here
  covers Builder playtest AND worldgen prefabs)

Tasks:

1. Extend `MechanismKind` with `valve`, `plug`, `sensor`, `counterweight`,
   and `relay` (no `sluice` — amendment 3).
2. Add optional fields to `Mechanism` for material, sensor type, latch mode,
   relay delay/action, valve one-shot/auto-close, and break fraction.
3. Extend `EditorObjectKind` with matching Builder object kinds.
4. Save/load needs NO shape change: `Mechanism[]` persists wholesale in level
   blobs; all new fields are optional so old saves remain valid.
5. Sanitization defaults live in `instantiateObjects` param reads (the
   paramNum convention) plus zone clamps; prefab capture already round-trips
   arbitrary object params.

Acceptance:

- Old expeditions load without migration errors.
- Existing mechanism tests still pass.
- New mechanism fields do not require non-null assertions in runtime hot paths.

### Phase 2: Runtime Primitive Behavior

Files:

- `src/game/Mechanisms.ts`
- `src/render/FrameComposer.ts`

(`src/sim/CellType.ts` / `colors.ts` untouched — no new cell ids needed;
Glass/Ash/Coal exist. Amendment 6.)

Tasks:

1. Implement valve/sluice open/close cell stamping.
2. Implement plug body watching and one-shot break outputs.
3. Implement generic sensor readings with bounded `zone` scans.
4. Implement counterweight threshold/latch behavior.
5. Implement relay queue, delay, and output actions.
6. Render visible states:
   - valve open/closed marks.
   - cracked/broken plugs.
   - sensor readings.
   - counterweight pan fill.
   - relay fired/queued pulse.
7. Reuse existing particle/audio language for activation and failure.

Acceptance:

- One mechanism update pass handles old and new mechanisms.
- No whole-world scans are introduced.
- Destroying a critical trigger follows fail-open behavior.

### Phase 3: Builder Authoring

Files:

- `src/builder/Builder.ts`
- `src/builder/document.ts`
- `src/builder/compile.ts`
- `src/builder/validate.ts`
- `src/builder/prefablib.ts`
- `src/builder/prefabPanel.ts`
- `src/styles/main.css`
- `docs/BUILDER.md`

Tasks:

1. Add placeable objects for new primitives.
2. Add object popovers/inspector controls:
   - valve material, size, mode.
   - plug material and break profile.
   - sensor type, material filter, threshold, latch mode.
   - counterweight zone and threshold.
   - relay delay and output action.
3. Extend link tool validation:
   - sensors, plugs, counterweights, relays, levers, braziers, plates,
     scales, buoys, charge latches can output (one out-link each).
   - doors, valves, relays can receive; plugs can receive only from a relay
     (the 'break'/'ignite'/'strike' detonator pattern).
   - sequence chains reject anything that can never un-fire: brazier,
     chargeLatch (existing), plus plug, counterweight, relay, and
     permanent-latch sensors.
4. Generalize the findability FIXPOINT in `builder/validate.ts`: valves
   stamp/block like doors and open when earnable; relays chain (a relay is
   earnable when its inputs are, and then counts as a satisfied input for
   its own target); plugs count as breachable-by-design (their material is
   non-Metal by validation rule when they gate progression).
5. Add link visualization colors and live reading overlays.
5. Ensure prefabs capture all new object fields and links.
6. Update Builder docs.

Acceptance:

- A user can author a three-step chain in Builder and playtest it.
- Prefab capture/paste preserves new mechanism links and local ids.
- Validation catches impossible sequence links, missing targets, and unreachable
  critical outputs.

### Phase 4: Machine Prefabs in Worldgen (amendment 5)

Files:

- New `scripts/gen-machine-prefabs.mjs` (authors the family JSONs)
- New `src/world/prefabs/builtin/machine-*.json`
- `src/config/gen.ts` (per-biome `machines: PrefabBudget`, GEN_VERSION 3)
- `src/world/CaveGenerator.ts` (second placePrefabs call, forked stream)
- `tests/prefabs-worldgen.test.ts` (earnability fixpoint over new kinds)
- `tests/machines.test.ts`

Tasks:

1. NO new placement framework: `placePrefabs` already does site search with
   progressive relaxation, ledger reservation (spawn/portal/key-vault/
   onboarding are pre-reserved; structures dodge reserved rects), anchor
   tunneling to the main path, and shared instantiation.
2. Author the four families as builtin prefabs via the generator script
   (cells + objects + links + anchors), tagged `machine` plus a family tag.
3. Gate by biome through `GEN[biome].machines.tags`:
   - Powder Mill: earthen, timber, scorched.
   - Alchemy Clock: flooded, fungal, crystal.
   - Kiln Elevator: scorched, volcanic, timber.
   - Crystal Relay Vault: crystal, frozen, earthen.
4. Budget: `count: [0, 1]` per level ([1, 1] where the family list is rich);
   placed on `hashSeed(seed, 'machines')` so the main stream and the
   'prefabs' stream stay byte-identical.
5. Bump `GEN_VERSION` to 3 (amendment 7).

Acceptance:

- Earthen golden hashes stay green (forked stream, post-cave pass).
- Findability audit passes with machines placed; reward cells reachable
  after the earnability fixpoint opens earnable actuators.
- Same seed -> identical machine placement (determinism test).
- An exhausted site search logs in DEV and skips cleanly (existing behavior).

### Phase 5: Verification and Tooling

Files:

- `tests/*.test.ts`
- `scripts/verify-builder-pro.mjs`
- New `scripts/verify-machines.mjs`
- `scripts/verify-findability.mjs`
- `docs/FEEL.md`
- `docs/DESIGN.md`

Tasks:

1. Unit tests for each primitive.
2. Golden-ish tests for deterministic structure placement using fixed seeds.
3. Browser verification:
   - spawn each structure in an isolated test level.
   - trigger it.
   - assert final door/valve/reward path opens.
4. Failure tests:
   - destroy each critical trigger.
   - assert fail-open or bypass.
5. Performance probes:
   - worst-case level with several inactive machines.
   - worst-case triggered machine with particles/liquids.
   - compare F3 frame budgets before/after.

Acceptance:

- `npm test` covers primitive contracts.
- Browser verification covers at least one full chain per structure family.
- Worst-case machine level stays inside current frame budget targets or has
  documented follow-up work.

## Data and Save Compatibility

New fields must be optional. The current save format stores `Mechanism[]` in
level blobs, so adding optional fields is low risk if default semantics are
well-defined:

- Missing `latch` defaults to 'timed' (the 420-frame plate convention).
- Missing `material` defaults to `Cell.Metal` for valves and `Cell.Stone`
  for plugs.
- Missing `zone` means the sensor/counterweight is inert and fails
  validation in Builder.
- Missing relay fields means `delayFrames: 0`, `outputAction: 'activate'`.

Worldgen-side: placing machines changes generated worlds, so `GEN_VERSION`
bumps to 3 and v2 expedition saves retire honestly on resume via the
existing guard (amendment 7). Builder documents and prefabs are unaffected.

When importing prefabs/docs, sanitizers should clamp sizes, thresholds, and
zones to reasonable limits so a malformed prefab cannot create massive scans.

## Performance Budget

The risk is not one machine; it is many small sensors scanning zones every
frame. Keep these constraints:

- Sensor zones should stay under roughly 200 cells in v1.
- Large reservoirs should be sensed through a smaller drain/measurement zone,
  not their full volume.
- Expensive readings can run every 4th or 8th frame if the visual latch covers
  the latency.
- Relays should be event/edge driven once a sensor reports active.
- Renderer overlays should draw only mechanisms near the camera, matching the
  existing `FrameComposer` pattern.

## Documentation Updates

Update these docs as implementation lands:

- `docs/BUILDER.md`: authoring controls, validation, prefab capture.
- `docs/FEEL.md`: machine readability, audio/visual language, failure-safe
  philosophy.
- `docs/DESIGN.md`: generated structure families and progression placement.
- `README.md`: short controls/feature summary once player-facing.
- `docs/UPGRADE-DELTA.md`: note how the new primitives relate to older
  mechanism/rune recommendations.

## Suggested Commit Slices

1. **Mechanism contract expansion**
   Types, save compatibility, compile stubs, tests for old behavior unchanged.

2. **Runtime primitives**
   Valves, plugs, generic sensors, counterweights, relays, unit tests.

3. **Builder authoring**
   Object placement, popovers, links, validation, prefab persistence.

4. **Machine prefabs + worldgen placement**
   Generator script, the four family prefabs (Powder Mill, Alchemy Clock,
   Kiln Elevator, Crystal Relay Vault), GEN machines budget, GEN_VERSION 3,
   determinism + earnability tests.

5. **Browser verification and docs**
   End-to-end scripts, screenshots if useful, docs refresh.

## Open Questions — RESOLVED (review audit)

1. Separate object types vs generic `gate` presets → **separate `valve` and
   `plug` kinds** (clear inspectors, clear popovers); `sluice` folded into
   valve as "a wide valve".
2. Prefabs vs code-generated stamps → **builtin prefabs through the existing
   pipeline** (amendment 5); a generator script authors them so layout logic
   stays reviewable code.
3. Debug console commands → **deferred**; headless probes drive
   `window.__game.ctx` directly, which covers the QA need. `machine.*`
   commands remain a follow-up.
4. Normal runs vs debug toggle → **normal runs immediately**, conservative
   budget (0–1 per level), because the CI earnability fixpoint + multi-seed
   findability audit gate regressions and GEN_VERSION retires stale saves.
5. Wrong-material outcomes → **non-punitive alternate/slower paths**, per the
   fail-open design rule; never a hard lock, never reward destruction beyond
   what the player's own chaos caused.

## Recommended First Implementation Target

Start with **valves, plugs, and generic sensors**, then implement a minimal
Powder Mill as the first full-chain structure. That path proves the whole stack:

- Builder can author a chain.
- Runtime can fire a material-driven sequence.
- Worldgen can place and validate it.
- Failure-safe rules prevent hard locks.
- Tests can simulate a complete structure without relying on manual play.

Once Powder Mill works, the Alchemy Clock, Kiln Elevator, and Crystal Relay
Vault should mostly be new templates over the same primitives.
