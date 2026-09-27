import type { Ctx, Enemy, EnemyDef } from '@/core/types';
import { PLAYER_HALF_W } from '@/core/types';
import { clamp } from '@/core/math';
import { entityRandom } from '@/core/simRandom';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import { emberColor, lavaColor, packRGB, sandColor, stoneColor } from '@/sim/colors';
import type { BossBrain, BossHost, BossMove, BossSense } from './types';
import { BOSS_WORLD_GRACE, bossPhaseFor, ensureBossBrain } from './types';

/**
 * THE KILN COLOSSUS — the final boss, a furnace that walks.
 *
 * Three phases (by health): above 66% it marches, SLAMS what comes close and
 * THROWS molten gobs at what keeps its distance, with the odd STOMP. Below 66%
 * it roars, starts VENTING its heat (a ring of real fire that also boils any
 * water near it — it defends against the one thing that can hurt it) and
 * stomps often. Below 33% the armour plates burst off its back (the core is
 * bare: every blow lands harder), its waves run faster, it throws in pairs and
 * its footfalls scorch.
 *
 * WATER is the strategy: a HOT kiln that water reaches (a ceiling tank dug
 * open, a flask, a flood) QUENCHES — thermal shock cracks it for a heavy,
 * readable burst of damage, a cloud of steam, and it kneels with its core split
 * open (a vulnerability window). A cold kiln just hisses: it must reheat
 * before the trick works again. Every attack is telegraphed on the same clock
 * that fires it, and every attack touches real cells.
 *
 * A boss fight is honest (BossBrain): nothing the player did not cause hurts it.
 */

export const COL = {
  /** Slam: telegraph (fists overhead) then the blow; recovery with fists in the ground. */
  SLAM_DUR: 74, SLAM_HIT: 30, SLAM_R: [12, 13, 15] as const, SLAM_REACH: 38,
  /** Stomp: rear up, then both fists down; waves along the floor. */
  STOMP_DUR: 66, STOMP_HIT: 32, WAVE_SPEED: [1.45, 1.75, 2.15] as const, WAVE_LIFE: 62, WAVE_DMG: 14,
  /** Molten throw: the arm reaches into its own furnace, cocks, lobs. */
  THROW_DUR: 64, THROW_HIT: 32, THROW_HIT2: 46, THROW_GRAV: 0.02,
  /** Heat vent: plates open (tell), then a ring of fire and boiling water. */
  VENT_DUR: 98, VENT_START: 42, VENT_END: 76, VENT_R: 17, BOIL_R: 26, VENT_DMG: 8,
  /** Quench: the thermal-shock beat. Share of max health, kneel, cooldown, reheat per tick. */
  QUENCH_DUR: 160, QUENCH_SHARE: 0.11, QUENCH_CD: 380, REHEAT: 1 / 480, QUENCH_HEAT: 0.6,
  /** Damage taken while kneeling (exposed) and once the plates are gone. */
  EXPOSED_MUL: 1.6, BARE_MUL: 1.25,
  ROAR_DUR: 72,
  /** Death: kneel, cracks flicker, the core overloads, the kiln comes apart. */
  DEATH_DUR: 214, DEATH_OVERLOAD: 128, DEATH_BLAST: 196,
  /** March speed cap by phase (cells/tick before pacing). */
  SPEED: [0.42, 0.5, 0.62] as const,
  /** Cooldown after a move, by phase (plus up to 30 random ticks). */
  RECOVER: [84, 62, 44] as const,
} as const;

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

/** Floor surface (first open cell above solid) near (x, y), searching ±span; null over a gap. */
function floorAt(ctx: Ctx, x: number, y: number, span = 7): number | null {
  const w = ctx.world, xi = Math.floor(x);
  for (let yy = Math.floor(y) - span; yy <= Math.floor(y) + span; yy++) {
    if (!w.inBounds(xi, yy) || !w.inBounds(xi, yy + 1)) continue;
    const here = w.types[w.idx(xi, yy)], below = w.types[w.idx(xi, yy + 1)];
    if (!blocksEntity(here) && !isLiquid(here) && blocksEntity(below)) return yy;
  }
  return null;
}

