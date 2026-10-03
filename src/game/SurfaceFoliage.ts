import type { Ctx } from '@/core/types';
import type { World } from '@/sim/World';
import { Cell, isGas } from '@/sim/CellType';
import { ashColor, fireColor, packRGB, smokeColor } from '@/sim/colors';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { AMBIENT_FOLIAGE_LIFE, FOLIAGE_BURN_TICKS, foliageBurnLife, foliageBurnState, foregroundFoliage } from '@/config/foliage';
import { foliageSupport, surfaceFoliageHash } from '@/world/surfaceFoliage';
import { visitSurfaceFronds, type SurfaceFrondPose } from '@/world/foliageGeometry';
import { foliageContactFuel, foliageHeatNearby, foliageTouchesHeat } from '@/game/FoliageHeat';

export interface SurfacePlant extends SurfaceFrondPose {
  velocity: number; burning: boolean; color: number;
}
interface Garden {
  epoch: number; revision: number;
  chunks: Map<number, { version: number; roots: SurfacePlant[] }>;
  poses: Map<number, SurfacePlant>;
  visible: SurfacePlant[];
}
const gardens = new WeakMap<World, Garden>();

/** Current material roots, shared by simulation and presentation. Discovery
 * is chunk-cached; querying a pose never advances its spring or burn clock. */
export function visibleSurfaceFoliage(ctx: Ctx): readonly SurfacePlant[] {
  const { camera } = ctx;
  return surfaceFoliageInBounds(ctx.world, camera.renderX - 40, camera.renderY - 40,
    camera.renderX + VIEW_W + 40, camera.renderY + VIEW_H + 40);
}

/** Gameplay queries the player's surroundings, independently of the camera. */
export function surfaceFoliageInBounds(world: World, left: number, top: number, right: number, bottom: number): readonly SurfacePlant[] {
  const a = world.activity;
  let garden = gardens.get(world);
  if (!garden || garden.epoch !== a.epoch) {
    garden = { epoch: a.epoch, revision: -1, chunks: new Map(), poses: new Map(), visible: [] };
    gardens.set(world, garden);
  }
  if (!a.ready && garden.revision !== world.mutationVersion) {
    garden.chunks.clear();
    for (const i of garden.poses.keys()) {
      if (world.types[i] !== Cell.Moss || world.life[i] > AMBIENT_FOLIAGE_LIFE) garden.poses.delete(i);
    }
  }
  garden.revision = world.mutationVersion;
  const roots = garden.visible; roots.length = 0;
  const x0 = Math.max(0, Math.floor(left / 64)), y0 = Math.max(0, Math.floor(top / 64));
  const x1 = Math.min(a.columns - 1, Math.floor(right / 64));
  const y1 = Math.min(a.rows - 1, Math.floor(bottom / 64));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const key = cy * a.columns + cx, version = a.versions[key];
    let chunk = garden.chunks.get(key);
    if (!chunk || chunk.version !== version) {
      // Prune the old membership before replacing it. Otherwise removed roots
      // leave poses behind and a later plant inherits their spring momentum.
      for (const p of chunk?.roots ?? []) {
        const i = world.idx(p.x, p.y);
        if (world.types[i] !== Cell.Moss || world.life[i] > AMBIENT_FOLIAGE_LIFE) garden.poses.delete(i);
      }
      const found: SurfacePlant[] = [];
      const add = (i: number): void => {
        if (world.types[i] !== Cell.Moss || world.life[i] > AMBIENT_FOLIAGE_LIFE) return;
        const x = i % world.width, y = Math.floor(i / world.width);
        if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return;
        const side = foliageSupport(world.types[i + world.width]) ? 0 : foliageSupport(world.types[i - 1]) ? 1 : foliageSupport(world.types[i + 1]) ? -1 : 0;
        const seed = surfaceFoliageHash(x, y);
        let p = garden.poses.get(i);
        if (!p) {
          const aquatic = world.types[i - world.width] === Cell.Water;
          const foreground = foregroundFoliage(x, y, side);
          p = { x, y, side, seed, foreground, height: foreground ? 28 + seed % 9 : side ? 10 + seed % 22 : aquatic ? 12 + seed % 22 : 5 + seed % 13,
            angle: 0, velocity: 0, part: 0, burn: 0, burning: false, color: world.colors[i] };
          garden.poses.set(i, p);
        }
        p.side = side; p.foreground = foregroundFoliage(x, y, side); found.push(p);
      };
      // The sim already maintains sorted growth indexes. Water or smoke
      // changing the chunk need not trigger another 4,096-cell root scan.
      if (a.ready) { for (const i of a.growthCells[key]) add(i); }
      else for (let y = Math.max(1, cy * 64); y < Math.min(world.height - 1, cy * 64 + 64); y++) {
        for (let x = Math.max(1, cx * 64); x < Math.min(world.width - 1, cx * 64 + 64); x++) add(world.idx(x, y));
      }
      chunk = { version, roots: found }; garden.chunks.set(key, chunk);
    }
    for (const p of chunk.roots) {
      const i = world.idx(p.x, p.y);
      if (world.types[i] === Cell.Moss && world.life[i] <= AMBIENT_FOLIAGE_LIFE) {
        // Saves and grid ignition can change life without rebuilding a chunk.
        // Hydrate presentation here, but leave burn advancement to the tick.
        const saved = foliageBurnState(world.life[i]);
        p.burn = Math.min(1, saved.age / FOLIAGE_BURN_TICKS); p.burning = saved.burning;
        roots.push(p);
      }
      else garden.poses.delete(i);
    }
  }
  return roots;
}

