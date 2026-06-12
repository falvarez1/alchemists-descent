import { BIOMES } from '@/config/biomes';
import { HEIGHT, WIDTH } from '@/config/constants';
import { GEN } from '@/config/gen';
import { clamp, hash2, valueNoise } from '@/core/math';
import { Rng, randomSeed } from '@/core/rng';
import type {
  Ctx,
  ExitPortal,
  LevelDef,
  LevelExitWell,
  Mechanism,
  Pickup,
  RuneVault,
  Waystone,
  WorldGenApi,
} from '@/core/types';
import { Cell } from '@/sim/CellType';
import {
  EMPTY_COLOR,
  fireColor,
  goldColor,
  gunpowderColor,
  iceColor,
  lavaColor,
  nitrogenColor,
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
import { applyBiomeExtras } from '@/world/biomeExtras';
import { spawnFortress as stampFortress } from '@/world/fortress';
import { SKELETONS } from '@/world/skeleton';
import type { SkeletonIO } from '@/world/skeleton';
import { extractRegionGraph } from '@/world/regions';
import { stampSecrets } from '@/world/secrets';
import { placeStructures } from '@/world/structures';

/* ===================== Procedural Generation Map Engines ===================== */

export class WorldGen implements WorldGenApi {
  /** Center of the carved spawn chamber (original caveSpawnHint). */
  spawnHint: { x: number; y: number } | null = null;

  /** Seeded generation stream; re-seeded from state.worldSeed by generateCaves. */
  private rng = new Rng(0);

  regenerate(ctx: Ctx): void {
    // The regenerate button always rolls a fresh world; generateCaves itself
    // never re-rolls the seed, so a fixed worldSeed replays the same layout.
    ctx.state.worldSeed = randomSeed();
    this.generateCaves(ctx);
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
    const skel = SKELETONS[G.skeleton.kind](io, G.skeleton);
    this.spawnHint = skel.spawnHint;
    // skel.tunnelY (the baseline primary-artery profile) has no remaining
    // consumers in the shared stages — the spawn chamber is carved inside the
    // skeleton, and generateLevel anchors everything on spawnHint. Non-baseline
    // skeletons return null; any future tunnelY dependency must fall back to
    // spawnHint.y or an open-cell scan.

    // --- 4) Commit with layered material palette + depth shading ---
    const seed = Math.floor(this.rng.next() * 100000);

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
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
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
    while (goldPlaced < G.goldPockets && goldTries < G.goldTriesCap) {
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
                world.colors[px + py * WIDTH] = poolType === Cell.Lava ? lavaColor() : nitrogenColor();
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
  ): {
    exit: LevelExitWell;
    waystones: Waystone[];
    spawn: { x: number; y: number };
    cauldron: { x: number; y: number } | null;
    pickups: Pickup[];
    portal: ExitPortal | null;
    mechanisms: Mechanism[];
    runeVaults: RuneVault[];
    boss: { x: number; y: number } | null;
  } {
    // 1) Base caves for the level's biome, replayable from the seed.
    ctx.state.currentBiome = def.biome;
    ctx.state.worldSeed = seed >>> 0;
    this.generateCaves(ctx);

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

    // 5) Biome extras first (fungus colonies, crystal clusters, snow drifts,
    //    coal seams, healing springs), so secrets can still find untouched
    //    thick wall masses afterward; then the placement brain + secrets.
    applyBiomeExtras(ctx, this.rng, def.biome);
    const graph = extractRegionGraph(ctx.world, spawn, { x: wellX, y: sealY - 12 });
    stampSecrets(ctx, this.rng, graph, def.biome);

    // 6) Cauldron: a stone brewing basin on the first waystone's ground row —
    //    9 wide, 1-row stone base, 2-tall side walls, open 7x3 interior bowl.
    const ws0 = waystones[0];
    const cSide = this.rng.next() < 0.5 ? -1 : 1;
    const cauldronX = Math.floor(clamp(ws0.x + cSide * 14, 8, WIDTH - 9));
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

    // 8) Landmark structures (upgrade-port meta layer): the exit portal above
    //    the seal plug, the golden key vault, hearts, tomes, chests, gold.
    const { pickups, portal, mechanisms, runeVaults, boss } = placeStructures(
      ctx,
      this.rng,
      graph,
      def,
      { x: wellX, sealY },
      waystones,
      spawn,
      cauldron,
    );

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
    };
  }
}