function countWaterNear(ctx: Ctx, x: number, y: number, r: number): number {
  const w = ctx.world;
  let n = 0;
  for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) {
    const X = Math.floor(x + dx), Y = Math.floor(y + dy);
    if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === Cell.Water) n++;
  }
  return n;
}

/** Damage multiplier for a blow landing on the colossus now. */
export function colossusDamageScale(e: Enemy): number {
  const b = e.boss;
  if (!b) return 1;
  return (b.exposed > 0 ? COL.EXPOSED_MUL : 1) * (b.plates <= 0 ? COL.BARE_MUL : 1);
}

/* ------------------------------------------------------------------ waves */

function launchWave(e: Enemy, b: BossBrain, x: number, dir: number): void {
  b.waves.push({ x, y: e.y, dir, life: COL.WAVE_LIFE, hit: false });
}

function stepWaves(ctx: Ctx, e: Enemy, b: BossBrain): void {
  const speed = COL.WAVE_SPEED[b.phase - 1] ?? COL.WAVE_SPEED[0];
  const p = ctx.player, w = ctx.world;
  for (let i = b.waves.length - 1; i >= 0; i--) {
    const wv = b.waves[i];
    wv.life--;
    wv.x += wv.dir * speed;
    const surf = floorAt(ctx, wv.x, wv.y);
    // A wave runs on real floor: a gap, a pool or a wall ends it.
    if (wv.life <= 0 || surf === null || blocksEntity(w.type(Math.floor(wv.x), surf - 3))) { b.waves.splice(i, 1); continue; }
    wv.y = surf;
    // The floor ripples: loose grains jump, dust kicks up in a running line.
    const xi = Math.floor(wv.x), gi = w.idx(xi, surf + 1), g = w.types[gi];
    if ((g === Cell.Sand || g === Cell.Ash || g === Cell.Gold || g === Cell.Snow || g === Cell.Coal) && w.types[w.idx(xi, surf)] === Cell.Empty) {
      const color = w.colors[gi];
      w.clearCellAt(gi);
      ctx.particles.spawn(xi + 0.5, surf, wv.dir * 0.3, -1.2 - entityRandom() * 0.8, g, color, 60, { grav: 0.08 });
    }
    ctx.particles.spawn(wv.x, surf, wv.dir * 0.2 + (entityRandom() - 0.5) * 0.4, -0.7 - entityRandom() * 0.9, null, packRGB(150, 132, 110), 24, { grav: 0.06 });
    if (b.phase >= 3 && (wv.life & 1) === 0) ctx.particles.spawn(wv.x, surf, 0, -0.8, null, emberColor(), 18, { glow: 2, grav: -0.01 });
    // It knocks the feet out from under anyone standing on it — jump it.
    if (!wv.hit && !p.dead && p.grounded && Math.abs(p.x - wv.x) < PLAYER_HALF_W + 2.5 && Math.abs(p.y - surf) < 5) {
      wv.hit = true;
      ctx.playerCtl.damage(COL.WAVE_DMG * (e.dmgK ?? 1), wv.dir * 1.6, -3.4, 'colossus-stomp');
    }
  }
}

/* ------------------------------------------------------------------ moves */

