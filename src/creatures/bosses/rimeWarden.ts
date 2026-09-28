import type { Ctx, Enemy, EnemyDamageSource, EnemyDef } from '@/core/types';
import { PLAYER_HALF_W } from '@/core/types';
import { clamp } from '@/core/math';
import { entityRandom } from '@/core/simRandom';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import { packRGB, snowColor, waterColor } from '@/sim/colors';
import { sightClear } from '@/creatures/perception';
import type { BossBrain, BossHost, BossMove, BossSense } from './types';
import { bossPhaseFor, ensureBossBrain } from './types';

/**
 * THE RIME WARDEN — the Cold Store's guardian: the refrigeration wing's old
 * night-watchman automaton, frozen to its post so long that it grew a hide of
 * rime. Six plates of real-looking ice armour it has to lose before it can be
 * hurt properly; the whole fight is getting them OFF.
 *
 * While the rime holds, blows GLANCE (a third of the damage, an icy plink and
 * a shimmer — the ward tells you so every time). Two ways through:
 *
 * - THAW it: heat on its body — fire, lava or embers touching it (a lit coal
 *   pit it stands in, oil set alight on it) — melts a plate every ~1.3 s it
 *   lasts. The plate runs off as real meltwater. (It cannot catch fire as a
 *   status: a burn would skip the rime. The Ice-House sinks coal pits in its
 *   floor for the purpose.)
 * - SHATTER it: one heavy blow (a blast, a flung body, a big bolt) cracks a
 *   plate off outright; and while it is FROZEN (a frost shard, nitrogen, a
 *   wade through the brine gutters — its own cold makes it brittle) any
 *   honest hit will.
 *
 * Losing a plate staggers it (a kneel you can punish). Bare, it takes blows
 * a little harder. Its moves, each telegraphed on the clock that fires it:
 * SLAM (fists overhead, then a ring of ice spikes out of the floor), STOMP
 * (rime waves racing along the floor — jump them; they freeze the water they
 * cross), HAIL (a fan of frost bolts torn off its shoulders) and, from the
 * second phase, FROST BREATH (a long inhale, then a cone that turns water to
 * ice, dusts every ledge with snow and freezes you where you stand — brine
 * never freezes: the gutters are the one safe water). Its roar into the second
 * phase brings the ceiling's icicles down.
 *
 * Only what the player caused hurts it (core/bossWard): heat and cold the
 * world supplies count only while he is engaged, as for the Kiln.
 */

export const RIME = {
  PLATES: 6,
  /** A blow on intact rime keeps this share. */
  GLANCE_MUL: 0.3,
  /** One blow this hard cracks a plate off outright. */
  SHATTER_HIT: 14,
  /** While frozen (brittle), a blow this hard does. */
  BRITTLE_HIT: 3,
  /** Ticks of heat on its body that melt one plate. */
  THAW_TICKS: 80,
  /** The kneel after a plate goes: its blows land whole, and the rime re-sets (no plate can go) till it rises. */
  STAGGER: 70,
  EXPOSED_MUL: 1.6,
  BARE_MUL: 1.25,
  SLAM_DUR: 74, SLAM_HIT: 30, SLAM_R: 16, SLAM_DMG: 15, SLAM_REACH: 34,
  STOMP_DUR: 66, STOMP_HIT: 32, WAVE_SPEED: [1.3, 1.6, 2.0] as const, WAVE_LIFE: 70, WAVE_DMG: 12,
  HAIL_DUR: 64, HAIL_HIT: 32,
  BREATH_DUR: 98, BREATH_START: 42, BREATH_END: 76, BREATH_R: 76, BREATH_HALF: 0.42, BREATH_DMG: 6,
  ROAR_DUR: 72,
  SPEED: [0.4, 0.48, 0.58] as const,
  RECOVER: [90, 70, 50] as const,
} as const;

/** The last slam's ice spikes: they stand for a while, then crumble (one ring at a time). */
const SPIKES = new WeakMap<Enemy, { cells: number[]; until: number }>();
const SPIKE_TICKS = 300;

