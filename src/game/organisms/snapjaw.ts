import type { Critter, Ctx, Enemy } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { corpses, removeCorpse } from '@/creatures/corpses';
import type { OrganismHost } from './common';
import { critterWithin, enemyWithin, hotNear, organismEvent, playerGap, projectileWithin, solidAt } from './common';
import {
  SNAP, SNAP_BITE, SNAP_BURN, SNAP_IGNITE, SNAP_DIGEST, SNAP_DMG_CREATURE, SNAP_DMG_PLAYER, SNAP_HP, SNAP_TELL, SNAP_TRIGGER, SNAPJAW_PREY,
} from './types';

/**
 * SNAPJAW — an ambush plant: a hinged, toothed pod on a muscular stalk, its
 * throat glowing a faint coal-red to draw the curious. Anything that brushes
 * it (a beetle, a bat, a slime, the alchemist) earns a TELL — the pod
 * shivers and leans toward it for a beat — then the SNAP. Small things are
 * swallowed and the jaw stays shut while it digests (a safe window you can
 * buy by feeding it: kick a corpse or a critter in). Bigger things are bitten
 * and shoved away. It can be burned (flame against the stalk chars it
 * through: it collapses to ash), shot, or blasted.
 */

/** The pod's hinge: the stalk tip, leaning toward whatever it is tracking. */
export function snapjawHead(c: Critter): { x: number; y: number } {
  const ax = (c.anchorX ?? c.x) + 0.5, ay = (c.anchorY ?? c.y) + 0.5;
  const nx = c.nx ?? 0, ny = c.ny ?? -1, reach = c.reach ?? 6;
  const lean = c.vx; // the tracking lean lives in vx/vy (sessile bodies do not integrate)
  const sway = Math.sin(c.phase * 0.7) * 0.7;
  return { x: ax + nx * reach + (-ny) * sway + lean, y: ay + ny * reach + nx * sway + c.vy };
}

function charTo(ctx: Ctx, c: Critter, cell: number): void {
  const ax = c.anchorX ?? c.x, ay = c.anchorY ?? c.y, nx = c.nx ?? 0, ny = c.ny ?? -1;
  const w = ctx.world;
  for (let k = 0; k < 4; k++) {
    const X = Math.floor(ax + nx * k), Y = Math.floor(ay + ny * k);
    if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === Cell.Empty) w.replaceCellAt(w.idx(X, Y), cell, cell === Cell.Ash ? packRGB(92, 88, 80) : packRGB(70, 96, 44));
  }
}

function dieBurnt(ctx: Ctx, c: Critter): void {
  const { x, y } = snapjawHead(c);
  charTo(ctx, c, Cell.Ash);
  ctx.particles.burst(x, y, 14, null, () => packRGB(255, 176, 40), 1.6, { glow: 2.2, grav: -0.03 });
  ctx.audio.sfx('organism.snapjaw.burn', x, y);
  organismEvent(ctx, 'snapjaw', 'die', x, y);
}

function dieTorn(ctx: Ctx, c: Critter): void {
  const { x, y } = snapjawHead(c);
  charTo(ctx, c, Cell.Fungus);
  ctx.particles.burst(x, y, 12, Cell.Slime, () => packRGB(110, 150, 60), 2.2);
  ctx.audio.sfx('organism.snapjaw.tear', x, y);
  organismEvent(ctx, 'snapjaw', 'die', x, y);
}

type Target = { kind: 'player' } | { kind: 'enemy'; e: Enemy } | { kind: 'critter'; c: Critter } | { kind: 'corpse'; i: number };

function findTarget(ctx: Ctx, c: Critter, host: OrganismHost, x: number, y: number, r: number): Target | null {
  if (playerGap(ctx, x, y) <= r) return { kind: 'player' };
  const e = enemyWithin(ctx, x, y, r);
  if (e) return { kind: 'enemy', e };
  const prey = critterWithin(host, c, x, y, r, SNAPJAW_PREY);
  if (prey) return { kind: 'critter', c: prey };
  const list = corpses();
  for (let i = 0; i < list.length; i++) {
    const k = list[i];
    if (k.world !== ctx.world || k.age < 20) continue;
    if (Math.hypot(k.e.x - x, k.e.y - 3 - y) <= r) return { kind: 'corpse', i };
  }
  return null;
}