function slam(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const t = b.moveT, f = face(e);
  if (t === 1) {
    host.voice(e, () => { ctx.audio.tone(72, 38, 0.6, 'sawtooth', 0.16); ctx.audio.grind(1.2); }, 800);
  }
  if (t > 1 && t < COL.SLAM_HIT && t % 6 === 0) {
    // Dust sifts off the raised fists: the tell has a sound and a shadow.
    ctx.particles.spawn(e.x + f * def.halfW * 0.8, e.y - def.h - 4, (entityRandom() - 0.5) * 0.3, 0.3, null, packRGB(140, 126, 106), 30, { grav: 0.05 });
  }
  if (t === COL.SLAM_HIT) {
    const x = e.x + f * (def.halfW + 10), y = e.y - 1;
    b.selfHarmUntil = ctx.state.frameCount + 3;
    ctx.explosions.trigger(x, y, COL.SLAM_R[b.phase - 1] ?? 12, { playerDamageSource: 'colossus-slam', enemyDamageMul: 0 });
    host.shakeAt(e.x, e.y, 0.04, 0.07);
    ctx.particles.burst(x, y - 2, 18, null, () => packRGB(150, 136, 116), 2.2, { grav: 0.06 });
    ctx.events.emit('creatureSignal', { x, y, radius: 240, strength: 1, kind: 'vibration' });
    b.exposed = Math.max(b.exposed, 26); // fists in the ground: the punish window
  }
}

function stomp(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const t = b.moveT;
  if (t === 1) host.voice(e, () => { ctx.audio.grind(1.4); ctx.audio.tone(55, 90, 0.55, 'sawtooth', 0.14); }, 800);
  if (t === COL.STOMP_HIT) {
    launchWave(e, b, e.x - def.halfW, -1);
    launchWave(e, b, e.x + def.halfW, 1);
    host.shakeAt(e.x, e.y, 0.045, 0.08);
    host.voice(e, () => { ctx.audio.boom(14); ctx.audio.hollowKnock(); }, 900);
    for (const s of [-1, 1]) ctx.particles.burst(e.x + s * def.halfW, e.y - 1, 12, null, () => packRGB(150, 136, 116), 1.8, { grav: 0.06 });
    ctx.events.emit('creatureSignal', { x: e.x, y: e.y, radius: 300, strength: 1, kind: 'vibration' });
  }
}

function lob(ctx: Ctx, e: Enemy, def: EnemyDef, b: BossBrain, tx: number, ty: number): void {
  const f = face(e);
  const x0 = e.x + f * def.halfW * 0.9, y0 = e.y - def.h - 2;
  const dx = tx - x0, dy = ty - y0;
  const T = clamp(Math.abs(dx) / 3.1, 26, 62);
  const g = COL.THROW_GRAV;
  const vx = dx / T, vy = (dy - 0.5 * g * T * T) / T;
  ctx.projectiles.push({ x: x0, y: y0, vx, vy, type: 'fireball', life: 260, age: 0, charging: false, hostile: true, source: 'colossus-fireball' });
  // The gob is real rock-melt: the grains that fly with it land as lava.
  for (let k = 0; k < 9; k++) {
    ctx.particles.spawn(x0 + (entityRandom() - 0.5) * 2, y0 + (entityRandom() - 0.5) * 2, vx * (0.94 + entityRandom() * 0.12),
      vy + (entityRandom() - 0.5) * 0.3, Cell.Lava, lavaColor(), 240, { grav: g, glow: 2.2 });
  }
  void b;
}

function toss(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const t = b.moveT;
  const p = ctx.player;
  if (t === 1) {
    b.aimX = p.x + p.vx * 18; b.aimY = p.y - 6;
    host.voice(e, () => { ctx.audio.tone(90, 150, 0.5, 'sawtooth', 0.12); ctx.audio.flame?.(); }, 800);
  }
  if (t > 8 && t < COL.THROW_HIT && t % 3 === 0) {
    // The fist comes out of the furnace dripping.
    const f = face(e);
    ctx.particles.spawn(e.x + f * def.halfW * 0.6, e.y - def.h * 0.75, (entityRandom() - 0.5) * 0.3, 0.2, null, lavaColor(), 22, { glow: 2.2, grav: 0.08 });
  }
  if (t === COL.THROW_HIT || (b.phase >= 3 && t === COL.THROW_HIT2)) {
    if (t === COL.THROW_HIT2) { b.aimX = p.x + p.vx * 14; b.aimY = p.y - 6; }
    lob(ctx, e, def, b, b.aimX, b.aimY);
    host.voice(e, () => ctx.audio.noiseBurst(0.22, 500, 0.12), 800);
  }
}

