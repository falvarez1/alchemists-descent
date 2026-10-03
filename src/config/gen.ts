import type { BiomeId, LockKind } from '@/core/types';

/**
 * Per-biome GENERATION config (skeleton strategy + decoration budgets).
 *
 * Like config/params.ts, these objects are intentionally MUTABLE live-tuning
 * data — tools may write straight into them. BUT: the `baseline` skeleton
 * params are LOAD-BEARING. They are the exact literals of the original
 * earthen cave generator, and tests/gen-golden.test.ts locks FNV-1a hashes
 * of the worlds they produce. Changing any baseline number (or the order of
 * the artery list) changes every existing seed's world; do it deliberately,
 * one value at a time, flagged in the commit (CLAUDE.md invariant #4).
 */

/**
 * Bumps with deliberate generation changes; the expedition save records it
 * and resume retires mismatched saves (restoreLevel's pristine-regen coupling
 * means a stale save against new generation silently desyncs otherwise).
 * v2: per-biome skeleton flip + authored prefab placement pass.
 * v3: machine structure rooms (chain-reaction prefabs, 'machines' stream).
 * v4: WIZARD-SCALE prefabs — interiors >= 22 tall (the player's collision
 *     box is 9x17), anchors halfW 10 with walk-in connector tunnels.
 * v5: two new Wave E puzzle archetypes (Freeze Bridge, Live Circuit) and a
 *     six-way, biome-biased archetype roll (consumes one extra rng draw).
 * v6: the Refuge — a hewn rest alcove off the portal shrine on every level
 *     (its gallery consumes rng draws ahead of all later placements).
 * v7: Freeze Bridge catch-tray walls raised to the drop-cell row — the brim
 *     is the fill line, so a saturated cup chokes the emitter instead of
 *     overflowing a drop into the trench (the tray-intact puzzle leaked).
 * v8: the Gilded Vault branch — a hidden arch alcove generates in one
 *     mid-descent host level (d2-d4 by expedition seed), and the 'gilded'
 *     branch biome joins the graph off the spine.
 * v9: the Sump — the leviathan's perched cistern arena on every depth-4
 *     level (metal-cased pool, three stone drain plugs, above the flood
 *     line so the drains empty downhill forever).
 * v10: terrain polish fills tiny carve notches and shallow walk-surface pits
 *      with neighboring rock, reducing saw-tooth ledges and snaggy ditches.
 * v11: recompute wizard-fit placement targets between authored-prefab and
 *      machine-room passes so later connectors use current, stamped terrain.
 * v12: rescue validator-matched machine-fed/ranged locks with cell-reachable
 *      tunnels after prefab and machine-room placement.
 * v13: D1 Spell Lab annex beside the first Refuge, with real-cell teaching
 *      stations and a checked tome reward.
 * v14: post-placement campaign dressing adds biome-specific ore, rubble,
 *      liquid pockets, and surface accents while respecting placement ledgers.
 * v15: biome goldBonus scales gold pocket budgets; non-lava pools use their
 *      material color; final findability errors carve fail-open rescue routes.
 * v16: longer biome vines and pass-through campaign hanging-vine dressing feed
 *      the soft strand simulation with observable, organic tendrils.
 * v17: cauldron set 28 cells from the waystone (the larger monuments overlapped);
 *      denser vines + new drape (wall-to-wall), loop, and heavy-cluster variants.
 * v18: GRAND CAVES — every skeleton's open-space carve radii scale by CAVE_SCALE
 *      (1.5x) for wider tunnels/shafts/chambers and more levitation room; the
 *      world map size is unchanged, only the carved space grows.
 * v19: mineral-vug fill — buried swiss-cheese air pockets pack with cave material
 *      (mostly solid stone/coal, ~19% hidden non-glowing RawOre caches, a rare
 *      crystal geode), discovered by digging + the wizard's light.
 * v20: review fixes (post-generateCaves, so the earthen golden hashes are
 *      UNCHANGED) — mechanism-vault archetype now rolls uniformly so the brazier
 *      puzzle actually appears; gauge-rescue tunnels can reach a target above
 *      row 26; a secret connector that never reaches open space no longer leaves
 *      an undiscoverable sealed chamber with a misleading tell.
 * v21: the heart container now calls connectToCaves like every other landmark,
 *      so a pocket-placed heart can no longer be unreachable. This carves a
 *      tunnel during placeStructures, changing the full-level cell output (the
 *      bare-cave gen-golden hashes are still UNCHANGED); gen-level-golden was
 *      re-recorded. Resume retires mismatched saves.
 * v22: sink-fill defaults raised (surfacePitWidth 6->20, surfacePitDepth 4->10,
 *      notchPasses 2->3) so legacy walk surfaces fill their snaggy pits/holes by
 *      default. terrainPolish runs inside generateCaves, so this changes the bare-
 *      cave output too — BOTH gen-golden and gen-level-golden re-recorded.
 * v23: LESS-POROUS CAVES — the swiss-cheese rock the player walked on was the
 *      skeleton's own porosity, which no safe post-fill could clean (filling closes
 *      passages; findability caught it). Fixed at the source: baseline caPasses
 *      5->9 (more CA smoothing consolidates the rock into solid blobs AND opens the
 *      caverns; the carved arteries keep connectivity), plus a bounded majority-rule
 *      consolidation post-pass (GEN_TUNE.rockFillPasses 2) for residual holes, plus
 *      cosmetic dirt/grass/moss/flower surface dressing. surfacePitDepth eased to 6.
 *      Re-recorded gen-golden + gen-level-golden.
 * v24: region graph occupancy now uses the runtime body-blocking predicate, and
 *      failed secret connectors roll back their trial carve instead of leaving
 *      hidden empty pockets behind.
 * v25: SOLID WALKABLE ROCK — v23's caPasses+consolidation cleaned the FINE speckle
 *      but the rock was still ~50% open porous-maze (the holes interconnect, so no
 *      connectivity-safe fill could touch them). Two changes fix it: (a) earthen
 *      baseline noiseDensity 0.54->0.66 so the rock starts mostly-solid with the
 *      carved arteries as the navigable network (Noita-style), and (b) a
 *      morphological CLOSE (terrainPolish.solidifyRock, GEN_TUNE.rockCloseRadius 2)
 *      that packs every CONNECTED open feature thinner than 2*r — the swiss-cheese
 *      speckle — while caverns/tunnels wider than r survive exactly (connectivity-
 *      safe by construction; findability stays clean). fillEnclosedHoles mops up the
 *      remaining sealed pockets. Re-recorded gen-golden + gen-level-golden (vault
 *      unchanged: gilded skips the polish block).
 * v26: LIVING GROUND COVER — walk-through grass (new Cell.Grass=37) plus sparse
 *      glowshroom/fungus tufts are planted on moss-crown walk surfaces
 *      (world/surfaceDress.plantGroundCover, after dressWalkSurface). Real
 *      soft-growth cells (bodies pass through; they burn/wither/creep on their
 *      own). Deterministic placement shifts cell types on verdant levels — re-
 *      recorded gen-golden + gen-level-golden (d8 + vault unchanged: not moss-crown).
 * v27: D1 Spell Lab water-prep station now includes a contained lava cup beside
 *      the basin, completing the first-run water/lava flask lesson. Full-level
 *      cell output changed for d1; re-recorded gen-level-golden only.
 * v28: mineral-vug fill now skips reward pickup guard boxes after all prefab
 *      and structure pickups are merged, preventing late rock fill from burying
 *      generated non-key rewards. Full-level output changed on affected seeds.
 * v29: bottom well shafts removed; D1 Refuge/bench moved near spawn and later
 *      depths no longer place a Refuge. Full-level output changed.
 * v30: the open strip below the caves is packed to solid rock — terrain now runs
 *      all the way down to the bedrock instead of leaving an empty bottom void.
 *      Full-level + base-cave output changed on every seed.
 * v31: D1 gains the Noita-style surface intro — open sky, a rolling grass
 *      surface, a starter cabin, and a timbered cave mouth above the spawn
 *      chamber. D1 full-level output changed; other depths unaffected.
 * v32: organic encounter lairs are carved after mineral-vug fill on signature
 *      depths: rootloper groves, rillback pools, and stonemaw seams. Full-level
 *      output changed on affected d2/d4/d5/d6/d8 seeds.
 * v33: worldgen validation now treats encounter lair affordances as first-class
 *      findability targets, so generated lair entrances and rewards are audited
 *      alongside gates, sensors, glyphs, and other progression-critical features.
 * v34: mechanism-vault trigger antechambers use swept wizard-gauge connectors,
 *      preventing cell-reachable pressure plates from being body-unreachable
 *      behind their own door after loose materials settle.
 */