function contact(ctx: Ctx, p: SurfacePlant, water: boolean): number {
  if (!foliageHeatNearby(ctx, p.x, p.y, p.height + 4, water)) return 0;
  let value = 0;
  visitSurfaceFronds(p, (ax, ay, bx, by) => {
    if (water) { if (!value && foliageTouchesHeat(ctx, ax, ay, bx, by, true)) value = 1; }
    else value = Math.max(value, foliageContactFuel(ctx, ax, ay, bx, by));
  });
  return value;
}

/** Springs and finite material fuel run alongside habitat motion, never in
 * draw calls. A swept body parts leaves even when it crosses between frames. */
export function updateSurfaceFoliage(ctx: Ctx): void {
  if (ctx.state.mode !== 'play' || !ctx.levels.current) return;
  const world = ctx.world, tick = ctx.state.frameCount;
  for (const p of visibleSurfaceFoliage(ctx)) {
    const i = world.idx(p.x, p.y);
    if (![i - 1, i + 1, i - world.width, i + world.width].some(at => foliageSupport(world.types[at]))) {
      world.replaceCellAt(i, Cell.Ash, ashColor()); continue;
    }
    const aquatic = world.type(p.x, p.y - 1) === Cell.Water;
    let target = Math.sin(tick * .021 + p.x * .07) * .035, part = 0;
    const brush = (x: number, y: number, vx: number): void => {
      const previous = x - vx, cx = p.x + .5, cy = p.y + .5 + (p.side ? p.height * .4 : -p.height * .4);
      const closest = Math.max(Math.min(x, previous), Math.min(Math.max(x, previous), cx));
      const dx = cx - closest, dy = cy - (y - 8), distance = Math.hypot(dx, dy * .65);
      const radius = 12 + Math.min(10, p.height * .3);
      if (distance >= radius) return;
      const strength = (1 - distance / radius) ** 2;
      target += (Math.max(-1, Math.min(1, (cx - closest) / 8)) * .65 + Math.max(-6, Math.min(6, vx)) * .08) * strength;
      part = Math.max(part, strength);
    };
    if (!ctx.player.dead) brush(ctx.player.x, ctx.player.y, ctx.player.vx);
    for (const e of ctx.enemies) if (e.hp > 0 && Math.abs(e.x - p.x) < 36) brush(e.x, e.y, e.vx);
    if (aquatic) target += world.flow.x(p.x, p.y) * .05;
    p.velocity = p.velocity * (aquatic ? .89 : .82) + (Math.max(-.85, Math.min(.85, target)) - p.angle) * (aquatic ? .035 : .075);
    p.angle = Math.max(-.95, Math.min(.95, p.angle + p.velocity));
    p.part += (part - p.part) * .16;
    let saved = foliageBurnState(world.life[i]);
    p.burn = Math.min(1, saved.age / FOLIAGE_BURN_TICKS); p.burning = saved.burning;
    if (!p.burning) {
      const fuel = contact(ctx, p, false);
      if (fuel > 0 && !contact(ctx, p, true)) {
        world.life[i] = foliageBurnLife(fuel, saved.age);
        saved = foliageBurnState(world.life[i]); p.burning = true;
      }
    }
    if (!p.burning) continue;
    if (contact(ctx, p, true)) {
      world.life[i] = -10 - Math.min(FOLIAGE_BURN_TICKS - 1, saved.age);
      p.burning = false;
      ctx.particles?.spawn(p.x, p.y - 2, 0, -.4, Cell.Steam, packRGB(154, 175, 168), 24, { grav: -.015 });
      continue;
    }
    // One small actual flame at ignition. Its fuel is inherited from the
    // contact, never renewed by the visual smoke and sparks that follow.
    if (saved.age === 0 && saved.fuel > 0) {
      const y = p.y - 1, at = world.idx(p.x, y), t = world.types[at];
      if (t === Cell.Empty || isGas(t)) { world.replaceCellAt(at, Cell.Fire, fireColor()); world.life[at] = saved.fuel; }
    }
    const age = saved.age + 1;
    world.life[i] = foliageBurnLife(saved.fuel, age); p.burn = age / FOLIAGE_BURN_TICKS;
    if (age >= FOLIAGE_BURN_TICKS) { world.replaceCellAt(i, Cell.Ash, ashColor()); p.burning = false; continue; }
    if ((tick + p.seed) % 10 === 0) {
      ctx.particles?.spawn(p.x, p.y - p.height * (1 - p.burn) * .4, Math.sin(tick) * .2, -.4, Cell.Smoke, smokeColor(), 28, { grav: -.018 });
      // Cosmetic sparks cannot ignite the next patch through the heat index.
      ctx.particles?.spawn(p.x, p.y - 2, .1, -.5, null, fireColor(), 14, { grav: -.015, glow: .8 });
    }
  }
}
