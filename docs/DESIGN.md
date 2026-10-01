# Breathing Works (An Alchemist's Descent) — Game Design

## Current contract: the run (Breathing Works, 2026-09)

The game is a free web roguelite: **a ~20-minute run through a living refinery, four floors, and death costs you something.** The plan is [plans/2026-09-26-breathing-works-overhaul.md](plans/2026-09-26-breathing-works-overhaul.md). Player-facing names come from `config/brand.ts`; save keys and storage prefixes deliberately keep the old names.

**Four floors** (`config/worldgraph.ts`), the refinery read as an organism:

| Floor | id | Name | Biome | Signature | Boss |
| --- | --- | --- | --- | --- | --- |
| 1 | `d1` | The Bellows | earthen (hand-built Works) | water, steam, the breathing cycle | — |
| 2 | `d2` | The Rot Gardens | fungal | growth, spores, marsh gas that ignites | — |
| 3 | `d3` | The Drowned Cisterns | flooded | water and electricity | the Sunken Leviathan (`boss: 'leviathan'`) |
| 4 | `d4` | The Kiln Heart | volcanic | lava, fire, steam, glass | the Kiln Colossus (`boss: 'colossus'`, final) |

Bosses are keyed on `LevelDef.boss`, never inferred from depth. Floors five to eight and the Gilded Vault branch are cut from the campaign (their biomes remain for the Builder). The transition curtain, the arrival banner, the Sanctum, the death screen and the ledger all say "Floor N of 4".

**Return phials.** A run carries three. A death spends one and the alchemist returns to the last checkpoint with the world intact (ragdoll, gold spill, waystone respawn — unchanged). The D1 refuge rest and every Sanctum between floors pour one back (never above three; the refuge re-arms once you have walked away from it). Dying with none left ends the run. The HUD shows three phial glyphs above the vitals that drain and refill; the death screen shows the same row and reads "Return with a phial (2 left)", or, on the last death, "Read the ledger". Phials and the run's counters live in the expedition save (`ExpeditionSave.run`).

**The run ends** on the Colossus (victory), on a death with no phial (fallen), or when the player abandons it from the pause menu. `game/RunDirector.ts` then writes the meta profile, retires the expedition save and emits `runEnded` with a `RunSummary` (`core/run.ts`). A run replaced by a new one is recorded as abandoned without a ledger. The **run ledger** (`ui/RunSummary.ts`) shows the outcome headline ("The Kiln is quiet." / "You fell in the Rot Gardens."), the epitaph, the four floors, play time without pauses, kills, alchemical kills and the best chain (counted from `alchemyKill`), deaths, gold and cards found, any kit the run unlocked, and four buttons: **Descend again** (focused; a fresh seed with the chosen kit, playing in about a second, no page reload), **Save clip** (`clipRequested`), **Copy share line**, **Title**. Victory no longer reloads the page.

**Starting kits** (`content/kits.ts`). A fresh run starts with its kit only:

| Kit | Wand I | Wand II | Satchel | Flasks | Unlock |
| --- | --- | --- | --- | --- | --- |
| spark (the Sparkwright's case) | Spark Bolt | Excavate Ray | Twin Cast, Swift Charm | water, nitrogen, oil | always |
| frost (the Rime case) | Frost Shard | Excavate Ray | Spark Bolt, Shatter Frozen | nitrogen, water, snow | reach floor 2 |
| ember (the Ember case) | Flame Jet | Excavate Ray | Spark Bolt, Oil Wick | oil, gunpowder, water | slay the Leviathan |
| storm (the Storm case) | Chain Lightning | Excavate Ray | Spark Bolt, Water Trail | water, nitrogen, oil | win a run |

**Discovered cards feed the reward pool, not the starting hand**: every card ever found joins the pools of tomes, waystones and depth grants (unowned cards first); D1's authored tomes keep their fixed pages.

**Meta profile** (`game/MetaProfile.ts`, localStorage `alchemists-descent-meta`, versioned, corrupt-safe, never overwrites a newer version): runs started and ended, best floor, victories, Leviathans slain, fastest victory, unlocked kits, the last kit chosen, `workshopUnlocked` (after the first run ends) and daily bests. The discovered-card list stays in its own store.

**The daily descent.** "Today's descent" on the title seeds the run from the UTC date (`dailySeed`), always with the spark kit, and keeps the best result per date (deeper, then victory, then the faster victory). The ledger shows today's best and a share line: `Breathing Works — daily 2026-09-26 — Floor 3/4 in 14:02 · 9 alchemical kills · best chain 3`.

**Title and pause.** The title shows Continue / Begin / the case picker (locked cases say how to earn them; the last choice is remembered) / Today's descent / Controls & comfort, and after a first run ends, **The Workshop** (the material sandbox). The Builder and the advanced run launcher stay authoring-only. The pause menu gains **Quit to title** (the descent is kept for Continue) and **Abandon run**; "Set up a run" is gone from player builds, and "Restart level" only appears for disposable test runs.

**Floors 2-4: terrain and placement (GEN 62, the level-design pass).** The Kiln Heart is volcanic: magma halls carved into rock and basin lakes (15-25K lava cells, contained; `world/lavaLakes`), the Colossus's moats 14 wide. Connectors end at the nearest body-fit cell the spawn can walk to and wander and swell, so a floor is not ten spokes from one hub (`connect.ts` organic mode). Nothing the player collects lies in rock, the golden key never rests in the sea (a flooded floor's exit shrine stands above the water), and the exit shrine has a stone pad and an open ring (`portalShrine`). The two waystones stand at 35% and 70% of the walk to the exit, and a brazier stands beside the key's vault (`routeWaystones`). A guardian's hall (the Ice-House, the Lens Room, the Sump's crown) keeps a five-cell shell with its two flank doors (`reshellHall`). The marsh floors hold a few real lamps of gas (400-900 cells under their biggest ceilings, `biomeExtras` gasDomes) and a bat roosts under one; the campaign floors carry about half the gold flecks (`goldKeep`). Sealed loot (rune vaults, tell pockets, secret walls) is intended and was left alone.

**The Sanctum** between floors pours back a phial and names the floor below — its line, its signature reaction and its resident (`content/floorLore.ts`), in the house voice: dry Victorian-industrial wit.

## The Living Descent (the first floor)

The September 2026 overhaul replaces the former opening and its mandatory bench lesson with **The Breathing Works**, eight connected rooms inside a corroded refinery. This contract supersedes the historical expansion proposal below. The implementation record is [living-descent-implementation.md](living-descent-implementation.md); the accepted proposal is [2026-09-04-engine-and-game-overhaul.md](2026-09-04-engine-and-game-overhaul.md).

Begin or continue an expedition directly from the entry screen. The walk from the spawn to the Bell & Tea Engine's crank runs through an **oil-soaked timber barricade**: one Spark Bolt sets it alight within the first few seconds (its moss-caulked seams take the flash, sealed oil pockets deep in its core flare, and it collapses once mostly burned; Excavate digs it too, so it can never lock the level). There is no other lock: pull the crank. Its required physical chain reaction produces the brass bell at the far catwalk receiver. The engine is played, not watched: the player keeps control and follows it along the catwalk. Three stations stick. A wand shot at the priming pan, a kick at the Persuader and a splash of the starting water through the duck's grate get them going again, and each has a slow physical backup. Carry that bell through the Works to the Lower Bell, where a riveted floor grate rings open for it (its two leaves are real metal that slide into slots under the floor) and the player drops through; the exit requires engine completion, bell collection and the open grate. The Rillback Sluice, Feeding Gallery, refuge, Silt Garden and return climb (now a climb between the garden and the sluice; its Intake hatch is sealed, so the walk to the crank has no pitfall) remain connected. A refuge restores health and glowseeds after a brief rest and sets the return checkpoint. Deeper campaign progression uses keys and portals; breakable wells remain legacy authoring structures. See [the engine contract](BELL-TEA-ENGINE.md).

The starting kit includes spark and excavation wands, water, nitrogen, oil, and physical glowseeds. Movement starts at full pace. Players can take dry ledges, drain the sluice with its handwheel, alter water with chemistry, or draw prey and predators aside. No card is required: Frost Shard waits in the Warm Refuge as an optional reward, and the other tomes (Bounce above the Intake, Heavy on the Feeding Gallery shelf, Double in the Undertow) reward exploration. The first route requires the engine and its bell; kills remain optional. Each milestone points the map compass at the next goal (crank, bell, lower gate) without overriding a player-set waypoint. Objectives are one short imperative line at a time (`Burn through the barricade.`, `Pull the engine crank.`, `Shoot the priming pan.`, `Kick the Persuader.`, `Pour water into the duck’s bath.`, `Carry the bell to the lower gate.`); the engine's caption card stays hidden while the barricade stands, so the two never disagree. Room names are announced only after a grounded arrival inside the room, never while falling past it, and the catwalk is named for the engine. The opening layout is GEN_VERSION 48. Every authored pool is contained (GEN_VERSION 45): the Breathing Chamber's vents drink from a sunken reservoir under a riveted grate, the Silt Garden pool is a sunken basin, and the Undertow chute opens at the garden's far west end, so the refuge stays dry and the Undertow stays a dark, dry trough.

The Intake also holds two quiet lessons, both in the first camera frame and neither on the forced route: an oil-cored wooden gate with warm light leaking over it seals a small store left of the spawn (the spark bolt's blast burns it out of the wall), and a sand-packed stone overhang with ore glinting on its underside hangs over the walk to the return shaft (the excavation ray opens the lip; the sand comes down in a curtain and a gold pile with it). Nothing happens until the player acts, so they cannot overwhelm the opening minute; when the player does act, the whole simulation answers.

Weavers remember what they saw and heard, investigate disturbances, feed, and return to their habitat. Their planted legs support a separate head and articulated posture. Rillbacks move through connected physical body segments and telegraph their attacks. Small fauna persist through saving and returning; offscreen promotion does not create replacement populations. Established vegetation starts dormant; new growth follows material rules.

The ventilation cycle warns before expelling real steam from finite water sources. Shelter, draining and freezing change the consequences. Terrain, chemistry and creature bodies remain authoritative; original raster textures and room landmarks are presentation assets.

The simulation advances at 60 Hz near the player. Distant fluids and growth use staggered 15 Hz updates; active heat, reagents and electrical propagation retain full cadence. The camera has no authority over activation. Mutations wake contact halos; inactive interiors retain their mass and state. Saves use asynchronous worker encoding and atomic IndexedDB checkpoints with previous-generation recovery.

The visual language is wet slate, chalk, worn copper, ivory bodies and restrained local light. A quiet corner HUD shows vitals, the active tool, named flasks and the current room objective. Settings expose text size, reduced flashes, camera shake, high-readability lighting, creature captions and keyboard remapping. Standard gamepad controls include menu navigation and pause/resume.

Automation can establish correctness, visual evidence and measured timing. Unfamiliar-player enjoyment, three uncoached solutions to the same encounter, and cross-hardware acceptance remain explicit human gates. Campaign expansion is not a substitute for those gates.

## Historical expansion rationale

The remaining sections preserve the earlier panel's proposals and implementation history. They are background, not a competing description of the current opening or progression contract. Raw proposals: `docs/design-panel-raw.md`.

## Vision

A persistent, fully simulated descent. The single arena becomes a **depth graph** of
1600×1064 cell worlds connected by breakable wells — Dead Cells' biome graph, Hollow
Knight's persistent scars and map-reading, Noita's truth that the simulation is both
the lock and the key. **There are no scripted doors**: every gate, secret, shortcut,
and puzzle is built from cells, so the tools of exploration are the tools of combat.

**The one commandment, enforced in every review: if the grid can't explain it, it
doesn't ship.**

## The expedition model (resolves metroidvania vs roguelite)

- (Superseded in part by the run contract above: a death now spends a return
  phial, and discovered cards feed reward pools instead of the starting shop.)
- **Within an expedition** the world is persistent: snapshots preserve every scar
  (drained lakes, burned scaffolds, stone bridges you cast); waystones stay lit;
  shortcut wells stay open. Death = respawn at your last lit waystone, world intact,
  15% of carried gold left as a recoverable stain where you died. Never a reset.
- **Across expeditions** the depth graph reseeds (new caves, new secrets), but
  knowledge persists: Grimoire recipes, Codex entries, surface-camp shortcut
  unlocks, and every spell card ever found enters the starting shop pool.
- Web-friendly: sessions can end anywhere (autosave on blur/visibilitychange).

## Core loop

Minute-to-minute: drop into a dark pocket → scout by wand-light → read the walls
(gold flecks, crack pixels, hollow *thunk* = something behind this) → choose a verb
(dig, burn, dissolve, flood, freeze) → fight amid the mess you made → siphon something
useful into a flask → light a waystone (you must BRING fire to it) → solve the biome's
physics lock at the chokepoint → break the floor seal, drop down the well.

## Pillar systems (what we're building, from which proposal)

1. **Depth graph + wells + snapshots** (P1; the campaign is now the four-floor run above) — `worldgraph.ts` data: Surface Camp →
   D1 Earthen → D2 Fungal Deep → D3 Frozen → D4 Flooded Caverns → D5 Timberworks →
   D6 Crystal Hollows → D7 Scorched Wastes → D8 Volcanic Maw, plus the Gilded Vault
   branch hosted by one mid-descent level. One live World at a time; RLE snapshots
   (~120-400KB/level) in RAM ×3 + IndexedDB; colors regenerate deterministically,
   stains re-applied. Cell IDs are save-format ABI: **append-only forever**.
2. **Region graph extraction** (P1) — flood-fill regions + adjacency with min wall
   thickness + main path + articulation points, extracted after generation (~30ms).
   The **single placement authority**: secrets, waystones, refuges, nests, puzzle
   locks, boss arenas all request placements from it.
3. **The Flask** (P1+P3 convergent — strongest signal in the panel) — siphon up to
   600 cells of any liquid/powder, carry, pour, throw (shatters, spawns real cells),
   drink. The master key uniting puzzles, combat, brewing, economy. 1 slot first,
   3 later. A flask of blood is a portable conductor; gunpowder is a site-built bomb.
4. **Reaction matrix + hardness table** (P3) — element interactions become data
   entries, not scattered if-chains; HARDNESS (0-5) turns dig-tier gating into a
   one-table metroidvania key system. Ships with the acid→gold nerf (3%, catalyst-
   amplified only in the Gilded Vault) in the SAME wave as flasks.
5. **Sim-sampled status system** (P2) — WET/OILED/BURNING/FROZEN/ELECTRIFIED read
   from the cells touching a body; statuses write cells back. One entity status
   struct shared by enemies, player, and potion effects (a potion is a timed rewrite
   of entity-vs-cell rules: stoneskin writes stone, acid blood swaps splatter).
6. **Wand frames + cast compiler** (P2, restrained) — 4 frames × ~14 cards at launch
   (the 7 legacy spells become cards), deterministic no-shuffle left-to-right
   compiler, depth-1 trigger cap, ×4 damage clamp enforced in the compiler.
   P3's flask-fed trail mod becomes the **Infuser** card (load it by pouring a flask).
   Wands are indestructible. The wand bench (B) is the alchemist's own kit — it
   opens anywhere, any floor (it pauses the sim while open, so it never overlaps
   live combat). The Refuge still hosts the offering shrine / Sanctum shop (E).
7. **Cauldron brewing + Grimoire** (P3) — brewing reads a literal grid histogram of
   what's in the basin with heat beneath; mis-brews are content; recipes persist
   across expeditions. ~5 potions at launch. This is where the title earns "Alchemist".
8. **Biome verb kits + sensor framework** (P1) — each biome = a verb (dig/flood,
   burn, freeze/shatter, conduct, make-stone), expressed through placed materials and
   hazard emitters. Sensors (PRESSURE / BUOY / CHARGE-LATCH / BURN-FUSE) read raw
   cells — enemy blood conducts, so emergent solutions are always valid. **Fail-open
   rule**: a destroyed mechanism groans and opens its gate 30s later. Physics can
   never hard-lock progression.
9. **Enemies that read and write the grid** (P2) — placed populations at gen time
   (45-70/level, finite, readable) + ambush triggers; nest-clear and vault chests
   replace wave-clear rewards. New roster examples: Spark Eel (charges its own liquid
   body), Stone Maw (leaves persistent tunnels), Powder Mage (throws the level at you).
   Pick/pogo melee as the zero-mana safety floor.
10. **Fire-lit waystones, material-colored minimap, secrets that obey the sim,
    hollow-wall tells** (P1) — checkpoints you earn by bringing fire; cartography that
    samples live World.types (your lava spill IS the map); secret walls made of real
    breachable materials with crack-pixel/audio tells; one relic secret guaranteed
    per level.
11. **Machine primitives + chain-reaction structures** (shipped June 2026, plan:
    docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md) — a reusable machine vocabulary
    (valves, breakable plugs, generic sensors, counterweights, one-shot relays)
    where actuators aggregate triggers with the door's AND/OR/SEQUENCE logic, and
    four generated structure families built from it as builtin prefabs, one room
    attempted per level, biome-gated: **Powder Mill** (fire → wooden hopper plug →
    sand ballast → counterweight → gate; earthen/timber/scorched), **Alchemy
    Clock** (stacked basins, liquid sensors, glass valves, overflow drains;
    flooded/fungal/crystal), **Kiln Elevator** (heat → boiler valve → flood →
    relay breaks the ash plug → ballast gate; scorched/volcanic/timber), and
    **Crystal Relay Vault** (charge latch → reservoir valve → conductor channel →
    relay → vault; crystal/frozen/earthen). Every chain is real cells — burning
    the fuse directly, blasting the tank, or flooding the channel yourself all
    count. Fail-open holds per stage; the CI earnability fixpoint + multi-seed
    findability audit gate every family.

## New materials (curated, append-only)

The current engine roster is 35 append-only cell ids. The original 21-cell set is
extended with the three elixirs (Life, Levity, Stone), the remapped
`alchemists-descent` port set (Toxic Sludge, Healium, Teleportium, Snow, Coal,
Crystal, Fungus, Glass, Ash, Glowshroom), and Cave Moss. The ported ids stay
remapped because 21-23 already belong to elixirs.

Year-one design candidates beyond the shipped sandbox set remain: Slag, Toxic Gas,
Spores, Brimstone, Obsidian (blast-proof, acid-soluble), Honey, and Void Salt
(liquid annihilation). Tar folds into an Oil variant. Gate materials are capped at
2-3 total. Mercury remains cut (five rules in one ID). Every new cell uses an
existing behavior template.

## Explicit cuts (do not resurrect without new evidence)

Full 27-card launch (→14), three bosses (→ Kiln Colossus only), Hollow Choir
entirely, Mercury, Crystal charge-novas + translucent glass rendering, separate
Essence currency + Workshop screen, acid→gold money printer, branch biomes at launch,
destructible dropped wands, dry-fire pocket-sim preview, ceiling-seal "no way back",
portable cauldron, shrine wrong-pour curses, per-biome shrine trio (→ merged Refuge).

## What the panel missed (now mandated)

- **Real Builder tooling**: the current Build mode is a Sandbox, not a level
  authoring tool. It should be renamed accordingly. A separate Builder must edit
  durable authored level documents with placeable objects, enemies, pickups,
  mechanisms, links, lights, procedural passes, validation, and playtest
  compilation. See `docs/BUILDER.md`.
- **Onboarding**: D1 gets authored teaching moments — a wooden seal with a brazier
  beside it, a sand plug over visible treasure, one free water-filled flask next to
  a small lava pool. Minute one must teach "materials are verbs".
- **Movement-feel sprint BEFORE content**: coyote time, jump buffering, levitation
  response curves, hitstop, knockback tuning, landing feedback. The brief names
  three movement-feel games; every hour of content is played through the movement.
- **Controls bible**: ~15 verbs must fit keyboard+mouse (and trackpad reality).
  Rule: no new input without removing one.
- **Frame-budget ledger**: sim 6ms / entities 2.5ms / render 5ms / 2.5ms headroom.
  Perf HUD + 3-4 automated worst-case scenes (spore cloud + flamethrower + 64
  projectiles + minimap refresh) as a release gate.
- **Seeded RNG**: mulberry32 through the generator (snapshots, level regen, daily
  seeds all depend on it) + determinism test harness. Discrete, owner-less work item
  the panel found unclaimed — schedule first.
- **Mid-session save/resume**: autosave on blur; "continue" restores mid-level state.
- **Physics mulligans**: waystones regenerate Refuge fixtures; springs re-drip;
  softlock audit checklist per biome.
- **Telemetry from wave one**: local counters — deaths by cause, puzzle solve-method
  distribution, secret find rate, flask material usage, card pick rate.
- **Material readability**: hover-identify in play, colorblind audit, audio-cue
  language per material family.
- **Audio mixing**: ducking + voice-stealing policy for simultaneous chaos.

## Implementation waves (each independently shippable)

### Wave A — "Bottles & Reactions" (foundation + immediate fun)
Seeded RNG + determinism harness; reaction matrix + hardness table (port existing
interactions into data); Flask v1 (siphon/pour/throw); acid→gold nerf; movement-feel
sprint; telemetry counters; perf HUD + budget ledger. Ships into the existing arena
and immediately doubles its playability.

### Wave B — "The Descent" (the game appears)
Depth graph + descent wells + streaming transitions (chunked gen behind a 600ms
curtain); persistence snapshots + autosave; fire-lit waystones + death/respawn rules;
material-colored minimap + M overlay; placed enemy populations (endless waves die
with the arena); Refuge shell (spring + shop placeholder); Surface Camp.

### Wave C — "Living Walls, Living Targets"
Region graph extraction; secrets + hollow-wall tells; status engine; first 5 new
enemies; cauldron brewing + 5 potions + Grimoire; Codex with first-discovery
bounties; D1 onboarding moments.

### Wave D — "Wandsmith"
4 frames, cast compiler with clamps, 14 cards (legacy spells + Infuser), bench UI,
card economy (nest chests, shop, anvil), pick/pogo melee.

### Wave E — "Locks Made of Physics"
Biome verb kits + the ~10 new materials; sensor framework with fail-open; three
puzzle archetypes (Sand Scale, Burning Seals, Sluice); Kiln Colossus boss (water-plug
thermal shock, pylon lightning stun — a physics puzzle wearing a health bar).

### Post-spine content drips
More branch biomes beyond the shipped Gilded Vault, second boss variants, more
cards/frames/potions/relics, and deeper authored Builder campaigns.

SHIPPED so far: **Freeze Bridge** (frozen-biased archetype 4 — a metal-lined water
trench, an eternal nitrogen drip off a ceiling icicle, and a diggable stone
catch-tray that disposes of every drop by pooling it to evaporation; break the
tray and each drop random-walks the crust and freezes the first open water it
finds until the ICE-census sensor at threshold 8 latches permanently) and
**Live Circuit** (crystal/scorched-biased archetype 5 — a copper rail from an
exposed strike-knob, two knife-switch valves standing open in 1-cell rail gaps,
their pre-thrown levers on the door apron, and a buried all-iron coil vault;
throw both switches, then land any spark on the knob. Every working part is
metal or runtime-stamped, so no carve can sever it; a 1-cell port shaft is the
universal pour-and-zap fallback). Both ride the existing sensor framework with
zero new mechanism kinds.