// v66: real damp surface moss and disconnected vine patches, preserving solid geometry and reserving fixture space.
export const GEN_VERSION = 66; // 65: THE LOCKS (the 'more fun' round, 2026-10-01): each campaign floor's key vault is a signature puzzle chamber on the route, sealed by a route-seal plug that the floor's own machine breaks (world/locks: d2 the Gas Bell, d3 the Weir, d4 the Crucible at the Colossus hall's gate); the structure pass draws no pocket vault on a locked floor, the gauge rescue judges the grid with every intact route seal open, and a floor without a lock is byte-identical. (Two branches each claimed 64 - the locks and the experiment - so the one that landed second took 65: a save made on the experiment alone must not resume into a world with the locks.) 64: THE EXPERIMENT (alchemy as a discovery game): floor 1 gains its cauldron, the Refuge Kettle (world/refugeKettle: a basin on the Warm Refuge plinth with an ember-banked furnace under it, a sunken cistern under a grate and a mound of tea leaves), and a generated floor's cauldron that stood off the route (it kept its first-waystone site while the bowls moved: 35 cells from the walk at best on d2-d4 seeds 1/5/7, 50-500 at worst) is moved beside the bowl nearest the route, else onto the walk at 40% (world/routeWaystones, CAULDRON_ROUTE_REACH 30); and every campaign cauldron stands on a FURNACE: a sealed 7x2 pocket of Ember cells in the ground three rows under its base, where the rock is sound (world/furnace bankFurnace, last of all in generateLevel: 37 of 40 floors), so a bowl is hot before anyone lights a thing. 63: two independent changes meet (merge of the 2026-09-30 polish pass). (a) THE WORKS’ CATWALKS LOSE THEIR BRACES — the five timber catwalks of floor 1 (the sluice stepping decks and the Feeding Gallery walkways) each grew two diagonal one-cell Wood sticks that ended in open air, held nothing up and caught the alchemist’s jumps; they are gone, and each deck now has a flush two-row joist under its middle, inset nine cells from its real ends (world/worksHabitat), over 61: THE FOOTING CONTRACT — fixtures stand on their own stamp and on ground (world/fixtureFooting). Every waystone, the cauldron, each hand-trigger and rune pedestal reserves its footing as a sealed footprint that later tunnels walk around; the waystone/cauldron connectors leave from above the bowl (they started AT it and took it and eight rows of floor: 30/30 waystones floated), the vault-trigger connector from high in its antechamber (it cut the shelf from under 18 triggers), the rune connector from above its pedestal; a gauge rescue of a fixture stops above its first own row; prefab connectors walk around their own prefab; the cauldron settles onto real ground on the nearer side; a waystone is never set on a pool bed (dry ground first, relaxed in tiers); a re-rolled treasure vault keeps its spawn clearance (a door slab 70 cells from d2 expedition 24's arrival sealed it in); the key is judged by the real collect rule (validate bodyCanCollect), never rests in a crack, and its vault's loose powder rim is fused. After the last carve every bowl, basin, body and glyph is re-stamped, the rock a stele or vessel is drawn over is cleared, and ground is put back under anything undercut (a plinth up to 12 rows, else a lip hung from rock, else a trigger comes down to the nearest dry ground on its side of its door), each taken back if it costs a route. — AND — (b) 62: WAYSTONES ON THE ROUTE, GAS DOMES, FEWER FLECKS (level-design pass, 2026-09-30): after the last carve the two generated bowls move to 35% and 70% of the body-fit walk to the exit and one more is lit beside the key (world/routeWaystones: 76 of 80 bowls within 40 cells of the route, were 11), a marsh floor's few biggest ceiling domes hold 400-900 cells of gas (biomeExtras gasDomes; a bat roost prefers one) and only 0.3-0.45 of the campaign floors' gold pockets are written (GenDef.goldKeep; the rng draws are unchanged), a rock-poor Kiln floor gets a second pass of smaller magma halls, a photocell is rescued by the beam the validator uses, a long tunnel walk that ended on its guard is finished (the old walk drifts left), structure connectors walk round placed prefab and machine rooms, a plinth is never poured down a kept-open shaft, a relocated trigger prefers a landing with its whole span supported. 62: A FLOODED FLOOR'S EXIT STANDS ABOVE THE WATER and the GUARDIAN HALLS KEEP A FIVE-CELL SHELL (wardenArenas reshellHall; the Kiln's moats 14 x 5). 62: THE END OF THE STARBURST (level-design pass, 2026-09-30): world/connect — on a campaign floor a connector ends at the NEAREST BODY-FIT CELL THE SPAWN CAN WALK TO (not the centroid of the nearest main-path region: a level's one giant region made every limb aim at one hub point, ten-plus straight 24-wide spokes), wanders sideways on hash noise that tapers to nothing at both ends (no rng draws), and swells a few cells with the odd bead chamber; the first and last steps, a connector leaving a sealed room, and every narrow (radius < 10) connector keep the old walk; the walk is judged for sealed features as it will be CARVED. A story nook's connector never crosses Metal, a grove drops the vines its carve orphaned. 62: LOOT AND SET PIECES STAND ON REAL GROUND (level-design pass, 2026-09-30): loot placed at a region's centroid rests on open ground (an entombed landing moves into its own region, to the nearest body-fit floor; 49 pickups had sunk 27-30 rows into rock), a tome's pocket is joined to the caves on a forked stream, a live circuit's one-cell port shaft and the roof hole under it are kept open by the footing pass (its lever lip sealed the latch: d4 seed 5, d3b seeds 5 and 7), loose stock (oil/gunpowder/water/sand pockets) is cleared out of every fixture's room after the last carve (world/looseStock), the exit shrine's pad and ring are restored (the carve took the plug's top: the floor under the portal was 0% solid) and an unreachable shrine is rescued from its flank mouths (d3 seed 5 and d3b seed 1337 generated with no way in). 62: THE KILN HEART IS VOLCANIC (level-design pass, 2026-09-30): the volcanic skeleton has more rock (fill .70, 9-12 tubes of 260 steps: the floor was 54-64% empty, now 44-56%), the 19x3 loose lava lenses are gone, and world/lavaLakes carves MAGMA HALLS into thick rock (a hall's lower lens is lava, its mouth a stone shelf with a gold lure) and floods natural basins, 13-18K lava cells in place of 1.3-2K, every lake contained by construction (rim fused to stone two cells deep, loose stock above it cleared, no lake on any walk to a place the player must stand, taken back if it costs a route) and registered as a placed room so repair routes walk round it; a boss hall cut off from the spawn is re-joined from its flank mouths by the gauge rescue; the golden key of a flooded floor never rests in the sea (a dry far body-fit cell instead of the giant region's centroid on the world floor). 61: THE FOOTING CONTRACT — fixtures stand on their own stamp and on ground (world/fixtureFooting). Every waystone, the cauldron, each hand-trigger and rune pedestal reserves its footing as a sealed footprint that later tunnels walk around; the waystone/cauldron connectors leave from above the bowl (they started AT it and took it and eight rows of floor: 30/30 waystones floated), the vault-trigger connector from high in its antechamber (it cut the shelf from under 18 triggers), the rune connector from above its pedestal; a gauge rescue of a fixture stops above its first own row; prefab connectors walk around their own prefab; the cauldron settles onto real ground on the nearer side; a waystone is never set on a pool bed (dry ground first, relaxed in tiers); a re-rolled treasure vault keeps its spawn clearance (a door slab 70 cells from d2 expedition 24's arrival sealed it in); the key is judged by the real collect rule (validate bodyCanCollect), never rests in a crack, and its vault's loose powder rim is fused. After the last carve every bowl, basin, body and glyph is re-stamped, the rock a stele or vessel is drawn over is cleared, and ground is put back under anything undercut (a plinth up to 12 rows, else a lip hung from rock, else a trigger comes down to the nearest dry ground on its side of its door), each taken back if it costs a route.
// 60: Pell's camp and the echo's stage are never a liquid basin — a story nook is carved only where no liquid stands level with its floor or above within 48 cells, its connector's route floor is at most a step (4 rows) above the room, and the quietFloor fallback is dry too (the user found Pell chest-deep in a Cisterns basin: d3 seeds 1 and 3 flooded their camps). 59: 59: a lair's own connectors walk around its ORGAN (the stonemaw's ore seam, the Rillback's pool + basin) — a tunnel is never kept out of the room it starts in, so the stonemaw's connector bored through its own seam (d4 seed 21: 175 -> 121; 20 of 32 seeds lost 5-68 cells); no tunnel's chosen END lies inside a sealed feature either (a story nook's route floor inside d2 seed 10's grove let its connector cut the grove) — nook, lair-fallback, light-fallback and vault-antechamber targets all skip sealed interiors; a detour leaves from its true start, not the snapped grid node; the structures' connectors pass the sealed footprints too
// 58: everything together — the second doors (biomes v55-57), the story (v55) and the lair fix (v55/56); late tunnels also route around the Cold Store / Glass Galleries rooms and guardian halls (connect SEALED_LABEL)
// 56: the story (55) and the lair fix (also 55) together — late tunnels route around sealed features AND the story's flue/nooks
// 55 (story): the Kiln's old flue (a ledged shaft behind a metal damper, the escape's climb) replaces its flue-side flank connector; Pell's camp and the resonant valve nooks carved off the main path on floors 2-4 (their own 'story' stream); floor 1's Guild locker nook off the return shaft
// 55 (lair fix): late tunnels walk AROUND sealed features — connectors and rescue tunnels carved after an encounter lair / the sump / a light room exist route round their footprints (world/connect sealedFootprints, cost-based, fail-open) instead of through them (a flora connector drained the whole d3 seed-3 Rillback pool); the Rillback pool re-asserts after the rescues; grove vines hang from the real rock ceiling (they used to be stamped in the air and dropped on arrival)
// 54 (fix3): the Sump keeps its rim — the Leviathan's arena stamps (and re-asserts) its stone shores and plinth, its flank connectors leave above the shore, it refuses sites built over earlier metal/loot, and the final rescue refills its pool; flora footing no longer counts loose powder as anchoring rock or gold as footing; the Kiln's flora budget grows 14/46 -> 18/72 with more fire-lilies
// 57 (merge): wave 3's second doors meet the story — the biomes' v55/v56 and the story's v55 together; goldens re-recorded
// 56 (biomes): the Cold Store's Ice-House (the Rime Warden's hall: coal pits, brine gutters, a walled vault; world/wardenArenas) and the Glass Galleries (d3b, crystal) — arcaded gallery halls over thinned vaults (forked 'glass-galleries'), the Periscope and the Prism Gate light rooms (forked 'glass-galleries-puzzles'; sealed lenses rescued at their optics' port), the glassworks' dressing (silvered panels, chandeliers, vitrines, windows; forked 'glass-galleries-dressing'), the Lenswright's Lens Room
// 55 (biomes): the Cold Store (d2b, frozen) — cold rooms in the crevasse skeleton, a floored spawn sill, brine pools, the refrigeration wing's dressing, the Frozen Fall and Ice Vault, the cold and glass flora kits; d1-d4 byte-identical
// 54: 54 (fix3): the Sump keeps its rim — the Leviathan's arena stamps (and re-asserts) its stone shores and plinth, its flank connectors leave above the shore, it refuses sites built over earlier metal/loot, and the final rescue refills its pool; flora footing no longer counts loose powder as anchoring rock or gold as footing; the Kiln's flora budget grows 14/46 -> 18/72 with more fire-lilies
// 53: the light, fauna and flora waves together — flora's forked 'flora' pass (plants + felling / root-ladder / thicket rooms) runs after the light puzzles, and D1 carries both the Undertow's lens-locked cache and the hand-planted flora with the Seed Cellar
// 52: the Kiln grew with a 34-cell Colossus (62x40 vault over a flat 116-wide floor, three ceiling tanks re-asserted after carves, a 16-row footing) and floors 2-4 seed a resident organism census (no cells)
// 51: light wave — floors 2-4 carve a photocell strongroom and a lumen-bloom crossing (forked 'light-puzzles' stream) plus designed dark zones; D1 gains the Undertow's lens-locked cache. (The flora branch also called its pass 51.)
// 50: the Kiln's ceiling tank (seal + water) is re-asserted after its right-flank connector and the gauge-rescue passes, which had pre-opened it on most seeds (the Colossus drowned unprovoked). 49: the Kiln's lava moats are sunk into the arena floor (flush pits with a stone keel) instead of stamped on top of it, where they ran out into a burning film
// 48: the opening: the Intake's cold lock is gone (the crank is open from the start; Frost Shard stays a refuge reward), an oil-soaked barricade seals the spawn-to-crank route, and the Lower Bell is a real floor grate whose leaves slide open for the bell
// 47: the living-descent played Bell & Tea Engine (low stations over the catwalk, fault fixtures, the duck's grated bath, the marble run; acid, lava and the boiler removed) merged into the four-floor spine
// 46: four floors (Bellows, Rot Gardens, Drowned Cisterns, Kiln Heart): d3 is flooded + the Leviathan's sump, d4 volcanic + the Kiln Colossus, bosses keyed on LevelDef.boss, the Gilded Vault arch/hoard no longer generate
// 45: Breathing Works liquids stay put (sunken steam reservoir under a grate, sunken garden pool, west Undertow chute) the Heavy Charm leaves the drip tray, even refuge steps and grounded glowshrooms