function vent(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const t = b.moveT, w = ctx.world;
  const cx = e.x, cy = e.y - def.h * 0.62;
  if (t === 1) host.voice(e, () => { ctx.audio.steam?.(); ctx.audio.tone(48, 70, 1.3, 'sawtooth', 0.14); }, 900);
  if (t < COL.VENT_START) {
    // The tell: plates lift, the chimneys roar white.
    if (t % 3 === 0) {
      for (const s of [-1, 1]) ctx.particles.spawn(cx + s * def.halfW * 0.35, e.y - def.h - 3, s * 0.2, -1.1 - entityRandom() * 0.5, null,
        t > COL.VENT_START - 14 ? packRGB(255, 190, 90) : packRGB(210, 214, 218), 26, { glow: t > COL.VENT_START - 14 ? 2 : 0.4, grav: -0.03 });
    }
    return;
  }
  if (t === COL.VENT_START) {
    host.shakeAt(e.x, e.y, 0.03, 0.06);
    host.voice(e, () => { ctx.audio.flame?.(); ctx.audio.noiseBurst(0.5, 300, 0.16); }, 900);
    b.heat = 1;
    const p = ctx.player;
    if (!p.dead && Math.hypot(p.x - cx, p.y - 8 - cy) < COL.VENT_R + 2) {
      ctx.playerCtl.damage(COL.VENT_DMG * (e.dmgK ?? 1), Math.sign(p.x - cx || 1) * 3.2, -2.2, 'colossus-vent');
    }
  }
  if (t >= COL.VENT_START && t <= COL.VENT_END) {
    if (t % 3 === 0) {
      // A ring of real flame breathes out of the seams.
      for (let k = 0; k < 10; k++) {
        const a = entityRandom() * Math.PI * 2, r = def.halfW * 0.7 + entityRandom() * (COL.VENT_R - def.halfW * 0.4);
        const X = Math.floor(cx + Math.cos(a) * r), Y = Math.floor(cy + Math.sin(a) * r * 0.8);
        if (!w.inBounds(X, Y) || w.types[w.idx(X, Y)] !== Cell.Empty) continue;
        const i = w.idx(X, Y);
        w.replaceCellAt(i, Cell.Fire, packRGB(255, 110 + ((entityRandom() * 90) | 0), 20));
        w.life[i] = 18 + ((entityRandom() * 14) | 0);
      }
      ctx.particles.burst(cx, cy, 6, null, emberColor, 2.4, { glow: 2.4, grav: -0.02 });
    }
    if (t % 6 === 0) {
      // ...and boils the water near it: its one defence against its one weakness.
      let boiled = 0;
      for (let dy = -COL.BOIL_R; dy <= COL.BOIL_R && boiled < 48; dy++) for (let dx = -COL.BOIL_R; dx <= COL.BOIL_R && boiled < 48; dx++) {
        const X = Math.floor(cx + dx), Y = Math.floor(e.y - 4 + dy);
        if (!w.inBounds(X, Y) || w.types[w.idx(X, Y)] !== Cell.Water || (X + Y + t) % 3 !== 0) continue;
        const i = w.idx(X, Y);
        w.replaceCellAt(i, Cell.Steam, packRGB(214, 220, 226));
        w.life[i] = 140;
        boiled++;
      }
      if (boiled > 0) host.voice(e, () => ctx.audio.sizzle(cx, cy), 500);
    }
  }
}

