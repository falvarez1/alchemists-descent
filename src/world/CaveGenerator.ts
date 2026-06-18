import { BIOMES } from '@/config/biomes';
import { HEIGHT, WIDTH } from '@/config/constants';
import { GEN, GEN_TUNE, scaleSkeletonSpec } from '@/config/gen';
import { clamp, hash2, valueNoise } from '@/core/math';
import { Rng, hashSeed, randomSeed } from '@/core/rng';
import { makeInstantiationSink } from '@/game/instantiate';
import type {
  AuthoredLight,
  Ctx,
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
import { Cell } from '@/sim/CellType';
import {
  COLOR_FN,
  EMPTY_COLOR,
  fireColor,
  goldColor,
  gunpowderColor,
  iceColor,
  oilColor,
  packRGB,
  sandColor,
  stoneColor,
  unpackB,
  unpackG,
  unpackR,
  waterColor,
  woodColor,
} from '@/sim/colors';
import { applyBiomeExtras, applyCampaignDressing, fillMineralVugs, goldPocketBudgetForBiome } from '@/world/biomeExtras';
import { PlacementLedger, carveRect, tunnelTo } from '@/world/connect';
import { spawnFortress as stampFortress } from '@/world/fortress';
import { SKELETONS } from '@/world/skeleton';
import type { SkeletonIO } from '@/world/skeleton';
import { polishCaveTerrain } from '@/world/terrainPolish';
import { dressWalkSurface } from '@/world/surfaceDress';
import { extractRegionGraph } from '@/world/regions';
import { placePrefabs } from '@/world/prefabs/place';
import { stampSecrets } from '@/world/secrets';
import { computeFits, reachableMask, wizardMask } from '@/world/validate';
import { placeStructures } from '@/world/structures';

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

export class WorldGen implements WorldGenApi {
  /** Center of the carved spawn chamber (original caveSpawnHint). */
  spawnHint: { x: number; y: number } | null = null;

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
    stampFortress(ctx);
  }

  generateCaves(ctx: Ctx): void {
    this.rng = new Rng(ctx.state.worldSeed >>> 0);
    const world = ctx.world;
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
        world.life[i] = 0;
        world.charge[i] = 0;
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
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          if (
            dx * dx + dy * dy <= 24 &&
            world.inBounds(x + dx, y + dy) &&
            world.types[x + dx + (y + dy) * WIDTH] === Cell.Wall &&
            this.rng.next() < 0.85
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
      polishCaveTerrain(world, {
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
      dressWalkSurface(world, { seed, minY: MIN_Y, floorBand: FLOOR_BAND, crown: B.crown, flowerChance: B.flowerChance });
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
  ): void {
      let wiz = wizardMask({ world: ctx.world, spawn });
      let cell = reachableMask({ world: ctx.world, spawn });
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
      const nearestWiz = (x: number, y: number): { x: number; y: number } | null => {
        let fallback: { x: number; y: number } | null = null;
        for (let r = 24; r <= 1200; r += 3) {
          for (let a = 0; a < 24; a++) {
            const ang = (a / 24) * Math.PI * 2;
            const X = Math.floor(x + Math.cos(ang) * r),
              Y = Math.floor(y + Math.sin(ang) * r);
            if (X > 1 && Y > 1 && X < WIDTH - 1 && Y < HEIGHT - 1 && wiz[X + Y * WIDTH]) {
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
      const rescueAt = (px: number, py: number, pass: () => boolean): boolean => {
        carveRect(ctx.world, px - SWEEP.halfW, py - 24, px + SWEEP.halfW, py + 4);
        // Let the rescue tunnel reach a chamber/target ABOVE the default row-26
        // floor (the rescue chamber's top is py-24); for deep features (every
        // case in the shipped seeds) this stays 26, so carve output is unchanged.
        const rescueMinY = Math.min(26, py - 24);
        const target = nearestWiz(px, py - 10) ?? {
          x: Math.floor(spawn.x),
          y: Math.floor(spawn.y) - 4,
        };
        tunnelTo(ctx.world, this.rng, px, py - 10, target.x, target.y, 12, SWEEP, rescueMinY);
        wiz = wizardMask({ world: ctx.world, spawn });
        cell = reachableMask({ world: ctx.world, spawn });
        if (pass()) return true;
        tunnelTo(ctx.world, this.rng, px, py - 10, Math.floor(spawn.x), Math.floor(spawn.y) - 4, 12, SWEEP, rescueMinY);
        wiz = wizardMask({ world: ctx.world, spawn });
        cell = reachableMask({ world: ctx.world, spawn });
        return pass();
      };
      const rescued: string[] = [];
      const failedRescues: string[] = [];
      const recordRescue = (label: string, attempt: () => boolean): void => {
        rescued.push(label);
        if (!attempt()) failedRescues.push(label);
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
          if (pass() && wizNearCount(m.x, m.y - 2, 6) >= 40) continue;
          recordRescue(`${m.kind}@${m.x},${m.y}`, () => rescueAt(m.x, m.y, pass));
        } else if (CELL_REACH.has(m.kind)) {
          const pass = (): boolean => cellNear(m.x, m.y - 2, 5);
          if (pass()) continue;
          if (labMechanism) {
            recordRescue(`spell-lab@${Math.floor(spellLab?.x ?? m.x)},${Math.floor(spellLab?.y ?? m.y)}`, () =>
              rescueSpellLab(pass),
            );
            continue;
          }
          recordRescue(`${m.kind}@${m.x},${m.y}`, () => rescueAt(m.x, m.y, pass));
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
      // it gets the same guarantee as the hands-on locks.
      for (const p of pickups) {
        if (p.kind !== 'key') continue;
        const kx = Math.floor(p.x),
          ky = Math.floor(p.y);
        const pass = (): boolean => wizNear(kx, ky, 10);
        if (pass() && wizNearCount(kx, ky, 10) >= 64) continue;
        recordRescue(`key@${kx},${ky}`, () => rescueAt(kx, ky, pass));
      }
      for (const ws of waystones) {
        const wx = Math.floor(ws.x),
          wy = Math.floor(ws.y);
        const pass = (): boolean => wizNear(wx, wy, 10);
        if (pass() && wizNearCount(wx, wy, 10) >= 64) continue;
        recordRescue(`waystone@${wx},${wy}`, () => rescueAt(wx, wy, pass));
      }
      if (cauldron) {
        const cx = Math.floor(cauldron.x),
          cy = Math.floor(cauldron.y);
        const pass = (): boolean => wizNear(cx, cy, 10);
        if (!pass() || wizNearCount(cx, cy, 10) < 64) {
          recordRescue(`cauldron@${cx},${cy}`, () => rescueAt(cx, cy, pass));
        }
      }
      if (import.meta.env.DEV && rescued.length > 0) {
        const suffix = failedRescues.length > 0 ? `; still cut off: ${failedRescues.join(' ')}` : '';
        console.warn(`[gen] ${def.id}: gauge-rescued ${rescued.length} cut-off feature(s): ${rescued.join(' ')}${suffix}`);
      }
  }

  /**
   * Descent-mode generation (Wave B/C): base biome caves, then the level dressing —
   * an indestructible bedrock floor, a stone-sealed exit well through it, two unlit
   * waystone braziers along the lower artery, sim-obeying secrets stamped off the
   * region graph, a cauldron basin beside the first waystone, and (depth 1 only)
   * the two onboarding moments near spawn. Layout randomness flows through this.rng
   * (re-seeded by generateCaves from worldSeed), so a level replays identically
   * from its seed. No enemies here — the levels manager places those.
   */
  generateLevel(
    ctx: Ctx,
    def: LevelDef,
    seed: number,
    opts?: { hostArch?: boolean },
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
    vaultArch: VaultArch | null;
    vaultHoard: { x: number; y: number } | null;
  } {
    // DEV stage timing — generation runs synchronously behind the curtain,
    // so a slow stage is a felt hitch; shout when the total crosses 400ms.
    const tStart = performance.now();
    let tPrev = tStart;
    const stages: Array<[string, number]> = [];
    const stage = (label: string): void => {
      if (!import.meta.env.DEV) return;
      const now = performance.now();
      stages.push([label, now - tPrev]);
      tPrev = now;
    };

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

    // 2) Bedrock: the bottom 6 rows become metal (explosion/acid/dig-proof),
    //    so the floor is indestructible everywhere except the well.
    for (let y = HEIGHT - 6; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) setCell(x, y, Cell.Metal, bedrockColor());
    }

    // 3) Exit well: a cased shaft through the bedrock, locked by a stone plug.
    const halfW = 14;
    const sealY = HEIGHT - 46;
    let wellX = spawn.x >= WIDTH / 2 ? Math.floor(WIDTH * 0.2) : Math.floor(WIDTH * 0.8);
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = Math.floor(this.rng.range(WIDTH * 0.12, WIDTH * 0.88));
      if (Math.abs(x - spawn.x) < 300) continue;
      wellX = x;
      break;
    }

    // Open shaft from the floor band straight through the bedrock (open bottom).
    for (let y = HEIGHT - 52; y < HEIGHT; y++) {
      for (let dx = -halfW; dx <= halfW; dx++) setCell(wellX + dx, y, Cell.Empty, EMPTY_COLOR);
    }
    // Indestructible casing flanking the shaft below the seal: the floor band is an
    // open strip, so without these walls the plug could simply be walked around.
    for (let y = sealY; y < HEIGHT; y++) {
      for (let t = 1; t <= 3; t++) {
        setCell(wellX - halfW - t, y, Cell.Metal, bedrockColor());
        setCell(wellX + halfW + t, y, Cell.Metal, bedrockColor());
      }
    }
    // The plug: 14 rows of diggable/blastable stone — that IS the lock.
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
    for (const anchor of [WIDTH * 0.33, WIDTH * 0.66]) {
      let placed = false;
      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const cx = Math.floor(anchor + (this.rng.next() - 0.5) * 80);
        if (cx < 12 || cx >= WIDTH - 12) continue;
        if (Math.abs(cx - wellX) < halfW + 26) continue;
        // Scan down from the lower artery's band for the first standable floor.
        let baseY = -1;
        for (let y = Math.floor(HEIGHT * 0.56); y < HEIGHT - 6; y++) {
          if (isOpenT(world.types[cx + y * WIDTH]) && isFloorT(world.types[cx + (y + 1) * WIDTH])) {
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
    applyBiomeExtras(ctx, this.rng, def.biome);
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
    }
    if (def.depth === 1) {
      // the two onboarding lessons sweep spawn±(120..124)x / ±84y for sites
      ledger.reserve(spawn.x - 140, spawn.y - 100, spawn.x + 140, spawn.y + 100, 'onboarding');
    }
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
    if (import.meta.env.DEV && secretCount < 2) {
      console.warn(`Worldgen placed only ${secretCount} sealed secret chambers for ${def.id}`);
    }
    stage('secrets');

    // 6) Cauldron: a stone brewing basin on the first waystone's ground row —
    //    9 wide, 1-row stone base, 2-tall side walls, open 7x3 interior bowl.
    const ws0 = waystones[0];
    const cSide = this.rng.next() < 0.5 ? -1 : 1;
    // Set well clear of the waystone — the runestone + cauldron render large now,
    // so a tight 14-cell offset made the cauldron sit in front of the stele.
    const cauldronX = Math.floor(clamp(ws0.x + cSide * 28, 8, WIDTH - 9));
    const cauldronBaseY = ws0.y + 1;
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

    // 7) D1 onboarding (depth 1 only): two staged lessons in sim literacy near
    //    spawn — fire eats wood, sand obeys gravity. Both are plain cells.
    if (def.depth === 1) {
      const isWallAt = (x: number, y: number): boolean =>
        x > 1 && x < WIDTH - 2 && y > 2 && y < HEIGHT - 7 && world.types[x + y * WIDTH] === Cell.Wall;
      const isOpenAt = (x: number, y: number): boolean =>
        world.inBounds(x, y) && world.types[x + y * WIDTH] === Cell.Empty;

      // (i) The wooden seal: a 12x8 pocket carved into a wall face, its throat
      // sealed with 4-thick wood, 40 gold inside, and a campfire smouldering
      // 10-14 cells outside as the hint that fire opens it.
      const trySeal = (ex: number, ey: number, dir: number, needFire: boolean): boolean => {
        if (!isOpenAt(ex, ey) || !isOpenAt(ex - dir, ey)) return false;
        for (let d = 1; d <= 16; d++) {
          for (let dy = -4; dy <= 3; dy++) {
            if (!isWallAt(ex + dir * d, ey + dy)) return false;
          }
        }
        let fireX = -1,
          fireY = -1;
        for (let out = 10; out <= 14 && fireX < 0; out++) {
          const px = ex - dir * out;
          if (px < 6 || px >= WIDTH - 6) continue;
          for (let py = Math.max(3, ey - 6); py < Math.min(HEIGHT - 7, ey + 24); py++) {
            if (world.types[px + py * WIDTH] === Cell.Empty && world.types[px + (py + 1) * WIDTH] === Cell.Wall) {
              fireX = px;
              fireY = py;
              break;
            }
          }
        }
        if (fireX < 0 && needFire) return false;
        for (let d = 1; d <= 16; d++) {
          for (let dy = -4; dy <= 3; dy++) {
            if (d <= 4) setCell(ex + dir * d, ey + dy, Cell.Wood, woodColor());
            else setCell(ex + dir * d, ey + dy, Cell.Empty, EMPTY_COLOR);
          }
        }
        let goldLeft = 40;
        for (let dy = 3; dy >= -4 && goldLeft > 0; dy--) {
          for (let d = 5; d <= 16 && goldLeft > 0; d++) {
            setCell(ex + dir * d, ey + dy, Cell.Gold, goldColor());
            goldLeft--;
          }
        }
        if (fireX >= 0) {
          // same pattern as the generator's campfires, burning a touch longer
          for (let dx = -4; dx <= 4; dx++) {
            if (isOpenAt(fireX + dx, fireY)) setCell(fireX + dx, fireY, Cell.Wood, woodColor());
            if (Math.abs(dx) <= 3 && isOpenAt(fireX + dx, fireY - 1))
              setCell(fireX + dx, fireY - 1, Cell.Wood, woodColor());
            if (Math.abs(dx) <= 3 && isOpenAt(fireX + dx, fireY - 2)) {
              setCell(fireX + dx, fireY - 2, Cell.Fire, fireColor());
              world.life[fireX + dx + (fireY - 2) * WIDTH] = 260 + Math.floor(this.rng.next() * 80);
            }
          }
        }
        return true;
      };
      let sealDone = false;
      for (let attempt = 0; attempt < 240 && !sealDone; attempt++) {
        const ex = spawn.x + Math.floor((this.rng.next() - 0.5) * 240);
        const ey = spawn.y + Math.floor((this.rng.next() - 0.5) * 170);
        const dir = this.rng.next() < 0.5 ? -1 : 1;
        sealDone = trySeal(ex, ey, dir, true) || trySeal(ex, ey, -dir, true);
      }
      // guaranteed fallback: systematic sweep of the spawn surroundings
      for (let dy = -84; dy <= 84 && !sealDone; dy += 3) {
        for (let dx = -120; dx <= 120 && !sealDone; dx += 2) {
          sealDone =
            trySeal(spawn.x + dx, spawn.y + dy, dx >= 0 ? 1 : -1, false) ||
            trySeal(spawn.x + dx, spawn.y + dy, dx >= 0 ? -1 : 1, false);
        }
      }

      // (ii) The sand plug: an 8x14 pit in the spawn region's floor — six rows
      // of cap sand over a hollow drop with 30 gold waiting at the bottom.
      const tryPlug = (px: number, relaxed: boolean): boolean => {
        if (px < 6 || px >= WIDTH - 8) return false;
        const yLo = Math.max(4, spawn.y - 70);
        const yHi = Math.min(HEIGHT - 26, spawn.y + 90);
        // natural floors are never perfectly flat: each column's surface may
        // sit up to `lead` cells below the shared top row
        const lead = relaxed ? 3 : 1;
        for (let y = yLo; y < yHi; y++) {
          let ok = true;
          for (let dx = -3; dx <= 4 && ok; dx++) {
            const col = px + dx;
            if (world.types[col + y * WIDTH] !== Cell.Empty) {
              ok = false;
              break;
            }
            let d = 1;
            while (d <= lead && world.types[col + (y + d) * WIDTH] === Cell.Empty) d++;
            for (; d <= 14 && ok; d++) {
              const t = world.types[col + (y + d) * WIDTH];
              if (relaxed ? t === Cell.Empty || t === Cell.Metal : t !== Cell.Wall) ok = false;
            }
          }
          if (!ok) continue;
          let goldLeft = 30;
          for (let d = 14; d >= 1; d--) {
            for (let dx = -3; dx <= 4; dx++) {
              if (d <= 6) setCell(px + dx, y + d, Cell.Sand, sandColor());
              else if (goldLeft > 0) {
                setCell(px + dx, y + d, Cell.Gold, goldColor());
                goldLeft--;
              } else setCell(px + dx, y + d, Cell.Empty, EMPTY_COLOR);
            }
          }
          return true;
        }
        return false;
      };
      let plugDone = false;
      for (let attempt = 0; attempt < 160 && !plugDone; attempt++) {
        const off = (12 + this.rng.int(110)) * (this.rng.next() < 0.5 ? -1 : 1);
        plugDone = tryPlug(spawn.x + off, false);
      }
      for (let off = 12; off <= 124 && !plugDone; off++) {
        plugDone = tryPlug(spawn.x + off, false) || tryPlug(spawn.x - off, false);
      }
      for (let off = 12; off <= 124 && !plugDone; off++) {
        plugDone = tryPlug(spawn.x + off, true) || tryPlug(spawn.x - off, true);
      }
    }

    stage('cauldron+onboarding');

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
      vaultArch,
      vaultHoard,
      sumpRepair,
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
      { hostArch: opts?.hostArch === true },
    );
    stage('structures');

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
    fillMineralVugs(ctx, new Rng(hashSeed(seed >>> 0, 'mineral-vugs')), ledger);
    stage('mineral-vugs');

    // 8c) GAUGE RESCUE: run the same connectivity audits the validator runs.
    //     Hands-on locks and door fronts use wizard connectivity (9x17 fits,
    //     spawn-connected). Machine-fed/ranged locks use cell connectivity.
    //     Anything still cut off gets a guaranteed chamber plus a tunnel into
    //     the spawn-connected component, verified by recomputing the masks.
    //     This closes the long tail of organic-junction rolls no static
    //     geometry can promise away.
    this.gaugeRescue(ctx, def, spawn, mechanisms, spellLab, runeVaults, pickups, waystones, cauldron);
    stage('gauge-rescue');

    // 8d) The Sump self-repairs AFTER the rescue pass: rescue tunnels eat all
    //     stone and spare only metal, and a wandering carve through the d4
    //     arena pre-opened every drain plug (observed on seed 1). The metal
    //     casing survives on its own; this puts back the parts that can't
    //     be armored (plugs, gold tells, the pool itself).
    sumpRepair?.();
    stage('sump-repair');

    if (import.meta.env.DEV) {
      const total = performance.now() - tStart;
      if (total > 400) {
        console.warn(
          `[gen] ${def.id} generateLevel ${total.toFixed(0)}ms — ` +
            stages.map(([label, ms]) => `${label} ${ms.toFixed(0)}ms`).join(', '),
        );
      }
    }

    // 9) Spawn reuses the carved spawn chamber center; manager fine-tunes footing.
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
      authoredLights: [...sink.authoredLights, ...structLights],
      emitters: [...sink.emitters, ...structEmitters],
      decors: sink.decors,
      refuge,
      spellLab,
      vaultArch,
      vaultHoard,
    };
  }
}