/**
 * Live-tunable worldgen LOOK knobs — MUTABLE like config/params.ts. The Sandbox
 * worldgen panel writes straight into these and "Generate Caves" re-runs gen with
 * the new values, so you can eyeball how a tweak changes the biome. The shipped
 * defaults below are the golden-locked v18/v19 values; the golden test asserts
 * generation at exactly these, so DON'T change a DEFAULT without re-recording
 * tests/gen-golden.test.ts + bumping GEN_VERSION. Runtime edits are a dev/preview
 * tool — they affect ALL generation (sandbox + expedition); find values you like,
 * then bake them into the defaults. (A mid-expedition tweak can desync a saved
 * level on reload, since the genVersion guard only locks the shipped baseline.)
 *
 * - caveScale: multiplier on every skeleton's OPEN-SPACE carve radii (tunnels,
 *   shafts, chambers, vaults, the spawn chamber, connectivity tunnels). 1.0 =
 *   original; >1 opens the caves up. Radius is consumed AFTER every rng draw, so
 *   the spawn anchor + stream are identical — only carved width changes.
 * - surfacePitWidth/Depth + notchPasses: how aggressively terrainPolish fills the
 *   snaggy walk-surface "sinks" and tiny notches (see world/terrainPolish.ts).
 */
export const GEN_TUNE = {
  caveScale: 1.5,
  // v22: raised from 6/4/2 so legacy walk surfaces fill their snaggy pits/holes by
  // default (the platforms read far cleaner). terrainPolish is bounded — it only
  // raises shallow walk-surface dips between shoulders + tiny enclosed notches.
  // Depth is kept modest (6, vs the wide 20): deeper fills risk closing a shaft-like
  // passage, which the findability audit flags (it failed at depth 10).
  surfacePitWidth: 20,
  surfacePitDepth: 6,
  notchPasses: 3,
  fillSurfacePits: true,
  // Majority-rule rock consolidation (terrainPolish.consolidateRock) — closes the
  // porous swiss-cheese holes so the rock the player walks on reads solid. passes 0
  // = off. Tuned via render + findability before baking the default.
  rockFillPasses: 2,
  rockFillThreshold: 4,
  // Swiss-cheese de-speckle (terrainPolish.fillEnclosedHoles): flood-fill every
  // open region and pack any SEALED pocket of <= holeFillMax cells with rock. The
  // peppered black specks that make solid rock read "porous" are exactly these
  // small enclosed pockets — the player can never reach them (they're walled in),
  // so filling them is cosmetic AND connectivity-safe by construction: a region
  // that connects two caverns (or is an open passage) is large, never filled. 0 = off.
  holeFillMax: 110,
  // Morphological CLOSE radius (terrainPolish.solidifyRock). Packs every CONNECTED
  // open feature thinner than 2*radius — the swiss-cheese speckle that makes solid
  // rock read porous — while caverns/tunnels wider than the radius are restored
  // exactly. This is the primary de-porosity lever (fillEnclosedHoles only catches
  // sealed pockets; the noise speckle is connected). 0 = off; 2 closes <=4-cell gaps.
  rockCloseRadius: 2,
};

