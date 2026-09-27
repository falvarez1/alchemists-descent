import type { Critter, Ctx } from '@/core/types';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import { corpses, scavengeCorpse } from '@/creatures/corpses';
import type { OrganismHost } from './common';
import { isHot, organismEvent, playerGap, projectileWithin } from './common';
import { BALL_REST, CRAWL, CRAWL_STEP_TICKS } from './types';

/**
 * WALL CRAWLERS — isopods (Rot Gardens) and ember beetles (Kiln Heart). They
 * walk the cave's real surface cell by cell with a hand on the wall (floor,
 * wall, ceiling, around every corner), stop to test the air with their
 * antennae, and drift toward carrion. Touched, shot or blasted, an isopod
 * rolls into an armoured ball that falls and bounces under gravity, lies
 * still until the coast is clear, then unrolls and finds the wall again.
 *
 * Ember beetles graze coal seams (a grazed Coal cell becomes Ash and the
 * beetle's belly brightens), shrug off fire, fizzle in water, and die as a
 * little pop of real embers.
 */

type Vec = readonly [number, number];
const rotR = (v: Vec): Vec => [-v[1], v[0]];
const rotL = (v: Vec): Vec => [v[1], -v[0]];

function blocked(ctx: Ctx, x: number, y: number, ember: boolean): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return true;
  const t = w.types[w.idx(x, y)];
  if (blocksEntity(t) || isLiquid(t)) return true;
  return !ember && isHot(t);
}

function isWall(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  return !w.inBounds(x, y) || blocksEntity(w.types[w.idx(x, y)]);
}

/** Re-attach to the nearest wall after a fall: prefer the floor under it. */
function attach(ctx: Ctx, c: Critter): boolean {
  const x = Math.floor(c.x), y = Math.floor(c.y);
  if (isWall(ctx, x, y)) return false;
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
    if (!isWall(ctx, x + dx, y + dy)) continue;
    c.anchorX = x; c.anchorY = y; c.nx = -dx; c.ny = -dy;
    return true;
  }
  return false;
}

function curl(ctx: Ctx, c: Critter, vx: number, vy: number): void {
  if (c.state === CRAWL.BALL) { c.vx += vx; c.vy += vy; return; }
  c.state = CRAWL.BALL; c.stateT = 0;
  c.vx = vx + (c.nx ?? 0) * 0.3; c.vy = vy + (c.ny ?? 0) * 0.3;
  organismEvent(ctx, c.kind, 'curl', c.x, c.y); // plates folding: audio/EventCues
}

/** A kick's gust or a near-miss blast: an isopod balls up and is thrown. */
export function shoveCrawler(ctx: Ctx, c: Critter, vx: number, vy: number): void {
  curl(ctx, c, vx, vy);
}

function emberDeath(ctx: Ctx, c: Critter, wet: boolean): void {
  const w = ctx.world, x = Math.floor(c.x), y = Math.floor(c.y);
  if (wet) {
    if (w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Empty) { w.replaceCellAt(w.idx(x, y - 1), Cell.Steam, packRGB(190, 196, 200)); w.life[w.idx(x, y - 1)] = 120; }
    ctx.particles.burst(c.x, c.y, 5, null, () => packRGB(200, 205, 210), 0.8, { grav: -0.04 });
    ctx.audio.sizzle(c.x, c.y);
  } else {
    // It dies as what it was full of: a pop of real embers.
    let n = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, -1]] as const) {
      if (n >= 2 || !w.inBounds(x + dx, y + dy) || w.types[w.idx(x + dx, y + dy)] !== Cell.Empty) continue;
      w.replaceCellAt(w.idx(x + dx, y + dy), Cell.Ember, packRGB(255, 120, 30)); n++;
    }
    ctx.particles.burst(c.x, c.y, 6, null, () => packRGB(255, 160, 50), 1.2, { glow: 2, grav: 0.04 });
    ctx.audio.sfx('organism.emberbeetle.pop', c.x, c.y);
  }
  organismEvent(ctx, c.kind, 'die', c.x, c.y);
}

