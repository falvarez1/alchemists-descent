import { MAX_PARTICLES } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Cell, isGas, isLiquid, isSolid } from '@/sim/CellType';
import { fireColor, fungusColor, mossColor, packRGB, waterColor } from '@/sim/colors';
import { handleViscousLiquid } from '@/sim/elements/liquids';
import { spawnSmoke } from '@/sim/elements/thermal';

/* ---------- Upgrade-port descent materials (noita-alchemists-descent.html) ---------- */

const CARDINAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
];

const FUNGUS_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, -1],
  [-1, -1],
];

const snowPasses = (t: number): boolean => t === Cell.Empty || isGas(t);
const coalPasses = (t: number): boolean => t === Cell.Empty || (isLiquid(t) && t !== Cell.Lava) || isGas(t);
const ashPasses = (t: number): boolean => t === Cell.Empty || isGas(t);

export function handleSnow(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Melts near any heat source (meltChance 0.45 — not a MaterialParams field)
  for (let i = 0; i < 4; i++) {
    const nx = x + (i === 0 ? 1 : i === 1 ? -1 : 0);
    const ny = y + (i === 2 ? 1 : i === 3 ? -1 : 0);
    if (!w.inBounds(nx, ny)) continue;
    const n = w.types[w.idx(nx, ny)];
    if ((n === Cell.Fire || n === Cell.Lava || n === Cell.Ember) && Math.random() < 0.45) {
      const i2 = w.idx(x, y);
      w.replaceCellAt(i2, Cell.Water, waterColor());
      return;
    }
  }
  // Light powder: settles softly, floats on water
  if (w.inBounds(x, y + 1) && snowPasses(w.types[w.idx(x, y + 1)]) && Math.random() < 0.7) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[Cell.Snow].friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && snowPasses(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
    if (w.inBounds(x - dir, y + 1) && snowPasses(w.types[w.idx(x - dir, y + 1)])) {
      w.swap(x, y, x - dir, y + 1);
      return;
    }
  }
}

