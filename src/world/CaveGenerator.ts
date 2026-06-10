import { BIOMES } from '@/config/biomes';
import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp, hash2, valueNoise } from '@/core/math';
import { Rng, randomSeed } from '@/core/rng';
import type { Ctx, WorldGenApi } from '@/core/types';
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
  unpackB,
  unpackG,
  unpackR,
  waterColor,
  woodColor,
} from '@/sim/colors';
import { spawnFortress as stampFortress } from '@/world/fortress';

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
    const FLOOR_BAND = HEIGHT - 52; // open strip at the bottom
    const MIN_Y = 2;

    // --- 1) Noise field (true = wall) ---
    // work[x][y] flattened to x + y * WIDTH (1 = wall, 0 = open)
    let work = new Uint8Array(WIDTH * HEIGHT);
    for (let x = 0; x < WIDTH; x += 2) {
      for (let y = 0; y < HEIGHT; y += 2) {
        const v = y >= FLOOR_BAND ? 0 : this.rng.next() < 0.54 ? 1 : 0;
        work[x + y * WIDTH] = v;
        if (x + 1 < WIDTH) work[x + 1 + y * WIDTH] = v;
        if (y + 1 < HEIGHT) {
          work[x + (y + 1) * WIDTH] = v;
          if (x + 1 < WIDTH) work[x + 1 + (y + 1) * WIDTH] = v;
        }
      }
    }
    for (let x = 0; x < WIDTH; x++) for (let y = FLOOR_BAND; y < HEIGHT; y++) work[x + y * WIDTH] = 0;

    // --- 2) Cellular automata, 5 smoothing passes (OOB counts as wall) ---
    for (let pass = 0; pass < 5; pass++) {
      const next = new Uint8Array(WIDTH * HEIGHT);
      for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < FLOOR_BAND; y++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const X = x + dx,
                Y = y + dy;
              if (X < 0 || X >= WIDTH || Y < 0) {
                n++;
                continue;
              }
              if (Y >= FLOOR_BAND) continue;
              if (work[X + Y * WIDTH]) n++;
            }
          }
          next[x + y * WIDTH] = n >= 5 ? 1 : n <= 3 ? 0 : work[x + y * WIDTH];
        }
      }
      work = next;
    }

    // --- 3) Carve a guaranteed traversable tunnel network ---
    const carveDisc = (cx: number, cy: number, r: number): void => {
      cx = Math.floor(cx);
      cy = Math.floor(cy);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            const X = cx + dx,
              Y = cy + dy;
            if (X > 1 && X < WIDTH - 2 && Y > MIN_Y && Y < HEIGHT) work[X + Y * WIDTH] = 0;
          }
        }
      }
    };

    // Two meandering horizontal arteries (upper + lower)
    const tunnelY: number[] = new Array<number>(WIDTH).fill(0);
    {
      const ph1 = this.rng.next() * Math.PI * 2,
        ph2 = this.rng.next() * Math.PI * 2;
      const base = HEIGHT * 0.4 + (this.rng.next() - 0.5) * 64;
      for (let x = 2; x < WIDTH - 2; x++) {
        let ty = base + Math.sin(x * 0.0075 + ph1) * 88 + Math.sin(x * 0.0021 + ph2) * 116;
        ty = clamp(ty, 60, FLOOR_BAND - 92);
        tunnelY[x] = Math.floor(ty);
        if (x % 4 === 0) carveDisc(x, ty, 16);
      }
    }
    {
      const ph1 = this.rng.next() * Math.PI * 2,
        ph2 = this.rng.next() * Math.PI * 2;
      const base = HEIGHT * 0.74;
      for (let x = 2; x < WIDTH - 2; x++) {
        let ty = base + Math.sin(x * 0.0065 + ph1) * 52 + Math.sin(x * 0.0025 + ph2) * 68;
        ty = clamp(ty, HEIGHT * 0.58, FLOOR_BAND - 28);
        if (x % 4 === 0) carveDisc(x, ty, 14);
      }
    }

    // Upper gallery artery
    {
      const ph1 = this.rng.next() * Math.PI * 2,
        ph2 = this.rng.next() * Math.PI * 2;
      const base = HEIGHT * 0.14;
      for (let x = 2; x < WIDTH - 2; x++) {
        let ty = base + Math.sin(x * 0.0085 + ph1) * 36 + Math.sin(x * 0.003 + ph2) * 44;
        ty = clamp(ty, 32, HEIGHT * 0.26);
        if (x % 4 === 0) carveDisc(x, ty, 14);
      }
    }

    // Mid gallery artery
    {
      const ph1 = this.rng.next() * Math.PI * 2,
        ph2 = this.rng.next() * Math.PI * 2;
      const base = HEIGHT * 0.57;
      for (let x = 2; x < WIDTH - 2; x++) {
        let ty = base + Math.sin(x * 0.007 + ph1) * 48 + Math.sin(x * 0.0024 + ph2) * 60;
        ty = clamp(ty, HEIGHT * 0.46, HEIGHT * 0.68);
        if (x % 4 === 0) carveDisc(x, ty, 14);
      }
    }

    // Vertical shafts stitching ceiling, all arteries, and the floor band together
    const shaftXs = [
      WIDTH * 0.08,
      WIDTH * 0.22,
      WIDTH * 0.36,
      WIDTH * 0.5,
      WIDTH * 0.64,
      WIDTH * 0.78,
      WIDTH * 0.92,
    ].map((v) => Math.floor(v + (this.rng.next() - 0.5) * 36));
    for (const sx of shaftXs) {
      const ph = this.rng.next() * Math.PI * 2;
      const amp = 24 + this.rng.next() * 32;
      let jitter = 0;
      for (let y = 20; y < FLOOR_BAND - 6; y += 3) {
        jitter += (this.rng.next() - 0.5) * 4.6;
        jitter = clamp(jitter, -28, 28);
        const wx = Math.floor(clamp(sx + Math.sin(y * 0.0125 + ph) * amp + jitter, 20, WIDTH - 20));
        carveDisc(wx, y, 11);
      }
    }

    // A handful of open chambers off the main routes
    for (let i = 0; i < 18; i++) {
      const cx = 48 + this.rng.next() * (WIDTH - 96);
      const cy = 80 + this.rng.next() * (FLOOR_BAND - 144);
      const rx = 26 + this.rng.next() * 20,
        ry = 17 + this.rng.next() * 13;
      for (let dy = -Math.ceil(ry); dy <= ry; dy++) {
        for (let dx = -Math.ceil(rx); dx <= rx; dx++) {
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
            const X = Math.floor(cx + dx),
              Y = Math.floor(cy + dy);
            if (X > 1 && X < WIDTH - 2 && Y > MIN_Y && Y < FLOOR_BAND) work[X + Y * WIDTH] = 0;
          }
        }
      }
    }

    // Spawn chamber dead center on the upper artery
    carveDisc(WIDTH / 2, tunnelY[Math.floor(WIDTH / 2)], 24);
    this.spawnHint = { x: Math.floor(WIDTH / 2), y: tunnelY[Math.floor(WIDTH / 2)] };

    // Stalactites dripping into the larger caverns (and a few stalagmites rising to meet them)
    for (let x = 8; x < WIDTH - 8; x++) {
      for (let y = MIN_Y + 1; y < FLOOR_BAND - 62; y++) {
        if (!(work[x + y * WIDTH] && !work[x + (y + 1) * WIDTH])) continue; // ceiling surface
        let depth = 0;
        while (depth < 90 && y + 1 + depth < FLOOR_BAND && !work[x + (y + 1 + depth) * WIDTH]) depth++;
        if (depth >= 52 && this.rng.next() < 0.35) {
          const len = 11 + Math.floor(this.rng.next() * Math.min(13, depth - 36));
          let hw = Math.round(len * 0.42);
          for (let s = 1; s <= len; s++) {
            const wob = this.rng.next() < 0.3 ? 1 : 0;
            for (let dx = -hw - wob; dx <= hw + wob; dx++) {
              const X = x + dx;
              if (X > 1 && X < WIDTH - 2) work[X + (y + s) * WIDTH] = 1;
            }
            if (this.rng.next() < 0.75) hw = Math.max(0, hw - 1);
          }
          // occasional stalagmite below
          if (this.rng.next() < 0.4 && depth >= 70) {
            const fy = y + depth; // floor surface row is open; ground at fy+1
            const slen = 6 + Math.floor(this.rng.next() * 7);
            let shw = Math.round(slen * 0.7);
            for (let s = 0; s < slen; s++) {
              for (let dx = -shw; dx <= shw; dx++) {
                const X = x + dx,
                  Y = fy - s;
                if (X > 1 && X < WIDTH - 2 && Y > MIN_Y) work[X + Y * WIDTH] = 1;
              }
              if (this.rng.next() < 0.8) shw = Math.max(0, shw - 1);
            }
          }
          x += 24 + Math.floor(this.rng.next() * 30);
        }
        break; // only the topmost ceiling per column
      }
    }

    // Strip orphaned 1-2 cell rock specks floating in open space
    for (let pass = 0; pass < 2; pass++) {
      for (let x = 1; x < WIDTH - 1; x++) {
        for (let y = 1; y < HEIGHT - 1; y++) {
          if (!work[x + y * WIDTH]) continue;
          let n = 0;
          if (work[x - 1 + y * WIDTH]) n++;
          if (work[x + 1 + y * WIDTH]) n++;
          if (work[x + (y - 1) * WIDTH]) n++;
          if (work[x + (y + 1) * WIDTH]) n++;
          if (n === 0 || (n === 1 && this.rng.next() < 0.7)) work[x + y * WIDTH] = 0;
        }
      }
    }

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
    while (goldPlaced < 100 && goldTries < 30000) {
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
    for (let attempt = 0; attempt < 3600 && seeds < 60; attempt++) {
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
}