function crumbleSpikes(ctx: Ctx, e: Enemy): void {
  const rec = SPIKES.get(e);
  if (!rec) return;
  SPIKES.delete(e);
  const w = ctx.world;
  let n = 0;
  for (const i of rec.cells) {
    if (w.types[i] !== Cell.Ice) continue;
    w.clearCellAt(i);
    if ((n++ & 3) === 0) {
      const x = i % w.width, y = (i / w.width) | 0;
      ctx.particles.spawn(x + 0.5, y + 0.5, (entityRandom() - 0.5) * 0.6, -0.3 - entityRandom() * 0.4, null, RIME_WHITE(), 18, { glow: 0.5, grav: 0.06 });
    }
  }
}

/** Its own spikes break under it as it walks into them (it never climbs its own ring). */
function trampleSpikes(ctx: Ctx, e: Enemy, def: EnemyDef, cells: number[]): void {
  const w = ctx.world;
  for (const i of cells) {
    if (w.types[i] !== Cell.Ice) continue;
    const x = i % w.width, y = (i / w.width) | 0;
    if (Math.abs(x - e.x) > def.halfW + 2 || y > e.y + 1 || y < e.y - def.h) continue;
    w.clearCellAt(i);
    if (entityRandom() < 0.3) ctx.particles.spawn(x + 0.5, y + 0.5, (entityRandom() - 0.5) * 0.8, -0.4, null, RIME_WHITE(), 16, { glow: 0.5, grav: 0.06 });
  }
}

const RIME_WHITE = (): number => packRGB(214 + ((entityRandom() * 30) | 0), 232 + ((entityRandom() * 20) | 0), 250);

function begin(ctx: Ctx, e: Enemy, b: BossBrain, move: BossMove, dur: number): void {
  b.lastMove = b.move === 'march' ? b.lastMove : b.move;
  b.move = move;
  b.moveT = 0;
  b.moveDur = dur;
  ctx.events.emit('bossMove', { kind: e.kind, move, phase: b.phase, x: e.x, y: e.y });
}

function face(e: Enemy): number {
  return e.mind?.facing ?? 1;
}

/** Floor surface (first open cell above solid) near (x, y); null over a gap. */
function floorAt(ctx: Ctx, x: number, y: number, span = 7): number | null {
  const w = ctx.world, xi = Math.floor(x);
  for (let yy = Math.floor(y) - span; yy <= Math.floor(y) + span; yy++) {
    if (!w.inBounds(xi, yy) || !w.inBounds(xi, yy + 1)) continue;
    const here = w.types[w.idx(xi, yy)], below = w.types[w.idx(xi, yy + 1)];
    if (!blocksEntity(here) && !isLiquid(here) && blocksEntity(below)) return yy;
  }
  return null;
}

/**
 * Heat on the body: fire, lava or embers in (or just around) its box, and a
 * lit coal bed under its feet. The lowest rows are read cell by cell (a pit's
 * flame licks the feet), the rest every other row.
 */
function heatOnBody(ctx: Ctx, e: Enemy, def: EnemyDef): number {
  const w = ctx.world;
  let n = 0;
  for (let dy = -2; dy <= def.h + 1; dy += dy < 4 ? 1 : 2) {
    for (let dx = -def.halfW - 1; dx <= def.halfW + 1; dx += 2) {
      const X = Math.floor(e.x + dx), Y = Math.floor(e.y - dy);
      if (!w.inBounds(X, Y)) continue;
      const i = w.idx(X, Y), t = w.types[i];
      if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember || (t === Cell.Coal && w.life[i] > 0)) n++;
    }
  }
  return n;
}

/** Brittle: frozen (a frost shard, nitrogen, a wade in the brine) — its own cold works against it. */
export function rimeBrittle(e: Enemy): boolean {
  return e.status.frozen > 0;
}

/** Damage multiplier once the rime is off (the exposed kneel, the bare body). */
export function rimeDamageScale(e: Enemy): number {
  const b = e.boss;
  if (!b || b.plates > 0) return 1;
  return (b.exposed > 0 ? RIME.EXPOSED_MUL : 1) * RIME.BARE_MUL;
}