/** Water reached a hot kiln: the thermal-shock beat. */
function quench(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const w = ctx.world;
  const dmg = e.maxHp * COL.QUENCH_SHARE;
  ctx.alchemy?.noteHit(e, 'steeped');
  e.hp -= dmg;
  b.playerDamage += dmg;
  e.flash = Math.max(e.flash, 10);
  b.heat = 0.12;
  b.quenchCd = COL.QUENCH_CD;
  b.exposed = COL.QUENCH_DUR - 10;
  begin(ctx, e, b, 'quench', COL.QUENCH_DUR);
  // The water on it flashes to steam; a cloud rolls off the cracked stone.
  let n = 0;
  for (let dy = -def.h - 4; dy <= 3; dy++) for (let dx = -def.halfW - 4; dx <= def.halfW + 4; dx++) {
    const X = Math.floor(e.x + dx), Y = Math.floor(e.y + dy);
    if (!w.inBounds(X, Y)) continue;
    const i = w.idx(X, Y), c = w.types[i];
    if (c === Cell.Water || (c === Cell.Empty && dy < -def.h * 0.5 && ((X * 5 + Y * 3) & 7) === 0 && n < 90)) {
      w.replaceCellAt(i, Cell.Steam, packRGB(220, 226, 232));
      w.life[i] = 160 + ((X + Y) & 31);
      n++;
    }
  }
  ctx.particles.burst(e.x, e.y - def.h * 0.6, 40, null, () => packRGB(230, 236, 240), 3.2, { glow: 0.5, grav: -0.04 });
  ctx.particles.burst(e.x, e.y - def.h * 0.6, 16, Cell.Stone, stoneColor, 2.6);
  host.shakeAt(e.x, e.y, 0.05, 0.08);
  host.voice(e, () => { ctx.audio.shatter?.(); ctx.audio.sizzle(e.x, e.y); ctx.audio.groan(); ctx.audio.steam?.(); }, 900);
  ctx.events.emit('combatCallout', { x: e.x, y: e.y - def.h - 8, text: 'THERMAL SHOCK', tone: 'brass' });
  e.attackCd = Math.max(e.attackCd, COL.QUENCH_DUR);
}

function roar(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const t = b.moveT;
  if (t === 1) {
    ctx.audio.duck(0.5, 1100);
    host.voice(e, () => { ctx.audio.tone(40, 104, 1.1, 'sawtooth', 0.22); ctx.audio.groan(); ctx.audio.grind(1.3); }, 900);
    host.shakeAt(e.x, e.y, 0.04, 0.07);
    ctx.particles.burst(e.x, e.y - def.h + 2, 30, null, emberColor, 2.8, { glow: 2.4, grav: -0.02 });
    if (!ctx.state.reduceFlashes) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 0.7);
    if (b.phase >= 3 && b.plates > 0) {
      // The armour bursts off its back: the furnace stands bare. (Its own
      // plates tumbling off it are not blows: a second of grace.)
      b.plates = 0;
      b.selfHarmUntil = ctx.state.frameCount + 90;
      for (let k = 0; k < 5; k++) {
        const s = k % 2 === 0 ? -1 : 1;
        const body = ctx.rigidBodies?.spawn?.({ kind: 'box', halfW: 2 + (k % 3), halfH: 2 + ((k + 1) % 2) },
          e.x + s * (3 + k * 2), e.y - def.h + 3, {
            density: 0.9, color: stoneColor(), restitution: 0.2, friction: 0.8,
            vx: s * (1.2 + entityRandom() * 1.6), vy: -2.2 - entityRandom() * 1.5, va: (entityRandom() - 0.5) * 0.5, tag: 'gore-chunk',
          });
        if (body) body.goreTtl = 900;
      }
      ctx.particles.burst(e.x, e.y - def.h + 2, 24, Cell.Stone, stoneColor, 3.2);
      ctx.events.emit('combatCallout', { x: e.x, y: e.y - def.h - 8, text: 'THE CORE IS BARE', tone: 'brass' });
    }
  }
}

/* ------------------------------------------------------------------ death */

function startDeath(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  begin(ctx, e, b, 'dying', COL.DEATH_DUR);
  e.hp = 1; // the sequence owns the body until the kiln comes apart
  e.attackCd = 999;
  e.vx = 0;
  b.waves.length = 0;
  b.exposed = 0;
  ctx.audio.duck(0.45, 2600);
  host.voice(e, () => { ctx.audio.groan(); ctx.audio.tone(80, 34, 1.8, 'sawtooth', 0.2); ctx.audio.grind(1.6); }, 1000);
  host.shakeAt(e.x, e.y, 0.04, 0.07);
  void def;
}

