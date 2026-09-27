import type { Ctx, Enemy } from '@/core/types';
import { Cell, isLiquid, isSoftGrowth } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { stainCell } from '@/sim/stains';
import { fxRandom } from '@/core/simRandom';
import type { Leg } from './rig/limb';
import type { RigPoint } from './rig/physics';
import type { CreatureRig } from './rig/types';

/**
 * The world notices the animals. Every rigged creature touches the grid the
 * way the wizard does: feet land on real cells and answer with dust, spores,
 * leaf flecks or a splash; heavy feet dent snow and flick sand; feet that
 * waded through blood track it across the stone; tails and tentacles that
 * break a liquid surface throw droplets of that liquid; bodies plough loose
 * powder aside; loose debris gets kicked.
 *
 * Mostly presentation particles (null-typed, fx stream); the few grid writes
 * (a snow print, a shoved sand grain, a blood-tracked stain) are small, local,
 * budgeted and draw no randomness.
 */

const MASS: Partial<Record<Enemy['kind'], number>> = {
  colossus: 3, golem: 2, leviathan: 2.5, weaver: 1.2, spitter: 1, mage: 0.8, rootloper: 0.9, stonemaw: 1.4, rillback: 0.8,
};
const massOf = (e: Enemy): number => MASS[e.kind] ?? 0.5;

const soundAt = new WeakMap<Enemy, number>();
function voice(ctx: Ctx, e: Enemy, every: number, fn: () => void): void {
  const now = ctx.state.frameCount, last = soundAt.get(e) ?? -1e9;
  if (now - last < every) return;
  soundAt.set(e, now);
  ctx.audio?.at?.(e.x, e.y, fn, 300);
}

const powder = (t: number): boolean => t === Cell.Sand || t === Cell.Snow || t === Cell.Coal || t === Cell.Gunpowder;
const trackable = (t: number): boolean => t === Cell.Blood || t === Cell.Slime || t === Cell.Oil || t === Cell.Toxic || t === Cell.Acid;
const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

function cellAt(ctx: Ctx, x: number, y: number): number {
  const w = ctx.world, ix = Math.floor(x), iy = Math.floor(y);
  return w.inBounds(ix, iy) ? w.types[w.idx(ix, iy)] : Cell.Wall;
}

