import {
  BOUNCE_COUNTS,
  INFUSED,
  PROJECTILE_MODS,
  TRIGGERED,
  TRIGGER_SOURCE_SPREAD,
  type ProjectileModState,
} from '@/combat/wands/projectileMarks';
import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import { EnemySpatialIndex } from '@/core/enemySpatial';
import type { Ctx, Projectile, ProjectilesApi, ProjectileType, RigidBody } from '@/core/types';
import { Cell, isConductor, isGas, isSolid } from '@/sim/CellType';
import { acidColor, COLOR_FN, EMPTY_COLOR, fireColor, iceColor, packRGB } from '@/sim/colors';
import { chargeDeposit } from '@/sim/electrical';
import type { World } from '@/sim/World';
import { probeHollow } from '@/world/secrets';

/**
 * Per-type impulse a player projectile imparts to a rigid body it strikes —
 * a TRUE momentum (Δv = push/mass), so a light wood crate is shoved hard and a
 * heavy metal one barely moves. Explosive types add their blast on top.
 */
const PROJECTILE_PUSH: Partial<Record<ProjectileType, number>> = {
  bolt: 90,
  pellet: 28,
  fireball: 55,
  meteor: 130,
  wisp: 36,
  iceshard: 90,
  frostbolt: 36,
  acidglob: 40,
  icelance: 80,
  bomb: 45,
};

const FROST_BODY_MOMENTUM_GRACE = 10;

/** Solid-for-projectiles test (same gate as the impact check in update()). */
function solidAt(world: World, x: number, y: number): boolean {
  if (!world.inBounds(x, y)) return true;
  const c = world.types[world.idx(x, y)];
  return c !== Cell.Empty && !isGas(c);
}

interface DiskOffset {
  dx: number;
  dy: number;
  dSq: number;
}

const diskOffsetCache = new Map<number, DiskOffset[]>();

function diskOffsets(radius: number): readonly DiskOffset[] {
  const r = Math.max(0, Math.floor(radius));
  let cached = diskOffsetCache.get(r);
  if (cached) return cached;
  cached = [];
  const rSq = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const dSq = dx * dx + dy * dy;
      if (dSq <= rSq) cached.push({ dx, dy, dSq });
    }
  }
  diskOffsetCache.set(r, cached);
  return cached;
}

/** A live ice-lance pierces a given enemy at most once. Without this the lance
 *  can re-enter an enemy it has already frozen (once the e.flash gate lapses)
 *  and read its OWN inflicted freeze to self-arm a shatter crit. */
const LANCE_HITS = new WeakMap<Projectile, Set<Ctx['enemies'][number]>>();

/** Frost Charge lays its terrain rime ONCE per projectile — a bouncing or
 *  lingering bolt must not re-ice a fresh disc on every wall contact. */
const FROST_TERRAIN_DONE = new WeakSet<Projectile>();

/** True if any 4-neighbour of (x,y) is solid — the rime test shared by
 *  freezeSplash and smallFrostSplash. */
function hasSolidNeighbor(world: World, x: number, y: number): boolean {
  for (let k = 0; k < 4; k++) {
    const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
    const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
    if (world.inBounds(nx, ny) && isSolid(world.types[world.idx(nx, ny)])) return true;
  }
  return false;
}

/** Frost shard impact: freeze standing water, rime exposed surfaces — never inside the player. */
function freezeSplash(ctx: Ctx, cx: number, cy: number, radius: number): void {
  const world = ctx.world;
  cx = Math.floor(cx);
  cy = Math.floor(cy);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const X = cx + dx,
        Y = cy + dy;
      if (!world.inBounds(X, Y)) continue;
      // never crust over the wizard
      if (Math.abs(X - ctx.player.x) <= 5 && Y <= ctx.player.y + 1 && Y >= ctx.player.y - 18)
        continue;
      const ci = world.idx(X, Y);
      const t = world.types[ci];
      if (t === Cell.Water) {
        world.replaceCellAt(ci, Cell.Ice, iceColor());
      } else if (t === Cell.Empty && Math.random() < 0.35) {
        // thin rime on solid-adjacent air cells
        if (hasSolidNeighbor(world, X, Y)) {
          world.replaceCellAt(ci, Cell.Ice, iceColor());
        }
      }
    }
  }
  ctx.particles.burst(cx, cy, 8, null, iceColor, 1.8, { glow: 1.6, grav: 0.03 });
  ctx.audio.shatter();
}

/** Deposit a disc of liquid cells (glob splashes, future flask spills). */
function splashLiquid(
  ctx: Ctx,
  cx: number,
  cy: number,
  type: number,
  colorFn: () => number,
  radius: number,
): void {
  const world = ctx.world;
  cx = Math.floor(cx);
  cy = Math.floor(cy);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const X = cx + dx,
        Y = cy + dy;
      if (!world.inBounds(X, Y)) continue;
      const ci = world.idx(X, Y);
      const t = world.types[ci];
      if (t === Cell.Empty || isGas(t)) {
        world.replaceCellAt(ci, type, colorFn());
      }
    }
  }
}

/**
 * Release a projectile's trigger payload (if any) at its terminal impact.
 * No-op for projectiles the wand system never charged.
 */
function releaseTriggered(ctx: Ctx, p: Projectile): void {
  const actions = TRIGGERED.get(p);
  if (!actions) return;
  TRIGGERED.delete(p);
  const sourceSpread = TRIGGER_SOURCE_SPREAD.get(p);
  TRIGGER_SOURCE_SPREAD.delete(p);
  const angle = Math.atan2(p.vy, p.vx);
  for (const action of actions) {
    ctx.wands.castActionAt(ctx, action, p.x, p.y, angle, {
      origin: 'trigger',
      target: { x: p.x, y: p.y },
      sourceSpread,
    });
  }
}

function pointOverlapsPlayer(ctx: Ctx, x: number, y: number): boolean {
  if (ctx.state.mode !== 'play' || ctx.player.dead) return false;
  return Math.abs(x - ctx.player.x) <= 5 && y <= ctx.player.y + 1 && y >= ctx.player.y - 18;
}