export function stepCrawler(ctx: Ctx, c: Critter, _host: OrganismHost): boolean {
  const ember = c.kind === 'emberbeetle';
  const w = ctx.world, t = ctx.state.frameCount;
  const xi = Math.floor(c.x), yi = Math.floor(c.y);
  if (!w.inBounds(xi, yi)) return false;
  const here = w.types[w.idx(xi, yi)];
  // Grid deaths: lava, acid; fire for the isopod; water for the ember beetle.
  if (here === Cell.Lava || here === Cell.Acid || (!ember && (here === Cell.Fire || here === Cell.Ember))) {
    ctx.particles.burst(c.x, c.y, 3, null, () => packRGB(140, 120, 90), 0.8, { grav: 0.04 });
    organismEvent(ctx, c.kind, 'die', c.x, c.y);
    return false;
  }
  if (ember && here === Cell.Water) { emberDeath(ctx, c, true); return false; }
  c.stateT = (c.stateT ?? 0) + 1;
  c.phase += 0.13;
  if ((c.meal ?? 0) > 0) c.meal = (c.meal ?? 0) - 1;
  const state = c.state ?? CRAWL.WALK;

  if (state === CRAWL.BALL || state === CRAWL.UNCURL) {
    if (state === CRAWL.UNCURL) {
      c.extent = Math.max(0, (c.extent ?? 1) - 0.05);
      if ((c.extent ?? 0) <= 0) {
        if (attach(ctx, c)) { c.state = CRAWL.WALK; c.stateT = 0; } else { c.state = CRAWL.BALL; c.extent = 1; }
      }
      return true;
    }
    c.extent = Math.min(1, (c.extent ?? 0) + 0.25);
    const wet = isLiquid(here);
    c.vy += wet ? 0.03 : 0.16;
    c.vx *= wet ? 0.9 : 0.995; c.vy *= wet ? 0.9 : 1;
    // Integrate with a bounce; a ball on the floor rolls downhill.
    const nx = c.x + c.vx, ny = c.y + c.vy;
    if (!isWall(ctx, Math.floor(nx), yi)) c.x = nx; else c.vx *= -0.45;
    if (!isWall(ctx, Math.floor(c.x), Math.floor(ny))) c.y = ny;
    else {
      // A ball that lands hard knocks on the stone (an isopod's plates; an ember beetle's shell).
      if (c.vy > 1.2) {
        if (ember) ctx.audio.skitter(c.x, c.y);
        else ctx.audio.sfx('organism.isopod.roll', c.x, c.y, { gain: Math.min(1.3, 0.5 + c.vy * 0.25) });
      }
      c.vy *= -0.35;
      c.vx *= 0.9;
      const fx = Math.floor(c.x), fy = Math.floor(c.y);
      if (!isWall(ctx, fx + 1, fy + 1) && isWall(ctx, fx - 1, fy + 1)) c.vx += 0.05;
      else if (!isWall(ctx, fx - 1, fy + 1) && isWall(ctx, fx + 1, fy + 1)) c.vx -= 0.05;
    }
    c.facing = c.vx < 0 ? -1 : 1;
    const still = Math.abs(c.vx) + Math.abs(c.vy) < 0.08;
    if (!still) c.stateT = Math.min(c.stateT ?? 0, 10);
    if (still && (c.stateT ?? 0) > BALL_REST && playerGap(ctx, c.x, c.y) > 16) { c.state = CRAWL.UNCURL; c.stateT = 0; }
    return true;
  }

  // ---- WALK / FEED ----
  const ax = c.anchorX ?? xi, ay = c.anchorY ?? yi;
  c.anchorX = ax; c.anchorY = ay;
  const hand = c.facing >= 0 ? 1 : -1;
  const n: Vec = [c.nx ?? 0, c.ny ?? -1];
  // Lost its wall (dug away, a door opened): it falls as a ball.
  let touching = false;
  for (let dy = -1; dy <= 1 && !touching; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isWall(ctx, ax + dx, ay + dy)) { touching = true; break; }
  if (!touching || isWall(ctx, ax, ay)) { curl(ctx, c, 0, 0.2); return true; }
  // Touched, or a bolt close by: an isopod curls. (Ember beetles scuttle instead.)
  if ((t + ax) % 2 === 0 && !ember && (playerGap(ctx, c.x, c.y) < 2.5 || projectileWithin(ctx, c.x, c.y, 3.5))) {
    curl(ctx, c, (c.x - ctx.player.x) * 0.02, -0.6);
    return true;
  }
  const wall: Vec = [-n[0], -n[1]];
  let d: Vec = hand > 0 ? rotL(wall) : rotR(wall);

  // Carrion: drift toward remains, then stop and feed.
  if (state === CRAWL.FEED || (t + ay) % 30 === 0) {
    let best = -1, bd = ember ? 0 : 75;
    const list = corpses();
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      if (k.world !== w || k.age < 60) continue;
      const dd = Math.hypot(k.e.x - c.x, k.e.y - 3 - c.y);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best >= 0) {
      const k = list[best];
      if (bd < 6) {
        if (c.state !== CRAWL.FEED) organismEvent(ctx, c.kind, 'scavenge', c.x, c.y);
        c.state = CRAWL.FEED;
        if ((c.stateT ?? 0) % 16 === 0) {
          ctx.particles.burst(c.x, c.y, 1, null, () => packRGB(120, 40, 40), 0.4, { grav: 0.05 });
          if (!scavengeCorpse(k, 4)) { c.state = CRAWL.WALK; c.stateT = 0; }
        }
        return true;
      }
      // Face the long way round less often than the short: turn about if it lies behind.
      const dot = (k.e.x - c.x) * d[0] + (k.e.y - 3 - c.y) * d[1];
      if (dot < -2 && (c.stateT ?? 0) > 40) { c.facing = -hand; c.stateT = 0; return true; }
    } else if (state === CRAWL.FEED) { c.state = CRAWL.WALK; c.stateT = 0; }
  }

  // Idle life: every so often it stops and tests the air.
  const pause = ((t + (ax * 13 + ay * 7)) % 420) < 50;
  const cadence = ember ? CRAWL_STEP_TICKS + 2 : CRAWL_STEP_TICKS;
  if (!pause && (c.stateT ?? 0) % cadence === 0) {
    if (entityRandom() < 0.004) { c.facing = -hand; return true; }
    const side = hand > 0 ? rotR(d) : rotL(d), other = hand > 0 ? rotL(d) : rotR(d);
    let moved = true;
    if (!blocked(ctx, ax + side[0], ay + side[1], ember)) d = side;
    else if (!blocked(ctx, ax + d[0], ay + d[1], ember)) { /* straight on */ }
    else if (!blocked(ctx, ax + other[0], ay + other[1], ember)) d = other;
    else { c.facing = -hand; moved = false; }
    if (moved) {
      c.anchorX = ax + d[0]; c.anchorY = ay + d[1];
      const s2 = hand > 0 ? rotR(d) : rotL(d);
      // Only a wall actually beside it redefines "down"; past a convex edge the
      // old normal holds for one more step, so the next step wraps the corner.
      if (isWall(ctx, c.anchorX + s2[0], c.anchorY + s2[1])) { c.nx = -s2[0]; c.ny = -s2[1]; }
      // Ember beetles graze the coal they walk on.
      if (ember && (c.meal ?? 0) < 200) {
        const gx = c.anchorX - (c.nx ?? 0), gy = c.anchorY - (c.ny ?? 0);
        if (w.inBounds(gx, gy) && w.types[w.idx(gx, gy)] === Cell.Coal && entityRandom() < 0.08) {
          w.replaceCellAt(w.idx(gx, gy), Cell.Ash, packRGB(70, 66, 62));
          ctx.audio.sfx('organism.emberbeetle.crunch', gx + 0.5, gy + 0.5);
          c.meal = 900;
          ctx.particles.spawn(gx + 0.5, gy + 0.5, 0, -0.3, null, packRGB(255, 150, 40), 20, { glow: 2, grav: -0.01 });
        }
      }
    }
  }
  // Presentation position eases toward the cell, pressed against its wall.
  const tx = (c.anchorX ?? ax) + 0.5 - (c.nx ?? 0) * 0.3, ty = (c.anchorY ?? ay) + 0.5 - (c.ny ?? 0) * 0.3;
  c.x += (tx - c.x) * 0.3; c.y += (ty - c.y) * 0.3;
  c.vx = 0; c.vy = 0;
  return true;
}

export { emberDeath };