/** One foot landing on (gx, gy) with outward surface normal (nx, ny). */
export function footfall(ctx: Ctx, e: Enemy, gx: number, gy: number, nx: number, ny: number, leg: Leg | null): void {
  const w = ctx.world, P = ctx.particles, mass = massOf(e);
  const cx = Math.floor(gx - nx * 0.5), cy = Math.floor(gy - ny * 0.5);
  if (!w.inBounds(cx, cy)) return;
  const under = w.types[w.idx(cx, cy)];
  const at = cellAt(ctx, gx + nx * 0.5, gy + ny * 0.5);
  const dir = Math.sign(e.vx) || (e.mind?.facing ?? 1);
  // Wading: a splash of whatever the foot came down in; sticky stuff clings.
  if (isLiquid(at)) {
    const col = w.colors[w.idx(Math.floor(gx + nx * 0.5), Math.floor(gy + ny * 0.5))];
    for (let k = 0; k < 2 + mass * 2; k++) P.spawn(gx, gy - 0.5, (fxRandom() - 0.5) * 1.2 + dir * 0.3, -0.5 - fxRandom() * mass * 0.6, null, col, 26, { grav: 0.14 });
    if (leg && trackable(at)) { leg.mud = 6; leg.mudColor = col; }
    voice(ctx, e, 18, () => ctx.audio.splash(Math.min(1, 0.15 + mass * 0.2)));
    return;
  }
  // Footprints: a heavy foot presses a real dent into snow; sand grains flick aside.
  if (powder(under) && mass >= 1) {
    const i = w.idx(cx, cy), col = w.colors[i];
    if (under === Cell.Snow) {
      w.clearCellAt(i);
      for (let k = 0; k < 3; k++) P.spawn(gx, gy - 0.5, (fxRandom() - 0.5) * 0.8, -0.3 - fxRandom() * 0.4, null, col, 24, { grav: 0.06 });
    } else if (under !== Cell.Gunpowder || mass >= 2) {
      // The surface grain is kicked back as a real grain; it lands and settles.
      const side = w.idx(cx - dir, cy - 1);
      if (w.inBounds(cx - dir, cy - 1) && w.types[side] === Cell.Empty) {
        w.clearCellAt(i);
        P.spawn(gx, gy - 1, -dir * (0.4 + mass * 0.3), -0.6 - mass * 0.2, under, col, 90);
      }
    }
  }
  // Soft growth brushed by the step: leaf flecks, fungus spores, glowcap motes.
  const growth = isSoftGrowth(at) ? at : isSoftGrowth(under) ? under : -1;
  if (growth === Cell.Glowshroom) {
    for (let k = 0; k < 3; k++) P.spawn(gx + (fxRandom() - 0.5) * 2, gy - 1, (fxRandom() - 0.5) * 0.4, -0.3 - fxRandom() * 0.4, null, packRGB(120, 255, 220), 50, { glow: 1.8, grav: -0.008 });
  } else if (growth === Cell.Fungus) {
    for (let k = 0; k < 2; k++) P.spawn(gx, gy - 1, (fxRandom() - 0.5) * 0.5, -0.25 - fxRandom() * 0.3, null, packRGB(190, 170, 120), 44, { glow: 0.6, grav: -0.006 });
  } else if (growth >= 0) {
    const col = w.colors[w.idx(Math.floor(gx), Math.floor(gy + (growth === at ? 0 : 0.5)))] || packRGB(70, 130, 60);
    for (let k = 0; k < 1 + (mass >= 1 ? 1 : 0); k++) P.spawn(gx, gy - 0.8, (fxRandom() - 0.5) * 0.8, -0.5 - fxRandom() * 0.4, null, col, 34, { grav: 0.05 });
  } else if (mass >= 1 && (under === Cell.Stone || under === Cell.Wall || under === Cell.RawOre || under === Cell.Sand || under === Cell.Coal || under === Cell.Wood)) {
    // Dust off hard ground, heavier feet raise more.
    const col = w.colors[w.idx(cx, cy)];
    const [r, g, b] = rgb(col);
    const dust = packRGB(Math.min(255, r * 0.8 + 40), Math.min(255, g * 0.8 + 36), Math.min(255, b * 0.8 + 30));
    for (let k = 0; k < Math.round(mass * 1.5); k++) P.spawn(gx + (fxRandom() - 0.5) * 2, gy - 0.5, (fxRandom() - 0.5) * 0.9 * mass, -0.15 - fxRandom() * 0.35, null, dust, 30, { grav: -0.004 });
  }
  // Tracks: a foot that waded through blood (or slime, oil…) prints it on stone.
  if (leg && leg.mud > 0 && (under === Cell.Stone || under === Cell.Wall || under === Cell.Wood || under === Cell.Ice)) {
    const [r, g, b] = rgb(leg.mudColor);
    stainCell(w, cx, cy, r, g, b, 0.18 + leg.mud * 0.06);
    leg.mud--;
  }
  // Loose debris near the foot gets kicked.
  const body = ctx.rigidBodies?.hitTest?.(gx + dir * 1.5, gy - 1.2);
  if (body && !body.tag?.startsWith('player')) ctx.rigidBodies.applyImpulseAt(body, dir * (0.4 + mass * 0.35), -0.3 - mass * 0.15, gx, gy - 1);
  // Weight you can hear (and, for the giant, feel).
  if (e.kind === 'colossus') {
    voice(ctx, e, 10, () => { ctx.audio.landThud(0.8); ctx.audio.hollowKnock(); });
    if (Math.hypot(e.x - ctx.player.x, e.y - ctx.player.y) < 220) ctx.fx.screenShake = Math.min(0.03, ctx.fx.screenShake + 0.012);
  } else if (e.kind === 'golem') voice(ctx, e, 12, () => ctx.audio.landThud(0.35));
  else if (e.kind === 'weaver') voice(ctx, e, 26, () => ctx.audio.chitin(0.18));
  else if (e.kind === 'spitter') voice(ctx, e, 22, () => ctx.audio.skitter());
  else if (e.kind === 'rootloper') voice(ctx, e, 30, () => ctx.audio.creak(0.35));
}

/** Droplets thrown where a body part breaks a liquid surface (in or out). */
function splashPoint(ctx: Ctx, e: Enemy, x: number, y: number, px: number, py: number, budget: { n: number }): void {
  if (budget.n <= 0) return;
  const wasL = isLiquid(cellAt(ctx, px, py)), nowL = isLiquid(cellAt(ctx, x, y));
  if (wasL === nowL) return;
  const vx = x - px, vy = y - py, sp = Math.hypot(vx, vy);
  if (sp < (nowL ? 0.45 : 0.6)) return;
  const w = ctx.world;
  // Find the surface line between the two samples.
  let sy = Math.floor(nowL ? y : py);
  const sx = Math.floor(nowL ? x : px);
  for (let k = 0; k < 8 && w.inBounds(sx, sy - 1) && isLiquid(w.types[w.idx(sx, sy - 1)]); k++) sy--;
  if (!w.inBounds(sx, sy)) return;
  const col = w.colors[w.idx(sx, sy)];
  const mass = massOf(e);
  const n = Math.min(10, Math.round(2 + sp * 2 + mass * 1.5));
  for (let k = 0; k < n; k++) {
    ctx.particles.spawn(sx + (fxRandom() - 0.5) * 2, sy - 0.5, vx * 0.3 + (fxRandom() - 0.5) * (0.8 + sp * 0.4),
      -(0.5 + fxRandom() * (0.6 + sp * 0.5 + mass * 0.3)), null, col, 30, { grav: 0.14 });
  }
  budget.n--;
  voice(ctx, e, 14, () => ctx.audio.splash(Math.min(1, 0.12 + sp * 0.15 + mass * 0.15)));
}

