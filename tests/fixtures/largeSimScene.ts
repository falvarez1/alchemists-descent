import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { reseedAllStreams, reseedTickStreams } from '@/core/simRandom';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { World } from '@/sim/World';
import { VineStrands } from '@/entities/VineStrands';

/**
 * A multi-chunk sim fixture (shared by tests/sim-golden-large.test.ts and
 * scripts/bench-sim.mjs). The 96x96 golden scene fits inside one 64-cell
 * activity chunk corner; this one spans many chunks so the activity grid's
 * cross-chunk halos, sleeping/coarse scheduling, and the electrical tracker
 * are all exercised: bands of sand/water/oil straddling chunk seams, a fire
 * line under oil, lava beside water, a charged metal bar in a pool, stone
 * shelves with gaps, and a partial interest window (so far chunks tick at
 * the coarse 15 Hz rate).
 */
export function buildLargeScene(world: World, scale = 1): void {
  const W = world.width, H = world.height;
  world.clear();
  const put = (x: number, y: number, t: number): void => {
    if (x >= 0 && y >= 0 && x < W && y < H) world.types[world.idx(x, y)] = t;
  };
  for (let x = 0; x < W; x++) { put(x, H - 1, Cell.Wall); put(x, H - 2, Cell.Wall); put(x, 0, Cell.Wall); }
  for (let y = 0; y < H; y++) { put(0, y, Cell.Wall); put(W - 1, y, Cell.Wall); }
  const bandTop = 6, bandBottom = Math.floor(H * 0.3);
  for (let y = bandTop; y < bandBottom; y++) {
    for (let x = 1; x < W - 1; x++) {
      const band = Math.floor((x + 19) / (37 * scale)) % 3;
      put(x, y, band === 0 ? Cell.Sand : band === 1 ? Cell.Water : Cell.Oil);
    }
  }
  // Fire line under the bands: the oil burns, the smoke and steam rise.
  for (let x = 3; x < W - 3; x += 5) {
    put(x, bandBottom + 1, Cell.Fire);
    world.life[world.idx(x, bandBottom + 1)] = 200;
  }
  // Stone shelves with gaps (falls, pours, piles that topple across seams).
  for (let s = 0; s < 3; s++) {
    const y = Math.floor(H * (0.45 + s * 0.15));
    for (let x = 1; x < W - 1; x++) if (((x + s * 41) % 97) > 11) put(x, y, Cell.Stone);
  }
  // Lava tongue beside a water pool near the floor.
  for (let y = H - 14; y < H - 2; y++) {
    for (let x = 8; x < Math.floor(W * 0.2); x++) put(x, y, Cell.Lava);
    for (let x = Math.floor(W * 0.2); x < Math.floor(W * 0.55); x++) put(x, y, Cell.Water);
  }
  // A charged metal bar lying in the pool: conduction crawls into the water.
  const barY = H - 8;
  for (let x = Math.floor(W * 0.3); x < Math.floor(W * 0.45); x++) put(x, barY, Cell.Metal);
  world.activity.invalidateAll();
  for (let x = Math.floor(W * 0.3); x < Math.floor(W * 0.33); x++) world.setChargeAt(world.idx(x, barY), 120);
}

export function makeSimCtx(world: World, worldSeed: number): Ctx {
  const ctx = {
    world,
    state: { mode: 'play', score: 0, frameCount: 0, worldSeed, currentBiome: 'earthen' },
    input: { mouse: { x: 0, y: 0 } },
    params: createGameParams(),
    events: { emit: () => undefined, on: () => undefined },
    projectileCtl: { update: () => undefined },
    shockwaves: [],
    particles: { list: [], spawn: () => undefined, burst: () => undefined },
    player: { x: 4, y: world.height - 6, dead: false, gold: 0, perks: {}, status: {} },
    audio: new Proxy({}, { get: () => () => undefined }),
  } as unknown as Ctx;
  ctx.vineStrands = new VineStrands(ctx);
  return ctx;
}

/** Build the scene and step it `ticks` game ticks at one substep each (as Game does). */
export function runLargeScene(worldSeed: number, ticks: number, width = 320, height = 256): { world: World; ctx: Ctx; sim: Simulation } {
  const world = new World(width, height);
  buildLargeScene(world);
  // Interest window: the left ~60% of the world; the rest runs coarse.
  world.simBounds.x0 = 0; world.simBounds.x1 = Math.floor(width * 0.6);
  world.simBounds.y0 = 0; world.simBounds.y1 = height;
  reseedAllStreams(worldSeed);
  const ctx = makeSimCtx(world, worldSeed);
  const sim = new Simulation();
  for (let t = 0; t < ticks; t++) {
    ctx.state.frameCount++;
    reseedTickStreams(worldSeed, ctx.state.frameCount);
    sim.processFrame(ctx);
  }
  return { world, ctx, sim };
}

/** FNV-1a over the planes that are state (types, life, charge). */
export function hashSimState(world: World): string {
  let h = 0x811c9dc5;
  const fold = (byte: number): void => { h ^= byte & 0xff; h = Math.imul(h, 0x01000193); };
  for (let i = 0; i < world.types.length; i++) {
    fold(world.types[i]);
    const life = world.life[i]; fold(life); fold(life >> 8);
    const charge = world.charge[i]; fold(charge); fold(charge >> 8);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function hashSimColors(world: World): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < world.colors.length; i++) {
    const c = world.colors[i];
    for (let s = 0; s < 32; s += 8) { h ^= (c >>> s) & 0xff; h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** FNV-1a over the activity grid's externally-read planes: render damage
 *  (TerrainArt), chunk versions (AuthorLink, navigation, flora), and the
 *  eligibility masks the sweep walks. */
export function hashActivity(world: World): string {
  const a = world.activity;
  a.flushTouches(); // consumers read the damage planes only after a flush
  let h = 0x811c9dc5;
  const fold32 = (v: number): void => {
    for (let s = 0; s < 32; s += 8) { h ^= (v >>> s) & 0xff; h = Math.imul(h, 0x01000193); }
  };
  for (const plane of [a.renderDirtyRows, a.rowMasks, a.versions]) for (let i = 0; i < plane.length; i++) fold32(plane[i]);
  for (const plane of [a.renderMinX, a.renderMinY, a.renderMaxX, a.renderMaxY]) for (let i = 0; i < plane.length; i++) fold32(plane[i]);
  for (const plane of [a.eligible, a.scheduled, a.dirty]) for (let i = 0; i < plane.length; i++) fold32(plane[i]);
  fold32(a.activeChunks); fold32(a.sleepingChunks); fold32(a.coarseChunks);
  return (h >>> 0).toString(16).padStart(8, '0');
}
