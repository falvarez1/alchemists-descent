import type { Ctx, HabitatPlantState } from '@/core/types';
import type { World } from '@/sim/World';
import { blocksEntity, Cell, isGas, isLiquid } from '@/sim/CellType';
import { ashColor, fireColor, packRGB, smokeColor } from '@/sim/colors';
import { WORKS_PLANTS, worksPlantRoot } from '@/world/worksHabitat';
import { visitFronds } from '@/world/foliageGeometry';
import { foliageHeatNearby, foliageTouchesHeat } from './FoliageHeat';

const gardens = new WeakMap<World, Array<HabitatPlantState | null>>();
export function habitatPlant(world: World, index: number): Readonly<HabitatPlantState> | null { return gardens.get(world)?.[index] ?? null; }
export function habitatBend(world: World, index: number): number { return habitatPlant(world, index)?.angle ?? 0; }

function plantsFor(ctx: Ctx): Array<HabitatPlantState | null> {
  const living = ctx.levels.current!.living!;
  living.plants ??= WORKS_PLANTS.map(([x, expectedY, _size, hanging]) => {
    const y = hanging ? -1 : worksPlantRoot(ctx.world, x, expectedY, false, true);
    return y < 0 ? null : { x, y, rootY: y, angle: 0, velocity: 0, rotation: 0, spin: 0, vx: 0, vy: 0, detached: false, burn: 0, burning: false, age: 0, spent: false };
  });
  gardens.set(ctx.world, living.plants);
  return living.plants;
}

function supported(world: World, x: number, y: number): boolean {
  for (let d = 1; d <= 4; d++) if (world.inBounds(x, y + d) && blocksEntity(world.type(x, y + d))) return true;
  return false;
}

/** The kick uses the same directional cone/falloff as loose cells and enemies. */
export function gustHabitat(ctx: Ctx, gustAt: (x: number, y: number) => number, dx: number, dy: number): void {
  if (!ctx.levels?.current?.living) return;
  const plants = plantsFor(ctx);
  for (let i = 0; i < plants.length; i++) {
    const p = plants[i]; if (!p || p.spent) continue;
    const size = WORKS_PLANTS[i][2], force = Math.max(gustAt(p.x, p.y), gustAt(p.x, p.y - size * .4), gustAt(p.x, p.y - size * .7));
    if (force <= 0) continue;
    p.velocity += dx * force * .34;
    if (p.detached) { p.vx += dx * force * 3; p.vy += dy * force * 3 - force; p.spin += dx * force * .08; }
    for (let k = 0; k < 3; k++) ctx.particles?.spawn(p.x + (k - 1) * 3, p.y - size * .45, dx * (1 + force * 3), dy * force - .5 - k * .2,
      null, p.burn > .2 ? packRGB(101, 87, 57) : packRGB(100, 134, 78), 22 + k * 5, { grav: .035 });
  }
}

function touchCrown(ctx: Ctx, p: HabitatPlantState, size: number, seed: number, water: boolean): boolean {
  if (!foliageHeatNearby(ctx, p.x, p.y, size + 3, water)) return false;
  let touched = false;
  visitFronds(p.x, p.y, size, seed, p.angle, p.rotation, (ax, ay, bx, by, _value, leaf, frond, along) => {
    if (touched || (leaf ? along > 1 - p.burn * (.8 + frond % 3 * .08) : along > 1 - p.burn * .6)) return;
    touched = foliageTouchesHeat(ctx, ax, ay, bx, by, water);
  });
  return touched;
}

function shedCrown(ctx: Ctx, p: HabitatPlantState, size: number): void {
  for (let i = 0; i < 9; i++) ctx.particles?.spawn(p.x + (i % 3 - 1) * size * .2, p.y - Math.floor(i / 3) * size * .2,
    (i % 3 - 1) * .6 + p.vx, -.4 - i % 2 * .3, Cell.Ash, ashColor(), 90 + i * 3, { grav: .08, deposit: true });
  if (ctx.world.inBounds(Math.floor(p.x), Math.floor(p.y)) && ctx.world.type(Math.floor(p.x), Math.floor(p.y)) === Cell.Moss) ctx.world.clearCell(Math.floor(p.x), Math.floor(p.y));
  p.spent = true; p.burning = false;
}

/** Simulation owns motion, fuel and heat contact; render reads the same crown
 * after its root is cut. Missing support cannot erase an intact canopy. */
