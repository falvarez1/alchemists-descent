import { BIOMES } from '@/config/biomes';
import { HEIGHT, WIDTH } from '@/config/constants';
import { GEN, GEN_TUNE, scaleSkeletonSpec } from '@/config/gen';
import { clamp, hash2, valueNoise } from '@/core/math';
import { Rng, hashSeed, randomSeed } from '@/core/rng';
import { reseedAllStreams } from '@/core/simRandom';
import { generateBreathingWorks } from '@/world/breathingWorks';
import { matureVegetation } from '@/world/vegetation';
import { makeInstantiationSink } from '@/game/instantiate';
import type {
  AuthoredLight,
  Ctx,
  DarkZone,
  LumenBloom,
  EnemyKind,
  ExitPortal,
  HazardEmitter,
  LevelDef,
  LevelExitWell,
  Mechanism,
  Pickup,
  PlacedPrefab,
  PrefabEnemy,
  RuneVault,
  RuntimeDecor,
  VaultArch,
  Waystone,
  WorldGenApi,
} from '@/core/types';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import {
  COLOR_FN,
  EMPTY_COLOR,
  fireColor,
  goldColor,
  gunpowderColor,
  iceColor,
  oilColor,
  packRGB,
  stoneColor,
  unpackB,
  unpackG,
  unpackR,
  waterColor,
  woodColor,
} from '@/sim/colors';
import { applyBiomeExtras, applyCampaignDressing, fillMineralVugs, goldPocketBudgetForBiome } from '@/world/biomeExtras';
import { type CarveAvoid, PlacementLedger, carveRect, sealedFootprints, setOrganicTunnels, tunnelTo } from '@/world/connect';
import { applyFloraPass } from '@/world/floraPass';
import { spawnFortress as stampFortress } from '@/world/fortress';
import { SKELETONS } from '@/world/skeleton';
import type { SkeletonIO } from '@/world/skeleton';
import { polishCaveTerrain, consolidateRock, fillEnclosedHoles, solidifyRock, type PolishTarget } from '@/world/terrainPolish';
import { dressWalkSurface, plantGroundCover } from '@/world/surfaceDress';
import { extractRegionGraph } from '@/world/regions';
import { placePrefabs } from '@/world/prefabs/place';
import { placeEncounterLairs } from '@/world/encounterLairs';
import { placeLightPuzzles, type LightPuzzleOutput } from '@/world/lightPuzzles';
import { dressColdStore } from '@/world/coldStore';
import { placeColdStorePuzzles, type ColdStorePuzzleOutput } from '@/world/coldStorePuzzles';
import { dressGlassGalleries } from '@/world/glassGalleries';
import { placeGalleryPuzzles, type GalleryPuzzleOutput } from '@/world/galleryPuzzles';
import { stampSecrets } from '@/world/secrets';
import { beamable, bodyCanCollect, computeFits, reachableMask, routeSealedWorld, wizardMask } from '@/world/validate';
import {
  type BodyRecord,
  cauldronFooting,
  holdFixtureFootings,
  recordBodies,
  reserveFooting,
  reserveTriggerFootings,
  waystoneFooting,
} from '@/world/fixtureFooting';
import { placeStructures } from '@/world/structures';
import { placeStorySites } from '@/world/storySites';
import { placeLavaLakes, type LakeTarget, type LavaLakeResult } from '@/world/lavaLakes';
import type { LockOutput } from '@/world/locks';
import { placeLock } from '@/world/placeLocks';
import { clearLooseStock, type StockSite } from '@/world/looseStock';
import { holdPortalShrine } from '@/world/portalShrine';
import { placeRouteWaystones } from '@/world/routeWaystones';
import type { LevelStorySites } from '@/core/story';

/* ===================== Procedural Generation Map Engines ===================== */

/** 4-connected neighbor offsets, hoisted out of the rim-light distance BFS so
 *  that pass allocates no per-cell neighbor literals (the open-cell frontier is
 *  10^5-10^6 cells over 13 levels). */
const N4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function shouldLogDevDiagnostics(): boolean {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return false;
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.VITEST !== 'true';
}

export class WorldGen implements WorldGenApi {
  /** Center of the carved spawn chamber (original caveSpawnHint). */
  spawnHint: { x: number; y: number } | null = null;

  /** The last level's lava lakes (a tuning aid for probes; null off the volcanic floor). */
  lastLavaLakes: LavaLakeResult | null = null;

  /** Paint seed for the most recent cave commit; captured by Builder docs. */
  paintSeed: number | null = null;

  /** Seeded generation stream; re-seeded from state.worldSeed by generateCaves. */
  private rng = new Rng(0);

  regenerate(ctx: Ctx): void {
    // The regenerate button always rolls a fresh world; generateCaves itself
    // never re-rolls the seed, so a fixed worldSeed replays the same layout.
    ctx.state.worldSeed = randomSeed();
    this.generateCaves(ctx);
    // Dress the DISPOSABLE sandbox preview (ore veins, moss, crystals, coal, gold,
    // then the campaign-recipe ore/glow/liquid/rubble/vine densities) so biome
    // look-tuning is visible right here, not only in a played expedition — the
    // expedition path does both passes inside generateLevel.
    applyBiomeExtras(ctx, this.rng, ctx.state.currentBiome);
    applyCampaignDressing(ctx, new Rng(hashSeed(ctx.state.worldSeed >>> 0, 'sandbox-dress')), ctx.state.currentBiome, new PlacementLedger());
    if (this.spawnHint) {
      ctx.camera.snapTo(this.spawnHint.x, this.spawnHint.y);
    }
  }

  spawnFortress(ctx: Ctx): void {
    ctx.world.activity.invalidateAll();
    stampFortress(ctx);
  }