/** Throw a plate off the body as real ice and meltwater, and stagger. */
function losePlate(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain, how: 'shattered' | 'thawed'): void {
  if (b.plates <= 0) return;
  b.plates--;
  b.heat = 0;
  b.quenchCd = RIME.STAGGER; // the rime re-sets while it kneels
  b.selfHarmUntil = ctx.state.frameCount + 20; // its own tumbling ice is not a blow
  const w = ctx.world;
  const side = entityRandom() < 0.5 ? -1 : 1;
  const px = e.x + side * def.halfW * 0.6, py = e.y - def.h * (0.4 + entityRandom() * 0.4);
  if (how === 'shattered') {
    // The plate bursts into glittering shards and a chunk that tumbles away.
    ctx.particles.burst(px, py, 22, Cell.Ice, RIME_WHITE, 3.0, { glow: 0.8 });
    const body = ctx.rigidBodies?.spawn?.({ kind: 'box', halfW: 3, halfH: 2 }, px, py, {
      density: 0.9, color: packRGB(176, 214, 240), restitution: 0.25, friction: 0.5,
      vx: side * (1.6 + entityRandom() * 1.4), vy: -2.2 - entityRandom(), va: (entityRandom() - 0.5) * 0.6, tag: 'gore-chunk',
    });
    if (body) body.goreTtl = 900;
    ctx.audio.sfx('creature.rimewarden.shatter', px, py);
  } else {
    // The plate slumps off as real meltwater and a hiss of steam.
    let n = 0;
    for (let k = 0; k < 40 && n < 18; k++) {
      const X = Math.floor(px + (entityRandom() - 0.5) * 8), Y = Math.floor(py + (entityRandom() - 0.5) * 6);
      if (!w.inBounds(X, Y) || w.types[w.idx(X, Y)] !== Cell.Empty) continue;
      w.replaceCellAt(w.idx(X, Y), Cell.Water, waterColor());
      n++;
    }
    ctx.particles.burst(px, py - 2, 12, null, () => packRGB(214, 220, 226), 1.2, { grav: -0.03 });
    ctx.audio.sfx('creature.rimewarden.thaw', px, py);
  }
  ctx.events.emit('combatCallout', { x: e.x, y: e.y - def.h - 8, text: how === 'shattered' ? 'SHATTERED' : 'THAWED', tone: 'brass' });
  host.shakeAt(e.x, e.y, 0.03, 0.06);
  if (b.plates === 0) {
    ctx.events.emit('combatCallout', { x: e.x, y: e.y - def.h - 18, text: 'THE RIME IS OFF', tone: 'finisher' });
  }
  // The stagger: a kneel, its chest open.
  b.exposed = RIME.STAGGER;
  b.waves.length = 0;
  begin(ctx, e, b, 'quench', RIME.STAGGER);
  e.attackCd = Math.max(e.attackCd, RIME.STAGGER);
}

/**
 * A blow landing on the Warden (the enemy system calls this after the ward has
 * allowed it). Returns the damage that actually lands: intact rime glances,
 * a heavy or brittle hit cracks a plate off (and lands whole), bare stone is
 * the multiplier's.
 */
export function rimeWardenHit(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, amount: number, source: EnemyDamageSource): number {
  const b = ensureBossBrain(e);
  if (b.plates <= 0) return source === 'direct' ? amount * rimeDamageScale(e) : amount;
  const brittle = rimeBrittle(e);
  if (b.quenchCd <= 0 && (amount >= RIME.SHATTER_HIT || (brittle && amount >= RIME.BRITTLE_HIT))) {
    losePlate(ctx, e, def, host, b, 'shattered');
    return amount;
  }
  // The punish windows (a kneel, its fists in the floor): the blow lands whole.
  if (b.exposed > 0) {
    ctx.particles.burst(e.x, e.y - def.h * 0.55, 4, null, RIME_WHITE, 1.6, { glow: 1.6, grav: 0.02 });
    return amount;
  }
  // Glance: say so every time, in ice.
  ctx.particles.burst(e.x, e.y - def.h * 0.6, 3, null, RIME_WHITE, 1.2, { glow: 1.4, grav: -0.01 });
  host.voice(e, () => ctx.audio.sfx('creature.rimewarden.glance', e.x, e.y));
  return amount * RIME.GLANCE_MUL;
}