/** Scan the cells overlapping an enemy's body box (±2-cell margin, 2-cell stride)
 *  for any matching `match` — shared by the wet-crit and shatter-crit checks. */
function bodyTouchesCell(ctx: Ctx, enemy: Ctx['enemies'][number], match: (type: number) => boolean): boolean {
  const world = ctx.world;
  const def = ctx.enemyCtl.defs[enemy.kind];
  const x0 = Math.floor(enemy.x - def.halfW - 2);
  const x1 = Math.floor(enemy.x + def.halfW + 2);
  const y0 = Math.floor(enemy.y - def.h - 2);
  const y1 = Math.floor(enemy.y + 2);
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      if (world.inBounds(x, y) && match(world.types[world.idx(x, y)])) return true;
    }
  }
  return false;
}

function bodyTouchesWater(ctx: Ctx, enemy: Ctx['enemies'][number]): boolean {
  return bodyTouchesCell(ctx, enemy, (t) => t === Cell.Water);
}

function bodyTouchesCryo(ctx: Ctx, enemy: Ctx['enemies'][number]): boolean {
  return bodyTouchesCell(ctx, enemy, (t) => t === Cell.Ice || t === Cell.Nitrogen);
}

function wetCritArmed(ctx: Ctx, p: Projectile, enemy: Ctx['enemies'][number]): boolean {
  const mods = PROJECTILE_MODS.get(p);
  return mods?.critWet === true && (enemy.status.wet > 0 || bodyTouchesWater(ctx, enemy));
}

function shatterCritArmed(ctx: Ctx, p: Projectile, enemy: Ctx['enemies'][number]): boolean {
  const mods = PROJECTILE_MODS.get(p);
  return mods?.shatterCrit === true && (enemy.status.frozen > 0 || bodyTouchesCryo(ctx, enemy));
}

function conditionalCritMul(wetCrit: boolean, shatterCrit: boolean): number {
  return Math.min(3, (wetCrit ? 1.8 : 1) * (shatterCrit ? 2 : 1));
}

function wetCritFeedback(ctx: Ctx, x: number, y: number): void {
  ctx.particles.burst(x, y - 6, 12, null, () => packRGB(100, 210, 255), 2.0, {
    glow: 2.2,
    grav: 0.02,
  });
  ctx.audio.tone(1180, 120, 0.14, 'triangle', 0.08);
}

function shatterCritFeedback(ctx: Ctx, x: number, y: number): void {
  ctx.particles.burst(x, y - 7, 14, null, () => packRGB(220, 245, 255), 2.2, {
    glow: 2.5,
    grav: 0.04,
  });
  ctx.audio.tone(1640, 100, 0.16, 'triangle', 0.1);
}

function electricFeedback(ctx: Ctx, x: number, y: number): void {
  ctx.particles.burst(x, y - 4, 10, null, () => packRGB(150, 230, 255), 1.7, {
    glow: 2.3,
    grav: 0,
  });
  ctx.audio.tone(1500, 300, 0.08, 'square', 0.06);
}

function pruneProjectileMods(p: Projectile, mods: ProjectileModState): void {
  if (
    mods.waterTrailBudget !== undefined ||
    mods.oilTrailBudget !== undefined ||
    mods.electricCharge === true ||
    mods.critWet === true ||
    mods.frostCharge === true ||
    mods.shatterCrit === true ||
    mods.shortHomingFrames !== undefined
  ) {
    return;
  }
  PROJECTILE_MODS.delete(p);
}

function chargeNearby(ctx: Ctx, cx: number, cy: number, radius: number, charge: number): void {
  const world = ctx.world;
  for (const { dx, dy, dSq } of diskOffsets(radius)) {
    const x = cx + dx;
    const y = cy + dy;
    if (!world.inBounds(x, y)) continue;
    const idx = world.idx(x, y);
    const t = world.types[idx];
    if (isConductor(t) || (dSq === 0 && t !== Cell.Empty && !isGas(t))) {
      world.setChargeAt(idx, Math.max(world.charge[idx], chargeDeposit(ctx, charge)));
    }
  }
}

function applyElectricChargeToEnemy(ctx: Ctx, p: Projectile, enemy: Ctx['enemies'][number]): void {
  const mods = PROJECTILE_MODS.get(p);
  if (mods?.electricCharge !== true) return;
  enemy.status.electrified = Math.max(enemy.status.electrified ?? 0, 60);
  chargeNearby(ctx, Math.floor(enemy.x), Math.floor(enemy.y - 5), 5, 12);
  electricFeedback(ctx, enemy.x, enemy.y);
}

function applyElectricChargeToTerrain(ctx: Ctx, p: Projectile, gx: number, gy: number): void {
  const mods = PROJECTILE_MODS.get(p);
  if (mods?.electricCharge !== true) return;
  chargeNearby(ctx, gx, gy, 4, 14);
  electricFeedback(ctx, gx, gy);
}

function frostChargeFeedback(ctx: Ctx, x: number, y: number): void {
  ctx.particles.burst(x, y - 5, 8, null, () => packRGB(190, 235, 255), 1.5, {
    glow: 1.8,
    grav: 0.03,
  });
  ctx.audio.tone(940, 180, 0.1, 'sine', 0.07);
}

function applyFrostChargeToEnemy(ctx: Ctx, p: Projectile, enemy: Ctx['enemies'][number]): void {
  const mods = PROJECTILE_MODS.get(p);
  if (mods?.frostCharge !== true) return;
  // Always deepen the chill: top up by 120 (to a 240-frame cap) so a target that
  // is already briefly frozen is REFRESHED rather than left untouched. On an
  // unfrozen enemy this still lands exactly 120.
  enemy.status.frozen = Math.min(240, (enemy.status.frozen ?? 0) + 120);
  frostChargeFeedback(ctx, enemy.x, enemy.y);
}