/** Frozen shipped baseline — the Sandbox worldgen "reset" restores it. */
export const GEN_TUNE_DEFAULTS: Readonly<typeof GEN_TUNE> = Object.freeze({
  ...GEN_TUNE,
});

const GEN_TUNE_SIGNATURE_KEYS = Object.keys(GEN_TUNE_DEFAULTS) as Array<keyof typeof GEN_TUNE>;

export function genTuneSignature(source: Readonly<typeof GEN_TUNE> = GEN_TUNE): string {
  return JSON.stringify(GEN_TUNE_SIGNATURE_KEYS.map((key) => [key, source[key]]));
}

export const GEN_TUNE_DEFAULT_SIGNATURE = genTuneSignature(GEN_TUNE_DEFAULTS);

/**
 * Worldgen LOOK slider metadata shared by the Sandbox (Toolbar) and Builder
 * panels — ONE source of truth for the field list, ranges, and the per-biome
 * dressing channels so the two hand-built panels can't drift apart. Each panel
 * still owns its own row-rendering primitive; only the metadata is shared.
 * `decimals: 0` marks an integer field.
 */
export const WORLDGEN_LOOK_FIELDS: ReadonlyArray<{
  key: 'caveScale' | 'surfacePitWidth' | 'surfacePitDepth' | 'notchPasses';
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
}> = [
  {
    key: 'caveScale',
    label: 'Cave size',
    min: 0.6,
    max: 2.2,
    step: 0.05,
    decimals: 2,
  },
  {
    key: 'surfacePitWidth',
    label: 'Sink fill width',
    min: 0,
    max: 24,
    step: 1,
    decimals: 0,
  },
  {
    key: 'surfacePitDepth',
    label: 'Sink fill depth',
    min: 1,
    max: 14,
    step: 1,
    decimals: 0,
  },
  {
    key: 'notchPasses',
    label: 'Notch passes',
    min: 0,
    max: 6,
    step: 1,
    decimals: 0,
  },
];

/** Per-biome campaign-dressing density channels (recipe key -> slider label),
 *  shared by both worldgen LOOK panels; each is a 0..2 density. */
export const WORLDGEN_DRESSING_CHANNELS: ReadonlyArray<readonly [string, string]> = [
  ['oreDensity', 'Ore density'],
  ['glowDensity', 'Glow density'],
  ['liquidDensity', 'Liquid density'],
  ['rubbleDensity', 'Rubble/moss density'],
  ['hangingDensity', 'Vine density'],
];

/* ============================================================
 * Baseline skeleton params (golden-hash locked)
 * ============================================================ */

/**
 * Row anchor resolved at carve time. Mirrors the original generator's inline
 * clamp expressions, which mix absolute rows, HEIGHT fractions, and
 * floor-band offsets.
 */
export type RowAnchor =
  | { kind: 'abs'; v: number } // literal row
  | { kind: 'hfrac'; v: number } // HEIGHT * v
  | { kind: 'floorOff'; v: number }; // floorBand - v

export interface ArterySpec {
  /** Center row = HEIGHT * baseFrac (jitter added below). */
  baseFrac: number;
  /**
   * Span of the uniform base jitter: base += (rng - 0.5) * baseJitter.
   * 0 means NO rng draw at all — the draw count is stream-order load-bearing.
   */
  baseJitter: number;
  amp1: number;
  freq1: number;
  amp2: number;
  freq2: number;
  clampLo: RowAnchor;
  clampHi: RowAnchor;
  radius: number;
  /** Carve a disc on every Nth column (x % carveEvery === 0). */
  carveEvery: number;
  /** The primary artery writes the tunnelY profile (spawn chamber anchor). */
  primary?: boolean;
}

export interface ShaftParams {
  /** Shaft x anchors as WIDTH fractions (jittered at carve time). */
  fracs: number[];
  /** Span of the uniform x jitter applied to each anchor. */
  xJitter: number;
  /** Sine sway amplitude = ampBase + rng * ampRand. */
  ampBase: number;
  ampRand: number;
  yStart: number;
  yStep: number;
  /** Shaft stops at floorBand - floorMargin. */
  floorMargin: number;
  /** Random-walk jitter per step: jitter += (rng - 0.5) * walkStep. */
  walkStep: number;
  /** Random-walk jitter clamp (±). */
  walkClamp: number;
  /** Sine sway frequency over y. */
  freq: number;
  /** Carve x clamped to [xClamp, WIDTH - xClamp]. */
  xClamp: number;
  radius: number;
}

export interface ChamberParams {
  count: number;
  /** cx = xMargin + rng * (WIDTH - 2 * xMargin). */
  xMargin: number;
  /** cy = yMin + rng * (floorBand - ySpanOff). */
  yMin: number;
  ySpanOff: number;
  /** Ellipse radii: r = base + rng * rand (rx drawn before ry). */
  rxBase: number;
  rxRand: number;
  ryBase: number;
  ryRand: number;
}

export interface StalactiteParams {
  /** Column scan range: [xMargin, WIDTH - xMargin). */
  xMargin: number;
  /** Ceiling scan stops at floorBand - ceilMaxOff. */
  ceilMaxOff: number;
  /** Max open-run probe below a ceiling cell. */
  probeDepth: number;
  /** Minimum open depth below the ceiling to consider a stalactite. */
  minDepth: number;
  chance: number;
  /** Length = lenBase + floor(rng * min(lenRandCap, depth - lenDepthOff)). */
  lenBase: number;
  lenRandCap: number;
  lenDepthOff: number;
  /** Initial half-width = round(len * hwFrac). */
  hwFrac: number;
  /** Chance of a 1-cell wobble bulge per row. */
  wobChance: number;
  /** Chance per row that the half-width tapers by 1. */
  taperChance: number;
  stalagChance: number;
  /** Stalagmite forms only when the open run is at least this deep. */
  stalagMinDepth: number;
  stalagLenBase: number;
  stalagLenRand: number;
  stalagHwFrac: number;
  stalagTaperChance: number;
  /** Column skip after placing: x += skipBase + floor(rng * skipRand). */
  skipBase: number;
  skipRand: number;
}