export function updateHabitatMotion(ctx: Ctx): void {
  if (!ctx.levels?.current?.living) return;
  const plants = plantsFor(ctx), world = ctx.world, tick = ctx.state.frameCount;
  for (let i = 0; i < plants.length; i++) {
    const p = plants[i]; if (!p || p.spent) continue;
    const [rootX, _expectedY, size] = WORKS_PLANTS[i];
    // Check the socket before detaching: a burning timber catches its crown.
    const socketHot = !p.detached && foliageTouchesHeat(ctx, rootX, p.rootY, rootX, p.rootY + 3);
    if (!p.burning && (socketHot || touchCrown(ctx, p, size, rootX, false))) p.burning = true;
    if (p.burning && touchCrown(ctx, p, size, rootX, true)) {
      p.burning = false;
      ctx.particles?.spawn(p.x, p.y - size * .4, 0, -.5, Cell.Steam, packRGB(154, 175, 168), 30, { grav: -.015 });
    }
    if (!p.detached && (world.type(rootX, p.rootY) !== Cell.Moss || !supported(world, rootX, p.rootY))) {
      p.detached = true; p.vx = p.velocity * size * .12; p.vy = -.2;
      p.spin = p.velocity * .35 + Math.sin(rootX) * .025;
      if (world.type(rootX, p.rootY) === Cell.Moss) world.clearCell(rootX, p.rootY);
    }
    if (p.detached) {
      p.age++;
      const wet = isLiquid(world.type(Math.floor(p.x), Math.floor(p.y - size * .3)));
      p.vx = p.vx * (wet ? .89 : .99) + (wet ? world.flow.x(p.x, p.y) * .04 : 0);
      p.vy = Math.min(5, p.vy * (wet ? .84 : .995) + (wet ? -.035 : .14));
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy)) * 2));
      for (let s = 0; s < steps; s++) {
        const nx = p.x + p.vx / steps, ny = p.y + p.vy / steps;
        if (world.inBounds(Math.floor(nx), Math.floor(p.y)) && !blocksEntity(world.type(Math.floor(nx), Math.floor(p.y)))) p.x = nx;
        else p.vx *= -.2;
        if (world.inBounds(Math.floor(p.x), Math.floor(ny)) && !blocksEntity(world.type(Math.floor(p.x), Math.floor(ny)))) p.y = ny;
        else { p.vy *= -.15; p.vx *= .78; p.spin *= .6; }
      }
      p.rotation += p.spin; p.spin *= wet ? .95 : .995;
      p.velocity *= .9; p.angle *= .99;
      if (p.age > 900) { shedCrown(ctx, p, size); continue; }
    } else {
      let target = Math.sin(tick * .018 + rootX * .037) * .035;
      const brush = (px: number, py: number, vx: number) => {
        const distance = Math.hypot(px - p.x, py - p.y + size * .4);
        if (distance >= 38) return;
        target += (Math.max(-1, Math.min(1, (p.x - px) / 18)) * .5 + vx * .022) * (1 - distance / 38);
      };
      brush(ctx.player.x, ctx.player.y - 8, ctx.player.vx);
      for (const enemy of ctx.enemies) if (enemy.hp > 0) brush(enemy.x, enemy.y - 7, enemy.vx);
      p.velocity = p.velocity * .79 + (target - p.angle) * .055;
      p.angle = Math.max(-.95, Math.min(.95, p.angle + p.velocity));
    }
    if (!p.burning) continue;
    p.burn = Math.min(1, p.burn + 1 / 210);
    if (p.burn >= 1) { shedCrown(ctx, p, size); continue; }
    if ((tick + i) % 5 !== 0) continue;
    // Finite fuel emits actual fire/embers from the current physical fronds.
    const frond = Math.floor(tick / 5) % (6 + rootX % 3), along = (3 + Math.floor(tick / 11) % Math.max(1, Math.floor(11 * (1 - p.burn)))) / 18;
    let emitted = false;
    visitFronds(p.x, p.y, size, rootX, p.angle, p.rotation, (_ax, _ay, bx, by, _value, leaf, branch, t) => {
      if (emitted || leaf || branch !== frond || t !== along) return;
      emitted = true;
      const x = Math.floor(bx), y = Math.floor(by);
      if (world.inBounds(x, y) && (world.type(x, y) === Cell.Empty || isGas(world.type(x, y)))) {
        const index = world.idx(x, y); world.replaceCellAt(index, Cell.Fire, fireColor()); world.life[index] = 18; world.moved[index] = world.movedTick;
      }
      ctx.particles?.spawn(bx, by, Math.sin(tick) * .3, -.5, Cell.Fire, fireColor(), 15, { grav: -.025, glow: 1.3 });
      if (tick % 2 === 0) ctx.particles?.spawn(bx, by - 1, .1, -.35, Cell.Smoke, smokeColor(), 40, { grav: -.015 });
      if (tick % 3 === 0) ctx.particles?.spawn(bx, by, Math.sin(tick) * .5, -.6, Cell.Ember, packRGB(242, 158, 64), 28, { grav: .018, glow: .8, deposit: true });
    });
  }
}
