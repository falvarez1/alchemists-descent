import type { Ctx, Enemy } from '@/core/types';
import type { World } from '@/sim/World';
import { Cell, isLiquid } from '@/sim/CellType';
import { COLOR_FN } from '@/sim/colors';
import { tickChain } from './body';
import { constrain, impulse, integrate, liquidAt, solidAt } from './rig/physics';
import type { RigPoint } from './rig/physics';
import { solveKnee } from './rig/limb';
import type { CreatureRig } from './rig/types';
import { BAT } from './species/bat';

/**
 * Corpses — Rain World's physical death. A slain creature keeps its body: the
 * rig goes limp and falls, drapes over ledges, floats belly-up in water; a
 * spider's legs curl in; gel slumps into a puddle; lights inside it gutter
 * out. After a while the remains melt back into the grid as the material
 * they were made of — blood, slime, acid, embers — so the world keeps them.
 *
 * Presentation-owned physics: nothing here can hit, block or be saved. The
 * list clears itself when the world changes (level transitions).
 */
export interface Corpse {
  e: Enemy;
  age: number;
  ttl: number;
  /** Skeleton constraints captured at death: point pairs and rest lengths. */
  bonds: Array<[RigPoint, RigPoint, number]>;
  /** 1 alive-bright → 0 dark: emissive parts gutter out. */
  glow: number;
  world: World;
}

const CORPSE_TTL = 720; // ~12s of remains
const MAX_CORPSES = 10;
const NO_CORPSE = new Set<Enemy['kind']>(['bomber', 'colossus', 'eggs']);

const list: Corpse[] = [];

export function corpses(): readonly Corpse[] {
  return list;
}

export function clearCorpses(): void {
  list.length = 0;
}

function allPoints(rig: CreatureRig): RigPoint[] {
  const pts: RigPoint[] = [...rig.pts];
  for (const c of rig.chains) pts.push(...c.pts);
  if (rig.soft) pts.push(...rig.soft.pts);
  return pts;
}

/** Keep the body: called from the kill path for creatures that leave remains. */
export function addCorpse(ctx: Ctx, e: Enemy, kx: number, ky: number): boolean {
  if (NO_CORPSE.has(e.kind) || ctx.state.mode !== 'play') return false;
  const rig = e.rig;
  const bonds: Corpse['bonds'] = [];
  if (rig) {
    // Bond each body chunk to its neighbours, each chain root to its nearest chunk.
    for (let i = 1; i < rig.pts.length; i++) {
      const a = rig.pts[i - 1], b = rig.pts[i];
      bonds.push([a, b, Math.hypot(a.x - b.x, a.y - b.y)]);
    }
    for (const c of rig.chains) {
      for (let i = 1; i < c.pts.length; i++) bonds.push([c.pts[i - 1], c.pts[i], c.seg]);
      let best: RigPoint | null = null, bd = Infinity;
      for (const p of rig.pts) { const d = Math.hypot(p.x - c.pts[0].x, p.y - c.pts[0].y); if (d < bd) { bd = d; best = p; } }
      if (best) bonds.push([best, c.pts[0], bd]);
    }
    // Every point gets a collision radius and the death impulse.
    const pts = allPoints(rig);
    for (const p of pts) { if (p.r <= 0) p.r = 0.4; impulse(p, (kx || 0) * 0.5, Math.min(0, (ky || 0) * 0.5) - 0.6); }
    if (rig.soft) for (const p of rig.soft.pts) p.r = Math.max(p.r, 0.5);
  }
  // Death poses the rig itself can't find by falling.
  if (rig && e.kind === 'bat') { rig.f[BAT.fold] = 1; rig.f[BAT.spread] = 0; rig.f[BAT.flapRate] = 0; }
  e.hp = Math.min(e.hp, 0);
  // A dead face: eyes shut, jaw slack.
  if (e.expression) { e.expression.lid = 1; e.expression.jaw = 0.4; e.expression.alert = 0; e.expression.fear = 0; }
  e.sleeping = false;
  e.flash = 0;
  e.windup = 0; e.swoop = 0; e.blink = 0; e.fusing = 0; e.recoil = 0; e.punching = 0; e.jetFuel = 0;
  e.attackCd = 999;
  if (e.weaverLoco) { e.weaverLoco.mode = 'airborne'; e.weaverLoco.vx += (kx || 0) * 0.3; e.weaverLoco.vy += -0.8; }
  e.submerged = false;
  list.push({ e, age: 0, ttl: CORPSE_TTL + ((e.bobPhase * 60) | 0), bonds, glow: 1, world: ctx.world });
  while (list.length > MAX_CORPSES) meltCorpse(ctx, list.shift()!, true);
  return true;
}