/** A dragging body part shoves loose powder aside: tails plough furrows in sand. */
function plough(ctx: Ctx, p: RigPoint, budget: { n: number }): void {
  if (budget.n <= 0 || p.hit === 0) return;
  const vx = p.x - p.px, vy = p.y - p.py;
  if (Math.abs(vx) + Math.abs(vy) < 0.35) return;
  const w = ctx.world;
  const ax = Math.floor(p.x + Math.sign(vx) * (p.r + 0.6)), ay = Math.floor(p.y + (p.hit & 1 ? p.r + 0.4 : 0));
  if (!w.inBounds(ax, ay)) return;
  const t = w.types[w.idx(ax, ay)];
  if (!powder(t)) return;
  const bx = ax + Math.sign(vx), by = ay - 1;
  if (!w.inBounds(bx, by) || w.types[w.idx(bx, by)] !== Cell.Empty) return;
  w.swap(ax, ay, bx, by);
  budget.n--;
}

const SPLASH = { n: 0 };
const PLOUGH = { n: 0 };

/** Everything a rigged creature does to the world this tick. */
export function touchWorld(ctx: Ctx, e: Enemy, rig: CreatureRig): void {
  if (ctx.state.mode !== 'play' || !ctx.particles) return;
  // Footfalls.
  for (const leg of rig.legs) {
    if (!leg.landed) continue;
    leg.landed = false;
    footfall(ctx, e, leg.gx, leg.gy, leg.gnx, leg.gny, leg);
  }
  const loco = e.weaverLoco;
  if (loco) {
    // The Weaver's own feet: land events from its locomotion's planted flags.
    let mask = rig.f[0] | 0, next = 0;
    loco.legs.forEach((l, i) => {
      if (l.planted) next |= 1 << i;
      if (l.planted && !(mask & (1 << i)) && (i + ctx.state.frameCount) % 2 === 0) footfall(ctx, e, l.x, l.y, loco.nx, loco.ny, null);
    });
    mask = next; rig.f[0] = mask;
  }
  // Surface breaks: bodies, tails, tentacles, gel.
  SPLASH.n = e.kind === 'leviathan' ? 4 : 2;
  PLOUGH.n = massOf(e) >= 1 ? 2 : 1;
  for (const p of rig.pts) { splashPoint(ctx, e, p.x, p.y, p.px, p.py, SPLASH); plough(ctx, p, PLOUGH); }
  for (const c of rig.chains) for (let i = 1; i < c.pts.length; i += 2) {
    const p = c.pts[i];
    splashPoint(ctx, e, p.x, p.y, p.px, p.py, SPLASH);
    plough(ctx, p, PLOUGH);
  }
  if (rig.soft) for (let i = 0; i < rig.soft.pts.length; i += 3) { const p = rig.soft.pts[i]; splashPoint(ctx, e, p.x, p.y, p.px, p.py, SPLASH); }
  if (e.body) for (let i = 0; i < e.body.nodes.length; i += 2) {
    const n = e.body.nodes[i];
    splashPoint(ctx, e, n.x, n.y, n.previousX, n.previousY, SPLASH);
  }
  // Gel leaves a glistening track on stone as it slides.
  if (rig.soft && e.grounded && Math.abs(e.vx) > 0.2 && ctx.state.frameCount % 9 === 0 && e.kind !== 'bomber') {
    const x = Math.floor(e.x), y = e.y + 1, w = ctx.world;
    if (w.inBounds(x, y)) {
      const t = w.types[w.idx(x, y)];
      if (t === Cell.Stone || t === Cell.Wall || t === Cell.Wood) stainCell(w, x, y, e.kind === 'acidslime' ? 150 : 70, e.kind === 'acidslime' ? 190 : 170, e.kind === 'acidslime' ? 40 : 140, 0.16);
    }
  }
}