/* ------------------------------------------------------------------ moves */

/** SLAM: fists overhead, then a ring of real ice spikes out of the floor. */
function slam(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const t = b.moveT, f = face(e), w = ctx.world;
  if (t > 1 && t < RIME.SLAM_HIT && t % 5 === 0) {
    ctx.particles.spawn(e.x + f * def.halfW * 0.8, e.y - def.h - 3, (entityRandom() - 0.5) * 0.3, 0.3, null, RIME_WHITE(), 30, { grav: 0.04, glow: 0.4 });
  }
  if (t !== RIME.SLAM_HIT) return;
  const cx = e.x + f * (def.halfW + 6);
  const surf = floorAt(ctx, cx, e.y, 8) ?? Math.floor(e.y);
  crumbleSpikes(ctx, e);
  const cells: number[] = [];
  // Spikes rise from the floor in a ring, tallest at the fists.
  for (let dx = -RIME.SLAM_R; dx <= RIME.SLAM_R; dx += 2) {
    const X = Math.floor(cx + dx), s = floorAt(ctx, X, surf, 4);
    if (s === null) continue;
    // Never under its own feet (it would stand on its own spikes).
    if (Math.abs(X - e.x) <= def.halfW + 2) continue;
    const hgt = Math.max(1, Math.round((1 - Math.abs(dx) / (RIME.SLAM_R + 1)) * 7));
    for (let k = 0; k < hgt; k++) {
      if (!w.inBounds(X, s - k) || w.types[w.idx(X, s - k)] !== Cell.Empty) break;
      if (Math.abs(ctx.player.x - X) <= PLAYER_HALF_W + 1 && s - k <= ctx.player.y + 1 && s - k >= ctx.player.y - 17) break;
      w.replaceCellAt(w.idx(X, s - k), Cell.Ice, k === hgt - 1 ? packRGB(226, 242, 252) : packRGB(150, 200, 236));
      cells.push(w.idx(X, s - k));
    }
  }
  SPIKES.set(e, { cells, until: ctx.state.frameCount + SPIKE_TICKS });
  ctx.particles.burst(cx, surf - 2, 20, null, RIME_WHITE, 2.4, { glow: 0.6, grav: 0.05 });
  ctx.audio.sfx('creature.rimewarden.slam', cx, surf);
  host.shakeAt(e.x, e.y, 0.04, 0.07);
  ctx.events.emit('creatureSignal', { x: cx, y: surf, radius: 240, strength: 1, kind: 'vibration' });
  const p = ctx.player;
  if (!p.dead && Math.abs(p.x - cx) < RIME.SLAM_R + 3 && Math.abs(p.y - surf) < 12) {
    ctx.playerCtl.damage(RIME.SLAM_DMG * (e.dmgK ?? 1), Math.sign(p.x - cx || f) * 3.4, -3.2, 'rimewarden-slam');
  }
  b.exposed = Math.max(b.exposed, 24); // fists in the ground: the punish window
}

/** STOMP: rime waves race along the floor both ways (jump them); they freeze the water they cross. */
function stomp(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  if (b.moveT !== RIME.STOMP_HIT) return;
  for (const dir of [-1, 1]) b.waves.push({ x: e.x + dir * def.halfW, y: e.y, dir, life: RIME.WAVE_LIFE, hit: false });
  host.shakeAt(e.x, e.y, 0.045, 0.08);
  ctx.audio.sfx('creature.rimewarden.stomp', e.x, e.y);
  ctx.events.emit('creatureSignal', { x: e.x, y: e.y, radius: 300, strength: 1, kind: 'vibration' });
}