export interface BaselineSkeletonParams {
  /** Wall probability per 2x2 noise block. */
  noiseDensity: number;
  caPasses: number;
  /** Carved in array order; exactly one entry should be primary. */
  arteries: ArterySpec[];
  shafts: ShaftParams;
  chambers: ChamberParams;
  /** Spawn chamber disc radius at (WIDTH/2, tunnelY[WIDTH/2]). */
  spawnRadius: number;
  stalactites: StalactiteParams;
  speckPasses: number;
  /** Chance to strip a wall speck with exactly one 4-neighbor. */
  speckLoneChance: number;
}

/* ============================================================
 * New skeleton params (not yet wired to any biome — GEN maps
 * everything to baseline; a later step flips them per biome)
 * ============================================================ */

export interface FungalParams {
  /** Wall probability of the background noise fill. */
  fillDensity: number;
  chains: number;
  links: number;
  rMin: number;
  rMax: number;
  throatW: number;
  artery: ArterySpec;
  /** CA passes run AFTER carving for organic blending. */
  caPasses: number;
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface CrevasseParams {
  field: { scaleX: number; scaleY: number; octaves: number; threshold: number };
  tunnels: {
    countMin: number;
    countMax: number;
    radiusMin: number;
    radiusMax: number;
    turn: number;
    gravityBias: number;
    branchChance: number;
    maxBranches: number;
    steps: number;
    xMargin: number;
  };
  shelves: { count: number; lenMin: number; lenMax: number; radius: number };
  /**
   * THE COLD STORE (wave 3): the refrigeration wing's cold rooms — wide,
   * flat-floored store halls with a vaulted ceiling, stacked in tiers and
   * cracked through by the crevasses. `tiers` are floor rows as world-height
   * fractions; each tier takes `perTier` halls. Optional: absent = the old
   * crevasse field only.
   */
  halls?: { tiers: number[]; perTier: [number, number]; wMin: number; wMax: number; hMin: number; hMax: number; vault: number };
  /** CA passes over the crevasse field before anything else is carved (fattens slivers). */
  caPasses?: number;
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface GalleryParams {
  fillDensity: number;
  fillCAPasses: number;
  /** Stacked low-amplitude wide arteries, top to bottom. */
  galleries: ArterySpec[];
  /** Flattened chambers (rx >> ry). */
  chambers: ChamberParams;
  sumps: {
    count: number;
    rMin: number;
    rMax: number;
    yFracMin: number;
    yFracMax: number;
  };
  shafts: ShaftParams;
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface ScaffoldParams {
  grid: {
    cellW: number;
    cellH: number;
    jitter: number;
    roomWFrac: number;
    roomHFrac: number;
    corridorW: number;
    skipChance: number;
  };
  /** Chance per cell to flip wall/open before the roughening CA passes. */
  sprinkle: number;
  caPasses: number;
  /** Vertical shafts at every Nth grid column. */
  shaftEvery: number;
  shaftHalfW: number;
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface VaultParams {
  fillDensity: number;
  caPasses: number;
  vaults: {
    countMin: number;
    countMax: number;
    rxMin: number;
    rxMax: number;
    ryMin: number;
    ryMax: number;
    yFracMin: number;
    yFracMax: number;
    xMargin: number;
  };
  pillars: {
    wMin: number;
    wMax: number;
    spacingMin: number;
    spacingMax: number;
    /** Pillar height as a fraction of the vault ellipse column height. */
    heightFrac: number;
  };
  arteries: ArterySpec[];
  shafts: ShaftParams;
  /**
   * THE GLASS GALLERIES (wave 3): the glassworks' long exhibition galleries —
   * flat-floored halls under an arcade of shallow arches (bays `bay` wide, the
   * crown `arch` of the height above the springers), stacked in tiers at the
   * `tiers` floor rows (world-height fractions), `perTier` to a tier. Long
   * level sight lines for the light to travel. Optional: absent = vaults only.
   */
  galleries?: { tiers: number[]; perTier: [number, number]; wMin: number; wMax: number; hMin: number; hMax: number; bay: [number, number]; arch: number };
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface TubeParams {
  fillDensity: number;
  caPasses: number;
  walkers: {
    countMin: number;
    countMax: number;
    steps: number;
    radiusMin: number;
    radiusMax: number;
    turn: number;
    gravityBias: number;
    branchChance: number;
    maxBranches: number;
    xMargin: number;
    yFracMin: number;
    yFracMax: number;
  };
  chambers: {
    count: number;
    rMin: number;
    rMax: number;
    lobes: number;
    xMargin: number;
    yMin: number;
    ySpanOff: number;
  };
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export type SkeletonSpec =
  | { kind: 'baseline'; params: BaselineSkeletonParams }
  | { kind: 'fungalPockets'; params: FungalParams }
  | { kind: 'frozenCrevasses'; params: CrevasseParams }
  | { kind: 'floodedGalleries'; params: GalleryParams }
  | { kind: 'timberScaffold'; params: ScaffoldParams }
  | { kind: 'crystalVaults'; params: VaultParams }
  | { kind: 'volcanicTubes'; params: TubeParams };

/** Authored-prefab placement budget for one biome's levels. */
export interface PrefabBudget {
  /** Slots rolled per level: rng.int within [min, max] inclusive. */
  count: [number, number];
  /** Registry tags eligible for this biome (any-of match). */
  tags: string[];
  /** Minimum center distance (cells) between two placed prefabs. */
  minSpacing: number;
  /** Minimum center distance (cells) from the spawn chamber. */
  minSpawnDist: number;
}

/** Basin-filled lava lakes (world/lavaLakes): the volcanic floor's signature. */
export interface LavaLakeBudget {
  /** Stop once this many cells are lava. */
  targetCells: number;
  maxLakes: number;
  minCells: number;
  /** Per lake. */
  maxCells: number;
  /** Rows between the lowest cell and the surface. */
  minDepth: number;
  /** Lakes sit below this fraction of the world's height. */
  yFracMin: number;
  /** How far (rows) a lake's surface may rise above its seed. */
  maxRise: number;
  /** Magma halls: chambers carved into thick rock, their lower part lava (count, half-width and half-height ranges). */
  halls: number;
  hallRx: [number, number];
  hallRy: [number, number];
}

export interface GenDef {
  skeleton: SkeletonSpec;
  /** Basin-filled lava lakes (GEN 62); only the volcanic floor has a budget, so no other biome draws from the pass. */
  lavaLakes?: LavaLakeBudget;
  /** Organic connectors (GEN 62, world/connect): the nearest spawn-reachable cell instead of the hub's centroid, wandering, swelling tunnels. Campaign floors only. */
  organicTunnels?: boolean;
  /** Waystones on the route: the two bowls at 35% and 70% of the body-fit walk to the exit, one more beside the key (GEN 62, world/routeWaystones). Campaign floors only. */
  routeWaystones?: boolean;
  /**
   * Fraction of the gold pockets that are stamped (GEN 62): the campaign floors carried 100 x goldBonus
   * (up to 160) pockets, ~20 flecks a screen competing with the real pickups. The placement loop still runs
   * for every pocket (same rng draws, so nothing else in the level moves); only every (1/keep)th is written.
   */
  goldKeep?: number;
  /** Clear the loose stock (oil, gunpowder, water, sand pockets) out of every fixture's room after the last carve (GEN 62, world/looseStock). Campaign floors only. */
  clearFixtureStock?: boolean;
  /**
   * THE LOCK (GEN 65, world/locks): the floor's signature puzzle. On a portal floor the key sits in a
   * vault chamber sealed by a route-seal plug that the puzzle's machine breaks (the structure pass
   * draws no key vault of its own); on the last floor the lock holds the Colossus hall's gate.
   * Absent = the old pocket vault, untouched (no rng draw moves on a floor without a lock).
   */
  lock?: LockKind;
  /** Discrete gold pocket count (decoration stage). */
  goldPockets: number;
  /** Placement attempts cap for gold pockets. */
  goldTriesCap: number;
  /** Combustible seed pocket count (oil/gunpowder). */
  seedPockets: number;
  /** Authored prefab placement budget (worldgen pass after the region graph). */
  prefabs: PrefabBudget;
  /** Machine structure budget (second placePrefabs pass on the forked
   *  'machines' stream — chain-reaction rooms gated per biome by family
   *  tags; docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md). */
  machines: PrefabBudget;
}

/* ============================================================
 * Default param factories (fresh objects per call so tuning one
 * biome can never silently retune another)
 * ============================================================ */

/** The original earthen skeleton, literal for literal. GOLDEN-HASH LOCKED. */
export function baselineSkeletonParams(): BaselineSkeletonParams {
  return {
    noiseDensity: 0.66,
    caPasses: 9,
    arteries: [
      // Primary meandering artery (defines tunnelY / the spawn chamber row).
      {
        baseFrac: 0.4,
        baseJitter: 64,
        amp1: 88,
        freq1: 0.0075,
        amp2: 116,
        freq2: 0.0021,
        clampLo: { kind: 'abs', v: 60 },
        clampHi: { kind: 'floorOff', v: 92 },
        radius: 16,
        carveEvery: 4,
        primary: true,
      },
      // Lower meandering artery.
      {
        baseFrac: 0.74,
        baseJitter: 0,
        amp1: 52,
        freq1: 0.0065,
        amp2: 68,
        freq2: 0.0025,
        clampLo: { kind: 'hfrac', v: 0.58 },
        clampHi: { kind: 'floorOff', v: 28 },
        radius: 14,
        carveEvery: 4,
      },
      // Upper gallery artery.
      {
        baseFrac: 0.14,
        baseJitter: 0,
        amp1: 36,
        freq1: 0.0085,
        amp2: 44,
        freq2: 0.003,
        clampLo: { kind: 'abs', v: 32 },
        clampHi: { kind: 'hfrac', v: 0.26 },
        radius: 14,
        carveEvery: 4,
      },
      // Mid gallery artery.
      {
        baseFrac: 0.57,
        baseJitter: 0,
        amp1: 48,
        freq1: 0.007,
        amp2: 60,
        freq2: 0.0024,
        clampLo: { kind: 'hfrac', v: 0.46 },
        clampHi: { kind: 'hfrac', v: 0.68 },
        radius: 14,
        carveEvery: 4,
      },
    ],
    shafts: {
      fracs: [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92],
      xJitter: 36,
      ampBase: 24,
      ampRand: 32,
      yStart: 20,
      yStep: 3,
      floorMargin: 6,
      walkStep: 4.6,
      walkClamp: 28,
      freq: 0.0125,
      xClamp: 20,
      radius: 11,
    },
    chambers: {
      count: 18,
      xMargin: 48,
      yMin: 80,
      ySpanOff: 144,
      rxBase: 26,
      rxRand: 20,
      ryBase: 17,
      ryRand: 13,
    },
    spawnRadius: 24,
    stalactites: {
      xMargin: 8,
      ceilMaxOff: 62,
      probeDepth: 90,
      minDepth: 52,
      chance: 0.35,
      lenBase: 11,
      lenRandCap: 13,
      lenDepthOff: 36,
      hwFrac: 0.42,
      wobChance: 0.3,
      taperChance: 0.75,
      stalagChance: 0.4,
      stalagMinDepth: 70,
      stalagLenBase: 6,
      stalagLenRand: 7,
      stalagHwFrac: 0.7,
      stalagTaperChance: 0.8,
      skipBase: 24,
      skipRand: 30,
    },
    speckPasses: 2,
    speckLoneChance: 0.7,
  };
}

export function fungalParams(): FungalParams {
  return {
    // denser-than-baseline base rock so the BUBBLES read as the level;
    // CA-blended noise voids are large enough to join the web (minArea)
    // instead of stippling it with drill tunnels
    fillDensity: 0.62,
    chains: 14,
    links: 6,
    rMin: 12,
    rMax: 24,
    throatW: 25, // radius 12: a 9x17 box needs r >= 9.62 + wobble slack
    artery: {
      baseFrac: 0.5,
      baseJitter: 60,
      amp1: 60,
      freq1: 0.006,
      amp2: 40,
      freq2: 0.0019,
      clampLo: { kind: 'abs', v: 70 },
      clampHi: { kind: 'floorOff', v: 60 },
      radius: 13,
      carveEvery: 4,
    },
    caPasses: 5,
    spawnRadius: 26,
    minArea: 350,
    tunnelRadius: 11, // a 9x17 box needs r >= 9.62 + wobble slack
  };
}

export function crevasseParams(): CrevasseParams {
  return {
    // THE COLD STORE (GEN 55): a few fat crevasses (threshold .52 -> .7, two
    // CA passes) so the rock reads as ice-split masses, not a comb of one-cell
    // slivers; the cold rooms below carry the level.
    field: { scaleX: 0.05, scaleY: 0.008, octaves: 2, threshold: 0.7 },
    tunnels: {
      countMin: 4,
      countMax: 5,
      radiusMin: 8,
      radiusMax: 10,
      turn: 0.55,
      gravityBias: 2.4,
      branchChance: 0.01,
      maxBranches: 2,
      steps: 300,
      xMargin: 140,
    },
    shelves: { count: 16, lenMin: 30, lenMax: 70, radius: 4 },
    halls: { tiers: [0.19, 0.38, 0.57, 0.77], perTier: [2, 3], wMin: 150, wMax: 250, hMin: 44, hMax: 62, vault: 0.22 },
    caPasses: 2,
    spawnRadius: 26,
    minArea: 500,
    tunnelRadius: 11, // a 9x17 box needs r >= 9.62 + wobble slack
  };
}

export function galleryParams(): GalleryParams {
  const gallery = (baseFrac: number, radius: number): ArterySpec => ({
    baseFrac,
    baseJitter: 22,
    amp1: 16,
    freq1: 0.0045,
    amp2: 10,
    freq2: 0.0016,
    clampLo: { kind: 'abs', v: 40 },
    clampHi: { kind: 'floorOff', v: 26 },
    radius,
    carveEvery: 4,
  });
  return {
    // denser fill + extra CA passes: stray noise pockets close up, so the
    // open space is dominated by the galleries themselves (the full-res
    // connectivity contract needs >= 70% of open cells on the main web)
    fillDensity: 0.66,
    fillCAPasses: 5,
    galleries: [gallery(0.16, 18), gallery(0.3, 19), gallery(0.44, 20), gallery(0.58, 21), gallery(0.72, 22)],
    chambers: {
      count: 14,
      xMargin: 70,
      yMin: 110,
      ySpanOff: 240,
      rxBase: 32,
      rxRand: 16,
      ryBase: 7,
      ryRand: 6,
    },
    sumps: { count: 7, rMin: 10, rMax: 16, yFracMin: 0.76, yFracMax: 0.84 },
    shafts: {
      fracs: [0.16, 0.4, 0.6, 0.86],
      xJitter: 30,
      ampBase: 12,
      ampRand: 16,
      yStart: 30,
      yStep: 3,
      floorMargin: 6,
      walkStep: 4.0,
      walkClamp: 22,
      freq: 0.009,
      xClamp: 20,
      radius: 13,
    },
    spawnRadius: 26,
    minArea: 300,
    tunnelRadius: 11, // a 9x17 box needs r >= 9.62 + wobble slack
  };
}

export function scaffoldParams(): ScaffoldParams {
  return {
    grid: {
      cellW: 130,
      cellH: 90,
      jitter: 22,
      roomWFrac: 0.62,
      roomHFrac: 0.55,
      corridorW: 26, // CA roughening eats ~3 per edge; >= 20 must survive
      skipChance: 0.1,
    },
    sprinkle: 0.05,
    caPasses: 2,
    shaftEvery: 2,
    shaftHalfW: 10,
    spawnRadius: 26,
    minArea: 500,
    tunnelRadius: 11, // a 9x17 box needs r >= 9.62 + wobble slack
  };
}

/** The Glass Galleries' skeleton: the crystal vaults thinned, and the galleries over them. */
export function galleriesParams(): VaultParams {
  const p = vaultParams();
  return {
    ...p,
    vaults: { ...p.vaults, countMin: 4, countMax: 6 },
    galleries: { tiers: [0.2, 0.4, 0.6, 0.79], perTier: [1, 2], wMin: 220, wMax: 420, hMin: 40, hMax: 52, bay: [30, 44], arch: 0.3 },
  };
}

export function vaultParams(): VaultParams {
  return {
    // denser-than-baseline rock so the tall vaults ARE the level (0.5 read
    // as murky half-open noise that drowned them); the extra CA passes
    // consolidate noise voids into blobs big enough to join the web
    fillDensity: 0.62,
    caPasses: 6,
    vaults: {
      countMin: 8,
      countMax: 12,
      rxMin: 18,
      rxMax: 30,
      ryMin: 40,
      ryMax: 70,
      yFracMin: 0.26,
      yFracMax: 0.62,
      xMargin: 90,
    },
    pillars: {
      wMin: 3,
      wMax: 5,
      spacingMin: 24,
      spacingMax: 40,
      heightFrac: 0.9,
    },
    arteries: [
      {
        baseFrac: 0.3,
        baseJitter: 40,
        amp1: 40,
        freq1: 0.006,
        amp2: 30,
        freq2: 0.0018,
        clampLo: { kind: 'abs', v: 60 },
        clampHi: { kind: 'floorOff', v: 80 },
        radius: 12,
        carveEvery: 4,
      },
      {
        baseFrac: 0.62,
        baseJitter: 40,
        amp1: 36,
        freq1: 0.0055,
        amp2: 28,
        freq2: 0.002,
        clampLo: { kind: 'hfrac', v: 0.5 },
        clampHi: { kind: 'floorOff', v: 40 },
        radius: 12,
        carveEvery: 4,
      },
    ],
    shafts: {
      fracs: [0.18, 0.5, 0.82],
      xJitter: 30,
      ampBase: 18,
      ampRand: 24,
      yStart: 24,
      yStep: 3,
      floorMargin: 6,
      walkStep: 4.2,
      walkClamp: 24,
      freq: 0.011,
      xClamp: 20,
      radius: 10,
    },
    spawnRadius: 26,
    // CA-consolidated geode blobs cluster just under 500 cells — join them
    minArea: 220,
    tunnelRadius: 11, // a 9x17 box needs r >= 9.62 + wobble slack
  };
}

export function tubeParams(): TubeParams {
  return {
    // THE KILN HEART (GEN 62): more rock, fewer and shorter tubes. The floor was
    // 54-64% empty (a web of 30-45 wide tunnels round islands of rock); at
    // 0.70 fill / 260 steps it is 46-56%, which leaves rock masses thick enough
    // to carve magma halls into (world/lavaLakes).
    fillDensity: 0.7,
    caPasses: 3,
    // denser web reaching closer to the borders: locks placed near the
    // edges (progressive relaxation goes there on tight seeds) must land
    // within connectToCaves' walk range of a connected region
    walkers: {
      countMin: 9,
      countMax: 12,
      steps: 260,
      radiusMin: 11,
      radiusMax: 14,
      turn: 0.7,
      gravityBias: 0.35,
      branchChance: 0.035,
      maxBranches: 8,
      xMargin: 90,
      yFracMin: 0.08,
      yFracMax: 0.3,
    },
    chambers: {
      count: 20,
      rMin: 9,
      rMax: 16,
      lobes: 4,
      xMargin: 60,
      yMin: 100,
      ySpanOff: 180,
    },
    spawnRadius: 26,
    minArea: 300,
    tunnelRadius: 11, // a 9x17 box needs r >= 9.62 + wobble slack
  };
}

/* ============================================================
 * Cave-size scaling (CAVE_SCALE). Applied to a skeleton spec just before it is
 * carved, so the param factories stay the literal golden source.
 * ============================================================ */

const scaleArtery = (a: ArterySpec, s: number): ArterySpec => ({
  ...a,
  radius: a.radius * s,
});
const scaleChambers = (c: ChamberParams, s: number): ChamberParams => ({
  ...c,
  rxBase: c.rxBase * s,
  rxRand: c.rxRand * s,
  ryBase: c.ryBase * s,
  ryRand: c.ryRand * s,
});
const scaleShaftsRadius = (sh: ShaftParams, s: number): ShaftParams => ({
  ...sh,
  radius: sh.radius * s,
});

/**
 * Return a copy of `spec` with every OPEN-SPACE carve radius multiplied by `s`.
 * Identity when s === 1 (the same object is returned so golden output is bit-
 * for-bit unchanged). Decorative wall features (stalactites, vault pillars) and
 * structural counts/positions are left untouched — only how wide each carve
 * opens. See CAVE_SCALE.
 */
export function scaleSkeletonSpec(spec: SkeletonSpec, s: number): SkeletonSpec {
  if (s === 1) return spec;
  switch (spec.kind) {
    case 'baseline': {
      const p = spec.params;
      return {
        kind: 'baseline',
        params: {
          ...p,
          arteries: p.arteries.map((a) => scaleArtery(a, s)),
          shafts: scaleShaftsRadius(p.shafts, s),
          chambers: scaleChambers(p.chambers, s),
          spawnRadius: p.spawnRadius * s,
        },
      };
    }
    case 'fungalPockets': {
      const p = spec.params;
      return {
        kind: 'fungalPockets',
        params: {
          ...p,
          artery: scaleArtery(p.artery, s),
          rMin: p.rMin * s,
          rMax: p.rMax * s,
          throatW: p.throatW * s,
          spawnRadius: p.spawnRadius * s,
          tunnelRadius: p.tunnelRadius * s,
        },
      };
    }
    case 'frozenCrevasses': {
      const p = spec.params;
      return {
        kind: 'frozenCrevasses',
        params: {
          ...p,
          tunnels: {
            ...p.tunnels,
            radiusMin: p.tunnels.radiusMin * s,
            radiusMax: p.tunnels.radiusMax * s,
          },
          shelves: { ...p.shelves, radius: p.shelves.radius * s },
          ...(p.halls ? { halls: { ...p.halls, hMin: p.halls.hMin * s, hMax: p.halls.hMax * s } } : {}),
          spawnRadius: p.spawnRadius * s,
          tunnelRadius: p.tunnelRadius * s,
        },
      };
    }
    case 'floodedGalleries': {
      const p = spec.params;
      return {
        kind: 'floodedGalleries',
        params: {
          ...p,
          galleries: p.galleries.map((g) => scaleArtery(g, s)),
          chambers: scaleChambers(p.chambers, s),
          sumps: { ...p.sumps, rMin: p.sumps.rMin * s, rMax: p.sumps.rMax * s },
          shafts: scaleShaftsRadius(p.shafts, s),
          spawnRadius: p.spawnRadius * s,
          tunnelRadius: p.tunnelRadius * s,
        },
      };
    }
    case 'timberScaffold': {
      const p = spec.params;
      return {
        kind: 'timberScaffold',
        params: {
          ...p,
          grid: {
            ...p.grid,
            corridorW: p.grid.corridorW * s,
            roomWFrac: Math.min(0.92, p.grid.roomWFrac * s),
            roomHFrac: Math.min(0.92, p.grid.roomHFrac * s),
          },
          shaftHalfW: p.shaftHalfW * s,
          spawnRadius: p.spawnRadius * s,
          tunnelRadius: p.tunnelRadius * s,
        },
      };
    }
    case 'crystalVaults': {
      const p = spec.params;
      return {
        kind: 'crystalVaults',
        params: {
          ...p,
          vaults: {
            ...p.vaults,
            rxMin: p.vaults.rxMin * s,
            rxMax: p.vaults.rxMax * s,
            ryMin: p.vaults.ryMin * s,
            ryMax: p.vaults.ryMax * s,
          },
          arteries: p.arteries.map((a) => scaleArtery(a, s)),
          shafts: scaleShaftsRadius(p.shafts, s),
          ...(p.galleries ? { galleries: { ...p.galleries, hMin: p.galleries.hMin * s, hMax: p.galleries.hMax * s } } : {}),
          spawnRadius: p.spawnRadius * s,
          tunnelRadius: p.tunnelRadius * s,
        },
      };
    }
    case 'volcanicTubes': {
      const p = spec.params;
      return {
        kind: 'volcanicTubes',
        params: {
          ...p,
          walkers: {
            ...p.walkers,
            radiusMin: p.walkers.radiusMin * s,
            radiusMax: p.walkers.radiusMax * s,
          },
          chambers: {
            ...p.chambers,
            rMin: p.chambers.rMin * s,
            rMax: p.chambers.rMax * s,
          },
          spawnRadius: p.spawnRadius * s,
          tunnelRadius: p.tunnelRadius * s,
        },
      };
    }
  }
}

/** Default spec instance per skeleton kind (used by structural tests). */
export function defaultSkeletonSpec(kind: SkeletonSpec['kind']): SkeletonSpec {
  switch (kind) {
    case 'baseline':
      return { kind, params: baselineSkeletonParams() };
    case 'fungalPockets':
      return { kind, params: fungalParams() };
    case 'frozenCrevasses':
      return { kind, params: crevasseParams() };
    case 'floodedGalleries':
      return { kind, params: galleryParams() };
    case 'timberScaffold':
      return { kind, params: scaffoldParams() };
    case 'crystalVaults':
      return { kind, params: vaultParams() };
    case 'volcanicTubes':
      return { kind, params: tubeParams() };
  }
}

function defaultPrefabBudget(): PrefabBudget {
  return {
    count: [1, 3],
    tags: ['vault', 'shrine', 'setpiece'],
    minSpacing: 180,
    minSpawnDist: 200,
  };
}

/** One machine room attempted per level; the family list is the biome gate. */
function machineBudget(tags: string[]): PrefabBudget {
  return {
    count: [1, 1],
    tags,
    minSpacing: 200,
    minSpawnDist: 220,
  };
}

function baselineDef(): GenDef {
  return {
    skeleton: { kind: 'baseline', params: baselineSkeletonParams() },
    goldPockets: 100,
    goldTriesCap: 30000,
    seedPockets: 60,
    prefabs: defaultPrefabBudget(),
    machines: machineBudget(['powdermill']),
  };
}

/**
 * Per-biome skeleton selection. earthen (the golden-hash-locked baseline)
 * and scorched keep the original cave shape; the other six run bespoke
 * topologies — a DELIBERATE generation change (old seeds produce new worlds
 * on those depths; the expedition genVersion guard retires stale saves).
 */
export const GEN: Record<BiomeId, GenDef> = {
  // d1 keeps a lighter prefab budget — the onboarding depth stays readable.
  // Machine family gating per biome follows the plan's matrix: Powder Mill
  // earthen/timber/scorched, Alchemy Clock flooded/fungal/crystal, Kiln
  // Elevator scorched/volcanic/timber, Crystal Relay crystal/frozen/earthen.
  earthen: {
    ...baselineDef(),
    prefabs: { ...defaultPrefabBudget(), count: [1, 2] },
    machines: machineBudget(['powdermill', 'crystalrelay']),
  },
  frozen: {
    ...baselineDef(),
    skeleton: { kind: 'frozenCrevasses', params: crevasseParams() },
    machines: machineBudget(['crystalrelay']),
    clearFixtureStock: true,
    organicTunnels: true,
    goldKeep: 0.45, // ~45 effective gold pockets (100 x goldBonus x keep)
    routeWaystones: true,
    lock: 'coldvault',
  },
  flooded: {
    ...baselineDef(),
    skeleton: { kind: 'floodedGalleries', params: galleryParams() },
    machines: machineBudget(['alchemyclock']),
    clearFixtureStock: true,
    organicTunnels: true,
    goldKeep: 0.45, // ~45 effective gold pockets (100 x goldBonus x keep)
    routeWaystones: true,
    lock: 'weir',
  },
  timber: {
    ...baselineDef(),
    skeleton: { kind: 'timberScaffold', params: scaffoldParams() },
    machines: machineBudget(['powdermill', 'kilnelevator']),
  },
  scorched: {
    ...baselineDef(),
    machines: machineBudget(['powdermill', 'kilnelevator']),
  },
  fungal: {
    ...baselineDef(),
    skeleton: { kind: 'fungalPockets', params: fungalParams() },
    machines: machineBudget(['alchemyclock']),
    clearFixtureStock: true,
    organicTunnels: true,
    goldKeep: 0.45, // ~45 effective gold pockets (100 x goldBonus x keep)
    routeWaystones: true,
    lock: 'gasbell',
  },
  // THE GLASS GALLERIES (d3b): the vaults, fewer, under tiers of long arcaded
  // exhibition galleries (the light puzzles and the Lenswright want sight lines).
  crystal: {
    ...baselineDef(),
    skeleton: { kind: 'crystalVaults', params: galleriesParams() },
    machines: machineBudget(['alchemyclock', 'crystalrelay']),
    clearFixtureStock: true,
    organicTunnels: true,
    goldKeep: 0.3, // ~45 effective gold pockets (100 x goldBonus x keep)
    routeWaystones: true,
    lock: 'periscope',
  },
  volcanic: {
    ...baselineDef(),
    skeleton: { kind: 'volcanicTubes', params: tubeParams() },
    machines: machineBudget(['kilnelevator']),
    clearFixtureStock: true,
    organicTunnels: true,
    goldKeep: 0.34, // ~45 effective gold pockets (100 x goldBonus x keep)
    routeWaystones: true,
    lavaLakes: { targetCells: 26000, maxLakes: 16, minCells: 500, maxCells: 4500, minDepth: 10, yFracMin: 0.4, maxRise: 70, halls: 10, hallRx: [44, 76], hallRy: [22, 34] },
    lock: 'crucible',
  },
  // The Gilded Vault: crystal-vault pillared halls re-dressed as a treasury,
  // gold-saturated (the hoard IS the decoration — see applyBiomeExtras' gold
  // veins + catalyst seams and the 'gilded' BiomeDef's acid pools).
  gilded: {
    ...baselineDef(),
    skeleton: { kind: 'crystalVaults', params: vaultParams() },
    goldPockets: 260,
    prefabs: {
      ...defaultPrefabBudget(),
      count: [1, 2],
      tags: ['vault', 'setpiece'],
    },
    machines: machineBudget(['crystalrelay']),
  },
};
