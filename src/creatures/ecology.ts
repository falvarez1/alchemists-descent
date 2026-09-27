import type { Critter, Ctx, Enemy } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { sightClear } from './perception';
import { nodeImmersion } from './body';
import type { Corpse } from './corpses';
import { corpses, scavengeCorpse } from './corpses';

/** Surface skimming and current drag are separate from pursuit: dry targets
 * do not give an immersed animal lift, and a strong sluice can carry it away. */
export function carryRillback(ctx: Ctx, enemy: Enemy): void {
  const x = enemy.x + enemy.fx, y = enemy.y - 4 + enemy.fy;
  const immersion = nodeImmersion(ctx.world, x, y);
  if ((enemy.rillWet ?? 0) >= .28 && (enemy.swoop ?? 0) === 0) {
    const above = nodeImmersion(ctx.world, x, y - 6);
    if (above < 1) {
      enemy.vy += (1 - above) * .22;
      if (enemy.vy < 0) enemy.vy *= .75;
    }
  }
  const strength = .065 * immersion;
  enemy.vx += (ctx.world.flow.x(x, y) - enemy.vx * .35) * strength;
  enemy.vy += ctx.world.flow.y(x, y) * strength;
}

/** Pool predation consumes an existing resident, never a decorative duplicate. */
export function rillbackPrey(ctx: Ctx, enemy: Enemy): Critter | null {
  if (!enemy.mind || enemy.mind.hunger < .18 || enemy.mind.intent !== 'forage' || (enemy.rillWet ?? 0) < .28) return null;
  let best: Critter | null = null, distance = 130 * 130;
  for (const prey of ctx.critters.list) {
    if (prey.kind !== 'fish' || ctx.world.type(Math.round(prey.x), Math.round(prey.y)) !== Cell.Water) continue;
    const d = (prey.x - enemy.x) ** 2 + (prey.y - enemy.y + 4) ** 2;
    if (d >= distance || !sightClear(ctx.world, enemy.x, enemy.y - 4, prey.x, prey.y)) continue;
    best = prey; distance = d;
  }
  return best;
}

export function feedRillback(ctx: Ctx, enemy: Enemy, prey: Critter): boolean {
  if (!enemy.mind || Math.hypot(prey.x - enemy.x, prey.y - enemy.y + 4) > 9 || !ctx.critters.list.includes(prey)) return false;
  ctx.critters.remove(prey);
  enemy.mind.hunger = .06;
  enemy.mind.intent = 'rest';
  enemy.mind.commitUntil = ctx.state.frameCount + 150;
  enemy.rillFeedT = 80;
  enemy.attackCd = Math.max(enemy.attackCd, 90);
  enemy.vx *= .35; enemy.vy *= .35;
  return true;
}

/** The lash hits only when the rendered tendril reaches its committed endpoint. */
export function advanceRootLash(ctx: Ctx, enemy: Enemy, canDamage = true): void {
  if (!enemy.rootLashT) return;
  enemy.rootLashT--;
  if (enemy.rootLashT === 5 && canDamage && enemy.rootLashX !== undefined && enemy.rootLashY !== undefined) {
    const x = enemy.rootLashX, y = enemy.rootLashY;
    if (!ctx.player.dead && Math.hypot(ctx.player.x - x, ctx.player.y - 9 - y) < 10 &&
        Math.hypot(x - enemy.x, y - enemy.y + 7) < 66 && sightClear(ctx.world, enemy.x, enemy.y - 7, x, y)) {
      ctx.playerCtl.damage(13 * (enemy.dmgK ?? 1), Math.sign(x - enemy.x || 1) * 3.2, -1.8, 'rootloper-lash');
    }
  }
  if (enemy.rootLashT === 0) { enemy.rootLashX = undefined; enemy.rootLashY = undefined; }
}

/* ------------------------------------------------------------------------
 * Visible ecology (WS-N): lures, scavengers, flock scatter.
 *
 * A lure is anything a forager can notice from where it stands: fresh
 * remains, a glowseed's glow, a swarm of moths circling a light. Predators
 * that are not busy with the alchemist drift toward the lures they care
 * about — which is what makes a lure a tool: lead the moths (your lantern)
 * past a sleeping roost, leave a corpse where you want the slimes, drop a
 * glowseed beside a snapjaw.
 * ---------------------------------------------------------------------- */

/** How far a slime smells remains; how close it must be to feed. */
export const SCAVENGE_RANGE = 110;
export const SCAVENGE_REACH = 7;
/** A moth swarm is at least this many moths inside SWARM_RADIUS of each other. */
export const SWARM_MIN = 3;
export const SWARM_RADIUS = 22;
/** How far a roosting or hunting bat notices a swarm. */
export const BAT_SWARM_RANGE = 170;

