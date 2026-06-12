# Alchemist's Descent — Expansion Design

The synthesis of a three-designer panel (exploration/world, combat/wands, alchemy/progression)
plus an adversarial creative-director critique. Raw proposals: `docs/design-panel-raw.md`.
This file is the canonical design; when it conflicts with the raw panel, this wins.

## Vision

A persistent, fully simulated descent. The single arena becomes a **depth graph** of
1600×1064 cell worlds connected by breakable wells — Dead Cells' biome graph, Hollow
Knight's persistent scars and map-reading, Noita's truth that the simulation is both
the lock and the key. **There are no scripted doors**: every gate, secret, shortcut,
and puzzle is built from cells, so the tools of exploration are the tools of combat.

**The one commandment, enforced in every review: if the grid can't explain it, it
doesn't ship.**

## The expedition model (resolves metroidvania vs roguelite)

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

1. **Depth stack + wells + snapshots** (P1) — `worldgraph.ts` data: Surface Camp →
   D1 Earthen → D2 Timberworks → D3 Frozen → D4 Galvanic Foundry → D5 Scorched Core →
   boss vault (branch biomes post-spine). One live World at a time; RLE snapshots
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
   Wands are indestructible. Bench lives in the Refuge.
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
Branch biomes (Flooded Caverns, Fungal Gloom), Gilded Vault, Freeze Bridge + Live
Circuit puzzle archetypes, second boss, more cards/frames/potions/relics.