function stepWaves(ctx: Ctx, e: Enemy, b: BossBrain): void {
  const speed = RIME.WAVE_SPEED[b.phase - 1] ?? RIME.WAVE_SPEED[0];
  const p = ctx.player, w = ctx.world;
  for (let i = b.waves.length - 1; i >= 0; i--) {
    const wv = b.waves[i];
    wv.life--;
    wv.x += wv.dir * speed;
    const surf = floorAt(ctx, wv.x, wv.y);
    if (wv.life <= 0 || surf === null || blocksEntity(w.type(Math.floor(wv.x), surf - 3))) { b.waves.splice(i, 1); continue; }
    wv.y = surf;
    // The wave front: a ridge of rime and frost smoke you can read and time.
    for (let k = 0; k < 3; k++) {
      ctx.particles.spawn(wv.x - wv.dir * k * 0.6, surf - k * 0.8, wv.dir * 0.2 + (entityRandom() - 0.5) * 0.4, -0.7 - entityRandom() - k * 0.2,
        null, RIME_WHITE(), 20 + k * 4, { grav: 0.04, glow: 0.5 });
    }
    // It freezes water it crosses (brine refuses), and frosts the floor.
    for (let dy = 1; dy <= 3; dy++) {
      const X = Math.floor(wv.x), Y = surf + dy;
      if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === Cell.Water) w.replaceCellAt(w.idx(X, Y), Cell.Ice, packRGB(170, 214, 244));
    }
    if ((wv.life & 3) === 0) {
      const X = Math.floor(wv.x);
      if (w.inBounds(X, surf) && w.types[w.idx(X, surf)] === Cell.Empty && w.types[w.idx(X, surf + 1)] !== Cell.Brine) {
        w.replaceCellAt(w.idx(X, surf), Cell.Snow, snowColor());
      }
    }
    if (!wv.hit && !p.dead && p.grounded && Math.abs(p.x - wv.x) < PLAYER_HALF_W + 2.5 && Math.abs(p.y - surf) < 5) {
      wv.hit = true;
      ctx.playerCtl.damage(RIME.WAVE_DMG * (e.dmgK ?? 1), wv.dir * 1.6, -3.2, 'rimewarden-wave');
      p.status.frozen = Math.max(p.status.frozen, 50);
    }
  }
}

/** HAIL: tear ice off its shoulders and throw it as a fan of frost bolts. */
function hail(ctx: Ctx, e: Enemy, def: EnemyDef, b: BossBrain): void {
  const t = b.moveT, f = face(e), p = ctx.player;
  if (t === 1) { b.aimX = p.x + p.vx * 16; b.aimY = p.y - 9; }
  if (t > 6 && t < RIME.HAIL_HIT && t % 4 === 0) {
    ctx.particles.spawn(e.x + f * def.halfW * 0.5, e.y - def.h - 1, (entityRandom() - 0.5) * 0.3, -0.3, null, RIME_WHITE(), 18, { glow: 0.8, grav: 0.02 });
  }
  if (t !== RIME.HAIL_HIT) return;
  const x0 = e.x + f * def.halfW * 0.6, y0 = e.y - def.h + 2;
  const base = Math.atan2(b.aimY - y0, b.aimX - x0);
  const n = b.phase >= 3 ? 5 : 3;
  for (let k = 0; k < n; k++) {
    const a = base + (k - (n - 1) / 2) * 0.16;
    ctx.projectiles.push({ x: x0, y: y0, vx: Math.cos(a) * 3.0, vy: Math.sin(a) * 3.0, type: 'frostbolt', life: 200, age: 0, charging: false, hostile: true, source: 'rimewarden-hail' });
  }
  ctx.audio.sfx('creature.rimewarden.hail', x0, y0);
}