/** Nearest remains worth eating within `radius` that the creature can see (not ghosts, not stone). */
export function scavengeTarget(ctx: Ctx, e: Enemy, radius = SCAVENGE_RANGE): Corpse | null {
  let best: Corpse | null = null, bd = radius;
  for (const c of corpses()) {
    if (c.world !== ctx.world || c.age < 30 || c.e === e) continue;
    const k = c.e.kind;
    if (k === 'wisp' || k === 'imp' || k === 'golem' || k === 'colossus' || k === 'bomber') continue;
    const d = Math.hypot(c.e.x - e.x, c.e.y - e.y);
    if (d >= bd || !sightClear(ctx.world, e.x, e.y - 4, c.e.x, c.e.y - 3)) continue;
    best = c; bd = d;
  }
  return best;
}

/** The centre of the densest moth swarm within `range` of (x, y), or null. */
export function mothSwarm(ctx: Ctx, x: number, y: number, range = BAT_SWARM_RANGE): { x: number; y: number; n: number } | null {
  let best: { x: number; y: number; n: number } | null = null;
  const list = ctx.critters.list;
  for (const a of list) {
    if ((a.kind !== 'moth' && a.kind !== 'ashmoth') || a.heldBy || Math.abs(a.x - x) > range || Math.abs(a.y - y) > range) continue;
    let n = 0, sx = 0, sy = 0;
    for (const b of list) {
      if (b.kind !== a.kind || b.heldBy) continue;
      if (Math.abs(b.x - a.x) < SWARM_RADIUS && Math.abs(b.y - a.y) < SWARM_RADIUS) { n++; sx += b.x; sy += b.y; }
    }
    if (n >= SWARM_MIN && (!best || n > best.n)) best = { x: sx / n, y: sy / n, n };
  }
  return best;
}

/**
 * A slime that is not hunting goes to remains it can smell and eats them:
 * it settles over the body, the body goes (faster than it would rot), and the
 * slime is healed and fattened for it. Returns the hop target x, or null.
 */
export function slimeForage(ctx: Ctx, e: Enemy): { x: number; feeding: boolean } | null {
  const c = scavengeTarget(ctx, e);
  if (!c) { e.scavengeT = 0; return null; }
  const d = Math.hypot(c.e.x - e.x, c.e.y - e.y);
  if (d > SCAVENGE_REACH) return { x: c.e.x, feeding: false };
  e.scavengeT = (e.scavengeT ?? 0) + 1;
  if (e.scavengeT % 20 === 0) {
    const left = scavengeCorpse(c, 30);
    e.hp = Math.min(e.maxHp, e.hp + 3);
    ctx.particles.burst(e.x, e.y - 3, 3, null, () => packRGB(120, 30, 34), 0.6, { grav: 0.05 });
    ctx.audio.at(e.x, e.y, () => ctx.audio.squelch(e.x, e.y), 220);
    if (e.scavengeT === 20) ctx.events.emit('organism', { kind: e.kind, action: 'scavenge', x: e.x, y: e.y });
    if (!left) e.scavengeT = 0;
  }
  return { x: c.e.x, feeding: true };
}

/** Bats roost together and panic together: one waking scatters its roost-mates. */
export function scatterRoost(ctx: Ctx, woke: Enemy, radius = 22): number {
  let n = 0;
  for (const b of ctx.enemies) {
    if (b === woke || b.kind !== 'bat' || !b.sleeping || b.hp <= 0) continue;
    if (Math.abs(b.x - woke.x) > radius || Math.abs(b.y - woke.y) > radius) continue;
    b.sleeping = false;
    // Every direction but together: a burst of wings out of the roost.
    const a = (n * 2.39996 + woke.bobPhase) % (Math.PI * 2);
    b.vx = Math.cos(a) * 1.6;
    b.vy = 0.7 + Math.abs(Math.sin(a)) * 0.8;
    b.attackCd = Math.max(b.attackCd, 40 + n * 12); // they scatter before they come back for you
    n++;
  }
  if (n > 0) ctx.events.emit('organism', { kind: 'bat', action: 'scatter', x: woke.x, y: woke.y });
  return n;
}

/**
 * An idle imp hunts the ash moths that ride the Kiln's updraft: the nearest one
 * within 70 cells is its target; within 4 it is eaten (a puff of ash and a
 * brighter ember glow). Returns the moth still being chased, or null.
 */
export function impSnack(ctx: Ctx, e: Enemy): Critter | null {
  let best: Critter | null = null, bd = 70;
  for (const c of ctx.critters.list) {
    if (c.kind !== 'ashmoth' || c.heldBy) continue;
    const d = Math.hypot(c.x - e.x, c.y - (e.y - 5));
    if (d < bd) { bd = d; best = c; }
  }
  if (best && bd < 4) {
    ctx.critters.remove(best);
    ctx.particles.burst(best.x, best.y, 5, null, () => packRGB(255, 170, 70), 0.8, { glow: 2, grav: -0.02 });
    ctx.events.emit('organism', { kind: 'imp', action: 'eat', x: best.x, y: best.y });
    return null;
  }
  return best;
}