function targetPoint(ctx: Ctx, t: Target): { x: number; y: number } {
  if (t.kind === 'player') return { x: ctx.player.x, y: ctx.player.y - 8 };
  if (t.kind === 'enemy') return { x: t.e.x, y: t.e.y - ctx.enemyCtl.defs[t.e.kind].h * 0.5 };
  if (t.kind === 'critter') return { x: t.c.x, y: t.c.y };
  const k = corpses()[t.i];
  return k ? { x: k.e.x, y: k.e.y - 3 } : { x: 0, y: 0 };
}

export function stepSnapjaw(ctx: Ctx, c: Critter, host: OrganismHost): boolean {
  const ax = c.anchorX ?? Math.floor(c.x), ay = c.anchorY ?? Math.floor(c.y);
  const nx = c.nx ?? 0, ny = c.ny ?? -1;
  if (!solidAt(ctx, ax - nx, ay - ny) || solidAt(ctx, ax, ay)) { dieTorn(ctx, c); return false; }
  c.hp ??= SNAP_HP;
  c.phase += 0.025;
  c.stateT = (c.stateT ?? 0) + 1;
  const t = ctx.state.frameCount;
  let head = snapjawHead(c);
  c.x = head.x; c.y = head.y;

  // FIRE: flame against the stalk or pod catches, and a caught plant burns
  // like the green wood it is — writing real flame along itself (which can
  // spread) until it is charred through, unless water puts it out.
  if ((t + ax) % 3 === 0) {
    const mx = (ax + head.x) / 2, my = (ay + head.y) / 2;
    const hot = hotNear(ctx, mx, my, 2.5);
    const alight = (c.gasp ?? 0) >= SNAP_IGNITE;
    if (hot > 0 || alight) {
      c.gasp = (c.gasp ?? 0) + (alight ? 1 : Math.min(4, hot));
      if (c.state !== SNAP.SNAP && c.state !== SNAP.TELL) { c.state = SNAP.TELL; c.stateT = 0; } // it thrashes
      if (alight && t % 6 === 0) {
        const k = ((t / 6) | 0) % 5 / 5, fx = Math.floor(ax + (head.x - ax) * k), fy = Math.floor(ay + (head.y - ay) * k) - 1;
        const w = ctx.world;
        if (w.inBounds(fx, fy)) {
          const cell = w.types[w.idx(fx, fy)];
          if (cell === Cell.Water || cell === Cell.Steam) c.gasp = Math.max(0, (c.gasp ?? 0) - 12); // doused
          else if (cell === Cell.Empty) { const i = w.idx(fx, fy); w.replaceCellAt(i, Cell.Fire, packRGB(255, 120, 30)); w.life[i] = 22; }
        }
        ctx.particles.spawn(head.x, head.y, 0, -0.4, null, packRGB(255, 140, 40), 16, { glow: 1.8, grav: -0.02 });
      }
    } else if ((c.gasp ?? 0) > 0) c.gasp = (c.gasp ?? 0) - 1;
    if ((c.gasp ?? 0) >= SNAP_BURN) { dieBurnt(ctx, c); return false; }
  }
  // BOLTS: a shot through the pod wounds it (and it snaps at the air, reflexively).
  const shot = projectileWithin(ctx, head.x, head.y, 3.2);
  if (shot && !shot.hostile && (c.stateT ?? 0) > 2 && c.state !== SNAP.SNAP) {
    c.hp -= 9;
    ctx.particles.burst(head.x, head.y, 5, Cell.Slime, () => packRGB(120, 160, 70), 1.4);
    if (c.hp <= 0) { dieTorn(ctx, c); return false; }
    c.state = SNAP.SNAP; c.stateT = 0;
  }

  const state = c.state ?? SNAP.OPEN;
  let gape = c.extent ?? 1;
  // The tracking lean relaxes unless a tell is pulling it toward prey.
  c.vx *= 0.85; c.vy *= 0.85;
  if (state === SNAP.OPEN) {
    gape += (1 - gape) * 0.08;
    if ((t + ay) % 2 === 0) {
      const target = findTarget(ctx, c, host, head.x, head.y, SNAP_TRIGGER);
      if (target) {
        c.state = SNAP.TELL; c.stateT = 0;
        const p = targetPoint(ctx, target);
        c.holds = target.kind === 'critter' ? target.c.id : undefined;
        c.vx = Math.max(-2, Math.min(2, (p.x - head.x) * 0.35));
        c.vy = Math.max(-2, Math.min(2, (p.y - head.y) * 0.35));
        // The warning: the pod shivers open with a wet creak before it strikes.
        ctx.audio.sfx('organism.snapjaw.tell', head.x, head.y);
      }
    }
  } else if (state === SNAP.TELL) {
    // ANTICIPATION: the pod shivers, gapes wider and leans in.
    gape = Math.min(1.25, gape + 0.03);
    const target = findTarget(ctx, c, host, head.x, head.y, SNAP_TRIGGER + 2);
    if (target) {
      const p = targetPoint(ctx, target);
      c.vx += ((p.x - head.x) * 0.35 - c.vx) * 0.3;
      c.vy += ((p.y - head.y) * 0.35 - c.vy) * 0.3;
    }
    if ((c.stateT ?? 0) >= SNAP_TELL) { c.state = SNAP.SNAP; c.stateT = 0; }
  } else if (state === SNAP.SNAP) {
    // COMMIT: the lunge carries the pod out along its lean, the jaw slams shut.
    gape = Math.max(0, gape - 0.45);
    c.vx *= 1.6; c.vy *= 1.6;
    c.vx = Math.max(-3, Math.min(3, c.vx)); c.vy = Math.max(-3, Math.min(3, c.vy));
    if ((c.stateT ?? 0) === 2) {
      head = snapjawHead(c);
      organismEvent(ctx, 'snapjaw', 'snap', head.x, head.y); // the clack: audio/EventCues
      const target = findTarget(ctx, c, host, head.x, head.y, SNAP_BITE);
      let fed = 0;
      if (target?.kind === 'player') {
        const dx = ctx.player.x - head.x;
        ctx.playerCtl.damage(SNAP_DMG_PLAYER, Math.sign(dx || -ny || 1) * 2.6, -1.8, 'snapjaw-bite');
      } else if (target?.kind === 'enemy') {
        const e = target.e, dx = e.x - head.x;
        ctx.enemyCtl.damage(e, SNAP_DMG_CREATURE, Math.sign(dx || 1) * 1.8, -1.2, 'impaled');
        e.fear = Math.max(e.fear ?? 0, 0.9);
        if (e.hp <= 0) fed = SNAP_DIGEST;
      } else if (target?.kind === 'critter') {
        host.remove(target.c);
        fed = SNAP_DIGEST;
      } else if (target?.kind === 'corpse') {
        const k = corpses()[target.i];
        if (k) { removeCorpse(k); fed = SNAP_DIGEST * 1.5; }
      }
      if (fed > 0) {
        c.meal = fed;
        ctx.particles.burst(head.x, head.y, 6, Cell.Blood, () => packRGB(150, 30, 34), 1.2);
        organismEvent(ctx, 'snapjaw', 'eat', head.x, head.y);
      }
    }
    if ((c.stateT ?? 0) >= 5) { c.state = (c.meal ?? 0) > 0 ? SNAP.CHEW : SNAP.REOPEN; c.stateT = 0; }
  } else if (state === SNAP.CHEW) {
    gape = 0.04 + Math.max(0, Math.sin((c.stateT ?? 0) * 0.22)) * 0.06;
    c.meal = (c.meal ?? 0) - 1;
    if ((c.stateT ?? 0) % 40 === 0) ctx.audio.sfx('organism.snapjaw.chew', head.x, head.y);
    if ((c.meal ?? 0) <= 0) { c.meal = 0; c.state = SNAP.REOPEN; c.stateT = 0; }
  } else {
    gape += (1 - gape) * 0.03;
    if ((c.stateT ?? 0) > 70) { c.state = SNAP.OPEN; c.stateT = 0; }
  }
  c.extent = gape;
  return true;
}