function smallFrostSplash(ctx: Ctx, cx: number, cy: number): void {
  const world = ctx.world;
  let frozen = 0;
  for (const { dx, dy } of diskOffsets(3)) {
    if (frozen >= 8) break;
    const x = cx + dx;
    const y = cy + dy;
    if (!world.inBounds(x, y) || pointOverlapsPlayer(ctx, x, y)) continue;
    const idx = world.idx(x, y);
    if (world.types[idx] === Cell.Water) {
      world.replaceCellAt(idx, Cell.Ice, iceColor());
      frozen++;
    }
  }
  for (const { dx, dy } of diskOffsets(3)) {
    if (frozen >= 8) break;
    const x = cx + dx;
    const y = cy + dy;
    if (!world.inBounds(x, y) || pointOverlapsPlayer(ctx, x, y)) continue;
    const idx = world.idx(x, y);
    if (world.types[idx] !== Cell.Empty) continue;
    if (hasSolidNeighbor(world, x, y)) {
      world.replaceCellAt(idx, Cell.Ice, iceColor());
      frozen++;
    }
  }
  if (frozen > 0) frostChargeFeedback(ctx, cx, cy);
}

function applyFrostChargeToTerrain(ctx: Ctx, p: Projectile, gx: number, gy: number): void {
  const mods = PROJECTILE_MODS.get(p);
  if (mods?.frostCharge !== true) return;
  if (FROST_TERRAIN_DONE.has(p)) return; // one rime splash per projectile (bounce/linger safe)
  FROST_TERRAIN_DONE.add(p);
  smallFrostSplash(ctx, gx, gy);
}

function shedTrail(
  ctx: Ctx,
  p: Projectile,
  mods: ProjectileModState,
  cell: Cell,
  budgetKey: 'waterTrailBudget' | 'oilTrailBudget',
  cadenceKey: 'waterTrailCadence' | 'oilTrailCadence',
): void {
  const budget = mods[budgetKey];
  if (budget === undefined || budget <= 0 || ctx.state.frameCount % (mods[cadenceKey] ?? 2) !== 0) return;
  const world = ctx.world;
  const spd = Math.hypot(p.vx, p.vy) || 1;
  const colorFn = COLOR_FN[cell] ?? (() => EMPTY_COLOR);
  let placed = 0;
  for (let d = 0; d < 2 && placed < budget; d++) {
    const tx = Math.floor(p.x - (p.vx / spd) * 2 + (Math.random() - 0.5) * 2);
    const ty = Math.floor(p.y - (p.vy / spd) * 2 + (Math.random() - 0.5) * 2);
    if (!world.inBounds(tx, ty) || pointOverlapsPlayer(ctx, tx, ty)) continue;
    const ti = world.idx(tx, ty);
    const t = world.types[ti];
    if (t === Cell.Empty || isGas(t)) {
      world.replaceCellAt(ti, cell, colorFn());
      placed++;
    }
  }
  mods[budgetKey] = budget - placed;
  if ((mods[budgetKey] ?? 0) <= 0) {
    delete mods[budgetKey];
    delete mods[cadenceKey];
    pruneProjectileMods(p, mods);
  }
}

// ===================== Projectiles & Black Holes =====================
export class Projectiles implements ProjectilesApi {
  private readonly enemyIndex = new EnemySpatialIndex();
  private readonly enemyScratch: Ctx['enemies'] = [];
  private indexedFrame = -1;
  private indexedEnemyCount = -1;

  private ensureEnemyIndex(ctx: Ctx): void {
    if (this.indexedFrame === ctx.state.frameCount && this.indexedEnemyCount === ctx.enemies.length) return;
    this.enemyIndex.rebuild(ctx.enemies);
    this.indexedFrame = ctx.state.frameCount;
    this.indexedEnemyCount = ctx.enemies.length;
  }

  /**
   * O(1) swap-remove of a projectile by index — the backward update loop has
   * already visited the tail, and projectile identity (WeakMap card marks,
   * black-hole refs) survives. Hoisted off the hot loop so update() doesn't
   * allocate a fresh closure every frame.
   */
  private removeAt(projectiles: Projectile[], idx: number): void {
    const last = projectiles.length - 1;
    if (idx !== last) projectiles[idx] = projectiles[last];
    projectiles.pop();
  }

  private damageEnemy(ctx: Ctx, enemy: Ctx['enemies'][number], amount: number, kx: number, ky: number): void {
    ctx.enemyCtl.damage(enemy, amount, kx, ky);
    if (enemy.hp <= 0) {
      this.enemyIndex.syncLive(ctx.enemies);
      this.indexedEnemyCount = ctx.enemies.length;
    }
  }

  private triggerExplosion(
    ctx: Ctx,
    x: number,
    y: number,
    radius: number,
    enemyDamageMul = 1,
    playerDamageSource = 'self-explosion',
  ): void {
    const options = enemyDamageMul === 1 && playerDamageSource === 'self-explosion'
      ? undefined
      : { enemyDamageMul, playerDamageSource };
    ctx.explosions.trigger(x, y, radius, options);
    this.enemyIndex.syncLive(ctx.enemies);
    this.indexedEnemyCount = ctx.enemies.length;
  }

