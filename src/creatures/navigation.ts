import type { Enemy, EnemyDef } from '@/core/types';
import type { World } from '@/sim/World';
import { blocksEntity, Cell } from '@/sim/CellType';

const STEP = 8, SIDE = 25, LIMIT = 192;
interface Route { x: number; y: number; next: number; revision: number; tx: number; ty: number; visited: number }
const routes = new WeakMap<Enemy, Route>();

/** Swept body clearance, not a ray through a gap narrower than the creature. */
export function bodyRouteClear(world: World, x: number, y: number, tx: number, ty: number, halfW: number, height: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(tx - x, ty - y) / 2));
  for (let i = 0; i <= steps; i++) {
    const cx = Math.round(x + (tx - x) * i / steps), cy = Math.round(y + (ty - y) * i / steps);
    for (let yy = cy - height; yy <= cy; yy++) for (let xx = cx - halfW; xx <= cx + halfW; xx++) {
      if (!world.inBounds(xx, yy)) return false;
      const type = world.type(xx, yy);
      if (blocksEntity(type) || type === Cell.Lava || type === Cell.Acid || type === Cell.Fire) return false;
    }
  }
  return true;
}

/** Bounded local search; steering still goes through each body's contact solver. */
export function localRoute(world: World, e: Enemy, def: EnemyDef, tx: number, ty: number, tick: number): Route {
  const cached = routes.get(e);
  let revision = world.activity.epoch;
  for (let y = Math.max(0, (e.y - 112) >> 6); y <= Math.min(world.activity.rows - 1, (e.y + 104) >> 6); y++) {
    for (let x = Math.max(0, (e.x - 112) >> 6); x <= Math.min(world.activity.columns - 1, (e.x + 104) >> 6); x++) {
      revision = Math.imul(revision ^ world.activity.versions[x + y * world.activity.columns], 16777619);
    }
  }
  if (cached && tick < cached.next && Math.hypot(cached.tx - tx, cached.ty - ty) < 24 &&
    (revision === cached.revision || tick < cached.next - 12)) return cached;
  const result: Route = { x: tx, y: ty, tx, ty, next: tick + 24 + (e.mind?.phase ?? 0) % 7, revision, visited: 0 };
  const halfW = Math.ceil(def.halfW), height = Math.ceil(def.h);
  // Bound even direct-route work. A far target first becomes a local waypoint.
  const distance = Math.hypot(tx - e.x, ty - e.y);
  if (distance > 88) { tx = e.x + (tx - e.x) * 88 / distance; ty = e.y + (ty - e.y) * 88 / distance; }
  if (bodyRouteClear(world, e.x, e.y, tx, ty, halfW, height)) { result.x = tx; result.y = ty; routes.set(e, result); return result; }
  const count = SIDE * SIDE, mid = (SIDE - 1) / 2, start = mid + mid * SIDE;
  const costs = new Float32Array(count).fill(Infinity), parents = new Int16Array(count).fill(-1);
  const closed = new Uint8Array(count), open = [start];
  costs[start] = 0;
  const px = (key: number): number => e.x + (key % SIDE - mid) * STEP;
  const py = (key: number): number => e.y + (Math.floor(key / SIDE) - mid) * STEP;
  const heuristic = (key: number): number => Math.hypot(px(key) - tx, py(key) - ty);
  let best = start;
  while (open.length && result.visited < LIMIT) {
    let pick = 0;
    for (let i = 1; i < open.length; i++) if (costs[open[i]] + heuristic(open[i]) < costs[open[pick]] + heuristic(open[pick])) pick = i;
    const key = open.splice(pick, 1)[0];
    if (closed[key]) continue;
    closed[key] = 1; result.visited++;
    if (heuristic(key) < heuristic(best)) best = key;
    if (heuristic(key) < STEP) break;
    for (const delta of [-SIDE, -1, 1, SIDE]) {
      const next = key + delta;
      if (next < 0 || next >= count || closed[next] || (Math.abs(delta) === 1 && Math.floor(key / SIDE) !== Math.floor(next / SIDE))) continue;
      const cost = costs[key] + STEP;
      if (cost >= costs[next] || !bodyRouteClear(world, px(key), py(key), px(next), py(next), halfW, height)) continue;
      costs[next] = cost; parents[next] = key; open.push(next);
    }
  }
  while (parents[best] >= 0 && parents[best] !== start) best = parents[best];
  result.x = px(best); result.y = py(best);
  routes.set(e, result);
  return result;
}