/** FROST BREATH: a long inhale (the tell), then a cone that freezes what it touches. */
function breath(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const t = b.moveT, w = ctx.world, p = ctx.player;
  const mx = e.x + face(e) * def.halfW * 0.7, my = e.y - def.h * 0.78;
  if (t < RIME.BREATH_START) {
    // The inhale: frost smoke drawn in toward its mouth from all round.
    if (t === 1) { b.aimX = p.x; b.aimY = p.y - 8; }
    if (t % 2 === 0) {
      const a = entityRandom() * Math.PI * 2, r = 18 + entityRandom() * 14;
      ctx.particles.spawn(mx + Math.cos(a) * r, my + Math.sin(a) * r, -Math.cos(a) * 0.9, -Math.sin(a) * 0.9, null, RIME_WHITE(), 18, { glow: 0.4, grav: 0 });
    }
    return;
  }
  if (t === RIME.BREATH_START) {
    ctx.audio.sfx('creature.rimewarden.breath', mx, my);
    host.shakeAt(e.x, e.y, 0.02, 0.05);
  }
  if (t > RIME.BREATH_END) return;
  const aim = Math.atan2(b.aimY - my, b.aimX - mx);
  // The cone: a spray of frost you can see, and the cold it leaves in the cells.
  for (let k = 0; k < 6; k++) {
    const a = aim + (entityRandom() - 0.5) * RIME.BREATH_HALF * 2, s = 2.2 + entityRandom() * 1.6;
    ctx.particles.spawn(mx, my, Math.cos(a) * s, Math.sin(a) * s, null, RIME_WHITE(), 26, { glow: 0.5, grav: 0 });
  }
  if (t % 3 === 0) {
    for (let k = 0; k < 24; k++) {
      const a = aim + (entityRandom() - 0.5) * RIME.BREATH_HALF * 2, r = 6 + entityRandom() * RIME.BREATH_R;
      const X = Math.floor(mx + Math.cos(a) * r), Y = Math.floor(my + Math.sin(a) * r);
      if (!w.inBounds(X, Y) || !sightClear(w, mx, my, X, Y)) continue;
      const i = w.idx(X, Y), c = w.types[i];
      if (c === Cell.Water) w.replaceCellAt(i, Cell.Ice, packRGB(176, 218, 246));
      else if (c === Cell.Empty && w.inBounds(X, Y + 1) && blocksEntity(w.types[w.idx(X, Y + 1)]) && w.types[w.idx(X, Y + 1)] !== Cell.Brine && entityRandom() < 0.4) {
        w.replaceCellAt(i, Cell.Snow, snowColor());
      }
    }
  }
  if (!p.dead && t % 10 === 0) {
    const dx = p.x - mx, dy = p.y - 8 - my, d = Math.hypot(dx, dy);
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - aim), Math.cos(Math.atan2(dy, dx) - aim)));
    if (d < RIME.BREATH_R && off < RIME.BREATH_HALF && sightClear(w, mx, my, p.x, p.y - 8)) {
      p.status.frozen = Math.max(p.status.frozen, 90);
      if (t % 20 === 0) ctx.playerCtl.damage(RIME.BREATH_DMG * (e.dmgK ?? 1), Math.cos(aim) * 1.2, -0.4, 'rimewarden-breath');
    }
  }
}

/** ROAR: the phase turns; into the second, the ceiling's icicles come down. */
function roar(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  if (b.moveT !== 1) return;
  ctx.audio.duck(0.5, 1100);
  host.shakeAt(e.x, e.y, 0.05, 0.08);
  ctx.particles.burst(e.x, e.y - def.h + 2, 30, null, RIME_WHITE, 2.6, { glow: 0.8, grav: -0.01 });
  const w = ctx.world;
  // Shake the icicles loose: every ice cell hanging free over the lair falls as real ice.
  let dropped = 0;
  for (let dx = -80; dx <= 80 && dropped < 40; dx += 2) {
    for (let dy = 20; dy <= 90; dy++) {
      const X = Math.floor(e.x + dx), Y = Math.floor(e.y - dy);
      if (!w.inBounds(X, Y) || !w.inBounds(X, Y + 1)) break;
      const i = w.idx(X, Y);
      if (w.types[i] !== Cell.Ice || w.types[w.idx(X, Y + 1)] !== Cell.Empty) continue;
      if (entityRandom() > 0.35) break;
      const color = w.colors[i];
      w.clearCellAt(i);
      ctx.particles.spawn(X + 0.5, Y + 0.5, (entityRandom() - 0.5) * 0.3, 0.2, Cell.Ice, color, 240, { grav: 0.14, deposit: true, hostileDmg: 5, hostileSource: 'rimewarden-icicle' });
      dropped++;
      break;
    }
  }
}

/* ------------------------------------------------------------------ brain */