  /**
   * A player projectile struck a rigid body: shove + spin it (mass-aware), then
   * resolve the projectile per type — 'pierce' (icelance keeps flying), 'bounce'
   * (bomb ricochets, detonates on its own timer), or 'consume' (everything else
   * fires its terminal effect at the contact). Mirrors the terrain-impact switch.
   */
  private impactBody(ctx: Ctx, p: Projectile, body: RigidBody): 'consume' | 'bounce' | 'pierce' {
    const spd = Math.hypot(p.vx, p.vy) || 1;
    const push = PROJECTILE_PUSH[p.type] ?? 30;
    const mx = (p.vx / spd) * push;
    const my = (p.vy / spd) * push;
    ctx.rigidBodies.applyMomentumAt(body, mx * 0.7, my * 0.7, body.x, body.y);
    ctx.rigidBodies.applyMomentumAt(body, mx * 0.3, my * 0.3, p.x, p.y);
    switch (p.type) {
      case 'icelance':
        body.frozenT = 90; // a frost lance freezes what it pierces
        body.frostMomentumGrace = Math.max(body.frostMomentumGrace ?? 0, FROST_BODY_MOMENTUM_GRACE);
        return 'pierce';
      case 'bomb':
        p.vx *= -0.3;
        p.vy *= -0.2;
        p.x += p.vx;
        p.y += p.vy;
        return 'bounce';
      case 'bolt':
        this.triggerExplosion(ctx, p.x, p.y, ctx.params.spells.bolt.explosionRadius!);
        break;
      case 'pellet':
        this.triggerExplosion(ctx, p.x, p.y, 6);
        break;
      case 'fireball':
        this.triggerExplosion(ctx, p.x, p.y, 10);
        break;
      case 'wisp':
        this.triggerExplosion(ctx, p.x, p.y, 5);
        break;
      case 'meteor':
        this.triggerExplosion(ctx, p.x, p.y, 40, p.mul ?? 1);
        break;
      case 'iceshard':
        body.frozenT = 90;
        body.frostMomentumGrace = Math.max(body.frostMomentumGrace ?? 0, FROST_BODY_MOMENTUM_GRACE);
        ctx.particles.burst(p.x, p.y, 10, null, iceColor, 1.5, { glow: 1.7, grav: 0.02 });
        break;
      case 'frostbolt':
        body.frozenT = 90;
        body.frostMomentumGrace = Math.max(body.frostMomentumGrace ?? 0, FROST_BODY_MOMENTUM_GRACE);
        ctx.particles.burst(p.x, p.y, 10, null, iceColor, 1.3, { glow: 1.5, grav: 0.02 });
        break;
      case 'acidglob':
        splashLiquid(ctx, p.x, p.y, Cell.Acid, acidColor, 3);
        break;
      default:
        ctx.particles.burst(p.x, p.y, 4, null, () => packRGB(255, 220, 150), 1.2, { glow: 1.6, grav: 0.03 });
        break;
    }
    releaseTriggered(ctx, p);
    return 'consume';
  }

  private applyShortHoming(ctx: Ctx, p: Projectile, mods: ProjectileModState): void {
    if (mods.shortHomingFrames === undefined) return;
    mods.shortHomingFrames--;
    if (mods.shortHomingFrames <= 0) {
      delete mods.shortHomingFrames;
      delete mods.shortHomingCadence;
      pruneProjectileMods(p, mods);
      return;
    }
    if (p.age < 4 || ctx.state.frameCount % (mods.shortHomingCadence ?? 4) !== 0) return;
    // A wisp already runs a stronger built-in seek with its own speed cap; a
    // second steering pass this frame would double-steer with a conflicting
    // cap. Let the frame counter (decremented above) still expire the mod, but
    // skip the redundant nudge.
    if (p.type === 'wisp') return;

    let best: Ctx['enemies'][number] | null = null;
    let bestD = 110 * 110;
    for (const e of this.enemyIndex.query(p.x, p.y + 5, 110, this.enemyScratch)) {
      if (!this.enemyIndex.has(e)) continue;
      const dx = e.x - p.x;
      const dy = e.y - 5 - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    }
    if (!best) return;

    const d = Math.sqrt(bestD) || 1;
    const initialSpeed = Math.hypot(p.vx, p.vy);
    p.vx += ((best.x - p.x) / d) * 0.36;
    p.vy += ((best.y - 5 - p.y) / d) * 0.36;
    const cap = Math.max(3.5, initialSpeed * 1.2);
    const spd = Math.hypot(p.vx, p.vy);
    if (spd > cap) {
      p.vx = (p.vx / spd) * cap;
      p.vy = (p.vy / spd) * cap;
    }
    ctx.particles.spawn(p.x, p.y, 0, 0, null, packRGB(160, 230, 255), 10, { grav: 0, glow: 1.8 });
  }