function heapRubble(ctx: Ctx, e: Enemy, def: EnemyDef): void {
  const w = ctx.world;
  const floor = floorAt(ctx, e.x, e.y, 10) ?? Math.floor(e.y);
  const half = def.halfW + 4;
  for (let dx = -half; dx <= half; dx++) {
    const k = 1 - Math.abs(dx) / (half + 1);
    const hgt = Math.round(Math.pow(k, 0.75) * 13);
    for (let dy = 0; dy < hgt; dy++) {
      const X = Math.floor(e.x + dx), Y = floor - dy;
      if (!w.inBounds(X, Y) || w.types[w.idx(X, Y)] !== Cell.Empty) continue;
      const i = w.idx(X, Y);
      // Its heart was molten: the core of the heap is lava, the rest stone and grit.
      if (Math.abs(dx) <= 3 && dy <= 2) w.replaceCellAt(i, Cell.Lava, lavaColor());
      else if (((X * 7 + Y * 13) % 10) < 3) w.replaceCellAt(i, Cell.Sand, sandColor());
      else w.replaceCellAt(i, Cell.Stone, stoneColor());
    }
  }
  for (let k = 0; k < 10; k++) {
    const X = Math.floor(e.x + (entityRandom() - 0.5) * half * 2.6), Y = floor - 14 - ((entityRandom() * 6) | 0);
    if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === Cell.Empty) w.replaceCellAt(w.idx(X, Y), Cell.Ember, emberColor());
  }
}

function tickDeath(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, b: BossBrain): void {
  const t = ++b.moveT;
  e.vx = 0;
  e.attackCd = 999;
  // Cracks gutter and flare: jets of fire and steam from the split stone.
  if (t < COL.DEATH_BLAST && t % (t < COL.DEATH_OVERLOAD ? 9 : 4) === 0) {
    const a = entityRandom() * Math.PI * 2, r = def.halfW * 0.6;
    const x = e.x + Math.cos(a) * r, y = e.y - def.h * 0.55 + Math.sin(a) * r * 0.7;
    const steam = t < COL.DEATH_OVERLOAD && (t / 9) % 2 === 0;
    for (let k = 0; k < 6; k++) {
      ctx.particles.spawn(x, y, Math.cos(a) * (1 + entityRandom()), Math.sin(a) * (1 + entityRandom()) - 0.6, null,
        steam ? packRGB(220, 224, 228) : packRGB(255, 130 + ((entityRandom() * 110) | 0), 30), 26, { glow: steam ? 0.3 : 2.4, grav: -0.02 });
    }
    host.shakeAt(e.x, e.y, 0.012, 0.04);
    if (t % 36 === 0) host.voice(e, () => ctx.audio.sizzle(x, y), 700);
  }
  if (t === COL.DEATH_OVERLOAD) {
    host.voice(e, () => { ctx.audio.tone(60, 260, 1.2, 'sawtooth', 0.18); ctx.audio.tone(120, 520, 1.2, 'square', 0.05); }, 1000);
  }
  if (t > COL.DEATH_OVERLOAD && t < COL.DEATH_BLAST && !ctx.state.reduceFlashes) {
    ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 0.3 + (t - COL.DEATH_OVERLOAD) / (COL.DEATH_BLAST - COL.DEATH_OVERLOAD) * 0.7);
  }
  if (t === COL.DEATH_BLAST) {
    ctx.explosions.trigger(e.x, e.y - def.h * 0.5, 24, { playerDamageSource: 'colossus-death', enemyDamageMul: 0 });
    heapRubble(ctx, e, def);
    for (let k = 0; k < 6; k++) {
      const s = k % 2 === 0 ? -1 : 1;
      const body = ctx.rigidBodies?.spawn?.({ kind: 'box', halfW: 2 + (k % 3), halfH: 2 + (k % 2) },
        e.x + s * (2 + k * 2), e.y - def.h * 0.7, {
          density: 0.9, color: stoneColor(), restitution: 0.22, friction: 0.8,
          vx: s * (1.5 + entityRandom() * 2.5), vy: -3 - entityRandom() * 2.5, va: (entityRandom() - 0.5) * 0.7, tag: 'gore-chunk',
        });
      if (body) body.goreTtl = 1200;
    }
    ctx.particles.burst(e.x, e.y - def.h * 0.5, 50, null, emberColor, 4.4, { glow: 2.8, grav: -0.01 });
    host.shakeAt(e.x, e.y, 0.07, 0.1);
  }
  if (t >= COL.DEATH_DUR && !b.finished) {
    b.finished = true;
    e.hp = 0;
    host.finishDeath(e);
  }
}