/** The remains return to the grid as what they were made of. */
function meltCorpse(ctx: Ctx, c: Corpse, quick = false): void {
  if (c.world !== ctx.world) return;
  const def = ctx.enemyCtl.defs[c.e.kind];
  const w = ctx.world;
  const cell = def.gore === Cell.Fire ? Cell.Ember : def.gore === Cell.Stone ? Cell.Sand : def.gore;
  const color = COLOR_FN[cell] ?? def.goreFn;
  const pts = c.e.rig ? allPoints(c.e.rig) : [];
  if (pts.length === 0) pts.push({ x: c.e.x, y: c.e.y - 3, px: 0, py: 0, r: 0, hit: 0, wet: 0 });
  let placed = 0;
  const budget = quick ? 6 : Math.min(28, Math.round(def.halfW * def.h * 0.12));
  for (let k = 0; k < pts.length * 2 && placed < budget; k++) {
    const p = pts[(k * 7) % pts.length];
    const x = Math.floor(p.x + ((k * 13) % 5) - 2), y = Math.floor(p.y + ((k * 5) % 3) - 1);
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    const t = w.types[i];
    if (t !== Cell.Empty && !(isLiquid(t) && t !== cell)) continue;
    w.replaceCellAt(i, cell, color());
    placed++;
  }
  if (!quick) ctx.particles?.burst(c.e.x, c.e.y - 3, 6, null, def.goreFn, 0.6, { grav: 0.05 });
  if (!quick) leaveBones(ctx, c);
}

const BONES: Partial<Record<Enemy['kind'], number>> = { spitter: 2, golem: 0, mage: 2, weaver: 1, rootloper: 0, stonemaw: 2, rillback: 1, leviathan: 3, bat: 1 };

/** What outlasts the flesh: a few bones (or a mask) left as real, kickable debris. */
function leaveBones(ctx: Ctx, c: Corpse): void {
  const count = BONES[c.e.kind] ?? 0;
  if (count <= 0 || !ctx.rigidBodies?.spawn) return;
  const big = c.e.kind === 'leviathan';
  for (let i = 0; i < count; i++) {
    const mask = c.e.kind === 'mage' && i === 0;
    const body = ctx.rigidBodies.spawn(
      mask ? { kind: 'circle', radius: 1.8 } : { kind: 'box', halfW: big ? 3.6 : 1.8 + (i % 2) * 0.5, halfH: big ? 0.9 : 0.55 },
      c.e.x + (i - count / 2) * 2.5, c.e.y - 2 - i,
      { density: 0.6, color: mask ? 0xd8cfb4 : chitin(c.e.kind), restitution: 0.3, friction: 0.7,
        vx: (i - count / 2) * 0.3, vy: -0.6, va: (i % 2 ? 0.2 : -0.2), tag: 'gore-chunk' },
    );
    body.goreTtl = 3600 + i * 120;
  }
}

function chitin(kind: Enemy['kind']): number {
  return kind === 'weaver' ? 0x241c30 : kind === 'stonemaw' ? 0x4a4236 : 0xcfc6ad;
}

function stepLegs(world: World, rig: CreatureRig, age: number): void {
  for (const leg of rig.legs) {
    // Legs go slack: feet fall until they rest on something, then slide in.
    let hip: RigPoint | null = null, bd = Infinity;
    for (const p of rig.pts) { const d = Math.hypot(p.x - leg.kx, p.y - leg.ky); if (d < bd) { bd = d; hip = p; } }
    if (!hip) continue;
    leg.planted = false; leg.swing = -1;
    if (!solidAt(world, leg.x, leg.y + 0.6)) leg.y += Math.min(1.2, 0.3 + age * 0.02);
    leg.x += (hip.x - leg.x) * 0.02;
    const reach = leg.upper + leg.lower, dx = leg.x - hip.x, dy = leg.y - hip.y, d = Math.hypot(dx, dy);
    if (d > reach) { leg.x = hip.x + dx / d * reach; leg.y = hip.y + dy / d * reach; }
    solveKnee(leg, hip.x, hip.y);
  }
}