  generateCaves(ctx: Ctx): void {
    this.rng = new Rng(ctx.state.worldSeed >>> 0);
    // Generation paints tint through the fx stream (sim/colors.ts). Anchoring
    // every stream here is what makes a fresh world reproducible from its seed
    // instead of from wherever the previous level happened to leave them.
    reseedAllStreams(ctx.state.worldSeed >>> 0);
    const world = ctx.world;
    world.clear();
    const B = BIOMES[ctx.state.currentBiome] || BIOMES.earthen;
    const G = GEN[ctx.state.currentBiome] || GEN.earthen;
    const FLOOR_BAND = HEIGHT - 52; // open strip at the bottom
    const MIN_Y = 2;

    // --- 1-3) Skeleton: noise fill + CA smoothing + carve network ---
    // work[x][y] flattened to x + y * WIDTH (1 = wall, 0 = open). The
    // strategy consumes this.rng directly, so the paint/decoration draws
    // below continue the same stream in the same order as the original
    // single-function generator (golden-hash locked for baseline).
    const work = new Uint8Array(WIDTH * HEIGHT);
    const io: SkeletonIO = {
      work,
      rng: this.rng,
      floorBand: FLOOR_BAND,
      minY: MIN_Y,
      worldSeed: ctx.state.worldSeed >>> 0,
    };
    const skel = SKELETONS[G.skeleton.kind](io, scaleSkeletonSpec(G.skeleton, GEN_TUNE.caveScale));
    this.spawnHint = skel.spawnHint;
    // skel.tunnelY (the baseline primary-artery profile) has no remaining
    // consumers in the shared stages — the spawn chamber is carved inside the
    // skeleton, and generateLevel anchors everything on spawnHint. Non-baseline
    // skeletons return null; any future tunnelY dependency must fall back to
    // spawnHint.y or an open-cell scan.

    // --- 4) Commit with layered material palette + depth shading ---
    const seed = Math.floor(this.rng.next() * 100000);
    this.paintSeed = seed;

    // Distance-from-air (multi-source BFS, capped) drives rim-light shading
    const dist = new Uint8Array(WIDTH * HEIGHT).fill(99);
    let frontier: Array<[number, number]> = [];
    for (let x = 0; x < WIDTH; x++) {
      for (let y = 0; y < HEIGHT; y++) {
        if (!work[x + y * WIDTH]) {
          dist[x + y * WIDTH] = 0;
          frontier.push([x, y]);
        }
      }
    }
    for (let d = 1; d <= 13 && frontier.length; d++) {
      const nf: Array<[number, number]> = [];
      for (const [fx2, fy2] of frontier) {
        for (const [dx, dy] of N4) {
          const X = fx2 + dx,
            Y = fy2 + dy;
          if (X < 0 || X >= WIDTH || Y < 0 || Y >= HEIGHT) continue;
          if (work[X + Y * WIDTH] && dist[X + Y * WIDTH] > d) {
            dist[X + Y * WIDTH] = d;
            nf.push([X, Y]);
          }
        }
      }
      frontier = nf;
    }

    for (let x = 0; x < WIDTH; x++) {
      for (let y = 0; y < HEIGHT; y++) {
        const i = x + y * WIDTH;
        if (!work[i]) {
          world.types[i] = Cell.Empty;
          world.colors[i] = EMPTY_COLOR;
          continue;
        }
        world.types[i] = Cell.Wall;

        // Material banding: packed dirt, dry soil, frosted stone, pale rock
        let m = valueNoise(x, y, 0.014, seed);
        m = clamp((m - 0.5) * 2.1 + 0.5, 0, 1);
        const grain = 0.85 + valueNoise(x, y, 0.12, seed + 5) * 0.3;
        const band = m < 0.4 ? B.bands[0] : m < 0.58 ? B.bands[1] : m < 0.84 ? B.bands[2] : B.bands[3];
        const r = band[0],
          g = band[1],
          b = band[2];

        // Rim-lit edges fading to dark cores
        const d = dist[i];
        const shade = d <= 2 ? 1.08 : d <= 4 ? 0.88 : d <= 6 ? 0.7 : d <= 8 ? 0.58 : d <= 10 ? 0.5 : 0.44;
        const jit = 0.92 + hash2(x, y, seed + 11) * 0.16;
        world.colors[i] = packRGB(
          Math.min(255, Math.floor(r * grain * shade * jit)),
          Math.min(255, Math.floor(g * grain * shade * jit)),
          Math.min(255, Math.floor(b * grain * shade * jit)),
        );
      }
    }

    // Moss + grass crowns on top surfaces, wildflowers, mossy ceiling fringe
    // (TRANSCRIBED in src/world/crownPalette.ts for the Builder's crownTint
    // pass. This stage is locked bit-for-bit by tests/gen-golden.test.ts —
    // never refactor it to call the transcription; sync both by hand.)
    for (let x = 0; x < WIDTH; x++) {
      for (let y = 1; y < HEIGHT - 1; y++) {
        const i = x + y * WIDTH;
        if (world.types[i] !== Cell.Wall) continue;
        const topish =
          world.types[x + (y - 1) * WIDTH] === Cell.Empty &&
          (y < 2 || world.types[x + (y - 2) * WIDTH] === Cell.Empty);
        const nbTop = (xx: number): boolean =>
          xx >= 0 &&
          xx < WIDTH &&
          world.types[xx + y * WIDTH] === Cell.Wall &&
          world.types[xx + (y - 1) * WIDTH] === Cell.Empty;
        if (topish && (nbTop(x - 1) || nbTop(x + 1))) {
          const t = hash2(x, y, seed + 21);
          if (B.crown === 'frost') {
            if (t < B.flowerChance) world.colors[i] = packRGB(165, 215, 255);
            else
              world.colors[i] = packRGB(
                192 + Math.floor(hash2(x, 0, seed) * 40),
                206 + Math.floor(hash2(x, 1, seed) * 34),
                228 + Math.floor(hash2(x, 2, seed) * 27),
              );
            if (world.types[x + (y + 1) * WIDTH] === Cell.Wall && hash2(x, y, seed + 23) < 0.5) {
              const i2 = x + (y + 1) * WIDTH;
              const c2 = world.colors[i2];
              world.colors[i2] = packRGB(
                Math.floor(unpackR(c2) * 0.85 + 18),
                Math.floor(unpackG(c2) * 0.88 + 22),
                Math.min(255, Math.floor(unpackB(c2) * 0.9 + 32)),
              );
            }
          } else if (B.crown === 'ember') {
            if (t < 0.06) world.colors[i] = packRGB(255, 110 + Math.floor(hash2(x, 1, seed) * 70), 22);
            else
              world.colors[i] = packRGB(
                68 + Math.floor(hash2(x, 0, seed) * 22),
                60 + Math.floor(hash2(x, 1, seed) * 16),
                54 + Math.floor(hash2(x, 2, seed) * 12),
              );
          } else {
            if (t < B.flowerChance) world.colors[i] = packRGB(212, 118, 166);
            else if (t < B.flowerChance + 0.05) world.colors[i] = packRGB(194, 176, 86);
            else
              world.colors[i] = packRGB(
                54 + Math.floor(hash2(x, 0, seed) * 26),
                126 + Math.floor(hash2(x, 1, seed) * 48),
                42 + Math.floor(hash2(x, 2, seed) * 22),
              );
            if (world.types[x + (y + 1) * WIDTH] === Cell.Wall) {
              world.colors[x + (y + 1) * WIDTH] = packRGB(
                44 + Math.floor(hash2(x, 3, seed) * 22),
                104 + Math.floor(hash2(x, 4, seed) * 40),
                36 + Math.floor(hash2(x, 5, seed) * 18),
              );
            }
            if (y + 2 < HEIGHT && world.types[x + (y + 2) * WIDTH] === Cell.Wall && hash2(x, y, seed + 23) < 0.6) {
              const i2 = x + (y + 2) * WIDTH;
              const c2 = world.colors[i2];
              world.colors[i2] = packRGB(
                Math.floor(unpackR(c2) * 0.7),
                Math.min(255, Math.floor(unpackG(c2) * 0.85 + 26)),
                Math.floor(unpackB(c2) * 0.7),
              );
            }
          }
        } else if (
          B.crown !== 'ember' &&
          world.types[x + (y + 1) * WIDTH] === Cell.Empty &&
          world.types[x + Math.min(HEIGHT - 1, y + 2) * WIDTH] === Cell.Empty &&
          hash2(x, y, seed + 29) < 0.22
        ) {
          const c = world.colors[i];
          if (B.crown === 'frost')
            world.colors[i] = packRGB(
              Math.floor(unpackR(c) * 0.9 + 14),
              Math.floor(unpackG(c) * 0.92 + 18),
              Math.min(255, Math.floor(unpackB(c) * 0.95 + 28)),
            );
          else
            world.colors[i] = packRGB(
              Math.floor(unpackR(c) * 0.75),
              Math.min(255, Math.floor(unpackG(c) * 0.9 + 18)),
              Math.floor(unpackB(c) * 0.75),
            );
        }
      }
    }

    // --- 5) Decorations ---
    // Gold: a limited number of discrete pockets, buried but adjacent to open space
    let goldPlaced = 0,
      goldTries = 0;
    const goldPocketTarget = goldPocketBudgetForBiome(G.goldPockets, ctx.state.currentBiome);
    const goldKeep = G.goldKeep ?? 1;
    while (goldPlaced < goldPocketTarget && goldTries < G.goldTriesCap) {
      goldTries++;
      const x = 14 + Math.floor(this.rng.next() * (WIDTH - 28));
      const y = 40 + Math.floor(this.rng.next() * (FLOOR_BAND - 70));
      if (world.types[x + y * WIDTH] !== Cell.Wall) continue;
      let nearOpen = false;
      for (let dy = -6; dy <= 6 && !nearOpen; dy += 2) {
        for (let dx = -6; dx <= 6 && !nearOpen; dx += 2) {
          if (world.inBounds(x + dx, y + dy) && world.types[x + dx + (y + dy) * WIDTH] === Cell.Empty)
            nearOpen = true;
        }
      }
      if (!nearOpen) continue;
      // (a kept pocket is written; the rest draw the same numbers and leave the rock alone, GenDef.goldKeep)
      const stamped = Math.floor((goldPlaced + 1) * goldKeep) > Math.floor(goldPlaced * goldKeep);
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          if (
            dx * dx + dy * dy <= 24 &&
            world.inBounds(x + dx, y + dy) &&
            world.types[x + dx + (y + dy) * WIDTH] === Cell.Wall &&
            this.rng.next() < 0.85 &&
            stamped
          ) {
            world.types[x + dx + (y + dy) * WIDTH] = Cell.Gold;
            world.colors[x + dx + (y + dy) * WIDTH] = goldColor();
          }
        }
      }
      goldPlaced++;
    }

    // Lava: a few molten pools settled on deep cavern floors
    const poolType = B.poolElement();
    let lavaPools = 0;
    for (let x = 8; x < WIDTH - 8 && lavaPools < B.pools; x++) {
      for (let y = Math.floor(HEIGHT * 0.66); y < FLOOR_BAND - 2 && lavaPools < B.pools; y++) {
        if (this.spawnHint && Math.abs(x - this.spawnHint.x) < 50 && Math.abs(y - this.spawnHint.y) < 46) continue;
        if (
          world.types[x + y * WIDTH] === Cell.Empty &&
          world.types[x + (y + 1) * WIDTH] === Cell.Wall &&
          this.rng.next() < 0.006
        ) {
          for (let dx = -9; dx <= 9; dx++) {
            for (let dy = 0; dy >= -2; dy--) {
              const px = x + dx,
                py = y + dy;
              if (
                world.inBounds(px, py) &&
                world.types[px + py * WIDTH] === Cell.Empty &&
                (dy === 0 || Math.abs(dx) <= 4 + dy * 2)
              ) {
                world.types[px + py * WIDTH] = poolType;
                world.colors[px + py * WIDTH] = (COLOR_FN[poolType] ?? COLOR_FN[Cell.Nitrogen])();
              }
            }
          }
          lavaPools++;
        }
      }
    }

    // Combustible seeds tucked into lower-half pockets
    let seeds = 0;
    for (let attempt = 0; attempt < 3600 && seeds < G.seedPockets; attempt++) {
      const x = 8 + Math.floor(this.rng.next() * (WIDTH - 16));
      const y = Math.floor(HEIGHT / 2) + Math.floor(this.rng.next() * (FLOOR_BAND - HEIGHT / 2 - 6));
      if (world.types[x + y * WIDTH] !== Cell.Empty) continue;
      const seedType = this.rng.next() < B.seedsOilBias ? Cell.Oil : Cell.Gunpowder;
      for (let i = -7; i <= 7; i++) {
        for (let j = -5; j <= 5; j++) {
          if (world.inBounds(x + i, y + j) && world.types[x + i + (y + j) * WIDTH] === Cell.Empty) {
            world.types[x + i + (y + j) * WIDTH] = seedType;
            world.colors[x + i + (y + j) * WIDTH] = seedType === Cell.Oil ? oilColor() : gunpowderColor();
          }
        }
      }
      seeds++;
    }

    // Timber platforms floating in the larger caverns (flammable, walkable)
    let beams = 0;
    for (let attempt = 0; attempt < B.beams * 110 && beams < B.beams; attempt++) {
      const bx = 30 + Math.floor(this.rng.next() * (WIDTH - 60));
      const by = 40 + Math.floor(this.rng.next() * (FLOOR_BAND - 84));
      if (this.spawnHint && Math.abs(bx - this.spawnHint.x) < 50 && Math.abs(by - this.spawnHint.y) < 50) continue;
      const bw = 15 + Math.floor(this.rng.next() * 10);
      let ok = true;
      for (let dx = -bw - 1; dx <= bw + 1 && ok; dx++) {
        for (let dy = -22; dy <= 21 && ok; dy++) {
          // original: grid[bx + dx]?.[by + dy] !== EMPTY (OOB reads count as blocked)
          if (!world.inBounds(bx + dx, by + dy) || world.types[bx + dx + (by + dy) * WIDTH] !== Cell.Empty)
            ok = false;
        }
      }
      if (!ok) continue;
      for (let dx = -bw; dx <= bw; dx++) {
        for (let t = 0; t < 4; t++) {
          const bi = bx + dx + (by + t) * WIDTH;
          world.types[bi] = Cell.Wood;
          const plank =
            (t === 0 ? 1.0 : t === 1 ? 0.9 : t === 2 ? 0.78 : 0.66) * (0.88 + hash2(bx + dx, t, 77) * 0.24);
          world.colors[bi] = packRGB(Math.floor(132 * plank), Math.floor(88 * plank), Math.floor(44 * plank));
        }
      }
      beams++;
    }

    // Smouldering campfires dotting the cavern floors
    let fires = 0;
    for (let attempt = 0; attempt < B.fires * 110 && fires < B.fires; attempt++) {
      const fx = 36 + Math.floor(this.rng.next() * (WIDTH - 72));
      const fy = 60 + Math.floor(this.rng.next() * (FLOOR_BAND - 86));
      if (world.types[fx + fy * WIDTH] !== Cell.Empty || world.types[fx + (fy + 1) * WIDTH] !== Cell.Wall) continue;
      if (this.spawnHint && Math.abs(fx - this.spawnHint.x) < 66 && Math.abs(fy - this.spawnHint.y) < 50) continue;
      for (let dx = -4; dx <= 4; dx++) {
        if (world.inBounds(fx + dx, fy) && world.types[fx + dx + fy * WIDTH] === Cell.Empty) {
          world.types[fx + dx + fy * WIDTH] = Cell.Wood;
          world.colors[fx + dx + fy * WIDTH] = woodColor();
        }
        if (Math.abs(dx) <= 3 && world.inBounds(fx + dx, fy - 1) && world.types[fx + dx + (fy - 1) * WIDTH] === Cell.Empty) {
          world.types[fx + dx + (fy - 1) * WIDTH] = Cell.Wood;
          world.colors[fx + dx + (fy - 1) * WIDTH] = woodColor();
        }
        if (Math.abs(dx) <= 3 && world.inBounds(fx + dx, fy - 2) && world.types[fx + dx + (fy - 2) * WIDTH] === Cell.Empty) {
          world.types[fx + dx + (fy - 2) * WIDTH] = Cell.Fire;
          world.colors[fx + dx + (fy - 2) * WIDTH] = fireColor();
          world.life[fx + dx + (fy - 2) * WIDTH] = 220 + Math.floor(this.rng.next() * 220);
        }
      }
      fires++;
    }

    // Frozen Depths: glacial ice crusts grown on exposed rock
    if (B.iceClusters > 0) {
      let ic = 0;
      for (let attempt = 0; attempt < B.iceClusters * 70 && ic < B.iceClusters; attempt++) {
        const x = 6 + Math.floor(this.rng.next() * (WIDTH - 12));
        const y = 14 + Math.floor(this.rng.next() * (FLOOR_BAND - 20));
        if (world.types[x + y * WIDTH] !== Cell.Wall) continue;
        let nearAir = false;
        for (const [ddx, ddy] of [
          [0, -1],
          [0, 1],
          [1, 0],
          [-1, 0],
        ]) {
          if (world.inBounds(x + ddx, y + ddy) && world.types[x + ddx + (y + ddy) * WIDTH] === Cell.Empty) {
            nearAir = true;
            break;
          }
        }
        if (!nearAir) continue;
        const cr = 4 + Math.floor(this.rng.next() * 5);
        for (let dy = -cr; dy <= cr; dy++) {
          for (let dx = -cr; dx <= cr; dx++) {
            if (dx * dx + dy * dy > cr * cr) continue;
            const X = x + dx,
              Y = y + dy;
            if (world.inBounds(X, Y) && world.types[X + Y * WIDTH] === Cell.Wall && this.rng.next() < 0.8) {
              world.types[X + Y * WIDTH] = Cell.Ice;
              world.colors[X + Y * WIDTH] = iceColor();
            }
          }
        }
        ic++;
      }
    }

    // Flooded Caverns: standing water below the flood line (spawn chamber stays dry)
    if (B.flood > 0) {
      const line = Math.floor(HEIGHT * B.flood);
      for (let x = 1; x < WIDTH - 1; x++) {
        for (let y = line; y < HEIGHT - 1; y++) {
          if (world.types[x + y * WIDTH] !== Cell.Empty) continue;
          if (this.spawnHint && Math.abs(x - this.spawnHint.x) < 58 && Math.abs(y - this.spawnHint.y) < 50) continue;
          world.types[x + y * WIDTH] = Cell.Water;
          world.colors[x + y * WIDTH] = waterColor();
        }
      }
    }

    // Final terrain polish runs after all rng-driven cave dressing so it
    // cannot perturb rejection-loop draw counts. It only fills terrain-shaped
    // air defects, using neighboring painted rock/crown colors. The lock-dense
    // Gilded Vault and timber scaffold routes keep their original thin-route
    // topology because generated locks are tuned tightly around them.
    if (ctx.state.currentBiome !== 'gilded' && ctx.state.currentBiome !== 'timber') {
      // Polish fills and walk-surface dressing are PRISTINE paint — a restore
      // regenerates them from the seed — not scars. Registering them as
      // colorOverrides told the renderer to show their raw biome paint instead
      // of the terrain atlas (the camouflage blotches on every procedural
      // floor) and bloated each save. Hand the passes a view without the
      // override set, exactly like the chunked generator's scratch adapter.
      const pristine: PolishTarget = {
        types: world.types, colors: world.colors, life: world.life, charge: world.charge, width: WIDTH, height: HEIGHT,
      };
      if (GEN_TUNE.rockFillPasses > 0) {
        consolidateRock(pristine, seed, MIN_Y, FLOOR_BAND, GEN_TUNE.rockFillPasses, GEN_TUNE.rockFillThreshold);
      }
      // De-speckle: a morphological close packs every CONNECTED open feature
      // thinner than 2*radius (the porous-noise speckle the player walks over),
      // leaving caverns/tunnels wider than the radius untouched. Then mop up any
      // remaining SEALED pockets. Both are connectivity-safe by construction.
      if (GEN_TUNE.rockCloseRadius > 0) {
        solidifyRock(pristine, seed, MIN_Y, FLOOR_BAND, GEN_TUNE.rockCloseRadius);
      }
      if (GEN_TUNE.holeFillMax > 0) {
        fillEnclosedHoles(pristine, seed, MIN_Y, FLOOR_BAND, GEN_TUNE.holeFillMax);
      }
      polishCaveTerrain(pristine, {
        seed,
        minY: MIN_Y,
        floorBand: FLOOR_BAND,
        maxPitWidth: GEN_TUNE.surfacePitWidth,
        maxPitDepth: GEN_TUNE.surfacePitDepth,
        notchPasses: GEN_TUNE.notchPasses,
        surfacePits: GEN_TUNE.fillSurfacePits,
      });
      // Cap the remaining shallow walk-surface snags and lay dirt + grass/moss/
      // flowers on the ledges the player walks (runs after polish so it dresses the
      // filled surface). See world/surfaceDress.ts.
      const dressOpts = { seed, minY: MIN_Y, floorBand: FLOOR_BAND, crown: B.crown, flowerChance: B.flowerChance };
      dressWalkSurface(pristine, dressOpts);
      // Living, walk-through ground cover (grass blades + sparse mushroom tufts) on
      // the dressed surface — real soft-growth cells that sway-spread, burn, and
      // wither on their own. See world/surfaceDress.plantGroundCover.
      plantGroundCover(world, dressOpts);
    }

    // SOLID TO THE FLOOR: the old open strip below the caves (a vestige of the
    // removed fall-through wells) becomes real rock, so a level never ends in an
    // empty void above the bedrock — terrain runs all the way down. Flood biomes
    // already filled their bottom with water, so only genuinely-empty cells pack.
    // Deep-core shade + grain keep it from reading as a flat slab.
    const deepBand = B.bands[2];
    for (let y = FLOOR_BAND; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = x + y * WIDTH;
        if (world.types[i] !== Cell.Empty) continue;
        world.types[i] = Cell.Wall;
        const grain = 0.85 + valueNoise(x, y, 0.12, seed + 5) * 0.3;
        const jit = 0.92 + hash2(x, y, seed + 11) * 0.16;
        const shade = 0.44; // deep core, far from any air
        world.colors[i] = packRGB(
          Math.min(255, Math.floor(deepBand[0] * grain * shade * jit)),
          Math.min(255, Math.floor(deepBand[1] * grain * shade * jit)),
          Math.min(255, Math.floor(deepBand[2] * grain * shade * jit)),
        );
      }
    }
  }

  /** GAUGE RESCUE: re-run the validator connectivity audits and carve a
   *  guaranteed chamber + tunnel for anything still cut off. Extracted verbatim
   *  from generateLevel; mutates ctx.world using the placed feature lists. */
  private gaugeRescue(
    ctx: Ctx,
    def: LevelDef,
    spawn: { x: number; y: number },
    mechanisms: Mechanism[],
    spellLab: { x: number; y: number; rewardX: number; rewardY: number } | null,
    runeVaults: RuneVault[],
    pickups: Pickup[],
    waystones: Waystone[],
    cauldron: { x: number; y: number } | null,
    sealed: readonly CarveAvoid[] = [],
    boss: { x: number; y: number } | null = null,
    arenaMouths: ReadonlyArray<{ x: number; y: number }> = [],
    portal: { x: number; y: number } | null = null,
    portalMouths: ReadonlyArray<{ x: number; y: number }> = [],
  ): void {
      // The masks see the grid with every intact route seal open, as the validator does: a lock's vault is
      // reachable by design, and the rescue must not tunnel round its plug (world/locks). With no seal
      // standing (every floor but a locked one) this is ctx.world itself.
      const maskWorld = () => routeSealedWorld(ctx.world, mechanisms);
      let wiz = wizardMask({ world: maskWorld(), spawn });
      let cell = reachableMask({ world: maskWorld(), spawn });
      const wizNear = (x: number, y: number, r: number): boolean => {
        return wizNearCount(x, y, r) > 0;
      };
      const wizNearCount = (x: number, y: number, r: number): number => {
        let count = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const X = Math.floor(x) + dx,
              Y = Math.floor(y) + dy;
            if (X > 0 && Y > 0 && X < WIDTH && Y < HEIGHT && wiz[X + Y * WIDTH]) count++;
          }
        }
        return count;
      };
      const cellNear = (x: number, y: number, r: number): boolean => {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const X = Math.floor(x) + dx,
              Y = Math.floor(y) + dy;
            if (X > 0 && Y > 0 && X < WIDTH && Y < HEIGHT && cell[X + Y * WIDTH]) return true;
          }
        }
        return false;
      };
      const HANDS_ON = new Set(['plate', 'lever', 'brazier', 'scale']);
      /** A hand-trigger's first own row: the lever's bracket, the brazier's lips, the plate, the scale's lips. */
      const fixtureTop = (m: Mechanism): number =>
        m.kind === 'lever' ? m.y + 1 : m.kind === 'brazier' ? m.y - 1 : m.kind === 'scale' ? m.y - 2 : m.y;
      const CELL_REACH = new Set(['sensor', 'counterweight', 'plug', 'buoy', 'chargelatch']);
      // nearest spawn-connected wizard cell whose STRAIGHT LINE from the
      // lock crosses no Metal — carvePocket spares Metal, so a tunnel aimed
      // through a door slab / vault shell / well casing is silently severed
      const metalOnLine = (x0: number, y0: number, x1: number, y1: number): boolean => {
        const steps2 = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
        for (let k = 0; k <= steps2; k++) {
          const X = Math.round(x0 + ((x1 - x0) * k) / steps2);
          const Y = Math.round(y0 + ((y1 - y0) * k) / steps2);
          for (let dy = -6; dy <= 6; dy += 3) {
            for (let dx = -6; dx <= 6; dx += 3) {
              const XX = X + dx,
                YY = Y + dy;
              if (XX < 0 || XX >= WIDTH || YY < 0 || YY >= HEIGHT) continue;
              if (ctx.world.types[XX + YY * WIDTH] === Cell.Metal) return true;
            }
          }
        }
        return false;
      };
      // Sealed features (an encounter lair's pool, the sump, a light room) are
      // walked around, and never the join target: their open interiors are
      // wizard-reachable, so the nearest reachable cell is often INSIDE one,
      // and a tunnel aimed there cut the d3 seed-20 Rillback pool in half.
      // A feature the rescued point itself stands in is its destination, not
      // an obstacle (a light room's own lock), and is not avoided.
      const avoidFor = (x: number, y: number): CarveAvoid[] =>
        sealed.filter((r) => !(x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1));
      const nearestWiz = (x: number, y: number): { x: number; y: number } | null => {
        const avoid = avoidFor(x, y);
        let fallback: { x: number; y: number } | null = null;
        for (let r = 24; r <= 1200; r += 3) {
          for (let a = 0; a < 24; a++) {
            const ang = (a / 24) * Math.PI * 2;
            const X = Math.floor(x + Math.cos(ang) * r),
              Y = Math.floor(y + Math.sin(ang) * r);
            if (X > 1 && Y > 1 && X < WIDTH - 1 && Y < HEIGHT - 1 && wiz[X + Y * WIDTH]
              && !avoid.some((q) => X >= q.x0 && X <= q.x1 && Y >= q.y0 && Y <= q.y1)) {
              if (!metalOnLine(x, y, X, Y)) return { x: X, y: Y };
              fallback ??= { x: X, y: Y };
            }
          }
        }
        return fallback;
      };
      // Rescue one STANDING point: a 15x20 rect chamber above it guarantees
      // fitting feet BY CONSTRUCTION (a disc tunnel only guarantees fits on
      // its centerline — a Metal pedestal in the tube mouth or a rock spire
      // a row above disc reach silently voids it; both happened). Then a
      // tunnel from the chamber joins the spawn component; verify by
      // recomputing the mask, and fall back to a tunnel aimed at the spawn.
      const SWEEP = { halfW: 10, up: 25, down: 12 }; // gauge-guaranteed gallery
      // `keep`: a FIXTURE's first own row (its bowl, bracket or floor). The
      // chamber then stops just above it and the tunnel leaves from high enough
      // that its first disc does too — a rescue used to dig four rows under the
      // thing it rescued and leave it floating (world/fixtureFooting).
      const rescueAt = (px: number, py: number, pass: () => boolean, keep?: number): boolean => {
        carveRect(ctx.world, px - SWEEP.halfW, py - 24, px + SWEEP.halfW, keep === undefined ? py + 4 : keep - 1);
        const ty = keep === undefined ? py - 10 : Math.min(py - 10, keep - 13);
        // Let the rescue tunnel reach a chamber/target ABOVE the default row-26
        // floor (the rescue chamber's top is py-24); for deep features (every
        // case in the shipped seeds) this stays 26, so carve output is unchanged.
        const rescueMinY = Math.min(26, py - 24);
        const target = nearestWiz(px, ty) ?? {
          x: Math.floor(spawn.x),
          y: Math.floor(spawn.y) - 4,
        };
        const avoid = avoidFor(px, ty);
        tunnelTo(ctx.world, this.rng, px, ty, target.x, target.y, 12, SWEEP, rescueMinY, avoid);
        wiz = wizardMask({ world: maskWorld(), spawn });
        cell = reachableMask({ world: maskWorld(), spawn });
        if (pass()) return true;
        tunnelTo(ctx.world, this.rng, px, ty, Math.floor(spawn.x), Math.floor(spawn.y) - 4, 12, SWEEP, rescueMinY, avoid);
        wiz = wizardMask({ world: maskWorld(), spawn });
        cell = reachableMask({ world: maskWorld(), spawn });
        return pass();
      };
      const rescued: string[] = [];
      const failedRescues: string[] = [];
      const recordRescue = (label: string, attempt: () => boolean): void => {
        rescued.push(label);
        if (!attempt()) failedRescues.push(label);
      };
      const failOpenTargetDoor = (trigger: Mechanism, pass: () => boolean): boolean => {
        const door = mechanisms.find((candidate) => candidate.kind === 'door' && candidate.id === trigger.targetId);
        if (!door) return false;
        for (let y = door.y; y < door.y + door.h; y++) {
          for (let x = door.x; x < door.x + door.w; x++) {
            if (!ctx.world.inBounds(x, y)) continue;
            const i = ctx.world.idx(x, y);
            if (ctx.world.types[i] === Cell.Metal) ctx.world.clearCellAt(i);
          }
        }
        door.state = 1;
        wiz = wizardMask({ world: maskWorld(), spawn });
        cell = reachableMask({ world: maskWorld(), spawn });
        return pass();
      };
      const inSpellLab = (x: number, y: number): boolean =>
        !!spellLab &&
        x >= spellLab.x - 30 &&
        x <= spellLab.x + 30 &&
        y >= spellLab.y - 28 &&
        y <= spellLab.y + 8;
      const spellLabDoor = spellLab
        ? mechanisms.find((m) => m.kind === 'door' && inSpellLab(m.x + m.w / 2, m.y + m.h / 2))
        : undefined;
      const spellLabSide = spellLabDoor && spellLab
        ? Math.sign(spellLabDoor.x + spellLabDoor.w / 2 - spellLab.x) || 1
        : 1;
      let spellLabRescued = false;
      const rescueSpellLab = (pass: () => boolean): boolean => {
        if (!spellLab) return false;
        if (spellLabRescued) return pass();
        spellLabRescued = true;
        return rescueAt(spellLab.x - spellLabSide * 36, spellLab.y - 5, pass);
      };
      for (const m of mechanisms) {
        const labMechanism = inSpellLab(m.x + m.w / 2, m.y + m.h / 2);
        if (m.kind === 'door') {
          const pass = (): boolean =>
            wizNear(m.x - 2, m.y + m.h - 2, 8) || wizNear(m.x + m.w + 1, m.y + m.h - 2, 8);
          const stable = (): boolean =>
            wizNearCount(m.x - 2, m.y + m.h - 2, 8) + wizNearCount(m.x + m.w + 1, m.y + m.h - 2, 8) >= 64;
          if (labMechanism && pass()) continue;
          if (labMechanism) {
            recordRescue(`spell-lab@${Math.floor(spellLab?.x ?? m.x)},${Math.floor(spellLab?.y ?? m.y)}`, () =>
              rescueSpellLab(pass),
            );
            continue;
          }
          if (pass() && stable()) continue;
          recordRescue(
            `${m.kind}@${m.x},${m.y}`,
            () => rescueAt(m.x - 6, m.y + m.h - 2, pass) || rescueAt(m.x + m.w + 5, m.y + m.h - 2, pass),
          );
        } else if (m.kind === 'valve') {
          const pass = (): boolean =>
            cellNear(m.x - 2, m.y + m.h / 2, 4) ||
            cellNear(m.x + m.w + 1, m.y + m.h / 2, 4) ||
            cellNear(m.x + m.w / 2, m.y - 2, 4) ||
            cellNear(m.x + m.w / 2, m.y + m.h + 1, 4);
          if (pass()) continue;
          recordRescue(
            `${m.kind}@${m.x},${m.y}`,
            () =>
              rescueAt(m.x + m.w / 2, m.y - 2, pass) ||
              rescueAt(m.x + m.w / 2, m.y + m.h + 1, pass) ||
              rescueAt(m.x - 2, m.y + m.h / 2, pass) ||
              rescueAt(m.x + m.w + 1, m.y + m.h / 2, pass),
          );
        } else if (HANDS_ON.has(m.kind)) {
          const pass = (): boolean => wizNear(m.x, m.y - 2, 6);
          const stable = (): boolean => wizNearCount(m.x, m.y - 2, 6) >= 40;
          if (pass() && stable()) continue;
          recordRescue(`${m.kind}@${m.x},${m.y}`, () => rescueAt(m.x, m.y, stable, fixtureTop(m)) || failOpenTargetDoor(m, stable));
        } else if (CELL_REACH.has(m.kind)) {
          // A lens sealed behind optics (world/galleryPuzzles) is reached at its
          // port — the rescue must never carve into the sealed lens itself.
          const rx = m.lightPort?.x ?? m.x, ry = m.lightPort?.y ?? m.y;
          // A photocell is judged by the BEAM (validate: photocell), not by a reachable cell beside it: a chandelier
          // or a panel the dressing hung in the line of its port blanks a lens the puzzle had made beamable
          // (d3b seed 3, d2b seed 7 after an unrelated gold change).
          const photocell = m.kind === 'sensor' && m.sensorType === 'light' && m.state === 0 && !m.requiresCard;
          const pass = (): boolean => cellNear(rx, ry - 2, 5) && (!photocell || beamable(wiz, ctx.world, rx, ry, 150));
          if (pass()) continue;
          if (labMechanism) {
            recordRescue(`spell-lab@${Math.floor(spellLab?.x ?? m.x)},${Math.floor(spellLab?.y ?? m.y)}`, () =>
              rescueSpellLab(pass),
            );
            continue;
          }
          recordRescue(`${m.kind}@${rx},${ry}`, () => rescueAt(rx, ry, pass));
        }
      }
      for (const v of runeVaults) {
        const rx = Math.floor(v.rx),
          ry = Math.floor(v.ry);
        const pass = (): boolean => cellNear(rx, ry, 5);
        if (pass()) continue;
        recordRescue(`rune@${rx},${ry}`, () => rescueAt(rx, ry, pass));
      }
      // The golden key gates progression and the wizard must WALK to it —
      // it gets the same guarantee as the hands-on locks, judged by the real
      // collect rule (validate bodyCanCollect): a key sunk in the floor is ten
      // cells from open ground and still cannot be taken. The rescue keeps the
      // floor it rests on.
      for (const p of pickups) {
        if (p.kind !== 'key') continue;
        const kx = Math.floor(p.x),
          ky = Math.floor(p.y);
        const pass = (): boolean => bodyCanCollect(wiz, ctx.world, p.x, p.y);
        if (pass() && wizNearCount(kx, ky, 10) >= 64) continue;
        let floor = ky + 1;
        while (floor < HEIGHT - 9 && !blocksEntity(ctx.world.types[kx + floor * WIDTH])) floor++;
        recordRescue(`key@${kx},${ky}`, () => rescueAt(kx, ky, pass, floor));
      }
      for (const ws of waystones) {
        const wx = Math.floor(ws.x),
          wy = Math.floor(ws.y);
        const pass = (): boolean => wizNear(wx, wy, 10);
        if (pass() && wizNearCount(wx, wy, 10) >= 64) continue;
        recordRescue(`waystone@${wx},${wy}`, () => rescueAt(wx, wy, pass, wy - 1));
      }
      if (cauldron) {
        const cx = Math.floor(cauldron.x),
          cy = Math.floor(cauldron.y);
        const pass = (): boolean => wizNear(cx, cy, 10);
        if (!pass() || wizNearCount(cx, cy, 10) < 64) {
          recordRescue(`cauldron@${cx},${cy}`, () => rescueAt(cx, cy, pass, cy - 1));
        }
      }
      // The boss hall is walked to like every lock (GEN 62): a hall whose flank
      // connectors landed in a region the spawn cannot reach is re-joined from its
      // mouths. Judged exactly as the validator does (validate: 'boss-arena').
      if (boss && arenaMouths.length > 0) {
        const pass = (): boolean => wizNear(boss.x, boss.y, 12);
        if (!pass()) recordRescue(`boss@${Math.floor(boss.x)},${Math.floor(boss.y)}`, () => arenaMouths.some((m) => rescueAt(m.x, m.y, pass)));
      }
      // The exit shrine likewise (validate: 'portal'): judged as the validator does.
      if (portal && portalMouths.length > 0) {
        const pass = (): boolean => wizNear(portal.x, portal.y + 6, 12);
        if (!pass()) recordRescue(`portal@${Math.floor(portal.x)},${Math.floor(portal.y)}`, () => portalMouths.some((m) => rescueAt(m.x, m.y, pass)));
      }
      for (const m of mechanisms) {
        if (!HANDS_ON.has(m.kind) || m.targetId < 0) continue;
        const stable = (): boolean => wizNearCount(m.x, m.y - 2, 6) >= 40;
        if (stable()) continue;
        recordRescue(`${m.kind}-target-door@${m.x},${m.y}`, () => failOpenTargetDoor(m, stable));
      }
      if (shouldLogDevDiagnostics() && rescued.length > 0) {
        const suffix = failedRescues.length > 0 ? `; still cut off: ${failedRescues.join(' ')}` : '';
        console.warn(`[gen] ${def.id}: gauge-rescued ${rescued.length} cut-off feature(s): ${rescued.join(' ')}${suffix}`);
      }
  }

  /**
   * Descent-mode generation (Wave B/C): base biome caves, then the level dressing —
   * an indestructible bedrock floor, an explicit portal anchor above sealed ground,
   * two unlit waystone braziers along the lower artery, sim-obeying secrets stamped
   * off the region graph, a cauldron basin beside the first waystone, and (depth 1
   * only) the two onboarding moments near spawn. Layout randomness flows through this.rng
   * (re-seeded by generateCaves from worldSeed), so a level replays identically
   * from its seed. No enemies here — the levels manager places those.
   */
  generateLevel(
    ctx: Ctx,
    def: LevelDef,
    seed: number,
  ): {
    exit: LevelExitWell;
    waystones: Waystone[];
    spawn: { x: number; y: number };
    cauldron: { x: number; y: number } | null;
    pickups: Pickup[];
    portal: ExitPortal | null;
    mechanisms: Mechanism[];
    runeVaults: RuneVault[];
    boss: { x: number; y: number; kind?: EnemyKind } | null;
    prefabEnemies: PrefabEnemy[];
    placedPrefabs: PlacedPrefab[];
    authoredLights: AuthoredLight[];
    emitters: HazardEmitter[];
    decors: RuntimeDecor[];
    refuge: { x: number; y: number } | null;
    spellLab: { x: number; y: number; rewardX: number; rewardY: number } | null;
    /** Retired with the Gilded Vault branch: never produced, always null. */
    vaultArch?: VaultArch | null;
    vaultHoard?: { x: number; y: number } | null;
    /** D1 only: the open-air start point on the surface, above the cave mouth. */
    surfaceSpawn: { x: number; y: number } | null;
    /** D1 only: the horizon row — Empty above it renders as open sky. */
    surfaceSkyLine: number | null;
    /** Light wave: designed deep-dark zones and lumen blooms. */
    darkZones?: DarkZone[];
    lumenBlooms?: LumenBloom[];
    /** STORY: pipes, Pell's camp, the resonant valve, the Kiln flue. */
    story?: LevelStorySites;
  } {
    if (def.id === 'd1') {
      const works = generateBreathingWorks(ctx, seed);
      matureVegetation(ctx.world);
      this.spawnHint = works.spawn;
      return works;
    }
    // DEV stage timing — generation runs synchronously behind the curtain,
    // so a slow stage is a felt hitch; shout when the total crosses 400ms.
    const tStart = performance.now();
    let tPrev = tStart;
    const stages: Array<[string, number]> = [];
    const stage = (label: string): void => {
      if (!shouldLogDevDiagnostics()) return;
      const now = performance.now();
      stages.push([label, now - tPrev]);
      tPrev = now;
    };

    this.lastLavaLakes = null;
    setOrganicTunnels(!!(GEN[def.biome] || GEN.earthen).organicTunnels);
    // 1) Base caves for the level's biome, replayable from the seed.
    ctx.state.currentBiome = def.biome;
    ctx.state.worldSeed = seed >>> 0;
    this.generateCaves(ctx);
    stage('caves');

    const world = ctx.world;
    const spawn = this.spawnHint ?? { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2) };

    const bedrockColor = (): number => {
      const j = Math.floor(this.rng.next() * 9) - 4;
      return packRGB(30 + j, 28 + j, 36 + j);
    };
    const setCell = (x: number, y: number, t: Cell, color: number): void => {
      if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
      const i = x + y * WIDTH;
      world.types[i] = t;
      world.colors[i] = color;
      world.life[i] = 0;
      world.charge[i] = 0;
    };

    // 2) Bedrock: the bottom 6 rows become metal (explosion/acid/dig-proof).
    //    Descent is explicit through the key portal now, so the terrain never
    //    ends in a hidden fall-through shaft.
    for (let y = HEIGHT - 6; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) setCell(x, y, Cell.Metal, bedrockColor());
    }

    // 3) Exit anchor: a sealed, readable portal site above bedrock. Older builds
    //    cut an open shaft through the floor here; keep the plug/approach tell,
    //    but leave the bottom terrain closed.
    const halfW = 14;
    let sealY = HEIGHT - 46;
    let wellX = spawn.x >= WIDTH / 2 ? Math.floor(WIDTH * 0.2) : Math.floor(WIDTH * 0.8);
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = Math.floor(this.rng.range(WIDTH * 0.12, WIDTH * 0.88));
      if (Math.abs(x - spawn.x) < 300) continue;
      wellX = x;
      break;
    }
    // GEN 62: a flooded floor's exit shrine stands ABOVE the flood, in the rock band over the water
    // line: at the world floor it was 100% under water (standing depth 42) and its light column
    // could not be read. The seal row is the lowest one above the flood whose plug, ring and shrine
    // are in solid rock; with none, the old row stands.
    const floodRow = BIOMES[def.biome]?.flood ? Math.floor(HEIGHT * BIOMES[def.biome].flood) : 0;
    if (floodRow > 0) {
      let bestRow = -1, bestShare = 0.6;
      for (let y = floodRow - 64; y >= Math.floor(HEIGHT * 0.38); y -= 4) {
        let rock = 0, total = 0;
        for (let yy = y - 34; yy <= y + 16; yy += 2) {
          for (let xx = wellX - 36; xx <= wellX + 36; xx += 2) {
            total++;
            if (world.types[xx + yy * WIDTH] === Cell.Wall) rock++;
          }
        }
        if (rock / total > bestShare) {
          bestShare = rock / total;
          bestRow = y;
          if (bestShare >= 0.92) break;
        }
      }
      if (bestRow > 0) sealY = bestRow;
    }

    // The old plug remains as a visible stone mound under the portal shrine,
    // but breaking it no longer bypasses the explicit key/bench progression.
    for (let y = sealY; y < sealY + 14; y++) {
      for (let dx = -halfW; dx <= halfW; dx++) setCell(wellX + dx, y, Cell.Stone, stoneColor());
    }
    // Approach pocket above the plug so the well mouth is findable.
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const py = sealY - 8 + dy;
        if (dx * dx + dy * dy <= 100 && py < sealY) setCell(wellX + dx, py, Cell.Empty, EMPTY_COLOR);
      }
    }
    // Gold flecks ringing the mouth — a glittering tell.
    let tells = 0;
    for (let attempt = 0; attempt < 80 && tells < 12; attempt++) {
      const a = this.rng.next() * Math.PI * 2;
      const rr = 10.5 + this.rng.next() * 3;
      const gx = Math.floor(wellX + Math.cos(a) * rr);
      const gy = Math.floor(sealY - 8 + Math.sin(a) * rr);
      if (gx <= 1 || gx >= WIDTH - 2 || gy <= 1) continue;
      if (world.types[gx + gy * WIDTH] === Cell.Wall) {
        setCell(gx, gy, Cell.Gold, goldColor());
        tells++;
      }
    }

    // 4) Waystones: two unlit brazier bowls on solid ground along the lower artery.
    const waystones: Waystone[] = [];
    const isOpenT = (t: number): boolean => t === Cell.Empty || t === Cell.Water;
    const isFloorT = (t: number): boolean =>
      t === Cell.Wall || t === Cell.Stone || t === Cell.Metal || t === Cell.Ice || t === Cell.Gold;
    const stampBrazier = (cx: number, baseY: number): void => {
      // 1-row stone base + two 2-tall side pillars; the 5x2 interior stays open
      // for fire (you must BRING fire to light it), with headroom above to pour.
      for (let dx = -3; dx <= 3; dx++) setCell(cx + dx, baseY, Cell.Stone, stoneColor());
      for (let t = 1; t <= 2; t++) {
        setCell(cx - 3, baseY - t, Cell.Stone, stoneColor());
        setCell(cx + 3, baseY - t, Cell.Stone, stoneColor());
      }
      for (let dy = 1; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setCell(cx + dx, baseY - dy, Cell.Empty, EMPTY_COLOR);
      }
      for (let dy = 3; dy <= 5; dy++) {
        for (let dx = -3; dx <= 3; dx++) setCell(cx + dx, baseY - dy, Cell.Empty, EMPTY_COLOR);
      }
      waystones.push({ x: cx, y: baseY - 1, lit: false });
    };
    const wetOver = (cx: number, baseY: number): boolean => {
      for (let y = baseY - 5; y <= baseY; y++) {
        for (let x = cx - 3; x <= cx + 3; x++) if (isLiquid(world.types[x + y * WIDTH])) return true;
      }
      return false;
    };
    for (const anchor of [WIDTH * 0.33, WIDTH * 0.66]) {
      let placed = false;
      // A checkpoint is lit with fire: its bowl is never set on the bed of a
      // pool (the scan reads water as open, and a restored bowl fills at once).
      // Relaxed in tiers, never skipped: dry ground on the lower artery, then
      // dry ground from higher up (a flooded floor's water table), then any
      // ground, as before.
      for (let attempt = 0; attempt < 120 && !placed; attempt++) {
        const tier = attempt < 40 ? 0 : attempt < 80 ? 1 : 2;
        const cx = Math.floor(anchor + (this.rng.next() - 0.5) * 80);
        if (cx < 12 || cx >= WIDTH - 12) continue;
        if (Math.abs(cx - wellX) < halfW + 26) continue;
        // Scan down from the lower artery's band for the first standable floor.
        let baseY = -1;
        for (let y = Math.floor(HEIGHT * (tier === 1 ? 0.35 : 0.56)); y < HEIGHT - 6; y++) {
          if (isOpenT(world.types[cx + y * WIDTH]) && isFloorT(world.types[cx + (y + 1) * WIDTH]) && (tier === 2 || !wetOver(cx, y))) {
            baseY = y;
            break;
          }
        }
        if (baseY < 0) continue;
        if (Math.abs(cx - spawn.x) < 80 && Math.abs(baseY - spawn.y) < 80) continue;
        if (
          !isFloorT(world.types[cx - 1 + (baseY + 1) * WIDTH]) ||
          !isFloorT(world.types[cx + 1 + (baseY + 1) * WIDTH])
        )
          continue;
        stampBrazier(cx, baseY);
        placed = true;
      }
      if (!placed) {
        // Guaranteed fallback: stand it on the bedrock at the bottom of the floor band.
        let cx = Math.floor(anchor);
        if (Math.abs(cx - wellX) < halfW + 26) cx = cx >= wellX ? wellX + halfW + 26 : wellX - halfW - 26;
        cx = Math.floor(clamp(cx, 12, WIDTH - 13));
        stampBrazier(cx, HEIGHT - 7);
      }
    }
    stage('dressing');

    // 5) Biome extras first (fungus colonies, crystal clusters, snow drifts,
    //    coal seams, healing springs), so secrets can still find untouched
    //    thick wall masses afterward; then the placement brain.
    applyBiomeExtras(ctx, this.rng, def.biome, waystones.map((ws) => ({ x: ws.x, y: ws.y })));
    let graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
    // Wizard-fit mask (9x17 erosion): connect tunnels target FIT cells, so
    // every guaranteed connection joins space the player can actually occupy
    // (carving only ADDS open space, so the mask stays valid as a target
    // hint through the whole placement phase).
    const fits = computeFits(ctx.world);
    stage('extras+graph');

    // 5b) Authored prefabs (forked rng stream — the main stream above keeps
    //     byte-identical output per seed). The ledger pre-reserves the level's
    //     fixed landmarks so prefabs keep clear; every later placement pass
    //     respects the prefab footprints recorded into it.
    const ledger = new PlacementLedger();
    ledger.reserve(spawn.x - 60, spawn.y - 60, spawn.x + 60, spawn.y + 60, 'spawn');
    ledger.reserve(wellX - halfW - 6, 0, wellX + halfW + 6, HEIGHT - 1, 'exit-well');
    for (let n = 0; n < waystones.length; n++) {
      const ws = waystones[n];
      const rx = n === 0 ? 34 : 12; // ws[0]'s wider margin also covers the cauldron site
      ledger.reserve(ws.x - rx, ws.y - 12, ws.x + rx, ws.y + 12, 'waystone');
      // ...and its bowl's footing is sealed ground every later tunnel walks around.
      reserveFooting(ledger, waystoneFooting(ws), 'waystone');
    }
    // The generated bowls (a prefab's waystone keeps its authored cells).
    const bowls = waystones.slice();
    const sink = makeInstantiationSink();
    const genDef = GEN[def.biome] || GEN.earthen;
    let placedPrefabs = placePrefabs(
      ctx,
      new Rng(hashSeed(seed >>> 0, 'prefabs')),
      graph,
      ledger,
      sink,
      genDef.prefabs,
      { spawn, wellX },
      fits,
    );
    if (placedPrefabs.length > 0) {
      graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
      fits.set(computeFits(ctx.world));
    }
    // Machine structure rooms: a SECOND placement pass on its own forked
    // stream — chain-reaction prefabs (valves, plugs, sensors, relays)
    // gated per biome by family tags. Same ledger, same sink, same anchors
    // pipeline; the 'prefabs' stream stays byte-identical per seed. Recompute
    // graph/fits first so machines connect to the world the prefab pass
    // actually produced, not stale pre-placement openings.
    const placedMachines = placePrefabs(
      ctx,
      new Rng(hashSeed(seed >>> 0, 'machines')),
      graph,
      ledger,
      sink,
      genDef.machines,
      { spawn, wellX },
      fits,
    );
    placedPrefabs = placedPrefabs.concat(placedMachines);
    // Prefab interiors are rooms: re-extract so secrets and the structure
    // brain place against the world as it now actually is.
    if (placedMachines.length > 0) {
      graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
      fits.set(computeFits(ctx.world));
    }
    stage('prefabs');

    const secretCount = stampSecrets(ctx, this.rng, graph, def.biome, ledger);
    if (shouldLogDevDiagnostics() && secretCount < 2) {
      console.warn(`Worldgen placed only ${secretCount} sealed secret chambers for ${def.id}`);
    }
    stage('secrets');

    // 6) Cauldron: a stone brewing basin on the first waystone's ground row —
    //    9 wide, 1-row stone base, 2-tall side walls, open 7x3 interior bowl.
    const ws0 = waystones[0];
    const cSide = this.rng.next() < 0.5 ? -1 : 1;
    // Set well clear of the waystone — the runestone + cauldron render large now,
    // so a tight 14-cell offset made the cauldron sit in front of the stele.
    // It stands on real ground: the side whose ground under the basin is nearer
    // the waystone's row wins (the rolled side on a tie), and the basin settles
    // onto the ground under its own centre. It used to be stamped on the
    // waystone's row whatever lay under it — over a 15-row pit on d2 seed 1337.
    const siteX = (side: number): number => Math.floor(clamp(ws0.x + side * 28, 8, WIDTH - 9));
    const undercut = (x: number): number => {
      let worst = 0;
      for (let dx = -4; dx <= 4; dx++) {
        let gap = 0;
        while (gap < 60 && !isFloorT(world.types[x + dx + (ws0.y + 2 + gap) * WIDTH])) gap++;
        worst = Math.max(worst, gap);
      }
      return worst;
    };
    const cauldronX = undercut(siteX(-cSide)) < undercut(siteX(cSide)) ? siteX(-cSide) : siteX(cSide);
    let cauldronBaseY = ws0.y + 1;
    for (let d = 0; d < 40 && !isFloorT(world.types[cauldronX + (cauldronBaseY + 1) * WIDTH]); d++) cauldronBaseY++;
    // carve clearance above the basin footprint if rock is in the way
    for (let dy = 1; dy <= 6; dy++) {
      for (let dx = -4; dx <= 4; dx++) setCell(cauldronX + dx, cauldronBaseY - dy, Cell.Empty, EMPTY_COLOR);
    }
    for (let dx = -4; dx <= 4; dx++) setCell(cauldronX + dx, cauldronBaseY, Cell.Stone, stoneColor());
    for (let t = 1; t <= 2; t++) {
      setCell(cauldronX - 4, cauldronBaseY - t, Cell.Stone, stoneColor());
      setCell(cauldronX + 4, cauldronBaseY - t, Cell.Stone, stoneColor());
    }
    const cauldron = { x: cauldronX, y: cauldronBaseY - 1 };
    reserveFooting(ledger, cauldronFooting(cauldron), 'cauldron');

    stage('cauldron');

    // 8) Landmark structures (upgrade-port meta layer): the exit portal above
    //    the seal plug, the golden key vault, hearts, tomes, chests, gold.
    const {
      pickups,
      portal,
      mechanisms,
      runeVaults,
      boss,
      emitters: structEmitters,
      authoredLights: structLights,
      refuge,
      spellLab,
      sumpRepair,
      kilnRepair,
      wardenRepair,
      kilnFlue,
      arenaMouths,
      kilnLock,
      portHoles,
      portalMouths,
    } = placeStructures(
      ctx,
      this.rng,
      graph,
      def,
      { x: wellX, sealY },
      waystones,
      spawn,
      cauldron,
      ledger,
      fits,
    );
    stage('structures');
    // The generator's own triggers and glyphs (the prefab ones below keep their authored cells).
    const ownTriggers = mechanisms.filter((m) => m.kind === 'lever' || m.kind === 'brazier');
    const ownRunes = runeVaults.slice();

    // 8b) Merge the prefab sink into the structure outputs. Mechanism ids are
    //     list-scoped (allocId), so the two independently-built lists collide
    //     on ids — shift the prefab ones past the structures' max. Both lists
    //     are internally consistent, so shifting id+targetId together is safe.
    let maxMechId = 0;
    for (const m of mechanisms) maxMechId = Math.max(maxMechId, m.id);
    for (const m of sink.mechanisms) {
      m.id += maxMechId;
      if (m.targetId >= 0) m.targetId += maxMechId;
    }
    mechanisms.push(...sink.mechanisms);
    pickups.push(...sink.pickups);
    runeVaults.push(...sink.runeVaults);
    waystones.push(...sink.waystones);
    // Every body as stamped, and every hand-trigger's footing sealed for the
    // passes still to carve (world/fixtureFooting): repeated below for the
    // set pieces that add their own.
    const bodies: BodyRecord = new Map();
    const footed = new Set<Mechanism>();
    recordBodies(world, mechanisms, bodies);
    reserveTriggerFootings(ledger, mechanisms, footed);
    stage('merge');

    // 8b.5) Late campaign dressing enriches terrain mass after all authored
    // placements have reserved their footprints. It uses a forked stream so
    // visual material richness does not perturb structure placement outcomes.
    const campaignDressing = applyCampaignDressing(
      ctx,
      new Rng(hashSeed(seed >>> 0, 'campaign-dressing')),
      def.biome,
      ledger,
      { pickups, mechanisms, runeVaults, portal, waystones, cauldron, fits },
    );
    if (campaignDressing.cellsChanged > 0) {
      graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
      fits.set(computeFits(ctx.world));
    }
    stage('campaign-dressing');

    // 8b.6) Mineral-vug fill: pack the buried swiss-cheese air pockets with cave
    // material (mostly solid stone/coal, ~19% hidden RawOre caches, a rare geode).
    // Forked stream, only ENCLOSED small pockets, respects the ledger — so it
    // can't shift structure placement or disconnect the reachable graph.
    fillMineralVugs(ctx, new Rng(hashSeed(seed >>> 0, 'mineral-vugs')), ledger, { pickups });
    stage('mineral-vugs');

    // 8b.7) Optional encounter lairs: small authored ecology pockets for the
    // organic enemy trio. They run after broad dressing/vug fill so their
    // signatures survive, but before rescue so downstream terrain audits see
    // the final cells. The encounter-lair probe owns lair reachability checks.
    const encounterLairs = placeEncounterLairs(
      ctx,
      new Rng(hashSeed(seed >>> 0, 'encounter-lairs')),
      graph,
      ledger,
      sink,
      def,
      { spawn, wellX },
      fits,
    );
    if (encounterLairs.placed.length > 0) {
      placedPrefabs = placedPrefabs.concat(encounterLairs.placed);
      graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
      fits.set(computeFits(ctx.world));
    }
    stage('encounter-lairs');

    // 8b.8) LIGHT WAVE: two light puzzles (a photocell strongroom, a lumen-bloom
    // crossing) carved off the caves on floors 2-4, each a room of designed
    // black, plus darkness over a big cave or two on the main route. Forked
    // stream; the shared ledger keeps them clear of everything placed above.
    const lightOut: LightPuzzleOutput = { mechanisms, pickups, darkZones: [], lumenBlooms: [], placed: [] };
    const lightAvoid = [
      ...waystones.map((w) => ({ x: w.x, y: w.y, r: 70 })),
      ...(portal ? [{ x: portal.x, y: portal.y, r: 90 }] : []),
      ...(boss ? [{ x: boss.x, y: boss.y, r: 170 }] : []),
      ...(refuge ? [{ x: refuge.x, y: refuge.y, r: 60 }] : []),
      { x: cauldron.x, y: cauldron.y, r: 50 },
    ];
    placeLightPuzzles(ctx, new Rng(hashSeed(seed >>> 0, 'light-puzzles')), graph, ledger, def,
      { spawn, wellX, avoid: lightAvoid }, fits, lightOut);
    if (lightOut.placed.length > 0) {
      placedPrefabs = placedPrefabs.concat(lightOut.placed);
      graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
      fits.set(computeFits(ctx.world));
    }
    stage('light-puzzles');
    // 8b.8a) THE SECOND DOORS' PUZZLE ROOMS (wave 3): the Cold Store's Frozen
    // Fall and Ice Vault. Their own forked stream and the shared ledger, before
    // the flora takes its ground; their tanks re-assert after the rescues.
    const setPieceRepairs: Array<() => void> = [];
    // THE CRUCIBLE (GEN 64): the Kiln hall's gatehouse was built with the hall (world/structures); it is a placed room and re-asserts after the rescues.
    if (kilnLock) {
      placedPrefabs = placedPrefabs.concat([kilnLock.placed]);
      setPieceRepairs.push(kilnLock.repair);
    }
    if (def.biome === 'frozen') {
      const cold: ColdStorePuzzleOutput = { pickups: [], placed: [], repairs: [] };
      placeColdStorePuzzles(ctx, new Rng(hashSeed(seed >>> 0, 'cold-store-puzzles')), graph, ledger,
        { spawn, wellX, avoid: lightAvoid }, fits, cold);
      pickups.push(...cold.pickups);
      setPieceRepairs.push(...cold.repairs);
      if (cold.placed.length > 0) {
        placedPrefabs = placedPrefabs.concat(cold.placed);
        graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
        fits.set(computeFits(ctx.world));
      }
      stage('cold-store-puzzles');
    }
    // ...and the Glass Galleries' Periscope and Prism Gate (the same frame).
    if (def.biome === 'crystal') {
      const glass: GalleryPuzzleOutput = { mechanisms, pickups: [], placed: [], repairs: [] };
      placeGalleryPuzzles(ctx, new Rng(hashSeed(seed >>> 0, 'glass-galleries-puzzles')), graph, ledger,
        { spawn, wellX, avoid: lightAvoid }, fits, glass);
      pickups.push(...glass.pickups);
      setPieceRepairs.push(...glass.repairs);
      if (glass.placed.length > 0) {
        placedPrefabs = placedPrefabs.concat(glass.placed);
        graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
        fits.set(computeFits(ctx.world));
      }
      stage('glass-galleries-puzzles');
    }
    // 8b.8b) THE LOCK (GEN 64, world/locks): the floor's signature puzzle and its key vault, a chamber on
    // the route sealed by a plug the puzzle's machine breaks. Its own forked stream, the shared ledger,
    // and nothing is drawn on a floor without one (so every other floor generates exactly as before).
    if (genDef.lock && genDef.lock !== 'crucible') {
      const lockOut: LockOutput = { mechanisms, pickups, placed: [], repairs: [], emitters: structEmitters, lights: structLights };
      placeLock(ctx, new Rng(hashSeed(seed >>> 0, 'locks')), genDef.lock, graph, ledger,
        { spawn, wellX, exit: portal ? { x: portal.x, y: portal.y } : null, avoid: lightAvoid }, fits, lockOut);
      setPieceRepairs.push(...lockOut.repairs);
      if (lockOut.placed.length > 0) {
        placedPrefabs = placedPrefabs.concat(lockOut.placed);
        graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
        fits.set(computeFits(ctx.world));
      }
      stage('lock');
    }
    recordBodies(world, mechanisms, bodies);
    reserveTriggerFootings(ledger, mechanisms, footed);
    // 8b.8) FLORA (wave 2): the floor's puzzle rooms (fell a tree across a
    // chasm or lava moat, water a thirsty seed into a root ladder, burn a
    // bramble thicket) carved into rock and joined to the main path, then the
    // floor's own plants on real ground. Its own forked stream: every earlier
    // placement stays byte-identical per seed. Floor 1 is hand-planted.
    // Its rooms' connectors walk around the sealed features placed so far (the
    // lairs, the sump, the light rooms): a flora connector took the whole d3
    // seed-3 Rillback pool when they walked straight through.
    const flora = applyFloraPass(ctx.world, new Rng(hashSeed(seed >>> 0, 'flora')), def.biome, ledger,
      { spawn, wellX, pickups, graph, fits, avoid: sealedFootprints(ledger) });
    if (flora.puzzles.length > 0) {
      pickups.push(...flora.pickups);
      sink.enemies.push(...flora.enemies);
      placedPrefabs = placedPrefabs.concat(flora.puzzles.map((p) => ({ id: `flora-${p.kind}`, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, focus: p.focus })));
      graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
      fits.set(computeFits(ctx.world));
    }
    stage('flora');
    // 8b.9) THE SECOND DOORS' DRESSING (wave 3): the Cold Store's icicles,
    // frozen falls, snow, frosted pipes and brine gutters — written only into
    // open cells a body never needs, after the plants have taken their ground.
    // Its own forked stream; no other floor draws from it.
    if (def.biome === 'frozen') {
      const dressed = dressColdStore(ctx.world, new Rng(hashSeed(seed >>> 0, 'cold-store-dressing')), ledger,
        { spawn, wellX, avoid: lightAvoid });
      if (shouldLogDevDiagnostics() && dressed.icicles < 60) console.warn(`[cold-store] only ${dressed.icicles} icicles on ${def.id}`);
      stage('cold-store-dressing');
    }
    if (def.biome === 'crystal') {
      const dressed = dressGlassGalleries(ctx.world, new Rng(hashSeed(seed >>> 0, 'glass-galleries-dressing')), ledger,
        { spawn, wellX, avoid: lightAvoid });
      if (shouldLogDevDiagnostics() && dressed.panels < 8) console.warn(`[glass-galleries] only ${dressed.panels} mirror panels on ${def.id}`);
      stage('glass-galleries-dressing');
    }

    // 8b.9) STORY (wave 3, GEN 55): the Docent's speaking-pipes near the
    // arrival and the waystones, Pell's lit camp nook and the resonant valve's
    // nook, each carved off the main path and joined to it. Its own forked
    // stream, after every other placement pass, respecting the ledger. On the
    // Kiln, Pell has gone ahead: his camp is cold.
    const storyPlaced = placeStorySites(world, new Rng(hashSeed(seed >>> 0, 'story')), graph, ledger, {
      spawn,
      waystones,
      avoid: [
        { x: cauldron.x, y: cauldron.y, r: 60 },
        ...(portal ? [{ x: portal.x, y: portal.y, r: 90 }] : []),
        ...(boss ? [{ x: boss.x, y: boss.y - 30, r: 190 }] : []),
        ...(kilnFlue ? [{ x: (kilnFlue.shaft.x0 + kilnFlue.shaft.x1) / 2, y: (kilnFlue.shaft.y0 + kilnFlue.shaft.y1) / 2, r: 170 }] : []),
      ],
    }, def.biome !== 'volcanic');
    if (storyPlaced.sites.camp || storyPlaced.sites.valve) {
      graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
      fits.set(computeFits(ctx.world));
    }
    stage('story');

    // (A GLOBAL powder settle was tried here and reverted: suspended powder
    // PLUGS are a deliberate authored primitive — the spell lab's dig-station
    // sand plug, the well plug bypass — and a world-wide settle destroys
    // them. Lair stamps settle their own rect instead; see encounterLairs.)

    // 8c) GAUGE RESCUE: run the same connectivity audits the validator runs.
    //     Hands-on locks and door fronts use wizard connectivity (9x17 fits,
    //     spawn-connected). Machine-fed/ranged locks use cell connectivity.
    //     Anything still cut off gets a guaranteed chamber plus a tunnel into
    //     the spawn-connected component, verified by recomputing the masks.
    //     This closes the long tail of organic-junction rolls no static
    //     geometry can promise away.
    // Rescue tunnels route around the sealed features too (fail-open: a sealed
    // room is dear, never a wall), and each repairs after them below.
    const sealed = sealedFootprints(ledger);
    this.gaugeRescue(ctx, def, spawn, mechanisms, spellLab, runeVaults, pickups, waystones, cauldron, sealed, boss, arenaMouths, portal, portalMouths);
    stage('gauge-rescue');

    // 8d) The Sump self-repairs AFTER the rescue pass: rescue tunnels eat all
    //     stone and spare only metal, and a wandering carve through the d4
    //     arena pre-opened every drain plug (observed on seed 1). The metal
    //     casing survives on its own; this puts back the parts that can't
    //     be armored (plugs, gold tells, the pool itself).
    sumpRepair?.();
    kilnRepair?.();
    // ...and so does a lair's pool, should a rescue have had to cut it.
    encounterLairs.repair();
    wardenRepair?.();
    stage('sump-repair');

    if (shouldLogDevDiagnostics()) {
      const total = performance.now() - tStart;
      if (total > 400) {
        console.warn(
          `[gen] ${def.id} generateLevel ${total.toFixed(0)}ms — ` +
            stages.map(([label, ms]) => `${label} ${ms.toFixed(0)}ms`).join(', '),
        );
      }
    }

    // Final terrain dressing can invalidate a route that was clean during the
    // main rescue pass (D1's surface cap is the usual culprit). Validate the
    // finished cell field before handing it to Levels/runtime repair.
    this.gaugeRescue(ctx, def, spawn, mechanisms, spellLab, runeVaults, pickups, waystones, cauldron, sealed, boss, arenaMouths, portal, portalMouths);
    // ...and the final rescue may carve again: the Kiln's seal is the player's
    // to dig, so re-assert its tank once more (idempotent; no-op off the Kiln).
    kilnRepair?.();
    // Likewise the Sump's casing, plugs and pool (a final rescue tunnel through
    // the basin took a column of its water on d3 seed 11) — but not its rock
    // rim: a tunnel the final rescue needed through it stays open.
    sumpRepair?.(false);
    // An encounter lair's pool likewise (idempotent: an intact pool is untouched).
    // Were its basin the only way a final rescue found, the runtime repair —
    // which routes around every placed room — reopens a way on arrival.
    encounterLairs.repair();
    wardenRepair?.(false);
    // FLORA puzzles re-assert what the rescue tunnels took (a tree, a cistern)
    // — writing only into open cells, so no route the rescue opened is closed.
    flora.repair();
    // The second doors' tanks and cisterns (casing, seal, liquid) likewise.
    for (const repair of setPieceRepairs) repair();
    stage('final-gauge-rescue');

    // 8d++) WAYSTONES ON THE ROUTE (GEN 62): the route exists only now, so the two generated bowls move to
    //      35% and 70% of the walk to the exit and one more is lit beside the key (world/routeWaystones).
    if (genDef.routeWaystones) {
      const placedWs = placeRouteWaystones({
        // (the walk ends where the floor does: its portal, or on the last floor the colossus's hall)
        world, ledger, spawn, exit: portal ?? boss ?? { x: wellX, y: sealY - 12 }, bowls, waystones,
        key: pickups.find((p) => p.kind === 'key') ?? null,
      });
      if (shouldLogDevDiagnostics() && (placedWs.moved > 0 || placedWs.brazier)) console.warn(`[gen] ${def.id}: route waystones - ${placedWs.moved} moved, ${placedWs.kept} kept${placedWs.brazier ? ', key brazier' : ''}`);
      stage('route-waystones');
    }

    // 8d+) FIXTURE STOCK (GEN 62): a seed pocket of oil or gunpowder, a stray dune or a puddle in
    //     the room of anything the player stands at is cleared (the audit: levers 45% in oil, a
    //     waystone in five liquid cells, an echo stage 31% sand, a portal ring half gunpowder).
    //     Only opens cells; a mass inside a room another pass owns (a prefab, a lair, a puzzle
    //     hall: any reserved rect but the waystone/spawn/well/footing ones) is its stock, left alone.
    if (genDef.clearFixtureStock) {
      const rooms = ledger.rects().filter((r) => !/^(waystone|spawn|exit-well|footing-)/.test(r.label));
      const held = (x: number, y: number): boolean => rooms.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
      const sites: StockSite[] = [];
      for (const ws of waystones) sites.push({ x0: ws.x - 14, y0: ws.y - 36, x1: ws.x + 14, y1: ws.y + 6 });
      sites.push({ x0: cauldron.x - 16, y0: cauldron.y - 16, x1: cauldron.x + 16, y1: cauldron.y + 6 });
      for (const m of mechanisms) {
        if (m.kind === 'lever' || m.kind === 'brazier' || m.kind === 'plate' || m.kind === 'scale') {
          sites.push({ x0: m.x - 16, y0: m.y - 28, x1: m.x + m.w + 16, y1: m.y + 8 });
        }
      }
      for (const v of runeVaults) sites.push({ x0: v.rx - 14, y0: v.ry - 20, x1: v.rx + 14, y1: v.ry + 8 });
      for (const p of pickups) if (p.kind === 'key') sites.push({ x0: p.x - 18, y0: p.y - 30, x1: p.x + 18, y1: p.y + 8 });
      if (portal) sites.push({ x0: portal.x - 34, y0: portal.y - 44, x1: portal.x + 34, y1: portal.y + 22 });
      const camp = storyPlaced.sites.camp, valve = storyPlaced.sites.valve;
      if (camp) sites.push({ x0: camp.x0 - 4, y0: camp.floorY - 34, x1: camp.x1 + 4, y1: camp.floorY + 2 });
      if (valve) sites.push({ x0: valve.stageX - valve.stageHalfW - 4, y0: valve.floorY - 24, x1: valve.stageX + valve.stageHalfW + 4, y1: valve.floorY + 2 });
      const cleared = clearLooseStock(world, sites, held);
      if (shouldLogDevDiagnostics() && cleared > 0) console.warn(`[gen] ${def.id}: ${cleared} cells of loose stock cleared from fixture rooms`);
      stage('fixture-stock');
      // The exit shrine's floor and ring (the carve took the plug's top; a pocket of powder sat in the ring).
      if (portal) {
        const shrine = holdPortalShrine(world, portal, { x: wellX, sealY, halfW });
        if (shouldLogDevDiagnostics() && shrine > 0) console.warn(`[gen] ${def.id}: exit shrine pad and ring restored (${shrine} cells)`);
      }
    }

    // 8e) THE FOOTING CONTRACT, after the last carve: every bowl, basin, body
    //     and glyph re-stamped, ground put back under anything a carve
    //     undercut, the key in open air on its floor under nothing that will
    //     fall. Fail-open: a fill that costs standing room elsewhere is undone.
    const footing = holdFixtureFootings(world, {
      bowls, cauldron, mechanisms, ownTriggers, runeVaults: ownRunes, pickups,
      story: { ...storyPlaced.sites, flue: kilnFlue }, bodies, spawn, keepOpen: portHoles,
    });
    if (shouldLogDevDiagnostics() && (footing.undercut.length > 0 || footing.reverted.length > 0)) {
      console.warn(`[gen] ${def.id}: footing undercut ${footing.undercut.join(' ') || '-'}; taken back ${footing.reverted.join(' ') || '-'}`);
    }
    stage('footing');

    // 8f) LAVA LAKES (GEN 62): a floor with a budget (the Kiln Heart) gets its
    //     basin-filled lakes LAST, on a forked stream, keeping clear of every
    //     placement and of the walk to each (world/lavaLakes).
    if (genDef.lavaLakes) {
      const lakeTargets: LakeTarget[] = [
        ...waystones.map((w) => ({ x: w.x, y: w.y, protect: 28 })),
        { x: cauldron.x, y: cauldron.y, protect: 28 },
        ...pickups.map((p) => ({ x: p.x, y: p.y, protect: 14 })),
        ...mechanisms.map((m) => ({ x: m.x + m.w / 2, y: m.y + m.h / 2, protect: 16 + Math.max(m.w, m.h) / 2 })),
        ...runeVaults.map((v) => ({ x: v.rx, y: v.ry, protect: 16 })),
        ...(portal ? [{ x: portal.x, y: portal.y, protect: 40 }] : []),
        ...(boss ? [{ x: boss.x, y: boss.y, protect: 70 }] : []),
        ...(storyPlaced.sites.camp ? [{ x: storyPlaced.sites.camp.x, y: storyPlaced.sites.camp.floorY - 8, protect: 30 }] : []),
        ...(storyPlaced.sites.valve ? [{ x: storyPlaced.sites.valve.stageX, y: storyPlaced.sites.valve.floorY - 8, protect: 34 }] : []),
        ...storyPlaced.sites.pipes.map((p) => ({ x: p.x, y: p.floorY - 8, protect: 22 })),
      ];
      const lakes = this.lastLavaLakes = placeLavaLakes(world, new Rng(hashSeed(seed >>> 0, 'lava-lakes')), ledger, spawn, lakeTargets, genDef.lavaLakes);
      pickups.push(...lakes.pickups);
      // Repair routes walk around a lake as they do round any placed room ('encounter-lair-' keeps the
      // terrain art off it: these are natural halls, not built ones).
      placedPrefabs = placedPrefabs.concat(lakes.lakes.map((l) => ({ id: `encounter-lair-lava-${l.kind}`, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1 })));
      if (shouldLogDevDiagnostics()) {
        console.warn(`[gen] ${def.id}: ${lakes.lakes.length} lava lake(s), ${lakes.cells} cells${lakes.dropped > 0 ? `, ${lakes.dropped} taken back for a route` : ''}`);
      }
      stage('lava-lakes');
    }

    setOrganicTunnels(false);

    // 9) Spawn reuses the carved spawn chamber center; manager fine-tunes footing.
    matureVegetation(ctx.world);
    return {
      exit: { x: wellX, sealY, halfW },
      waystones,
      spawn: { x: spawn.x, y: spawn.y },
      cauldron,
      pickups,
      portal,
      mechanisms,
      runeVaults,
      boss,
      prefabEnemies: sink.enemies,
      placedPrefabs,
      authoredLights: [...sink.authoredLights, ...structLights, ...storyPlaced.lights],
      emitters: [...sink.emitters, ...structEmitters],
      decors: [...sink.decors],
      refuge,
      spellLab,
      // D1 (the only level with a surface) is generateBreathingWorks, above.
      surfaceSpawn: null,
      surfaceSkyLine: null,
      darkZones: lightOut.darkZones,
      lumenBlooms: lightOut.lumenBlooms,
      story: { ...storyPlaced.sites, flue: kilnFlue },
    };
  }
}