/* ------------------------------------------------------------------ brain */

/**
 * Colossus AI for one tick (replaces the old march/slam/volley branch). The
 * shared tail of the enemy loop still integrates `vx/vy`.
 */
export function tickColossus(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost, s: BossSense): void {
  const b = ensureBossBrain(e);
  e.vy += 0.36;
  e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
  if (b.move === 'dying') { tickDeath(ctx, e, def, host, b); return; }
  stepWaves(ctx, e, b);
  if (b.exposed > 0) b.exposed--;
  if (b.quenchCd > 0) b.quenchCd--;

  // Footfalls: a landing shakes the kiln (the old gate), heavier by phase.
  if (e.grounded && !e.prevG) {
    host.shakeAt(e.x, e.y, 0.02, 0.05);
    host.voice(e, () => ctx.audio.hollowKnock(), 640);
  }
  e.prevG = e.grounded;

  // Phase changes are events, not stat bumps: it roars (and in the third, sheds its plates).
  const phase = bossPhaseFor(e.hp / e.maxHp);
  if (phase > b.phase && b.move !== 'quench') {
    b.phase = phase;
    begin(ctx, e, b, 'roar', COL.ROAR_DUR);
  }

  // WATER on a hot kiln: the thermal shock. On a cooling one: a hiss, no harm.
  const wet = e.status.wet > 0;
  if (wet && !b.wasWet) b.wetStart = ctx.state.frameCount;
  // Only water that reaches it after the fight began is the player's doing
  // (a tank a wandering carve pre-opened must not crack it before he arrives).
  // A puddle it was already standing in when the fight began does not count
  // either: the soaking must start after its entrance (a fair first beat).
  const fresh = b.engaged && b.wetStart >= b.engagedAt + BOSS_WORLD_GRACE;
  if (!wet && b.move !== 'quench') b.heat = Math.min(1, b.heat + COL.REHEAT);
  if (wet && fresh && b.heat >= COL.QUENCH_HEAT && b.quenchCd <= 0 && b.move !== 'roar') {
    quench(ctx, e, def, host, b);
    if (e.hp <= 0) { startDeath(ctx, e, def, host, b); return; }
  } else if (wet && ctx.state.frameCount % 5 === 0) {
    ctx.particles.spawn(e.x + (entityRandom() - 0.5) * def.halfW * 2, e.y - entityRandom() * def.h, (entityRandom() - 0.5) * 0.3, -0.5,
      null, packRGB(214, 220, 226), 22, { grav: -0.03 });
  }
  b.wasWet = wet;

  // March — rooted while it commits to a move, never during its entrance roar.
  const busy = b.move !== 'march';
  // It closes to arm's length and no further: a kiln looms over you, it does not stand in you.
  const close = Math.abs(s.pdx) < def.halfW + 10;
  if (busy || host.introducing(e)) e.vx *= 0.6;
  else if (s.targetAlive && !close && e.timer % 2 === 0) e.vx += Math.sign(s.pdx) * 0.06;
  else if (close) e.vx *= 0.7;
  // A body that heavy shoulders the alchemist aside rather than overlapping him.
  const p = ctx.player;
  if (!p.dead && Math.abs(p.x - e.x) < def.halfW + PLAYER_HALF_W - 1 && p.y > e.y - def.h && p.y < e.y + 4) {
    const dir = Math.sign(p.x - e.x) || -face(e);
    if (e.timer % 6 === 0) ctx.playerCtl.applyImpulse(dir * 1.4, -0.5);
  }
  const cap = COL.SPEED[b.phase - 1] ?? COL.SPEED[0];
  e.vx = clamp(e.vx, -cap, cap);
  if (b.phase >= 3 && e.grounded && Math.abs(e.vx) > 0.2 && e.timer % 20 === 0) {
    // Bare-cored, it scorches where it walks.
    const w = ctx.world, X = Math.floor(e.x + (entityRandom() - 0.5) * def.halfW), Y = Math.floor(e.y);
    if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === Cell.Empty) w.replaceCellAt(w.idx(X, Y), Cell.Ember, emberColor());
  }

  // Furnace breath off the shoulders, brighter as it heats.
  if (ctx.state.frameCount % 5 === 0 && b.heat > 0.4) {
    ctx.particles.spawn(e.x + (entityRandom() - 0.5) * def.halfW * 1.4, e.y - def.h + 2, (entityRandom() - 0.5) * 0.4, -0.6 - entityRandom() * 0.5,
      null, packRGB(255, 120 + Math.floor(entityRandom() * 100), 20), 18, { glow: 2.0 * b.heat, grav: -0.01 });
  }

  if (busy) {
    b.moveT++;
    switch (b.move) {
      case 'slam': slam(ctx, e, def, host, b); break;
      case 'stomp': stomp(ctx, e, def, host, b); break;
      case 'throw': toss(ctx, e, def, host, b); break;
      case 'vent': vent(ctx, e, def, host, b); break;
      case 'roar': roar(ctx, e, def, host, b); break;
      default: break;
    }
    if (b.moveT >= b.moveDur) {
      const was = b.move;
      b.lastMove = was;
      b.move = 'march';
      b.moveT = 0;
      const rec = COL.RECOVER[b.phase - 1] ?? COL.RECOVER[0];
      // A roar into the second phase breathes fire at once; otherwise, recover.
      e.attackCd = was === 'roar' && b.phase === 2 ? 0 : rec + Math.floor(entityRandom() * 30);
      if (was === 'roar' && b.phase === 2) b.lastMove = 'roar';
    }
    return;
  }
  if (!s.canAttack || e.attackCd > 0 || host.introducing(e)) return;

  // CHOOSE: range, phase, water in the room, and never the same trick twice running.
  const d = Math.abs(s.pdx);
  const waterNear = countWaterNear(ctx, e.x, e.y - def.h * 0.5, 26) > 10;
  const P = b.phase;
  let next: BossMove | null = null;
  if (P >= 2 && (waterNear || wet) && b.lastMove !== 'vent') next = 'vent';
  else if (P >= 2 && b.lastMove === 'roar') next = 'vent';
  else if (d < COL.SLAM_REACH && Math.abs(s.pdy) < 34) next = b.lastMove === 'slam' ? (e.grounded ? 'stomp' : 'slam') : 'slam';
  else if (d < 160 && e.grounded && b.lastMove !== 'stomp' && (P >= 2 || entityRandom() < 0.45)) next = 'stomp';
  else if (d < 330 && host.hasAttackLine(e, def, true)) next = 'throw';
  else if (d < 160 && e.grounded) next = 'stomp';
  if (!next) return;
  const dur = next === 'slam' ? COL.SLAM_DUR : next === 'stomp' ? COL.STOMP_DUR : next === 'throw' ? COL.THROW_DUR : COL.VENT_DUR;
  if (e.mind && next !== 'vent') e.mind.facing = Math.sign(s.pdx) || e.mind.facing;
  begin(ctx, e, b, next, dur);
}

/** A blow or a status tried to kill it: the death is a sequence, not a pop. */
export function colossusBeginDeath(ctx: Ctx, e: Enemy, def: EnemyDef, host: BossHost): boolean {
  const b = ensureBossBrain(e);
  if (b.finished) return false;
  if (b.move !== 'dying') startDeath(ctx, e, def, host, b);
  return true;
}