export function handleCoal(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const P = ctx.params.materials[Cell.Coal];
  // Slow to catch, but burns long and hot once lit
  for (let i = 0; i < 4; i++) {
    const nx = x + (i === 0 ? 1 : i === 1 ? -1 : 0);
    const ny = y + (i === 2 ? 1 : i === 3 ? -1 : 0);
    if (!w.inBounds(nx, ny)) continue;
    const n = w.types[w.idx(nx, ny)];
    if ((n === Cell.Fire || n === Cell.Lava) && Math.random() < P.igniteChance!) {
      const i2 = w.idx(x, y);
      w.replaceCellAt(i2, Cell.Fire, fireColor());
      w.life[i2] = P.burnDuration! + Math.floor(Math.random() * 40);
      return;
    }
  }
  if (w.inBounds(x, y + 1) && coalPasses(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < P.friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && coalPasses(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
  }
}

export function handleAsh(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Featherlight residue — drifts as it falls, dissolves in water
  for (let i = 0; i < 4; i++) {
    const nx = x + (i === 0 ? 1 : i === 1 ? -1 : 0);
    const ny = y + (i === 2 ? 1 : i === 3 ? -1 : 0);
    if (w.inBounds(nx, ny) && w.types[w.idx(nx, ny)] === Cell.Water && Math.random() < 0.1) {
      const i2 = w.idx(x, y);
      w.clearCellAt(i2);
      return;
    }
  }
  const drift = Math.random() < 0.35 ? (Math.random() < 0.5 ? 1 : -1) : 0;
  if (
    w.inBounds(x + drift, y + 1) &&
    ashPasses(w.types[w.idx(x + drift, y + 1)]) &&
    Math.random() < 0.55
  ) {
    w.swap(x, y, x + drift, y + 1);
    return;
  }
  if (w.inBounds(x, y + 1) && ashPasses(w.types[w.idx(x, y + 1)]) && Math.random() < 0.5) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[Cell.Ash].friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && ashPasses(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
  }
}

/**
 * Cave moss (Wave F): slow benign creep across damp rock. Spreads only into
 * air hugging a solid surface AND only where liquid sits nearby — the damp
 * parts of a cave green over; dry galleries stay bare stone.
 */
export function handleMoss(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const i = w.idx(x, y);
  if (w.life[i] === 0) w.life[i] = 10 + Math.floor(Math.random() * 14);
  if (w.life[i] < 0) return;
  if (Math.random() > 0.02) return; // far slower than fungus — geology pace
  // dampness: any liquid within a loose 4-cell sniff (5 random samples)
  let damp = false;
  for (let s = 0; s < 5 && !damp; s++) {
    const sx = x + Math.floor(Math.random() * 9) - 4;
    const sy = y + Math.floor(Math.random() * 9) - 4;
    if (w.inBounds(sx, sy) && isLiquid(w.types[w.idx(sx, sy)])) damp = true;
  }
  if (!damp) return;
  const d = CARDINAL_DIRS[Math.floor(Math.random() * CARDINAL_DIRS.length)];
  const nx = x + d[0];
  const ny = y + d[1];
  if (w.inBounds(nx, ny) && w.types[w.idx(nx, ny)] === Cell.Empty) {
    let touching = false;
    for (let k = 0; k < 4 && !touching; k++) {
      const tx = nx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ty = ny + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (w.inBounds(tx, ty)) {
        const t = w.types[w.idx(tx, ty)];
        if (isSolid(t) && t !== Cell.Moss && t !== Cell.Fungus) touching = true;
      }
    }
    if (touching) {
      const ni = w.idx(nx, ny);
      w.types[ni] = Cell.Moss;
      w.colors[ni] = mossColor();
      w.life[ni] = Math.max(2, w.life[i] - 1 - Math.floor(Math.random() * 3));
      w.moved[ni] = w.movedTick;
    }
  }
  w.life[i]--;
  if (w.life[i] <= 0) w.life[i] = -1; // mature: settled green, stops creeping
}

/**
 * Glowcap colonies creep along solid surfaces with a finite energy budget.
 * lifeGrid: 0 = fresh spore (charge it), >0 = spreading energy, -1 = mature.
 * (spreadRate 0.10 — not a MaterialParams field.)
 */
export function handleFungus(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const i = w.idx(x, y);
  if (w.life[i] === 0) w.life[i] = 16 + Math.floor(Math.random() * 22);
  if (w.life[i] < 0) return;
  if (Math.random() > 0.1) return;
  const d = FUNGUS_DIRS[Math.floor(Math.random() * FUNGUS_DIRS.length)];
  const nx = x + d[0];
  const ny = y + d[1];
  if (w.inBounds(nx, ny) && w.types[w.idx(nx, ny)] === Cell.Empty) {
    // Only spread into cells that hug a solid surface — clings like moss
    let touching = false;
    for (let k = 0; k < 4 && !touching; k++) {
      const tx = nx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ty = ny + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (w.inBounds(tx, ty)) {
        const t = w.types[w.idx(tx, ty)];
        if (isSolid(t) && t !== Cell.Fungus) touching = true;
      }
    }
    if (touching) {
      const ni = w.idx(nx, ny);
      w.types[ni] = Cell.Fungus;
      w.colors[ni] = fungusColor();
      w.life[ni] = Math.max(2, w.life[i] - 2 - Math.floor(Math.random() * 3));
      w.moved[ni] = w.movedTick;
    }
  }
  w.life[i]--;
  if (w.life[i] <= 0) w.life[i] = -1; // mature: stop spreading, keep glowing
}

/** Toxic sludge / healium / teleportium share viscous flow with bespoke quirks. */
export function handleExoticLiquid(ctx: Ctx, x: number, y: number, type: Cell): void {
  const w = ctx.world;
  handleViscousLiquid(ctx, x, y, type);
  const i = w.idx(x, y);
  if (w.types[i] !== type) return; // moved away this frame
  if (
    type === Cell.Healium &&
    Math.random() < ctx.params.materials[Cell.Healium].evaporationSpeed!
  ) {
    w.replaceCellAt(i, Cell.Steam, packRGB(255, 170 + Math.floor(Math.random() * 30), 200));
    w.life[i] = 40;
    return;
  }
  if (
    type === Cell.Teleportium &&
    Math.random() < 0.004 &&
    ctx.particles.list.length < MAX_PARTICLES - 60
  ) {
    ctx.particles.spawn(
      x + Math.random(),
      y,
      (Math.random() - 0.5) * 0.3,
      -0.3 - Math.random() * 0.3,
      null,
      packRGB(190, 110, 255),
      22,
      { grav: -0.01, glow: 2.2 },
    );
  }
  if (type === Cell.Toxic && Math.random() < 0.0015) spawnSmoke(ctx, x, y);
}
