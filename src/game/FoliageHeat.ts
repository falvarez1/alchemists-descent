import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

type HeatTrace = { ax: number; ay: number; bx: number; by: number; wet: boolean };
type HeatIndex = { tick: number; buckets: Map<number, HeatTrace[]> };
const indexes = new WeakMap<Ctx, HeatIndex>();
const regions = new WeakMap<World, { epoch: number; chunks: Map<number, { version: number; flags: number }> }>();
const bucketKey = (x: number, y: number) => (Math.floor(y / 32) + 2048) * 4096 + Math.floor(x / 32) + 2048;
const hot = (type: number | null) => type === Cell.Fire || type === Cell.Ember || type === Cell.Lava;
const wet = (type: number | null) => type === Cell.Water || type === Cell.Nitrogen;
const thermalClass = new Uint8Array(256);
for (const type of [Cell.Fire, Cell.Ember, Cell.Lava, Cell.Oil]) thermalClass[type] = 1;
for (const type of [Cell.Water, Cell.Nitrogen]) thermalClass[type] = 2;

/** Build one small spatial index per tick, shared by bushes and lifted vines.
 * Swept traces catch fast embers crossing a leaf between simulation samples. */
function traces(ctx: Ctx): HeatIndex {
  let index = indexes.get(ctx);
  if (index && index.tick === ctx.state.frameCount) return index;
  index ??= { tick: -1, buckets: new Map() };
  index.tick = ctx.state.frameCount; index.buckets.clear(); indexes.set(ctx, index);
  const add = (ax: number, ay: number, vx: number, vy: number, isWet: boolean) => {
    const trace = { ax, ay, bx: ax + vx, by: ay + vy, wet: isWet };
    const x0 = Math.min(ax, trace.bx) - 2, x1 = Math.max(ax, trace.bx) + 2;
    const y0 = Math.min(ay, trace.by) - 2, y1 = Math.max(ay, trace.by) + 2;
    for (let y = Math.floor(y0 / 32); y <= Math.floor(y1 / 32); y++) for (let x = Math.floor(x0 / 32); x <= Math.floor(x1 / 32); x++) {
      const key = bucketKey(x * 32, y * 32), bucket = index!.buckets.get(key);
      if (bucket) bucket.push(trace); else index!.buckets.set(key, [trace]);
    }
  };
  for (const p of ctx.particles?.list ?? []) if (hot(p.type) || wet(p.type)) add(p.x, p.y, p.vx, p.vy, wet(p.type));
  for (const p of ctx.projectiles ?? []) if (p.type === 'fireball' || p.type === 'meteor') add(p.x, p.y, p.vx, p.vy, false);
  return index;
}

function cellMatches(ctx: Ctx, x: number, y: number, water: boolean): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return false;
  const i = w.idx(x, y), type = w.types[i];
  return water ? wet(type) : hot(type) || (type === Cell.Oil && w.life[i] > 0);
}

export function foliageHeatNearby(ctx: Ctx, x: number, y: number, radius: number, water = false): boolean {
  const index = traces(ctx);
  const x0 = Math.floor(x - radius), x1 = Math.ceil(x + radius), y0 = Math.floor(y - radius), y1 = Math.ceil(y + radius);
  for (let by = Math.floor(y0 / 32); by <= Math.floor(y1 / 32); by++) for (let bx = Math.floor(x0 / 32); bx <= Math.floor(x1 / 32); bx++) {
    if (index.buckets.get(bucketKey(bx * 32, by * 32))?.some(t => t.wet === water)) return true;
  }
  const world = ctx.world, activity = world.activity;
  let cached = regions.get(world);
  if (!cached || cached.epoch !== activity.epoch) { cached = { epoch: activity.epoch, chunks: new Map() }; regions.set(world, cached); }
  // Broad phase follows terrain mutation versions. A cold, unchanged region
  // costs a lookup instead of rescanning every cell around every moving leaf.
  for (let cy = Math.max(0, y0 >> 6); cy <= Math.min(activity.rows - 1, y1 >> 6); cy++) {
    for (let cx = Math.max(0, x0 >> 6); cx <= Math.min(activity.columns - 1, x1 >> 6); cx++) {
      const key = cx + cy * activity.columns, version = activity.ready ? activity.versions[key] : activity.revision;
      let chunk = cached.chunks.get(key);
      if (!chunk || chunk.version !== version) {
        let flags = 0;
        const right = Math.min(world.width, (cx + 1) * 64), bottom = Math.min(world.height, (cy + 1) * 64);
        // Oil remains a candidate when only its fuel countdown changes.
        for (let yy = cy * 64; yy < bottom && flags !== 3; yy++) {
          const end = right + yy * world.width;
          for (let at = cx * 64 + yy * world.width; at < end; at++) flags |= thermalClass[world.types[at]];
        }
        chunk = { version, flags }; cached.chunks.set(key, chunk);
      }
      if (chunk.flags & (water ? 2 : 1)) return true;
    }
  }
  return false;
}

export function foliageTouchesHeat(ctx: Ctx, ax: number, ay: number, bx: number, by: number, water = false): boolean {
  const index = traces(ctx), steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
  for (let step = 0; step <= steps; step++) {
    const x = ax + (bx - ax) * step / steps, y = ay + (by - ay) * step / steps;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (cellMatches(ctx, Math.floor(x) + dx, Math.floor(y) + dy, water)) return true;
    for (const trace of index.buckets.get(bucketKey(x, y)) ?? []) {
      if (trace.wet !== water) continue;
      const dx = trace.bx - trace.ax, dy = trace.by - trace.ay;
      const t = Math.max(0, Math.min(1, ((x - trace.ax) * dx + (y - trace.ay) * dy) / (dx * dx + dy * dy || 1)));
      if ((x - trace.ax - t * dx) ** 2 + (y - trace.ay - t * dy) ** 2 < 2.25) return true;
    }
  }
  return false;
}