export function tickRimeWarden(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, s: BossSense): void {
  const b = ensureBossBrain(e);
  if (b.plates > RIME.PLATES) b.plates = RIME.PLATES;
  e.vy += 0.36;
  e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
  stepWaves(ctx, e, b);
  const spikes = SPIKES.get(e);
  if (spikes && ctx.state.frameCount >= spikes.until) crumbleSpikes(ctx, e);
  else if (spikes && e.timer % 3 === 0) trampleSpikes(ctx, e, def, spikes.cells);
  if (b.exposed > 0) b.exposed--;
  if (e.grounded && !e.prevG) {
    host.shakeAt(e.x, e.y, 0.018, 0.045);
    host.voice(e, () => ctx.audio.hollowKnock(), 600);
  }
  e.prevG = e.grounded;

  // THAW: heat the player brought (the ward decides) melts a plate at a time
  // (none while it kneels: the rime re-sets).
  if (b.quenchCd > 0) b.quenchCd--;
  const heat = heatOnBody(ctx, e, def);
  if (b.plates > 0 && heat >= 2 && b.quenchCd <= 0 && host.worldHarm(e)) {
    b.heat += 1;
    if (ctx.state.frameCount % 4 === 0) {
      ctx.particles.spawn(e.x + (entityRandom() - 0.5) * def.halfW * 2, e.y - entityRandom() * def.h, (entityRandom() - 0.5) * 0.3, -0.6,
        null, packRGB(214, 220, 226), 22, { grav: -0.03 });
      // Meltwater weeps off the thawing rime.
      if (entityRandom() < 0.35) {
        const X = Math.floor(e.x + (entityRandom() - 0.5) * def.halfW * 2), Y = Math.floor(e.y - 2);
        if (ctx.world.inBounds(X, Y) && ctx.world.types[ctx.world.idx(X, Y)] === Cell.Empty) ctx.world.replaceCellAt(ctx.world.idx(X, Y), Cell.Water, waterColor());
      }
    }
    if (b.heat >= RIME.THAW_TICKS) losePlate(ctx, e, def, host, b, 'thawed');
  } else if (b.heat > 0) b.heat = Math.max(0, b.heat - 0.25);
  // Brittle (frozen): a hoar of frost glitters over it — hit it now.
  if (rimeBrittle(e) && b.plates > 0 && ctx.state.frameCount % 6 === 0) {
    ctx.particles.spawn(e.x + (entityRandom() - 0.5) * def.halfW * 2, e.y - entityRandom() * def.h, 0, -0.1, null, packRGB(240, 250, 255), 14, { glow: 1.6, grav: 0 });
  }

  // Phase turns are events: it roars.
  const phase = bossPhaseFor(e.hp / e.maxHp);
  if (phase > b.phase && b.move !== 'quench') {
    b.phase = phase;
    begin(ctx, e, b, 'roar', RIME.ROAR_DUR);
  }

  const busy = b.move !== 'march';
  const close = Math.abs(s.pdx) < def.halfW + 8;
  if (busy || host.introducing(e)) e.vx *= 0.6;
  else if (s.targetAlive && !close && e.timer % 2 === 0) e.vx += Math.sign(s.pdx) * 0.06;
  else if (close) e.vx *= 0.7;
  const p = ctx.player;
  if (!p.dead && Math.abs(p.x - e.x) < def.halfW + PLAYER_HALF_W - 1 && p.y > e.y - def.h && p.y < e.y + 4) {
    const dir = Math.sign(p.x - e.x) || -face(e);
    if (e.timer % 6 === 0) ctx.playerCtl.applyImpulse(dir * 1.3, -0.5);
  }
  // Frozen stiff (brittle), it lumbers at half speed.
  const cap = (RIME.SPEED[b.phase - 1] ?? RIME.SPEED[0]) * (e.status.frozen > 0 ? 0.5 : 1);
  e.vx = clamp(e.vx, -cap, cap);
  // Cold breath off its shoulders.
  if (ctx.state.frameCount % 7 === 0) {
    ctx.particles.spawn(e.x + (entityRandom() - 0.5) * def.halfW * 1.4, e.y - def.h + 1, (entityRandom() - 0.5) * 0.3, -0.25, null, RIME_WHITE(), 26, { glow: 0.3, grav: 0.005 });
  }

  if (busy) {
    b.moveT++;
    switch (b.move) {
      case 'slam': slam(ctx, e, def, host, b); break;
      case 'stomp': stomp(ctx, e, def, host, b); break;
      case 'throw': hail(ctx, e, def, b); break;
      case 'vent': breath(ctx, e, def, host, b); break;
      case 'roar': roar(ctx, e, def, host, b); break;
      default: break;
    }
    if (b.moveT >= b.moveDur) {
      b.lastMove = b.move;
      b.move = 'march';
      b.moveT = 0;
      e.attackCd = (RIME.RECOVER[b.phase - 1] ?? RIME.RECOVER[0]) + Math.floor(entityRandom() * 30);
    }
    return;
  }
  if (!s.canAttack || e.attackCd > 0 || host.introducing(e)) return;

  const d = Math.abs(s.pdx), P = b.phase;
  let next: BossMove | null = null;
  // Close: the slam (a stomp between two). Mid-range: stomp and hail take
  // turns (a hail after every stomp; otherwise a coin toss). From the second
  // phase the breath can come at any range it reaches.
  if (P >= 2 && b.lastMove !== 'vent' && d < 110 && entityRandom() < 0.35) next = 'vent';
  else if (d < RIME.SLAM_REACH && Math.abs(s.pdy) < 30) next = b.lastMove === 'slam' && e.grounded ? 'stomp' : 'slam';
  else if (d < 300 && host.hasAttackLine(e, def) && (b.lastMove === 'stomp' || !e.grounded || d >= 150 || entityRandom() < 0.45)) next = 'throw';
  else if (d < 150 && e.grounded) next = 'stomp';
  if (!next) return;
  const dur = next === 'slam' ? RIME.SLAM_DUR : next === 'stomp' ? RIME.STOMP_DUR : next === 'throw' ? RIME.HAIL_DUR : RIME.BREATH_DUR;
  if (e.mind) e.mind.facing = Math.sign(s.pdx) || e.mind.facing;
  begin(ctx, e, b, next, dur);
}