  private implosionCollapse(ctx: Ctx, p: Projectile): void {
    const world = ctx.world;
    const cx = Math.floor(p.x),
      cy = Math.floor(p.y);
    const R = Math.floor(p.vortexRad! * 1.2);
    // Everything left inside the well is sheared loose and streams into the center
    for (const { dx, dy, dSq } of diskOffsets(R)) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!world.inBounds(nx, ny)) continue;
      const ci = world.idx(nx, ny);
      const t = world.types[ci];
      if (t === Cell.Empty || t === Cell.Metal) continue;
      const d = Math.sqrt(dSq) || 1;
      if (Math.random() < 0.35) {
        ctx.particles.spawn(
          nx,
          ny,
          (-dx / d) * (2.0 + d * 0.1),
          (-dy / d) * (2.0 + d * 0.1),
          null,
          world.colors[ci],
          60,
          { grav: 0, glow: t === Cell.Gold || t === Cell.Lava ? 1.6 : 0 },
        );
      }
      world.clearCellAt(ci);
    }
    // Inverted shockwave: space visibly snaps inward
    ctx.shockwaves.push({ cx, cy, currentRadius: 0, maxRadius: R * 2.4, speed: 5.5, strength: -16 });
    // Converging ring of violet light
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = R * (0.8 + Math.random() * 0.4);
      ctx.particles.spawn(
        cx + Math.cos(a) * rr,
        cy + Math.sin(a) * rr,
        -Math.cos(a) * 3.2,
        -Math.sin(a) * 3.2,
        null,
        packRGB((190 + Math.random() * 60) | 0, 80, 255),
        40,
        { grav: 0, glow: 2.8 },
      );
    }
    // Pinprick of light at the singularity
    ctx.particles.burst(cx, cy, 10, null, () => packRGB(240, 220, 255), 0.8, { glow: 3.0, grav: 0 });
    ctx.fx.bloomKick = Math.min(1.1, ctx.fx.bloomKick + 0.85);
    ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.03, 0.05);
    ctx.audio.implode();
  }

  private updateSingularityGravityWells(ctx: Ctx): void {
    const world = ctx.world;
    for (let i = ctx.projectiles.length - 1; i >= 0; i--) {
      const p = ctx.projectiles[i];
      if (p.type === 'blackhole') {
        const vortexRad = Math.floor(p.vortexRad!);
        const centerX = Math.floor(p.x);
        const centerY = Math.floor(p.y);
        const sim = world.simBounds;
        const offsets = diskOffsets(vortexRad);
        const stride = offsets.length > 16000 ? 4 : offsets.length > 8000 ? 2 : 1;
        const start = stride === 1 ? 0 : p.age % stride;
        for (let offsetIndex = start; offsetIndex < offsets.length; offsetIndex += stride) {
          const { dx, dy, dSq } = offsets[offsetIndex];
          const px = centerX + dx;
          const py = centerY + dy;
          if (px < sim.x0 || px >= sim.x1 || py < sim.y0 || py >= sim.y1 || !world.inBounds(px, py)) continue;
          const ci = world.idx(px, py);
          const t = world.types[ci];
          if (t === Cell.Empty || t === Cell.Metal) continue;
          if (dSq <= Math.max(9, (vortexRad * 0.12) ** 2)) {
            // crossed the event horizon: gone
            world.clearCellAt(ci);
          } else if (t === Cell.Wall) {
            // bedrock shears loose and streams toward the singularity
            if (Math.random() < 0.05) {
              const d = Math.sqrt(dSq) || 1;
              ctx.particles.spawn(
                px,
                py,
                (-dx / d) * (1.2 + Math.random() * 1.6),
                (-dy / d) * (1.2 + Math.random() * 1.6),
                null,
                world.colors[ci],
                90,
                { grav: 0 },
              );
              world.clearCellAt(ci);
            }
          } else if (Math.random() < 0.55) {
            const stepX = px - Math.sign(dx),
              stepY = py - Math.sign(dy);
            if (world.inBounds(stepX, stepY)) {
              const st = world.types[world.idx(stepX, stepY)];
              if (st === Cell.Empty || st === Cell.Steam || st === Cell.Smoke) {
                world.swap(px, py, stepX, stepY);
              }
            }
          }
        }
        // Drag entities toward the singularity
        for (const e of this.enemyIndex.query(p.x, p.y, vortexRad * 1.4, this.enemyScratch)) {
          if (!this.enemyIndex.has(e)) continue;
          const dx = p.x - e.x,
            dy = p.y - e.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < vortexRad * 1.4 && d > 0.5) {
            e.vx += (dx / d) * 0.22;
            e.vy += (dy / d) * 0.22;
            if (d < 4) this.damageEnemy(ctx, e, 2.2, 0, 0);
          }
        }
        if (ctx.state.mode === 'play' && !ctx.player.dead) {
          const dx = p.x - ctx.player.x,
            dy = p.y - (ctx.player.y - 3);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < vortexRad * 1.2 && d > 1) {
            ctx.player.vx += (dx / d) * 0.1;
            ctx.player.vy += (dy / d) * 0.1;
          }
        }
      }
    }
  }

  update(ctx: Ctx): void {
    this.ensureEnemyIndex(ctx);
    this.updateSingularityGravityWells(ctx);

    const world = ctx.world;
    const projectiles = ctx.projectiles;
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life--;
      p.age++;

      if (p.charging) {
        p.life = 240;
        if (p.vortexRad! < ctx.params.spells.blackhole.collapseLimit!) {
          p.vortexRad = p.vortexRad! + ctx.params.spells.blackhole.chargeRate!;
        }
        continue;
      }

      if (p.type === 'blackhole' && p.life <= 0) {
        this.implosionCollapse(ctx, p);
        releaseTriggered(ctx, p);
        this.removeAt(projectiles, i);
        continue;
      }

      if (p.type === 'bomb' && p.life <= 0) {
        const mul = p.mul ?? 1;
        const radius = Math.floor(ctx.params.spells.bomb.explosionRadius! * Math.min(1.45, 1 + (mul - 1) * 0.15));
        this.triggerExplosion(ctx, p.x, p.y, radius, mul);
        releaseTriggered(ctx, p);
        this.removeAt(projectiles, i);
        continue;
      }

      // Per-type gravity / steering
      if (p.type === 'bomb' || p.type === 'fireball' || p.type === 'frostbolt')
        p.vy += p.type === 'bomb' ? 0.14 : p.type === 'fireball' ? 0.02 : 0.01;
      else if (p.type === 'iceshard') p.vy += 0.04;
      else if (p.type === 'meteor') p.vy += 0.07;
      else if (p.type === 'acidglob') p.vy += 0.12;
      else if (p.type === 'wisp') {
        // Seek the nearest enemy within 240px
        let best = null,
          bestD = 240 * 240;
        for (const e of this.enemyIndex.query(p.x, p.y + 5, 240, this.enemyScratch)) {
          if (!this.enemyIndex.has(e)) continue;
          const dx = e.x - p.x,
            dy = e.y - 5 - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            best = e;
          }
        }
        if (best) {
          const d = Math.sqrt(bestD) || 1;
          p.vx += ((best.x - p.x) / d) * 0.42;
          p.vy += ((best.y - 5 - p.y) / d) * 0.42;
          const spd = Math.hypot(p.vx, p.vy);
          if (spd > 5.2) {
            p.vx = (p.vx / spd) * 5.2;
            p.vy = (p.vy / spd) * 5.2;
          }
        }
        if (ctx.state.frameCount % 2 === 0) {
          ctx.particles.spawn(
            p.x,
            p.y,
            (Math.random() - 0.5) * 0.25,
            (Math.random() - 0.5) * 0.25,
            null,
            packRGB(120, 230, 255),
            12,
            { grav: 0, glow: 2.4 },
          );
        }
      }

      const mods = PROJECTILE_MODS.get(p);
      if (mods) {
        this.applyShortHoming(ctx, p, mods);
        // Electric charge is a passive aura for the projectile's whole life by
        // design (no budget/decay, unlike the trail/homing mods); the mod is
        // intentionally retained by pruneProjectileMods until the projectile is
        // GC'd. The frameCount % 4 cadence keeps the per-life scan cost bounded.
        if (mods.electricCharge && ctx.state.frameCount % 4 === 0) {
          chargeNearby(ctx, Math.floor(p.x), Math.floor(p.y), 2, 8);
        }
      }

      // Infuser card (Wave D): the wand charged this projectile from the flask —
      // it sheds up to 2 real cells of that material per frame in its wake, down
      // to a fixed budget paid for at cast time (then the mark is dropped, so the
      // trail is conserved and the WeakMap entry doesn't leak).
      const infused = INFUSED.get(p);
      if (infused !== undefined) {
        const spd = Math.hypot(p.vx, p.vy) || 1;
        const colorFn = COLOR_FN[infused.material];
        for (let d = 0; d < 2 && infused.budget > 0; d++) {
          const tx = Math.floor(p.x - (p.vx / spd) * 2 + (Math.random() - 0.5) * 2);
          const ty = Math.floor(p.y - (p.vy / spd) * 2 + (Math.random() - 0.5) * 2);
          if (!world.inBounds(tx, ty)) continue;
          const ti = world.idx(tx, ty);
          const t = world.types[ti];
          if (t === Cell.Empty || isGas(t)) {
            world.replaceCellAt(ti, infused.material, colorFn ? colorFn() : EMPTY_COLOR);
            infused.budget--;
          }
        }
        if (infused.budget <= 0) INFUSED.delete(p);
      }

      if (mods) {
        shedTrail(ctx, p, mods, Cell.Water, 'waterTrailBudget', 'waterTrailCadence');
        shedTrail(ctx, p, mods, Cell.Oil, 'oilTrailBudget', 'oilTrailCadence');
      }

      // Swept movement: sub-step at <=1 cell so fast bolts can't tunnel through thin walls
      const speed = Math.max(Math.abs(p.vx), Math.abs(p.vy));
      const steps = Math.max(1, Math.ceil(speed));
      let removed = false;
      for (let s = 0; s < steps && !removed; s++) {
        p.x += p.vx / steps;
        p.y += p.vy / steps;
        const gx = Math.floor(p.x),
          gy = Math.floor(p.y);

        if (!world.inBounds(gx, gy)) {
          if (p.type === 'warp') {
            p.x = clamp(p.x, 3, WIDTH - 4);
            p.y = clamp(p.y, 10, HEIGHT - 2);
            if (!ctx.spells.executeWarp(p))
              ctx.particles.burst(p.x, p.y, 10, null, () => packRGB(200, 140, 255), 1.6, {
                glow: 2.2,
                grav: -0.01,
              });
          } else if (p.type === 'meteor') {
            // A meteor that flies past the edge still detonates at the clamped
            // last in-bounds point — parity with the life<=0/terrain meteor
            // branches, so an off-screen lob isn't silently swallowed.
            p.x = clamp(p.x, 1, WIDTH - 2);
            p.y = clamp(p.y, 1, HEIGHT - 2);
            this.triggerExplosion(ctx, p.x, p.y, 40, p.mul ?? 1);
          }
          // Non-hostile carriers release their nested trigger payload at the
          // clamped exit point (mirrors the terrain/enemy/life<=0 paths).
          if (!p.hostile) releaseTriggered(ctx, p);
          this.removeAt(projectiles, i);
          removed = true;
          break;
        }

        // Ice lance: pierce, deep-freeze, keep flying
        if (!p.hostile && p.type === 'icelance') {
          for (const e of this.enemyIndex.query(p.x, p.y + 5, 12, this.enemyScratch)) {
            if (!this.enemyIndex.has(e)) continue;
            // Pierce each enemy at most once. The e.flash gate alone let the lance
            // re-enter a target after ~4 ticks and read its OWN inflicted freeze to
            // self-arm the shatter crit; the per-lance hit set closes that.
            const lanceHits = LANCE_HITS.get(p);
            if (e.flash > 2 || lanceHits?.has(e)) continue;
            const dx = e.x - p.x,
              dy = e.y - 5 - p.y;
            if (dx * dx + dy * dy < 130) {
              if (lanceHits) lanceHits.add(e);
              else LANCE_HITS.set(p, new Set([e]));
              const wetCrit = wetCritArmed(ctx, p, e);
              const shatterCrit = shatterCritArmed(ctx, p, e);
              const critMul = conditionalCritMul(wetCrit, shatterCrit);
              applyElectricChargeToEnemy(ctx, p, e);
              this.damageEnemy(ctx, e, 30 * (p.mul ?? 1) * critMul, p.vx * 0.4, -0.8);
              // Ice lance deep-freezes inherently; a Frost Charge mod's 120 would be
              // subsumed by this 150, so applying it here would only be dead work.
              e.status.frozen = Math.max(e.status.frozen, 150);
              ctx.particles.burst(e.x, e.y - 5, 10, null, () => packRGB(200, 240, 255), 2.2, {
                glow: 1.8,
                grav: 0.08,
              });
              if (wetCrit) wetCritFeedback(ctx, e.x, e.y);
              if (shatterCrit) shatterCritFeedback(ctx, e.x, e.y);
              ctx.audio.tone(900 + Math.random() * 300, 130, 0.12, 'sine', 0.08);
            }
          }
          // freeze water in the wake
          for (let fz = -2; fz <= 2; fz++) {
            for (let fzx = -2; fzx <= 2; fzx++) {
              const wx2 = gx + fzx,
                wy2 = gy + fz;
              if (
                world.inBounds(wx2, wy2) &&
                world.types[world.idx(wx2, wy2)] === Cell.Water &&
                Math.random() < 0.6
              ) {
                const wi = world.idx(wx2, wy2);
                world.replaceCellAt(wi, Cell.Ice, iceColor());
              }
            }
          }
          // frosty contrail
          if (Math.random() < 0.5)
            ctx.particles.spawn(
              p.x,
              p.y,
              (Math.random() - 0.5) * 0.4,
              -0.2,
              null,
              packRGB(190, 235, 255),
              10,
              { grav: -0.005, glow: 1.6 },
            );
        }

        // Hostile projectiles: fireballs detonate on the player, frostbolts
        // hit lighter but soak in as a real frozen status, acid globs splash
        if (p.hostile && ctx.state.mode === 'play' && !ctx.player.dead) {
          // A crawler is a smaller, lower target — shots at standing-head
          // height pass clean over the 9x9 body (CRAWL.md: a real dodge).
          const crawl = ctx.player.crawling;
          const dx = ctx.player.x - p.x,
            dy = ctx.player.y - (crawl ? 4 : 9) - p.y;
          if (dx * dx + dy * dy < (crawl ? 45 : 85)) {
            if (p.type === 'frostbolt') {
              ctx.playerCtl.damage(6, p.vx * 0.8, -0.6, p.source ?? 'frostbolt');
              ctx.player.status.frozen = Math.max(ctx.player.status.frozen, 120);
            } else if (p.type === 'acidglob') {
              ctx.playerCtl.damage(8, p.vx * 1.3, -1.6, p.source ?? 'acidglob');
              splashLiquid(ctx, p.x, p.y, Cell.Acid, acidColor, 3);
            } else {
              const source = p.source ?? 'hostile-fireball';
              ctx.playerCtl.damage(11, p.vx * 1.7, -2.3, source);
              this.triggerExplosion(ctx, p.x, p.y, 10, 1, source);
            }
            this.removeAt(projectiles, i);
            removed = true;
            break;
          }
        }
        // Player projectiles: detonate on enemies (meteors hit a wider arc)
        if (
          !p.hostile &&
          (p.type === 'bolt' ||
            p.type === 'pellet' ||
            p.type === 'iceshard' ||
            p.type === 'wisp' ||
            p.type === 'meteor')
        ) {
          const mul = p.mul ?? 1;
          let hit = false;
          const hitRadius = p.type === 'meteor' ? 15 : 12;
          for (const e of this.enemyIndex.query(p.x, p.y + 5, hitRadius, this.enemyScratch)) {
            if (!this.enemyIndex.has(e)) continue;
            const dx = e.x - p.x,
              dy = e.y - 5 - p.y;
            if (dx * dx + dy * dy < (p.type === 'meteor' ? 200 : 120)) {
              const wetCrit = wetCritArmed(ctx, p, e);
              const shatterCrit = shatterCritArmed(ctx, p, e);
              const critMul = conditionalCritMul(wetCrit, shatterCrit);
              const damageMul = mul * critMul;
              const explosionMul = critMul;
              applyElectricChargeToEnemy(ctx, p, e);
              if (p.type === 'bolt') {
                this.damageEnemy(ctx, e, 18 * damageMul, p.vx * 0.8, -1.6);
                this.triggerExplosion(ctx, p.x, p.y, ctx.params.spells.bolt.explosionRadius!, explosionMul);
              } else if (p.type === 'pellet') {
                this.damageEnemy(ctx, e, 8 * damageMul, p.vx * 0.6, -1.0);
                this.triggerExplosion(ctx, p.x, p.y, 6, explosionMul);
              } else if (p.type === 'iceshard') {
                this.damageEnemy(ctx, e, 16 * damageMul, p.vx * 0.5, -0.8);
                e.status.frozen = Math.max(e.status.frozen, 140);
                freezeSplash(ctx, p.x, p.y, 7);
              } else if (p.type === 'wisp') {
                this.damageEnemy(ctx, e, 13 * damageMul, p.vx * 0.5, -1.0);
                this.triggerExplosion(ctx, p.x, p.y, 5, explosionMul);
              } else {
                this.triggerExplosion(ctx, p.x, p.y, 40, damageMul);
              }
              applyFrostChargeToEnemy(ctx, p, e);
              if (wetCrit) wetCritFeedback(ctx, e.x, e.y);
              if (shatterCrit) shatterCritFeedback(ctx, e.x, e.y);
              releaseTriggered(ctx, p);
              this.removeAt(projectiles, i);
              hit = true;
              break;
            }
          }
          if (hit) {
            removed = true;
            break;
          }
        }

        // Rigid bodies are solid to player shots: a strike shoves + spins the
        // body (mass-aware — wood flies, metal resists), then the shot resolves
        // its terminal effect on the body (pierce/bounce/detonate per type).
        if (ctx.rigidBodies && !p.hostile && p.type !== 'warp' && p.type !== 'blackhole') {
          // `?.` so a stubbed rigid-body layer (e.g. gallery previews) is harmless,
          // mirroring Lightning.cast — calling a missing hitTest crashed the frame.
          const body = ctx.rigidBodies.hitTest?.(p.x, p.y);
          if (body) {
            const fate = this.impactBody(ctx, p, body);
            if (fate === 'consume') {
              this.removeAt(projectiles, i);
              removed = true;
              break;
            }
            if (fate === 'bounce') break;
            // 'pierce' → keep flying through
          }
        }

        const col = world.types[world.idx(gx, gy)];
        if (col !== Cell.Empty && !isGas(col)) {
          applyElectricChargeToTerrain(ctx, p, gx, gy);
          applyFrostChargeToTerrain(ctx, p, gx, gy);
          // Hollow-wall tell (pillar 10): a player shot striking a thin wall
          // with open space behind it knocks hollow — probed through the real
          // cells along the impact direction. The speed gate keeps a bomb
          // resting on the ground from drumming every frame.
          if (
            !p.hostile &&
            (p.type === 'bolt' || p.type === 'bomb' || p.type === 'fireball') &&
            Math.abs(p.vx) + Math.abs(p.vy) > 0.8
          ) {
            const behind = probeHollow(ctx.world, gx, gy, p.vx, p.vy);
            if (behind) {
              ctx.audio.hollowKnock();
              for (let d = 0; d < 2; d++) {
                ctx.particles.spawn(
                  gx,
                  gy,
                  (Math.random() - 0.5) * 1.4,
                  -0.4 - Math.random() * 0.9,
                  null,
                  packRGB(145, 145, 152),
                  30,
                  { grav: 0.1 },
                );
              }
            }
          }
          // Bounce card (Wave D): while charges remain, a player bolt/fireball
          // ricochets off terrain instead of detonating — reflect off the
          // axis whose substep entered the solid (cf. the bomb branch below).
          if (!p.hostile && (p.type === 'bolt' || p.type === 'fireball')) {
            const left = BOUNCE_COUNTS.get(p);
            if (left !== undefined && left > 0) {
              BOUNCE_COUNTS.set(p, left - 1);
              const prevGx = Math.floor(p.x - p.vx / steps);
              const prevGy = Math.floor(p.y - p.vy / steps);
              // Name each probe after the axis it tests: the x-step alone is
              // (new gx, prev gy); the y-step alone is (prev gx, new gy).
              const hitFromXStep = solidAt(world, gx, prevGy);
              const hitFromYStep = solidAt(world, prevGx, gy);
              if (hitFromXStep || !hitFromYStep) p.vx *= -0.55;
              if (hitFromYStep || !hitFromXStep) p.vy *= -0.55;
              p.x += p.vx;
              p.y += p.vy;
              ctx.particles.burst(gx, gy, 4, null, () => packRGB(255, 215, 120), 1.2, {
                glow: 2.0,
                grav: 0.02,
              });
              break;
            }
          }
          if (p.type === 'icelance') {
            // shatter: ice shards + frozen splash
            ctx.spells.erodeAt(gx, gy, 3);
            for (let fz = -5; fz <= 5; fz++) {
              for (let fzx = -5; fzx <= 5; fzx++) {
                if (fz * fz + fzx * fzx > 26) continue;
                const wx2 = gx + fzx,
                  wy2 = gy + fz;
                if (world.inBounds(wx2, wy2) && world.types[world.idx(wx2, wy2)] === Cell.Water) {
                  const wi = world.idx(wx2, wy2);
                  world.replaceCellAt(wi, Cell.Ice, iceColor());
                }
              }
            }
            ctx.particles.burst(gx, gy, 16, Cell.Ice, iceColor, 2.6);
            ctx.particles.burst(gx, gy, 8, null, () => packRGB(220, 245, 255), 2.0, {
              glow: 2.0,
              grav: 0.06,
            });
            ctx.audio.tone(1600, 160, 0.14, 'triangle', 0.1);
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'pellet') {
            this.triggerExplosion(ctx, gx, gy, 6);
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'iceshard') {
            freezeSplash(ctx, gx, gy, 7);
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'wisp') {
            this.triggerExplosion(ctx, gx, gy, 5);
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'meteor') {
            this.triggerExplosion(ctx, gx, gy, 40, p.mul ?? 1);
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'acidglob') {
            splashLiquid(ctx, gx, gy, Cell.Acid, acidColor, 3);
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'bolt') {
            this.triggerExplosion(ctx, gx, gy, ctx.params.spells.bolt.explosionRadius!);
            world.setChargeAt(world.idx(gx, gy), chargeDeposit(ctx, 20));
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'fireball') {
            this.triggerExplosion(ctx, gx, gy, 10, 1, p.hostile ? p.source ?? 'hostile-fireball' : 'self-explosion');
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'frostbolt') {
            // No blast — the impact frost-locks nearby water into real ice
            let frozen = 0;
            for (let dy = -4; dy <= 4 && frozen < 6; dy++) {
              for (let dx = -4; dx <= 4 && frozen < 6; dx++) {
                if (dx * dx + dy * dy > 16) continue;
                const nx = gx + dx,
                  ny = gy + dy;
                if (!world.inBounds(nx, ny)) continue;
                const ci = world.idx(nx, ny);
                if (world.types[ci] === Cell.Water) {
                  world.replaceCellAt(ci, Cell.Ice, iceColor());
                  frozen++;
                }
              }
            }
            ctx.particles.burst(gx, gy, 10, null, iceColor, 1.3, { glow: 1.5, grav: 0.02 });
            ctx.audio.tone(900, 400, 0.1, 'sine', 0.1);
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'warp') {
            if (!ctx.spells.executeWarp(p))
              ctx.particles.burst(p.x, p.y, 10, null, () => packRGB(200, 140, 255), 1.6, {
                glow: 2.2,
                grav: -0.01,
              });
            this.removeAt(projectiles, i);
            removed = true;
          } else if (p.type === 'bomb') {
            p.vx *= -0.3;
            p.vy *= -0.2;
            p.x += p.vx;
            p.y += p.vy;
          }
          // Trigger card (Wave D): a terminal terrain impact releases any
          // nested cast payload at the hit point.
          if (removed && !p.hostile) {
            releaseTriggered(ctx, p);
            // Rune glyphs and levers answer to projectile strikes too
            ctx.events.emit('structureStrike', { x: gx, y: gy, radius: 7 });
          }
          break;
        }
      }
      if (removed) continue;

      if (p.life <= 0) {
        if (p.type === 'warp') {
          p.x = clamp(p.x, 3, WIDTH - 4);
          p.y = clamp(p.y, 10, HEIGHT - 2);
          if (!ctx.spells.executeWarp(p))
            ctx.particles.burst(p.x, p.y, 10, null, () => packRGB(200, 140, 255), 1.6, {
              glow: 2.2,
              grav: -0.01,
            });
        } else if (p.type === 'meteor') {
          this.triggerExplosion(ctx, p.x, p.y, 40, p.mul ?? 1);
        }
        // A timed-out carrier still detonates its nested trigger cast at its
        // final position (parity with the terrain/enemy/bomb impact paths) —
        // otherwise a bolt fired into open sky silently swallows the payload.
        if (!p.hostile) releaseTriggered(ctx, p);
        this.removeAt(projectiles, i);
        continue;
      }

      if (p.type === 'fireball' && ctx.state.frameCount % 2 === 0) {
        ctx.particles.spawn(
          p.x,
          p.y,
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2,
          null,
          packRGB(255, 110, 20),
          9,
          { grav: -0.01, glow: 1.8 },
        );
      }
      if (p.type === 'meteor') {
        ctx.particles.spawn(
          p.x,
          p.y,
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
          Cell.Fire,
          fireColor(),
          16 + Math.floor(Math.random() * 10),
          { grav: -0.01, glow: 2.4 },
        );
      }
    }
  }
}