function stepWeaverCorpse(world: World, e: Enemy, age: number): void {
  const loco = e.weaverLoco;
  if (!loco) return;
  // Fall until the body rests, then roll onto its back and draw the legs in.
  loco.vy = Math.min(3, loco.vy + 0.25);
  loco.vx *= 0.94;
  const nx = loco.px + loco.vx, ny = loco.py + loco.vy;
  if (!solidAt(world, nx, ny + 5)) { loco.px = nx; loco.py = ny; }
  else { loco.vy = 0; loco.vx *= 0.6; }
  const roll = Math.min(1, age / 50);
  loco.nx += (0 - loco.nx) * 0.1;
  loco.ny += (-1 + roll * 1.6 - loco.ny) * 0.08; // tips toward belly-up
  const l = Math.hypot(loco.nx, loco.ny) || 1; loco.nx /= l; loco.ny /= l;
  const curl = Math.min(1, age / 70);
  for (const leg of loco.legs) {
    if (leg.missing) continue;
    leg.planted = false;
    // Dead spiders fold their legs over the body.
    const tx = loco.px + (leg.x - loco.px) * (1 - curl * 0.55), ty = loco.py - 6 * curl + (leg.y - loco.py) * (1 - curl * 0.7);
    leg.x += (tx - leg.x) * 0.08; leg.y += (ty - leg.y) * 0.08;
    leg.lift = 0;
  }
  e.x = Math.round(loco.px); e.y = Math.round(loco.py + 9);
}

export function updateCorpses(ctx: Ctx): void {
  const world = ctx.world;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.world !== world) { list.splice(i, 1); continue; }
    c.age++;
    c.glow = Math.max(0, 1 - c.age / 150);
    const e = c.e, rig = e.rig;
    const wet = liquidAt(world, e.x, e.y - 3);
    const limp = { gravity: 0.22, damping: 0.93, wetDamping: 0.8, buoyancy: -0.35, friction: 0.7 };
    if (rig) {
      for (const p of allPoints(rig)) integrate(world, p, limp);
      for (let it = 0; it < 3; it++) for (const [a, b, rest] of c.bonds) constrain(world, a, b, rest, 0.5, 0.9);
      if (rig.soft) {
        // Gel deflates into a spreading puddle.
        const sb = rig.soft;
        let cx = 0, cy = 0;
        for (const p of sb.pts) { cx += p.x; cy += p.y; }
        cx /= sb.pts.length; cy /= sb.pts.length;
        for (let k = 0; k < sb.pts.length; k++) {
          const p = sb.pts[k], rx = sb.rest[k * 2] * (1 + Math.min(0.6, c.age / 200)), ry = sb.rest[k * 2 + 1] * Math.max(0.35, 1 - c.age / 120);
          p.x += (cx + rx - p.x) * 0.05; p.y += (cy + ry - p.y) * 0.05;
        }
        sb.cx = cx; sb.cy = cy;
      }
      stepLegs(world, rig, c.age);
      // Keep the gameplay anchor on the remains for culling and melting.
      const anchor = rig.pts[0] ?? rig.soft?.pts[0] ?? rig.chains[0]?.pts[0];
      if (anchor) { e.x = Math.round(anchor.x); e.y = Math.round(anchor.y + 4); }
    }
    if (e.kind === 'weaver') stepWeaverCorpse(world, e, c.age);
    if (e.body) {
      // Chain bodies: the head drops (or floats up, belly-first) and the spine follows.
      const head = e.body.nodes[0];
      const hx = head.x + (head.x - head.previousX) * 0.9, hy = head.y + (wet ? -0.15 : 0.5);
      const hy2 = solidAt(world, hx, hy + head.radius) ? head.y : hy;
      tickChain(world, e.body, hx, hy2, wet, ctx.state.frameCount, e.kind === 'rillback' && wet);
      e.x = Math.round(head.x); e.y = Math.round(head.y + 4);
    }
    // Flies find the dead within a few seconds (within sight of the wizard).
    if (c.age === 150 && ctx.critters?.spawn && e.kind !== 'wisp' && e.kind !== 'imp' &&
        Math.abs(e.x - ctx.player.x) < 320 && Math.abs(e.y - ctx.player.y) < 200) {
      const flies = e.kind === 'leviathan' || e.kind === 'golem' ? 3 : 2;
      for (let f = 0; f < flies; f++) ctx.critters.spawn('fly', e.x + (f - 1) * 3, e.y - 6 - f * 2);
    }
    if (c.age >= c.ttl) { meltCorpse(ctx, c); list.splice(i, 1); }
  }
}