/** The Warden's death: it comes apart into a heap of real ice and snow. */
export function rimeWardenDeathHeap(ctx: Ctx, e: Enemy, def: EnemyDef): void {
  const w = ctx.world;
  crumbleSpikes(ctx, e);
  // The real floor under it: the first footing at or below its feet.
  let floor = Math.floor(e.y);
  for (let yy = Math.floor(e.y) - 2; yy < Math.floor(e.y) + 24; yy++) {
    if (!w.inBounds(Math.floor(e.x), yy + 1)) break;
    if (blocksEntity(w.types[w.idx(Math.floor(e.x), yy + 1)]) && !blocksEntity(w.types[w.idx(Math.floor(e.x), yy)])) { floor = yy; break; }
  }
  const half = def.halfW + 4;
  for (let dx = -half; dx <= half; dx++) {
    const k = 1 - Math.abs(dx) / (half + 1);
    const hgt = Math.round(Math.pow(k, 0.8) * 10);
    for (let dy = 0; dy < hgt; dy++) {
      const X = Math.floor(e.x + dx), Y = floor - dy;
      if (!w.inBounds(X, Y) || w.types[w.idx(X, Y)] !== Cell.Empty) continue;
      const i = w.idx(X, Y);
      if (dy >= hgt - 2) w.replaceCellAt(i, Cell.Snow, snowColor());
      else w.replaceCellAt(i, Cell.Ice, dy === 0 ? packRGB(96, 158, 214) : packRGB(150 + ((X * 7) % 30), 200, 236));
    }
  }
  for (let k = 0; k < 6; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const body = ctx.rigidBodies?.spawn?.({ kind: 'box', halfW: 2 + (k % 3), halfH: 2 + (k % 2) }, e.x + side * (2 + k * 2), e.y - def.h * 0.7, {
      density: 0.9, color: packRGB(170, 212, 240), restitution: 0.25, friction: 0.5,
      vx: side * (1.5 + entityRandom() * 2.2), vy: -3 - entityRandom() * 2, va: (entityRandom() - 0.5) * 0.7, tag: 'gore-chunk',
    });
    if (body) body.goreTtl = 1200;
  }
  ctx.particles.burst(e.x, e.y - def.h * 0.5, 50, null, RIME_WHITE, 4.0, { glow: 1.2, grav: 0.02 });
}
