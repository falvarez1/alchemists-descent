import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { difficultyMods } from '@/config/difficulty';
import { clamp } from '@/core/math';
import type { CardId, Critter, CritterKind, Ctx, Enemy, EnemyControlApi, EnemyDef, EnemyKind } from '@/core/types';
import { createDefaultStatus, sampleAndTickStatus } from '@/entities/status';
import { makePickup, POTION_KINDS } from '@/core/pickupDefs';
import { blocksEntity, Cell, isSoftGrowth } from '@/sim/CellType';
import {
  acidColor,
  bloodColor,
  fireColor,
  goldColor,
  iceColor,
  nitrogenColor,
  packRGB,
  slimeColor,
  smokeColor,
  stoneColor,
  toxicColor,
  vineColor,
} from '@/sim/colors';
import { splatterStain } from '@/sim/stains';

// ===================== Enemies =====================
interface CellCandidate {
  x: number;
  y: number;
  d2: number;
}

function addNearestCandidate(list: CellCandidate[], cap: number, x: number, y: number, d2: number): void {
  if (list.length < cap) {
    list.push({ x, y, d2 });
    return;
  }
  let worst = 0;
  let worstD2 = list[0].d2;
  for (let i = 1; i < list.length; i++) {
    if (list[i].d2 > worstD2) {
      worst = i;
      worstD2 = list[i].d2;
    }
  }
  if (d2 < worstD2) list[worst] = { x, y, d2 };
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  slime: { hp: 48, halfW: 5, h: 8, bounty: 30, gore: Cell.Slime, goreFn: slimeColor },
  imp: { hp: 40, halfW: 5, h: 12, bounty: 50, gore: Cell.Fire, goreFn: fireColor },
  golem: { hp: 170, halfW: 7, h: 20, bounty: 150, gore: Cell.Stone, goreFn: stoneColor },
  acidslime: { hp: 40, halfW: 5, h: 8, bounty: 45, gore: Cell.Acid, goreFn: acidColor },
  wisp: { hp: 22, halfW: 4, h: 8, bounty: 60, gore: Cell.Nitrogen, goreFn: nitrogenColor },
  mage: { hp: 60, halfW: 5, h: 14, bounty: 120, gore: Cell.Blood, goreFn: bloodColor },
  // Upgrade port (noita-alchemists-descent.html)
  bat: { hp: 16, halfW: 3, h: 5, bounty: 15, gore: Cell.Blood, goreFn: bloodColor },
  spitter: { hp: 55, halfW: 5, h: 11, bounty: 60, gore: Cell.Toxic, goreFn: toxicColor },
  bomber: { hp: 34, halfW: 5, h: 8, bounty: 45, gore: Cell.Fire, goreFn: fireColor },
  // Eight-legged Fungal/Timber elite: controls space by writing real vine webbing.
  // halfW 9 is the drawn abdomen, NOT the ~12-cell leg span: a 19-wide collision
  // box lets the weaver place and path through normal cave corridors (a 25-wide
  // box wedged in fungal/timber tunnels and froze its AI). Its legs still splay
  // visually onto the walls. Hit detection is query-radius based, so the smaller
  // box doesn't shrink how readily player shots connect.
  weaver: { hp: 260, halfW: 9, h: 18, bounty: 220, gore: Cell.Blood, goreFn: bloodColor },
  // The Kiln Colossus: the run's final door. Water is the strategy.
  colossus: { hp: 520, halfW: 13, h: 26, bounty: 600, gore: Cell.Stone, goreFn: stoneColor },
  // Wave F: slime egg clutch — destroy it now or fight what hatches later
  eggs: { hp: 14, halfW: 4, h: 5, bounty: 25, gore: Cell.Slime, goreFn: slimeColor },
  // The Sunken Leviathan: d4's mid-boss. Water is its armor — drain the
  // cistern or electrify it (it bleeds CONDUCTOR into its own pool).
  leviathan: { hp: 460, halfW: 9, h: 14, bounty: 450, gore: Cell.Blood, goreFn: bloodColor },
};

/** Reference enemy footprint (halfW×h) that sprays the baseline gore counts.
 *  Mid-size foes (~slime/spitter) sit near 1×; a bat barely spatters, a golem
 *  or colossus gushes. The factor is clamped to a sane band (see goreCount). */
const GORE_REF_AREA = 50;
const ENV_DAMAGE_FEEDBACK_COOLDOWN = 12;
const WEAVER_PREY: ReadonlySet<CritterKind> = new Set<CritterKind>(['moth', 'firefly', 'beetle', 'fly']);
const WEAVER_DISTURBANCE_WAKE_PAD = 88;
const WEAVER_CRANKY_FRAMES = 260;
const WEAVER_TRAIL_WEB_COOLDOWN = 18;
const WEAVER_TRAIL_LOCAL_BUDGET = 34;
const WEAVER_SUPPORT_REGIONS = [-56, -44, -31, -18, 18, 31, 44, 56] as const;

// --- Gust knockback (the player's kick is a wind blast; see Player.kick) ----
const GUST_REF_MASS = 40; // a slime-ish footprint (halfW·h); push scales inversely
const GUST_MASS_LO = 0.2; // heaviest foes barely budge
const GUST_MASS_HI = 4.5; // lightest foes (bats) get hurled
const GUST_KNOCK_FRAMES_MAX = 18; // longest ballistic-launch window (AI + flight cap suppressed)
const KNOCK_GRAV = 0.12; // gentle gravity during a launch so the arc reads
const KNOCK_DRAG = 0.97; // per-frame air drag on a launched body
const SLAM_MASS_MAX = 26; // only SMALL foes (bat 15, eggs 20) gib on a wall; heavier ones just thud
const SLAM_MIN_SPEED = 3.5; // ...and only above a real impact speed (cells/frame), not a gentle bump
const SLAM_DMG_BASE = 12; // base wall-slam damage...
const SLAM_DMG_PER_SPEED = 2.4; // ...plus this per cell/frame of impact speed (small foes gib outright)

/** Cells a kind shrugs off when statuses are sampled: imps bathe in fire, wisps in cold. */
const STATUS_IMMUNE: Partial<
  Record<EnemyKind, Partial<Record<'burning' | 'frozen' | 'electrified' | 'wet' | 'oiled', boolean>>>
> = {
  imp: { burning: true },
  wisp: { frozen: true },
  // The kiln cannot burn or freeze — but it CAN be doused (wet = thermal shock)
  colossus: { burning: true, frozen: true },
  // A soaked hide never catches — but cold stiffens it and charge cooks it
  leviathan: { burning: true },
};

/** Does cell `c` deal environmental harm to `kind`? Single source of truth for
 *  both the env-damage tick and the wary look-ahead (so they never disagree):
 *  fire/lava burn everything but the imp; acid eats everything but the acidslime. */
export function enemyLethalCell(kind: EnemyKind, c: number): boolean {
  if ((c === Cell.Fire || c === Cell.Lava) && kind !== 'imp') return true;
  if (c === Cell.Acid && kind !== 'acidslime') return true;
  return false;
}

/** Human-readable AI state for the cell inspector ("panicking", "wary", …). */
export function enemyStateLabel(e: Enemy): string {
  if ((e.knockT ?? 0) > 0) return 'launched';
  if (e.status.frozen > 0) return 'frozen';
  if (e.status.burning > 0) return 'panicking'; // on fire → flailing
  if (e.status.electrified > 0) return 'shocked';
  if ((e.wary ?? 0) > 0) return 'wary'; // recoiling from a hazard edge
  if (e.kind === 'weaver' && (e.windup ?? 0) > 0) return 'poised';
  if (e.kind === 'weaver' && e.blink > 0) return 'weaving';
  if (e.sleeping) return 'asleep';
  if (e.kind === 'weaver' && (e.cranky ?? 0) > 0) return 'cranky';
  if (e.windup) return 'winding up';
  if (e.alerted) return 'hunting';
  if (e.patrol && e.patrol.length > 0) return 'patrolling';
  return 'idle';
}

export class Enemies implements EnemyControlApi {
  readonly defs: Record<EnemyKind, EnemyDef> = ENEMY_DEFS;

  private readonly disposers: Array<() => void> = [];

  constructor(private ctx: Ctx) {
    const onStrike = ctx.events?.on('structureStrike', ({ x, y, radius }) => {
      this.wakeSleepingWeaversNear(x, y, radius + WEAVER_DISTURBANCE_WAKE_PAD, 'disturbance');
    });
    const onImpact = ctx.events?.on('groundImpact', ({ x, y, radius, strength }) => {
      this.wakeSleepingWeaversNear(x, y, radius + WEAVER_DISTURBANCE_WAKE_PAD + strength * 18, 'disturbance');
    });
    if (onStrike) this.disposers.push(onStrike);
    if (onImpact) this.disposers.push(onImpact);
  }

  /** Tear down the page-lifetime EventBus subscriptions (symmetry with the
   *  constructor; the Game disposes this alongside the other singletons). */
  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  spawn(kind: EnemyKind, x: number, y: number): void {
    const ctx = this.ctx;
    const def = this.defs[kind];
    // Find an open pocket: scan downward from the requested point, retrying nearby columns
    let sx = Math.floor(clamp(x, def.halfW + 2, WIDTH - def.halfW - 3));
    let sy = -1;
    for (let attempt = 0; attempt < 10 && sy < 0; attempt++) {
      const tx =
        attempt === 0
          ? sx
          : Math.floor(clamp(sx + (Math.random() - 0.5) * 240, def.halfW + 2, WIDTH - def.halfW - 3));
      for (let yy = Math.max(def.h, Math.floor(y)); yy < HEIGHT - 2; yy++) {
        if (ctx.physics.entityFree(tx, yy, def.halfW, def.h)) {
          sx = tx;
          sy = yy;
          break;
        }
      }
    }
    if (sy < 0) sy = Math.max(def.h, Math.floor(y)); // last resort
    // Depth scaling: tougher and harder-hitting the deeper you descend; difficulty
    // multiplies both on top (level 3 = ×1, so the shipped curve is untouched).
    const depth = ctx.state.mode === 'play' ? (ctx.levels.current?.def.depth ?? 1) : 1;
    const diff = difficultyMods(ctx.state);
    const hpMul = (1 + (depth - 1) * 0.16) * diff.enemyHp;
    const dmgK = (1 + (depth - 1) * 0.1) * diff.enemyDamage;
    ctx.enemies.push({
      kind,
      x: sx,
      y: sy,
      fx: 0,
      fy: 0,
      vx: 0,
      vy: 0,
      hp: Math.round(def.hp * hpMul),
      maxHp: Math.round(def.hp * hpMul),
      dmgK,
      flash: 0,
      timer: Math.floor(Math.random() * 80),
      attackCd: 60,
      bobPhase: Math.random() * Math.PI * 2,
      grounded: false,
      stride: 0,
      splat: 0,
      prevG: false,
      blink: 0,
      jetFuel: 0,
      jetCd: 0,
      stuckT: 0,
      status: createDefaultStatus(),
    });
    ctx.particles.burst(sx, sy, 6, Cell.Smoke, smokeColor, 0.9);
  }

  /** Per-material gore channel for the cell being sprayed (red blood, green
   *  slime, glowing acid/toxic ooze are tuned discretely; other materials —
   *  stone, fire, nitrogen — ride the master dial alone). */
  private goreChannelMul(material: number): number {
    const g = this.ctx.params.global;
    if (material === Cell.Blood) return g.goreBlood;
    if (material === Cell.Slime) return g.goreSlime;
    if (material === Cell.Acid || material === Cell.Toxic) return g.goreOoze;
    return 1;
  }

  /** Scale a baseline gore particle count by: the `bloodAmount` master dial, the
   *  per-material channel (`material` = the cell being sprayed), and the enemy's
   *  body size (halfW×h vs GORE_REF_AREA, clamped 0.3–4×) so spray is
   *  proportional to the foe — a bat barely spatters, a golem gushes.
   *  Always ≥ 0, integer. */
  private goreCount(e: Enemy, n: number, material: number): number {
    const def = this.defs[e.kind];
    const sizeFactor = Math.max(0.3, Math.min(4, (def.halfW * def.h) / GORE_REF_AREA));
    return Math.max(
      0,
      Math.round(n * this.ctx.params.global.bloodAmount * this.goreChannelMul(material) * sizeFactor),
    );
  }

  /** Stamp a small puddle of real liquid gore into the empty cells around a
   *  death so a wet pool exists immediately; the airborne spray then feeds it,
   *  it flows downhill, stains what it touches, and eventually dries (liquids.ts).
   *  Grid-explained gore: it IS Cell.Blood, nothing painted on top. */
  private seedGorePool(x: number, y: number, r: number): void {
    const w = this.ctx.world;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let dy = -1; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (Math.random() < 0.45) continue;
        const xx = cx + dx;
        const yy = cy + dy;
        if (!w.inBounds(xx, yy)) continue;
        const i = w.idx(xx, yy);
        if (w.types[i] === Cell.Empty) w.replaceCellAt(i, Cell.Blood, bloodColor());
      }
    }
  }

  damage(e: Enemy, amount: number, kx: number, ky: number): void {
    const ctx = this.ctx;
    // WATER IS THE LEVIATHAN'S ARMOR: while the body is actually in water
    // (cell census, not the wet meter) hits glance off — and SAY so, every
    // time, with a cold shimmer and a dull plink. Drain the pool.
    if (e.kind === 'leviathan' && e.submerged === true) {
      amount *= 0.25;
      ctx.particles.burst(e.x, e.y - 7, 3, null, () => packRGB(120, 220, 255), 1.2, {
        glow: 1.8,
        grav: -0.01,
      });
      ctx.audio.tone(820, 520, 0.05, 'triangle', 0.07);
    }
    e.hp -= amount;
    e.flash = 6;
    e.vx += kx || 0;
    e.vy += ky || 0;
    const def = this.defs[e.kind];
    ctx.particles.burst(
      e.x,
      e.y - 5,
      this.goreCount(e, Math.min(13, 4 + amount * 0.35), def.gore),
      def.gore,
      def.goreFn,
      2.1,
      e.kind === 'imp' ? { glow: 1.8, grav: 0.06 } : undefined,
    );
    // Wounds bleed: a directional spray that pools where it lands
    if (e.kind !== 'imp') {
      if (Math.random() < 0.6) splatterStain(ctx.world, e.x - Math.sign(kx || 0) * 3, e.y - 5, 4);
      const n = this.goreCount(e, Math.min(22, 5 + Math.floor(amount * 0.8)), Cell.Blood);
      for (let i = 0; i < n; i++) {
        ctx.particles.spawn(
          e.x + ((Math.random() * 5) | 0) - 2,
          e.y - 5 + ((Math.random() * 5) | 0) - 2,
          (kx || 0) * 0.6 + (Math.random() - 0.5) * 2.6,
          (ky || 0) * 0.5 - 0.6 - Math.random() * 1.8,
          Cell.Blood,
          bloodColor(),
          160,
        );
      }
    } else {
      ctx.particles.burst(
        e.x,
        e.y - 5,
        this.goreCount(e, Math.min(8, 2 + Math.floor(amount * 0.3)), Cell.Fire),
        Cell.Fire,
        fireColor,
        1.8,
        { glow: 2.0, grav: -0.01 },
      );
    }
    if (e.hp <= 0) this.kill(e, kx, ky);
  }

  /** The player's kick is a wind blast: shove a foe along (dirX,dirY), mass-scaled
   *  so a bat is hurled and a golem barely rocks. Light foes enter a brief ballistic
   *  LAUNCH (AI + per-kind flight cap suppressed in tickKnock) so the shove actually
   *  carries — and a fast launch SMASHES into the first wall it meets, painting it. */
  gustShove(e: Enemy, dirX: number, dirY: number, strength: number): void {
    if (strength <= 0 || e.hp <= 0) return;
    if (e.kind === 'colossus' || e.kind === 'leviathan') return; // a gust can't move a boss
    const def = this.defs[e.kind];
    const mass = def.halfW * def.h; // footprint proxy: bat 15, slime 40, golem 140
    const push = strength * clamp(GUST_REF_MASS / mass, GUST_MASS_LO, GUST_MASS_HI);
    e.sleeping = false; // a roosting bat is knocked loose
    e.knockVx = (e.knockVx ?? 0) + dirX * push;
    e.knockVy = (e.knockVy ?? 0) + dirY * push - push * 0.18; // a touch of lift
    // Heavy foes get a short stagger; light ones a long, wall-smashing flight.
    e.knockT = Math.max(e.knockT ?? 0, Math.round(clamp(push * 2, 3, GUST_KNOCK_FRAMES_MAX)));
  }

  /** Advance a gust-launched foe ballistically, suppressing its AI and flight cap
   *  so the shove carries. Returns true while the launch owns the body (the update
   *  loop then skips normal AI + integration). A launch ≥ SLAM_MIN_SPEED that meets
   *  a wall smashes the foe against it (slamWall). */
  private tickKnock(e: Enemy, def: EnemyDef): boolean {
    if ((e.knockT ?? 0) <= 0) return false;
    e.knockT = (e.knockT ?? 0) - 1;
    const ctx = this.ctx;
    const vx = (e.knockVx ?? 0) * KNOCK_DRAG;
    const vy = ((e.knockVy ?? 0) + KNOCK_GRAV) * KNOCK_DRAG;
    const speed = Math.hypot(vx, vy);
    e.fx += vx;
    e.fy += vy;
    let hit = false;
    // Sweep one cell at a time so a fast launch can't tunnel a thin wall.
    let sx = Math.trunc(e.fx);
    while (sx !== 0 && !hit) {
      const step = sx > 0 ? 1 : -1;
      const tx = Math.floor(clamp(e.x + step, 6, WIDTH - 7));
      if (tx === e.x || !ctx.physics.entityFree(tx, e.y, def.halfW, def.h)) {
        hit = true;
        break;
      }
      e.x = tx;
      e.fx -= step;
      sx -= step;
    }
    let sy = Math.trunc(e.fy);
    while (sy !== 0 && !hit) {
      const step = sy > 0 ? 1 : -1;
      const ty = Math.floor(clamp(e.y + step, 14, HEIGHT - 7));
      if (ty === e.y || !ctx.physics.entityFree(e.x, ty, def.halfW, def.h)) {
        hit = true;
        break;
      }
      e.y = ty;
      e.fy -= step;
      sy -= step;
    }
    e.knockVx = vx;
    e.knockVy = vy;
    // A small foe hurled fast into a wall SMASHES (gib + wall paint); a heavier
    // one just thuds. Either way a wall stops the launch — never phase through it.
    if (hit && speed >= SLAM_MIN_SPEED && def.halfW * def.h <= SLAM_MASS_MAX) {
      this.slamWall(e, def, vx, vy, speed); // consumes the launch; may kill
      return true;
    }
    if (hit) {
      // bumped a wall (too heavy/slow to gib) — stop dead against it
      e.vx = 0;
      e.vy = 0;
      e.fx = 0;
      e.fy = 0;
      e.knockT = 0;
      e.knockVx = 0;
      e.knockVy = 0;
    } else if ((e.knockT ?? 0) <= 0) {
      // launch ran its course in open air — hand the residual momentum to the AI
      e.vx = vx;
      e.vy = vy;
      e.fx = 0;
      e.fy = 0;
      e.knockVx = 0;
      e.knockVy = 0;
    }
    return true;
  }

  /** A foe launched into a wall: smear blood across the impact, gout particles into
   *  the stone, and take heavy speed-scaled damage (small foes gib outright). */
  private slamWall(e: Enemy, def: EnemyDef, vx: number, vy: number, speed: number): void {
    const ctx = this.ctx;
    const nx = vx / (speed || 1);
    const ny = vy / (speed || 1);
    const r = Math.max(3, Math.round((def.halfW + def.h) * 0.4));
    // Paint the wall at the impact point (just past the body), plus a lighter smear
    // around the body. splatterStain only takes on Wall/Wood/Stone/Ice.
    splatterStain(ctx.world, e.x + Math.round(nx * (def.halfW + 1)), e.y - 5 + Math.round(ny * 3), r);
    splatterStain(ctx.world, e.x, e.y - 5, Math.ceil(r * 0.6));
    // Blood gouts driven INTO the wall...
    for (let k = 0; k < 14; k++) {
      ctx.particles.spawn(
        e.x + (Math.random() - 0.5) * def.halfW,
        e.y - 5 + (Math.random() - 0.5) * def.h,
        nx * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
        ny * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
        Cell.Blood,
        bloodColor(),
        150,
      );
    }
    ctx.particles.burst(e.x, e.y - 5, 10, null, () => packRGB(150, 140, 120), 1.6, { grav: 0.05 });
    ctx.audio.noiseBurst(0.12, 170, 0.13); // wet crunch
    ctx.audio.tone(120, 70, 0.12, 'square', 0.08);
    // THE PUNCH: a wall-slam gib is a kill-cam moment — a beat of hitstop, a bloom
    // flash, and a small shake, all scaled a touch by how hard it hit.
    const punch = Math.min(1, speed / 12);
    ctx.fx.hitstop = Math.max(ctx.fx.hitstop, 3 + Math.round(punch * 2));
    ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 0.7 + punch * 0.5);
    this.shakeAt(e.x, e.y, 0.014 + punch * 0.014, 0.05);
    // Consume the launch, then take the hit (lethal for small foes → gib gore).
    e.knockT = 0;
    e.knockVx = 0;
    e.knockVy = 0;
    e.fx = 0;
    e.fy = 0;
    e.vx = 0;
    e.vy = 0;
    this.damage(e, SLAM_DMG_BASE + speed * SLAM_DMG_PER_SPEED, -nx * 0.6, -ny * 0.6);
  }

  private removeEnemyAt(index: number): Enemy | undefined {
    const enemies = this.ctx.enemies;
    if (!Number.isInteger(index) || index < 0 || index >= enemies.length) return undefined;
    const removed = enemies[index];
    const last = enemies.length - 1;
    if (index !== last) enemies[index] = enemies[last];
    enemies.pop();
    return removed;
  }

  private removeEnemy(e: Enemy): Enemy | undefined {
    const idx = this.ctx.enemies.indexOf(e);
    return idx === -1 ? undefined : this.removeEnemyAt(idx);
  }

  private killAt(index: number, e: Enemy, kx: number, ky: number): void {
    const removed = this.ctx.enemies[index] === e ? this.removeEnemyAt(index) : this.removeEnemy(e);
    if (!removed) return;
    this.finishKill(e, kx, ky);
  }

  kill(e: Enemy, kx: number, ky: number): void {
    if (!this.removeEnemy(e)) return;
    this.finishKill(e, kx, ky);
  }

  private finishKill(e: Enemy, kx: number, ky: number): void {
    const ctx = this.ctx;
    const def = this.defs[e.kind];
    // Bombers go out the only way they know how
    if (e.kind === 'bomber') {
      ctx.explosions.trigger(e.x, e.y - 4, 24 + Math.floor(Math.random() * 3));
      this.dropBounty(e, def);
      this.maybeDropPotion(e);
      if (ctx.player.perks.vampirism && !ctx.player.dead) {
        ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 2);
      }
      ctx.waves.kills++;
      return;
    }
    // The Sunken Leviathan: a MID-boss — the run continues, richer by a
    // heart and a card. The pool it dies in inherits a final bloom of gore.
    if (e.kind === 'leviathan') {
      ctx.particles.burst(e.x, e.y - 6, 46, Cell.Water, () => packRGB(40, 130, 210), 4.4);
      ctx.particles.burst(e.x, e.y - 6, this.goreCount(e, 34, Cell.Blood), Cell.Blood, bloodColor, 3.6);
      ctx.particles.burst(e.x, e.y - 10, 18, null, () => packRGB(140, 230, 255), 3.0, {
        glow: 2.2,
        grav: -0.01,
      });
      splatterStain(ctx.world, e.x, e.y - 5, 12);
      this.seedGorePool(e.x, e.y - 2, 8);
      this.dropBounty(e, def);
      const runtime = ctx.levels.current;
      if (runtime && ctx.state.mode === 'play') {
        const REWARD_CARDS: CardId[] = ['icelance', 'meteor', 'blackhole', 'triple', 'trigger'];
        runtime.pickups.push(makePickup('heart', e.x - 5, e.y - 8));
        runtime.pickups.push(
          makePickup('tome', e.x + 5, e.y - 8, {
            card: REWARD_CARDS[Math.floor(Math.random() * REWARD_CARDS.length)],
          }),
        );
      }
      ctx.audio.groan();
      ctx.audio.squelch();
      this.shakeAt(e.x, e.y, 0.035, 0.06);
      ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 1.2);
      ctx.waves.kills++;
      ctx.events.emit('toast', { text: 'THE SUMP FALLS STILL' });
      return;
    }
    // The Kiln Colossus: the run ends here, loudly.
    if (e.kind === 'colossus') {
      ctx.explosions.trigger(e.x, e.y - 10, 28);
      ctx.particles.burst(e.x, e.y - 12, this.goreCount(e, 40, Cell.Stone), Cell.Stone, stoneColor, 4.5);
      ctx.particles.burst(e.x, e.y - 12, 24, null, () => packRGB(255, 170, 40), 3.8, {
        glow: 2.6,
        grav: -0.01,
      });
      this.dropBounty(e, def);
      ctx.audio.portalWhoosh();
      ctx.fx.screenShake = 0.06;
      ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 1.6);
      ctx.waves.kills++;
      ctx.events.emit('toast', { text: 'THE KILN IS COLD' });
      ctx.events.emit('runComplete', { gold: ctx.state.score });
      // The run is complete — the save has nothing left to protect.
      ctx.levels.abandonExpedition();
      return;
    }
    // Gib burst + gold bounty shower
    ctx.particles.burst(
      e.x,
      e.y - 5,
      this.goreCount(e, 22, def.gore),
      def.gore,
      def.goreFn,
      3.6,
      e.kind === 'imp' ? { glow: 1.6, grav: 0.08 } : undefined,
    );
    if (e.kind === 'acidslime') {
      // The membrane ruptures: a shower of real acid rains back into the grid
      ctx.particles.burst(e.x, e.y - 4, this.goreCount(e, 26, Cell.Acid), Cell.Acid, acidColor, 3.4);
    }
    if (e.kind === 'spitter') {
      // Toxic bulb ruptures — caustic shower instead of blood
      ctx.particles.burst(e.x, e.y - 5, this.goreCount(e, 40, Cell.Toxic), Cell.Toxic, toxicColor, 3.8);
    } else if (e.kind !== 'imp') {
      // Violent blood splash: fast radial spray + slow wide arc + heavy directional
      // gouts. Counts are size-scaled in goreCount, so a golem gushes and a bat dribbles.
      ctx.particles.burst(e.x, e.y - 5, this.goreCount(e, 46, Cell.Blood), Cell.Blood, bloodColor, 4.8);
      ctx.particles.burst(e.x, e.y - 7, this.goreCount(e, 24, Cell.Blood), Cell.Blood, bloodColor, 2.2);
      for (let i = 0; i < this.goreCount(e, 16, Cell.Blood); i++) {
        ctx.particles.spawn(
          e.x,
          e.y - 5,
          (kx || 0) * 1.0 + (Math.random() - 0.5) * 6.5,
          (ky || 0) * 0.8 - 2.2 - Math.random() * 3.0,
          Cell.Blood,
          bloodColor(),
          240,
        );
      }
      // gore decal painted straight onto the nearby cave walls
      splatterStain(ctx.world, e.x, e.y - 5, e.kind === 'golem' ? 14 : e.kind === 'bat' ? 5 : 10);
      // ...and a real wet pool at the feet that the spray keeps feeding
      this.seedGorePool(e.x, e.y - 2, e.kind === 'golem' ? 5 : e.kind === 'bat' ? 1 : 3);
    }
    this.dropBounty(e, def);
    this.maybeDropPotion(e);
    // Vampirism boon: every kill feeds the alchemist
    if (ctx.player.perks.vampirism && !ctx.player.dead) {
      ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 2);
    }
    ctx.audio.squelch();
    this.shakeAt(e.x, e.y, 0.012, 0.04);
    ctx.waves.kills++;
  }

  /**
   * Screen shake with distance: full strength at the screen's heart, fading
   * quadratically to nothing ~420 cells out. A quake next door rattles you;
   * the same quake across the cavern is a tremor; off-screen it is nothing.
   */
  private shakeAt(x: number, y: number, amount: number, cap: number): void {
    const ctx = this.ctx;
    const cx = ctx.camera.x + VIEW_W / 2,
      cy = ctx.camera.y + VIEW_H / 2;
    const d = Math.hypot(x - cx, y - cy);
    const falloff = Math.max(0, 1 - d / 420);
    if (falloff <= 0) return;
    ctx.fx.screenShake = Math.min(ctx.fx.screenShake + amount * falloff * falloff, cap);
  }

  /** Felled foes sometimes drop a potion (golems are walking apothecaries). */
  private maybeDropPotion(e: Enemy): void {
    const ctx = this.ctx;
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play') return;
    if (Math.random() < (e.kind === 'golem' ? 0.3 : 0.12)) {
      runtime.pickups.push(
        makePickup('potion', e.x, e.y - 5, {
          potion: POTION_KINDS[Math.floor(Math.random() * POTION_KINDS.length)],
        }),
      );
    }
  }

  /** Gold coin shower (homing in play mode) + build-mode direct score credit. */
  private dropBounty(e: Enemy, def: EnemyDef): void {
    const ctx = this.ctx;
    const coins = Math.max(1, Math.ceil(def.bounty / 10));
    const baseValue = Math.floor(def.bounty / coins);
    let remainder = def.bounty - baseValue * coins;
    for (let i = 0; i < coins; i++) {
      const value = baseValue + (remainder-- > 0 ? 1 : 0);
      ctx.particles.spawn(
        e.x,
        e.y - 5,
        (Math.random() - 0.5) * 4.2,
        -2.2 - Math.random() * 2.4,
        null,
        goldColor(),
        300,
        {
          homing: ctx.state.mode === 'play',
          value,
          glow: 2.0,
          grav: ctx.state.mode === 'play' ? 0 : 0.14,
        },
      );
    }
    if (ctx.state.mode !== 'play') {
      ctx.state.score += def.bounty;
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
    }
  }

  /**
   * Powder Mage telekinesis: tear up to 14 powder cells (Sand/Gold/Gunpowder,
   * nearest-first within 40 cells) OUT of the grid and hurl them at the player
   * as hostile debris. The level itself is the ammunition — whatever misses
   * re-deposits as real cells where it lands.
   */
  private telekinesisVolley(e: Enemy): void {
    const ctx = this.ctx;
    const world = ctx.world;
    const player = ctx.player;
    const ex = Math.floor(e.x),
      ey = Math.floor(e.y) - 7;
    const found: CellCandidate[] = [];
    for (let dy = -40; dy <= 40; dy++) {
      for (let dx = -40; dx <= 40; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 1600) continue;
        const nx = ex + dx,
          ny = ey + dy;
        if (!world.inBounds(nx, ny)) continue;
        const t = world.types[world.idx(nx, ny)];
        if (t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder) {
          addNearestCandidate(found, 14, nx, ny, d2);
        }
      }
    }
    found.sort((a, b) => a.d2 - b.d2);
    const n = Math.min(14, found.length);
    for (let k = 0; k < n; k++) {
      const c = found[k];
      const ci = world.idx(c.x, c.y);
      const t = world.types[ci];
      const color = world.colors[ci];
      world.clearCellAt(ci);
      const aim = Math.atan2(player.y - 9 - c.y, player.x - c.x) + (Math.random() - 0.5) * 0.24;
      const spd = 3.6 + Math.random() * 0.8;
      ctx.particles.spawn(c.x, c.y, Math.cos(aim) * spd, Math.sin(aim) * spd, t, color, 170, {
        hostileDmg: 6,
        glow: 0.6,
        grav: 0.015,
      });
    }
    if (n > 0) {
      ctx.audio.tone(240, 70, 0.3, 'sawtooth', 0.12);
      this.shakeAt(e.x, e.y, 0.006, 0.04);
    }
  }

  /**
   * The leviathan's ranged arm: it TEARS WATER OUT OF ITS OWN POOL and
   * throws it (the powder mage's trick, aimed through a liquid). The level
   * is the ammunition — every volley thins the very armor it hides in, and
   * a drained basin leaves it nothing to throw.
   */
  private poolVolley(e: Enemy): void {
    const ctx = this.ctx;
    const world = ctx.world;
    const player = ctx.player;
    const ex = Math.floor(e.x),
      ey = Math.floor(e.y) - 6;
    const found: CellCandidate[] = [];
    for (let dy = -26; dy <= 26; dy += 2) {
      for (let dx = -26; dx <= 26; dx += 2) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 676) continue;
        const nx = ex + dx,
          ny = ey + dy;
        if (!world.inBounds(nx, ny)) continue;
        if (world.types[world.idx(nx, ny)] === Cell.Water) addNearestCandidate(found, 12, nx, ny, d2);
      }
    }
    found.sort((a, b) => a.d2 - b.d2);
    const n = Math.min(12, found.length);
    for (let k = 0; k < n; k++) {
      const c = found[k];
      const ci = world.idx(c.x, c.y);
      const color = world.colors[ci];
      world.clearCellAt(ci);
      const aim = Math.atan2(player.y - 9 - c.y, player.x - c.x) + (Math.random() - 0.5) * 0.2;
      const spd = 3.2 + Math.random() * 0.9;
      ctx.particles.spawn(c.x, c.y, Math.cos(aim) * spd, Math.sin(aim) * spd - 0.4, Cell.Water, color, 170, {
        hostileDmg: 5,
        glow: 0.5,
        grav: 0.03,
      });
    }
    if (n > 0) {
      ctx.audio.noiseBurst(0.14, 900, 0.1, true);
      this.shakeAt(e.x, e.y, 0.005, 0.03);
    }
  }

  private weaverFooting(e: Enemy, def: EnemyDef): number {
    const w = this.ctx.world;
    const cx = Math.floor(e.x);
    const foot = Math.floor(e.y);
    let support = 0;
    let hazard = 0;
    for (let dy = -2; dy <= 4; dy += 2) {
      for (let dx = -def.halfW - 4; dx <= def.halfW + 4; dx += 4) {
        const x = cx + dx;
        const y = foot + dy;
        if (!w.inBounds(x, y)) continue;
        const t = w.types[w.idx(x, y)];
        if (isSoftGrowth(t)) {
          support += 1;
        } else if (enemyLethalCell(e.kind, t)) {
          hazard += 1;
        }
      }
    }
    // The sample grid yields up to ~28 cells, so divide by 14: support reaches
    // full footing at ~half growth coverage and then visibly DROPS as the player
    // burns the web away. (The /7 this replaced saturated to 1.0 after only a
    // handful of cells, so cutting the weaver's footing barely registered.)
    return clamp((support - hazard * 1.5) / 14, 0, 1);
  }

  private weaverPhysicalFooting(e: Enemy): { support: number; anchors: number; centerX: number } {
    const w = this.ctx.world;
    const cx = Math.floor(e.x);
    const foot = Math.floor(e.y);
    let support = 0;
    let anchors = 0;
    let centerX = 0;

    for (const offset of WEAVER_SUPPORT_REGIONS) {
      const targetX = cx + offset;
      let best = 0;
      let bestX = targetX;
      for (let yy = foot - 18; yy <= foot + 22; yy += 2) {
        if (yy < 1 || yy >= HEIGHT - 1) continue;
        for (let xx = targetX - 12; xx <= targetX + 12; xx += 3) {
          if (!w.inBounds(xx, yy)) continue;
          const t = w.types[w.idx(xx, yy)];
          const growth = isSoftGrowth(t);
          const load = growth ? 0.95 : this.ctx.physics.cellBlocks(xx, yy) ? 1 : blocksEntity(t) ? 0.55 : 0;
          if (load <= 0) continue;
          const exposed =
            (w.inBounds(xx, yy - 1) && !this.ctx.physics.cellBlocks(xx, yy - 1)) ||
            (w.inBounds(xx - 1, yy) && !this.ctx.physics.cellBlocks(xx - 1, yy)) ||
            (w.inBounds(xx + 1, yy) && !this.ctx.physics.cellBlocks(xx + 1, yy)) ||
            (w.inBounds(xx, yy + 1) && !this.ctx.physics.cellBlocks(xx, yy + 1));
          if (!exposed) continue;
          const dx = Math.abs(xx - targetX);
          const dy = Math.abs(yy - foot);
          const reachPenalty = Math.min(0.78, dx * 0.045 + dy * 0.025);
          const score = load * (1 - reachPenalty) + (growth ? 0.16 : 0);
          if (score > best) {
            best = score;
            bestX = xx;
          }
        }
      }
      if (best > 0.22) {
        anchors++;
        support += clamp(best, 0, 1);
        centerX += bestX;
      }
    }

    return {
      support: clamp(support / WEAVER_SUPPORT_REGIONS.length, 0, 1),
      anchors,
      centerX: anchors > 0 ? centerX / anchors : e.x,
    };
  }

  private weaveThread(e: Enemy, tx: number, ty: number): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const sx = Math.floor(e.x);
    const sy = Math.floor(e.y - this.defs[e.kind].h * 0.55);
    const ex = Math.floor(clamp(tx, 3, WIDTH - 4));
    const ey = Math.floor(clamp(ty, 8, HEIGHT - 8));
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;
    const shotLen = Math.max(58, Math.min(138, len * 0.78 + 18));
    const headX = sx + dirX * shotLen;
    const headY = sy + dirY * shotLen;
    let placed = 0;
    ctx.vineStrands.addWebShot(sx + 0.5, sy + 0.5, dirX, dirY, {
      color: vineColor(),
      length: shotLen,
      speed: 3.0 + Math.min(1.2, len / 180),
      slack: 0.04 + Math.min(0.04, len / 1200),
      lifetime: 360,
      ashOnExpire: true,
    });
    const anchorX = Math.floor(headX);
    const anchorY = Math.floor(headY);
    let supported = false;
    for (let ay = anchorY - 1; ay <= anchorY + 1 && !supported; ay++) {
      for (let ax = anchorX - 1; ax <= anchorX + 1; ax++) {
        if (!w.inBounds(ax, ay)) continue;
        const t = w.types[w.idx(ax, ay)];
        if (blocksEntity(t) || isSoftGrowth(t)) {
          supported = true;
          break;
        }
      }
    }
    if (supported) {
      for (let oy = -1; oy <= 1; oy++) {
        const x = anchorX;
        const y = anchorY + oy;
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        if (w.types[i] !== Cell.Empty) continue;
        w.replaceCellAt(i, Cell.Vines, vineColor());
        w.life[i] = 160 + Math.floor(Math.random() * 70);
        placed++;
      }
    }
    ctx.audio.squelch();
    ctx.particles.burst(headX, headY, Math.max(5, Math.min(10, placed + 4)), Cell.Vines, vineColor, 1.1);
  }

  private weaveFootTrail(e: Enemy, support: number): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const cx = Math.floor(e.x);
    const foot = Math.floor(e.y);
    let localVines = 0;
    for (let dy = -6; dy <= 5; dy += 2) {
      for (let dx = -18; dx <= 18; dx += 3) {
        const x = cx + dx;
        const y = foot + dy;
        if (w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Vines) localVines++;
      }
    }
    if (localVines > WEAVER_TRAIL_LOCAL_BUDGET) return;
    let placed = 0;
    const radius = (e.cranky ?? 0) > 0 ? 16 : 11;
    for (let n = 0; n < 10 && placed < 5; n++) {
      const x = cx + Math.floor((Math.random() * 2 - 1) * radius);
      const y = foot - 2 + Math.floor(Math.random() * 6);
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      if (w.types[i] !== Cell.Empty) continue;
      const below = w.inBounds(x, y + 1) ? w.types[w.idx(x, y + 1)] : Cell.Empty;
      const above = w.inBounds(x, y - 1) ? w.types[w.idx(x, y - 1)] : Cell.Empty;
      const left = w.inBounds(x - 1, y) ? w.types[w.idx(x - 1, y)] : Cell.Empty;
      const right = w.inBounds(x + 1, y) ? w.types[w.idx(x + 1, y)] : Cell.Empty;
      // Anything solid OR soft growth gives a strand something to cling to,
      // including walls/ceilings when the floor has been cut away.
      const cling =
        blocksEntity(below) ||
        blocksEntity(above) ||
        blocksEntity(left) ||
        blocksEntity(right) ||
        isSoftGrowth(below) ||
        isSoftGrowth(above) ||
        isSoftGrowth(left) ||
        isSoftGrowth(right);
      if (!cling && support > 0.45) continue;
      w.replaceCellAt(i, Cell.Vines, vineColor());
      w.life[i] = 120 + Math.floor(Math.random() * 70);
      placed++;
    }
    if (placed > 0 && (e.cranky ?? 0) > 0) {
      ctx.particles.burst(e.x, e.y - 4, Math.min(placed + 2, 7), Cell.Vines, vineColor, 0.8);
    }
  }

  private disturbLair(e: Enemy, tx: number, ty: number): void {
    const ctx = this.ctx;
    this.weaveThread(e, tx, ty);
    e.webPulse = Math.max(e.webPulse ?? 0, 18);
    ctx.critters.scatter(e.x, e.y - 8, 96, 2.2);
    ctx.vineStrands.applyRadialImpulse(e.x, e.y - 20, 115, 3.4);
    this.shakeAt(e.x, e.y, 0.012, 0.035);
  }

  private findWeaverAnchor(e: Enemy): CellCandidate | null {
    const w = this.ctx.world;
    const cx = Math.floor(e.x);
    const cy = Math.floor(e.y);
    let best: CellCandidate | null = null;
    for (let dy = -28; dy <= 18; dy += 3) {
      for (let dx = -82; dx <= 82; dx += 4) {
        const x = cx + dx;
        const y = cy + dy;
        if (!w.inBounds(x, y)) continue;
        const t = w.types[w.idx(x, y)];
        const growth = isSoftGrowth(t);
        if (!growth && !blocksEntity(t)) continue;
        const exposed =
          (w.inBounds(x, y - 1) && !this.ctx.physics.cellBlocks(x, y - 1)) ||
          (w.inBounds(x - 1, y) && !this.ctx.physics.cellBlocks(x - 1, y)) ||
          (w.inBounds(x + 1, y) && !this.ctx.physics.cellBlocks(x + 1, y)) ||
          (w.inBounds(x, y + 1) && !this.ctx.physics.cellBlocks(x, y + 1));
        if (!exposed) continue;
        const sidePenalty = Math.abs(dx) < 12 ? 80 : 0;
        const growthBonus = growth ? -140 : 0;
        const d2 = dx * dx + dy * dy * 1.25 + sidePenalty + growthBonus;
        if (!best || d2 < best.d2) best = { x, y, d2 };
      }
    }
    return best;
  }

  private weaverNeedleStrike(e: Enemy, tx: number, ty: number): void {
    const ctx = this.ctx;
    const x = Math.floor(clamp(tx, 3, WIDTH - 4));
    const y = Math.floor(clamp(ty, 8, HEIGHT - 8));
    ctx.particles.burst(x, y, 9, Cell.Sand, stoneColor, 1.5);
    ctx.audio.hollowKnock();
    this.shakeAt(x, y, 0.008, 0.035);
    if (ctx.world.inBounds(x, y) && blocksEntity(ctx.world.types[ctx.world.idx(x, y)])) return;
    const dx = ctx.player.x - x;
    const dy = ctx.player.y - 8 - y;
    if (!ctx.player.dead && Math.abs(dx) < 15 && Math.abs(dy) < 18) {
      ctx.playerCtl.damage(18 * (e.dmgK ?? 1), Math.sign(ctx.player.x - e.x || 1) * 4.0, -2.2);
      ctx.particles.burst(ctx.player.x, ctx.player.y - 8, 7, Cell.Blood, bloodColor, 1.4);
    }
  }

  private wakeWeaver(
    e: Enemy,
    source: 'proximity' | 'harm' | 'disturbance',
    tx = e.x,
    ty = e.y,
  ): void {
    const ctx = this.ctx;
    e.sleeping = false;
    e.alerted = true;
    e.blink = 0;
    const disturbed = source === 'disturbance';
    if (disturbed) {
      e.cranky = Math.max(e.cranky ?? 0, WEAVER_CRANKY_FRAMES);
      e.recoil = Math.max(e.recoil ?? 0, 10);
      e.attackCd = Math.min(e.attackCd, 24);
      const dir = Math.sign(tx - e.x || ctx.player.x - e.x || 1);
      e.vx += dir * 0.42;
      this.disturbLair(e, tx, ty);
    } else {
      e.windup = Math.max(e.windup ?? 0, source === 'harm' ? 8 : 14);
      e.attackCd = Math.max(e.attackCd, 34);
      e.webPulse = Math.max(e.webPulse ?? 0, 10);
    }
    ctx.audio.tone(disturbed ? 130 : 160, disturbed ? 55 : 70, disturbed ? 0.38 : 0.28, 'triangle', 0.08);
    ctx.particles.burst(e.x, e.y - this.defs[e.kind].h, disturbed ? 12 : 8, Cell.Vines, vineColor, 1.1);
  }

  private wakeSleepingWeaversNear(
    x: number,
    y: number,
    radius: number,
    source: 'disturbance',
  ): number {
    const r2 = radius * radius;
    let woken = 0;
    for (const e of this.ctx.enemies) {
      if (e.kind !== 'weaver' || !e.sleeping) continue;
      const def = this.defs[e.kind];
      const dx = e.x - x;
      const dy = e.y - def.h * 0.5 - y;
      if (dx * dx + dy * dy > r2) continue;
      this.wakeWeaver(e, source, x, y);
      woken++;
    }
    return woken;
  }

  private findWeaverPrey(e: Enemy, radius = 86): Critter | null {
    const r2 = radius * radius;
    let best: Critter | null = null;
    let bestD2 = r2;
    for (const cr of this.ctx.critters.list) {
      if (!WEAVER_PREY.has(cr.kind)) continue;
      const dx = cr.x - e.x;
      const dy = cr.y - (e.y - 8);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        best = cr;
        bestD2 = d2;
      }
    }
    return best;
  }

  private weaverFeed(e: Enemy): boolean {
    const prey = this.findWeaverPrey(e);
    if (!prey) return false;
    const dx = prey.x - e.x;
    const dy = prey.y - (e.y - 8);
    const d = Math.hypot(dx, dy) || 1;
    if (d < 12) {
      this.ctx.particles.burst(prey.x, prey.y, 5, null, () => packRGB(150, 165, 105), 0.9, {
        grav: 0.04,
      });
      this.ctx.critters.remove(prey);
      e.hp = Math.min(e.maxHp, e.hp + 14);
      e.recoil = Math.max(e.recoil ?? 0, 10);
      e.weaverFeedT = Math.max(e.weaverFeedT ?? 0, 18);
      e.attackCd = Math.max(e.attackCd, 22);
      this.ctx.audio.squelch();
      return true;
    }

    const support = e.weaverSupport ?? 0;
    e.vx += (dx / d) * (0.055 + support * 0.035);
    if (e.grounded && Math.abs(dx) < 10 && dy < -12) e.vy -= 0.08;
    if (d < 34) e.weaverFeedT = Math.max(e.weaverFeedT ?? 0, 8);
    return true;
  }

  /** True if the cell just ahead of a grounded walker (foot ±1, in dir) is lethal
   *  to it — used so it refuses to voluntarily step into lava/fire/acid. */
  private lethalAhead(e: Enemy, def: EnemyDef, dir: number): boolean {
    const w = this.ctx.world;
    const X = Math.floor(e.x) + dir * (def.halfW + 1);
    const foot = Math.floor(e.y);
    for (let Y = foot - 1; Y <= foot + 1; Y++) {
      if (w.inBounds(X, Y) && enemyLethalCell(e.kind, w.types[w.idx(X, Y)])) return true;
    }
    return false;
  }

  /** True if there's no floor just ahead within a short, steppable drop — the lip
   *  of a hole/cliff. A grounded Weaver uses this to refuse to stride out over a
   *  drop it can't step down into (so it stops at the edge and reaches/recentres
   *  instead of walking off into the void it just had dug out from under it).
   *  `depth` is how far down it will tolerate a step before calling it a void. */
  private dropAhead(e: Enemy, def: EnemyDef, dir: number, depth = 12): boolean {
    const w = this.ctx.world;
    const X = Math.floor(e.x) + dir * (def.halfW + 2);
    const foot = Math.floor(e.y);
    for (let Y = foot - 1; Y <= foot + depth; Y++) {
      if (w.inBounds(X, Y) && this.ctx.physics.cellBlocks(X, Y)) return false; // floor within reach
    }
    return true;
  }

  /** A surface a spider leg can grip: load-bearing terrain OR soft growth (vines,
   *  moss — it hooks its claws into those too). Matches the renderer's foothold
   *  test so the legs visibly land where the climb AI believes there's purchase. */
  private climbGrips(x: number, y: number): boolean {
    const w = this.ctx.world;
    if (!w.inBounds(x, y)) return false;
    const t = w.types[w.idx(x, y)];
    return blocksEntity(t) || isSoftGrowth(t);
  }

  /** Climb height of the wall column standing at world `X` beside `foot`: 0 unless
   *  there's grippable terrain beside the foot (so a high ledge with clear air at
   *  foot level doesn't read as a wall), else the unbroken rise above it. A giant
   *  spider scales anything that out-tops the 6-cell step it can stride. */
  private wallColumnHeight(X: number, foot: number): number {
    const w = this.ctx.world;
    let footed = false;
    for (let Y = foot - 1; Y <= foot + 2; Y++) {
      if (this.climbGrips(X, Y)) { footed = true; break; }
    }
    if (!footed) return 0;
    let h = 0;
    for (let Y = foot - 1; Y >= foot - 96; Y--) {
      if (!w.inBounds(X, Y)) break;
      if (this.climbGrips(X, Y)) h = foot - Y;
      else break; // first clear cell up the face is the top of this wall
    }
    return h;
  }

  /** Height of a climbable wall immediately ahead in `dir` (adjacent to the body). */
  private weaverWallAhead(e: Enemy, def: EnemyDef, dir: number): number {
    return this.wallColumnHeight(Math.floor(e.x) + dir * (def.halfW + 1), Math.floor(e.y));
  }

  /** Nearest sheer wall (taller than a step-over) within `maxDist` to either side —
   *  where the spider should march to BEGIN a climb when its quarry is perched
   *  overhead and out of stride-reach. Nearest wins; ties break toward `prefer`. */
  private weaverSeekWall(e: Enemy, def: EnemyDef, maxDist: number, prefer: number): number {
    const foot = Math.floor(e.y);
    const base = Math.floor(e.x);
    const order = prefer >= 0 ? [1, -1] : [-1, 1];
    for (let dist = def.halfW + 1; dist <= maxDist; dist++) {
      for (const dir of order) {
        if (this.wallColumnHeight(base + dir * dist, foot) > 7) return dir;
      }
    }
    return 0;
  }

  private enemyEnvironmentDamage(e: Enemy, index?: number): void {
    const ctx = this.ctx;
    const def = this.defs[e.kind];
    let dmg = 0;
    for (let dy = 0; dy < def.h; dy += 2) {
      const X = Math.floor(e.x),
        Y = Math.floor(e.y) - dy;
      if (!ctx.world.inBounds(X, Y)) continue;
      const c = ctx.world.types[ctx.world.idx(X, Y)];
      if (enemyLethalCell(e.kind, c)) dmg += c === Cell.Lava ? 1.6 : c === Cell.Acid ? 0.9 : 0.7;
    }
    if (dmg <= 0) return;
    if ((e.envDamageFeedbackCd ?? 0) <= 0) {
      e.envDamageFeedbackCd = ENV_DAMAGE_FEEDBACK_COOLDOWN;
      e.flash = Math.max(e.flash, 2);
      ctx.particles.burst(e.x, e.y - 5, 3, Cell.Smoke, smokeColor, 0.7, { grav: 0.02 });
    }
    e.hp -= dmg;
    if (e.hp <= 0) {
      if (index === undefined) this.kill(e, 0, 0);
      else this.killAt(index, e, 0, 0);
    }
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const enemies = ctx.enemies;
    const player = ctx.player;
    const targetAlive = !player.dead;
    const debugEnemyAttacksSuppressed = ctx.debug?.active === true;

    const sim = ctx.world.simBounds;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e) continue;
      const def = this.defs[e.kind];
      // Freeze foes far outside the simulation window — they wake when you approach
      if (e.x < sim.x0 - 60 || e.x > sim.x1 + 60 || e.y < sim.y0 - 60 || e.y > sim.y1 + 60)
        continue;
      // Debug freeze (Runtime panel): a posed/dragged foe skips its AI entirely
      // while the renderer keeps drawing it (and solving a held Weaver's legs).
      if (ctx.debug.frozenEnemy(e)) continue;
      if (e.flash > 0) e.flash--;
      if ((e.envDamageFeedbackCd ?? 0) > 0) e.envDamageFeedbackCd = (e.envDamageFeedbackCd ?? 0) - 1;
      if ((e.wary ?? 0) > 0) e.wary = (e.wary ?? 0) - 1;
      if ((e.cranky ?? 0) > 0) e.cranky = (e.cranky ?? 0) - 1;
      if ((e.webPulse ?? 0) > 0) e.webPulse = (e.webPulse ?? 0) - 1;
      if ((e.weaverFeedT ?? 0) > 0) e.weaverFeedT = (e.weaverFeedT ?? 0) - 1;
      if ((e.weaverCrest ?? 0) > 0) e.weaverCrest = (e.weaverCrest ?? 0) - 1;
      e.timer++;
      if (e.attackCd > 0 && !debugEnemyAttacksSuppressed) e.attackCd--;
      this.enemyEnvironmentDamage(e, i);
      if (enemies[i] !== e) continue; // died from environment

      // Sim-sampled statuses (DESIGN pillar 5/9): every 2nd frame the cells
      // touching the body ARE the status — damage lands straight on hp (no
      // flash), and a frozen body's horizontal speed is scaled once per sample.
      if (e.timer % 2 === 0) {
        const eff = sampleAndTickStatus(ctx, e, def.halfW, def.h, STATUS_IMMUNE[e.kind], 2);
        if (eff.damage > 0) e.hp -= eff.damage;
        if (e.hp <= 0) {
          this.killAt(i, e, 0, 0);
          continue;
        }
        if (eff.slowFactor !== 1) e.vx *= eff.slowFactor;
      }

      // Gust-launched foes fly ballistically (AI + flight cap suppressed) until
      // they land, slow, or smash into a wall — see gustShove/tickKnock.
      if (this.tickKnock(e, def)) continue;

      const pdx = player.x - e.x,
        pdy = player.y - 9 - (e.y - 5);
      const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
      const canAttackTarget = targetAlive && !debugEnemyAttacksSuppressed;

      // THE NOTICE: the first time a foe clocks you, it says so — a blip and
      // a spark of attention over its head. The colossus announces itself
      // rather more thoroughly.
      if (!e.alerted && targetAlive && pDist < 300 * difficultyMods(ctx.state).enemySense && e.kind !== 'eggs' && !e.sleeping) {
        e.alerted = true;
        if (e.kind === 'colossus') {
          ctx.audio.tone(46, 110, 0.9, 'sawtooth', 0.22);
          ctx.audio.groan();
          this.shakeAt(e.x, e.y, 0.025, 0.04);
        } else if (e.kind === 'leviathan') {
          // a deep churn under the surface — the pool itself announces it
          ctx.audio.tone(58, 30, 0.8, 'sine', 0.2);
          ctx.audio.groan();
          ctx.particles.burst(e.x, e.y - 14, 16, null, () => packRGB(150, 220, 255), 1.8, {
            glow: 1.4,
            grav: -0.03,
          });
          this.shakeAt(e.x, e.y, 0.02, 0.04);
        } else {
          ctx.audio.alert();
          ctx.particles.burst(e.x, e.y - def.h - 3, 3, null, () => packRGB(255, 245, 200), 0.8, {
            glow: 1.6,
            grav: -0.02,
          });
        }
      }

      // AUTHORED PATROLS EARN DE-ALERT (Rain World texture): a patroller
      // that loses you for ~5 seconds shrugs and returns to its route.
      // Strictly gated on Builder-authored patrol — generated enemies keep
      // their one-way alert exactly as before.
      if (e.alerted && e.patrol && e.patrol.length > 0 && e.kind !== 'colossus') {
        if (!targetAlive || pDist > 300) {
          e.calmT = (e.calmT ?? 0) + 1;
          if (e.calmT > 300) {
            e.alerted = false;
            e.calmT = 0;
            // a dim gray puff: the scent went cold
            ctx.particles.burst(e.x, e.y - def.h - 3, 2, null, () => packRGB(150, 158, 170), 0.6, {
              glow: 1.1,
              grav: -0.015,
            });
          }
        } else e.calmT = 0;
      }

      // WOUNDED TELLS: under 30% a body leaks — you can read who is nearly done.
      if (e.hp < e.maxHp * 0.3 && e.timer % 26 === 0 && e.kind !== 'eggs') {
        ctx.particles.spawn(
          e.x + (Math.random() - 0.5) * def.halfW,
          e.y - Math.random() * def.h * 0.6,
          (Math.random() - 0.5) * 0.2,
          0.4,
          null,
          def.goreFn(),
          30,
          { grav: 0.1 },
        );
      }

      if (e.kind === 'slime' || e.kind === 'acidslime') {
        e.vy += 0.3;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if (e.grounded) {
          e.vx *= 0.6;
          // ANTICIPATION (Rain World): the body visibly gathers before it
          // leaps — the old instant hops now charge through a short windup.
          if (!e.windup) {
            if (targetAlive && pDist < 260 && e.timer % 50 === 0) e.windup = 7;
            else if (e.timer % 130 === 0) e.windup = 12; // a lazy wander gathers longer
          } else {
            e.windup--;
            if (e.windup === 0) {
              // wounded slimes spring shallow and crooked
              const hurtK = e.hp / e.maxHp < 0.4 ? 0.55 + Math.random() * 0.3 : 1;
              if (targetAlive && pDist < 260) {
                e.vx = Math.sign(pdx) * (1.8 + Math.random() * 0.9) * hurtK;
                e.vy = (-3.1 - Math.random() * 1.0) * hurtK;
              } else if (!e.alerted && e.patrol && e.patrol.length > 0) {
                // PATROL (Builder-authored): hop along the waypoint loop
                const wp = e.patrol[(e.patrolIdx ?? 0) % e.patrol.length];
                if (Math.abs(wp[0] - e.x) < 14)
                  e.patrolIdx = ((e.patrolIdx ?? 0) + 1) % e.patrol.length;
                e.vx = (Math.sign(wp[0] - e.x) || 1) * (1.5 + Math.random() * 0.7) * hurtK;
                e.vy = (-2.6 - Math.random() * 0.6) * hurtK;
              } else {
                e.vx = (Math.random() - 0.5) * 2.8 * hurtK;
                e.vy = -2.4 * hurtK;
              }
            }
          }
        }
        // Corrosive trail: an acid slime sweats one real acid cell at its feet
        if (e.kind === 'acidslime' && e.timer % 14 === 0) {
          const tx = Math.floor(e.x);
          for (let dy = 0; dy <= 1; dy++) {
            const ty = Math.floor(e.y) + dy;
            if (!ctx.world.inBounds(tx, ty)) break;
            const ti = ctx.world.idx(tx, ty);
            if (ctx.world.types[ti] === Cell.Empty) {
              ctx.world.replaceCellAt(ti, Cell.Acid, acidColor());
              break;
            }
          }
        }
        // Melee contact
        if (canAttackTarget && e.attackCd === 0 && Math.abs(pdx) < 11 && Math.abs(pdy) < 17) {
          ctx.playerCtl.damage(
            (e.kind === 'acidslime' ? 10 : 12) * (e.dmgK ?? 1),
            Math.sign(pdx) * -3.6,
            -2.8,
          );
          e.attackCd = 45;
        }
      } else if (e.kind === 'eggs') {
        // Slime egg clutch: sits glistening, then hatches — sooner if you
        // loom over it. Killing it normally pays the small bounty instead.
        e.vy += 0.3;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if (e.grounded) e.vy = 0;
        const due =
          !debugEnemyAttacksSuppressed &&
          (e.timer > 1400 + e.bobPhase * 220 || (targetAlive && pDist < 36 && e.timer > 240));
        if (due) {
          const brood = 2 + (e.bobPhase > Math.PI ? 1 : 0);
          for (let b2 = 0; b2 < brood; b2++) {
            ctx.enemyCtl.spawn('slime', e.x + (b2 - 1) * 4, e.y - 2);
          }
          ctx.particles.burst(e.x, e.y - 3, 14, Cell.Slime, slimeColor, 2.0);
          ctx.audio.squelch();
          ctx.events.emit('toast', { text: 'AN EGG CLUTCH HATCHES' });
          this.removeEnemyAt(i);
          continue;
        }
      } else if (e.kind === 'bat') {
        // Roosting (Wave F): hangs dormant from the ceiling until disturbed
        if (e.sleeping) {
          e.vx = 0;
          e.vy = 0;
          if (targetAlive && pDist < 70) {
            e.sleeping = false;
            e.vy = 1.2; // drop off the ceiling
            ctx.audio.tone(1900 + Math.random() * 600, 2600, 0.08, 'square', 0.06);
          }
          continue;
        }
        // Erratic flying swarmer: darts at the wizard, contact bites.
        // Wave F predation: a moth nearby is easier prey than the wizard.
        e.bobPhase += 0.22;
        let hunting = false;
        if (!targetAlive || pDist > 120) {
          let prey = null as Critter | null;
          const critters = ctx.critters.list;
          for (let ci2 = 0; ci2 < critters.length; ci2++) {
            const cr = critters[ci2];
            if (cr.kind !== 'moth') continue;
            const cdx = cr.x - e.x,
              cdy = cr.y - e.y;
            if (cdx * cdx + cdy * cdy < 70 * 70) {
              prey = cr;
              break;
            }
          }
          if (prey) {
            hunting = true;
            const cdx = prey.x - e.x,
              cdy = prey.y - e.y;
            const cd = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
            e.vx += (cdx / cd) * 0.16;
            e.vy += (cdy / cd) * 0.16;
            if (cd < 4) {
              // gulp: a puff of wing dust and the moth is gone
              ctx.particles.burst(prey.x, prey.y, 3, null, () => packRGB(150, 140, 110), 0.8);
              ctx.critters.remove(prey);
            }
          }
        }
        // Wounded wings fail in bursts (Rain World body language): a
        // flutter-tumble that sinks and scrambles before the bat recovers.
        if (e.hp / e.maxHp < 0.4 && !e.tumble && Math.random() < 0.012) e.tumble = 14;
        if (e.tumble) {
          e.tumble--;
          e.vx += (Math.random() - 0.5) * 0.5;
          e.vy += 0.18;
        } else if (e.windup) {
          // ANTICIPATION: brake and flare the wings for a beat — THEN the dart
          if (!debugEnemyAttacksSuppressed) e.windup--;
          e.vx *= 0.72;
          e.vy = e.vy * 0.72 - 0.06; // hover-lift while flaring
          if (e.windup === 0 && canAttackTarget) {
            const d = pDist || 1;
            e.swoop = 12;
            e.vx = (pdx / d) * 2.5;
            e.vy = (pdy / d) * 2.5;
            ctx.audio.tone(1500, 900, 0.05, 'square', 0.04);
          }
        } else if (!hunting && targetAlive && pDist < 320) {
          const d = pDist || 1;
          e.vx += (pdx / d) * 0.14;
          e.vy += (pdy / d) * 0.14;
          if (canAttackTarget && pDist < 64 && e.attackCd === 0 && !e.swoop) e.windup = 8;
        } else if (!hunting) {
          e.vx += (Math.random() - 0.5) * 0.1;
          e.vy += (Math.random() - 0.5) * 0.1;
        }
        if (e.swoop && !debugEnemyAttacksSuppressed) e.swoop--;
        e.vy += Math.sin(e.bobPhase) * 0.08;
        // a committed dart briefly outruns the normal flight cap
        const batMax = e.swoop ? 2.6 : 1.7;
        e.vx = clamp(e.vx, -batMax, batMax);
        e.vy = clamp(e.vy, -batMax, batMax);
        if (!ctx.physics.entityFree(e.x, e.y, def.halfW, def.h)) {
          e.y -= 1;
          e.vy = -0.6;
        }
        if (canAttackTarget && e.attackCd === 0 && Math.abs(pdx) < 8 && Math.abs(pdy) < 12) {
          ctx.playerCtl.damage(6 * (e.dmgK ?? 1), Math.sign(pdx) * -2.2, -1.6);
          e.attackCd = 50;
          // dart away after the bite
          e.vx = -Math.sign(pdx) * 1.6;
          e.vy = -1.0;
        }
      } else if (e.kind === 'spitter') {
        // Rooted toxic bulb: settles, then lobs caustic globs in an arc
        e.vy += 0.33;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        e.vx *= 0.4;
        if ((e.recoil ?? 0) > 0) e.recoil = (e.recoil ?? 0) - 1;
        if (canAttackTarget && e.attackCd === 0 && pDist < 280) {
          const arc = Math.atan2(pdy - Math.min(60, pDist * 0.35), pdx);
          const spd = 2.6 + pDist * 0.006;
          ctx.projectiles.push({
            x: e.x,
            y: e.y - def.h,
            vx: Math.cos(arc) * spd,
            vy: Math.sin(arc) * spd - 1.4,
            type: 'acidglob',
            life: 220,
            age: 0,
            charging: false,
            hostile: true,
          });
          ctx.audio.flame();
          e.recoil = 14;
          e.attackCd = 150 + Math.floor(Math.random() * 50);
        }
      } else if (e.kind === 'bomber') {
        // Fast hopping slime that fuses and detonates when close
        e.vy += 0.3;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if ((e.fusing ?? 0) > 0) {
          if (!debugEnemyAttacksSuppressed) e.fusing = (e.fusing ?? 0) - 1;
          e.vx *= 0.5;
          if (e.fusing === 0) {
            this.killAt(i, e, 0, 0);
            continue;
          }
        } else {
          if (e.grounded) {
            e.vx *= 0.6;
            if (targetAlive && pDist < 300 && e.timer % 32 === 0) {
              e.vx = Math.sign(pdx) * (2.4 + Math.random() * 0.8);
              e.vy = -2.8 - Math.random() * 0.8;
            } else if (!e.alerted && e.patrol && e.patrol.length > 0 && e.timer % 110 === 0) {
              // PATROL (Builder-authored): hop along the waypoint loop
              const wp = e.patrol[(e.patrolIdx ?? 0) % e.patrol.length];
              if (Math.abs(wp[0] - e.x) < 14)
                e.patrolIdx = ((e.patrolIdx ?? 0) + 1) % e.patrol.length;
              e.vx = (Math.sign(wp[0] - e.x) || 1) * (2.0 + Math.random() * 0.6);
              e.vy = -2.2;
            } else if (e.timer % 110 === 0) {
              e.vx = (Math.random() - 0.5) * 3.0;
              e.vy = -2.2;
            }
          }
          if (canAttackTarget && pDist < 34) {
            e.fusing = 36; // light the fuse
            ctx.audio.tone(900, 60, 0.3, 'square', 0.1);
          }
        }
      } else if (e.kind === 'weaver') {
        // The Weaver reads its footing, then controls the room by writing
        // real vine strands. The legs are rendered with IK; the grid mechanics
        // are here so burning/cutting growth changes how confidently it moves.
        e.vy += 0.32;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if (e.timer % 6 === 0) {
          e.weaverSupport = this.weaverFooting(e, def);
          const physical = this.weaverPhysicalFooting(e);
          e.weaverPhysicalSupport = physical.support;
          e.weaverAnchorCount = physical.anchors;
          e.weaverSupportCenterX = physical.centerX;
        }
        const support = e.weaverSupport ?? 0;
        const physicalSupport = e.weaverPhysicalSupport ?? (e.grounded ? 0.45 : 0);
        const anchorCount = e.weaverAnchorCount ?? (physicalSupport > 0.35 ? 4 : 0);
        const visualSupport = e.weaverVisualSupport ?? physicalSupport;
        const cranky = (e.cranky ?? 0) > 0;
        // Footing loss keys off REAL TERRAIN under the body, not the renderer's
        // per-frame planted-leg count: a brisk gait swings 3-4 legs at once, and
        // folding that into "unsupported" made the Weaver flicker into recovery on
        // every stride — flailing its legs and stalling its own chase. The visual
        // plant count only escalates an ALREADY-physical crisis (the deep-stranded
        // confirmation below), never invents one on solid ground.
        const unsupported = physicalSupport < 0.34 || anchorCount < 3;
        e.weaverFallT = unsupported ? Math.min(90, (e.weaverFallT ?? 0) + 1) : Math.max(0, (e.weaverFallT ?? 0) - 3);
        const panic = clamp((e.weaverFallT ?? 0) / 45, 0, 1);
        // Footing CRISIS keys off real load-bearing terrain, NOT preferred growth:
        // plain stone is perfectly stable footing (growth merely makes it better
        // and faster — see confidence/maxWeaverSpeed below). The Weaver only drops
        // into recovery / no-attack when it PHYSICALLY loses its footing, so on a
        // bare-stone arena it still stands tall, chases, and strikes normally.
        const unstable = unsupported || (e.weaverFallT ?? 0) > 16;
        const confidence = 0.62 + support * 0.36 + physicalSupport * 0.28 + (cranky ? 0.25 : 0) - panic * 0.2;

        if ((e.recoil ?? 0) > 0) e.recoil = (e.recoil ?? 0) - 1;

        if (e.sleeping) {
          e.vx = 0;
          e.vy = 0;
          const forcedAwake = e.hp < e.maxHp || e.status.burning > 0 || e.status.electrified > 0;
          if (forcedAwake || (targetAlive && pDist < 82)) {
            this.wakeWeaver(e, forcedAwake ? 'harm' : 'proximity');
          } else if (!debugEnemyAttacksSuppressed && e.timer % 180 === 0) {
            this.weaveThread(e, e.x + (Math.random() - 0.5) * 28, e.y - 18 - Math.random() * 18);
          }
          continue;
        }

        // Continuous balance: ALWAYS ease the body toward the centre of its real
        // footing, so it never teeters out over a hole — ~0 when well-centred,
        // firm when a foot region has dropped away. This is the decisive "back
        // onto solid ground / stand up properly" correction, and it runs whether
        // or not the creature has tipped into the full recovery state.
        const balanceDx = (e.weaverSupportCenterX ?? e.x) - e.x;
        // Recentre over solid footing — but ONLY in a real footing crisis (the load
        // under it is actually gone). The support centroid is resampled every 6
        // frames, so on good ground it always trails a walking body by a stride, and
        // it also drifts toward whichever side has a wall — so recentring-while-OK
        // both crawled the chase to a halt AND shoved the Weaver back off any wall it
        // approached to climb. Below the crisis line the unstable block already owns
        // recovery; above it, just let the legs walk.
        // ...and never while scaling/cresting a wall (weaverCrest>0): the centroid lags
        // toward the face it just left and would haul the body back off the climb.
        // Fires in a crisis (small imbalance) OR whenever the support has shifted HARD
        // to one side — teetering on the lip of a hole — even if the footing metric
        // hasn't tipped to "unsupported" (a half-cut floor reads as pSup~0.38, not a
        // crisis, yet the body is hanging over the void and must shuffle onto solid
        // ground). A normal stride's centroid lag is small, so the wide gate is safe.
        // Teetering = the support has shifted hard to one side AND there's an actual
        // VOID on the opposite (unsupported) side — i.e. the body is hanging over the
        // lip of a hole and must shuffle back onto solid ground. The void check is what
        // separates this from a brisk walk: a fast body trails its 6-frame support
        // centroid by >16 too, but on full ground there's NO drop on the lagging side,
        // so recentring (which would haul the chase to a crawl — the known pitfall)
        // stays off. dropAhead probes the side away from the centroid.
        const recenterDir = Math.sign(balanceDx);
        const voidSide = -recenterDir;
        // ...but NOT when that void is the way DOWN to the quarry: at the lip of a
        // ledge with prey below on the drop side, it should descend (chase), not back
        // away. Mirrors the chase's chasingDownOverEdge so the two never fight.
        const descendingToPrey = pdy > 10 && Math.sign(pdx || 1) === voidSide;
        const teetering =
          Math.abs(balanceDx) > 14 &&
          recenterDir !== 0 &&
          !descendingToPrey &&
          this.dropAhead(e, def, voidSide, 8);
        if (anchorCount >= 1 && Math.abs(balanceDx) > 5 && (unsupported || teetering) && (e.weaverCrest ?? 0) === 0) {
          e.vx += clamp(balanceDx * 0.03, -0.3, 0.3);
        }

        // --- WALL CLIMB: a giant spider scales sheer walls its legs can grip ----
        // When the quarry is up and out of stride-reach behind a wall taller than
        // the 6-cell step it can manage, the Weaver latches onto the face and walks
        // straight up it (the render IK grips left/right-wall footholds on its own),
        // then crests onto the ledge via the same step-up that mounts low ledges.
        // Clinging reads as "unsupported" to the footing metric, so the climb must
        // OWN movement this frame — it suppresses the stranded-recovery flailing and
        // the fall, and drives its own up-the-wall velocity past the balance nudge.
        let climbing = false;
        let climbDir = e.weaverClimbDir ?? 0;
        let climbWall = 0; // height of the adjacent wall this frame (drives the ascent)
        if (e.alerted && targetAlive && !e.sleeping) {
          const targetAbove = pdy < 8; // quarry at or above the body (pdy<0 ⇒ above)
          const toward = Math.sign(pdx) || climbDir || 1;
          let bestDir = 0;
          let bestH = 0;
          for (const d of toward >= 0 ? [1, -1] : [-1, 1]) {
            const h = this.weaverWallAhead(e, def, d);
            if (h > bestH) {
              bestH = h;
              bestDir = d;
            }
          }
          const climbedT = e.weaverClimbT ?? 0;
          // A wall taller than a step-over standing toward the quarry is a BARRIER
          // between them — scale it whether the quarry is overhead OR level/below on
          // the far side (climb up, crest, descend). Engaging only on "quarry above"
          // left it pinned against a wall when the alchemist stood across a pillar at
          // the same height — exactly the stuck-walking-into-the-wall the report shows.
          // Engage when a wall taller than a step-over is a BARRIER between us and the
          // quarry: either the quarry is overhead, or it's level/below on the far side
          // of a wall that lies TOWARD it (bestDir === the way to the quarry). The
          // direction check matters — without it, a weaver teetering on the lip of a
          // cut-away floor would scramble UP the hole's edge (a wall on the side AWAY
          // from the quarry) instead of recentring onto solid ground.
          const barrierAhead =
            bestH > 7 && (targetAbove || (Math.abs(pdx) > def.halfW + 2 && bestDir === Math.sign(pdx)));
          if (barrierAhead) {
            climbing = true;
            climbDir = bestDir;
            climbWall = bestH;
          } else if (climbedT > 0 && climbedT < 600 && !e.grounded && climbDir !== 0) {
            // latched mid-climb: stay on the wall through the crest until we mount a
            // ledge (grounded) or the wall genuinely ends. Crucially this no longer
            // requires the quarry to stay overhead — once the spider rises above a
            // level target it must keep climbing to crest, not release into a fall.
            const stillWall = this.weaverWallAhead(e, def, climbDir);
            if (stillWall > 3 || climbedT < 50) {
              climbing = true;
              climbWall = stillWall;
            }
          }
        }
        if (climbing) {
          if ((e.weaverClimbT ?? 0) === 0) {
            // latch-on: a grip chirp + a puff of silk where the claws bite in
            ctx.audio.tone(150, 70, 0.3, 'triangle', 0.07);
            ctx.particles.burst(e.x + climbDir * (def.halfW + 1), e.y - def.h * 0.4, 4, Cell.Smoke, smokeColor, 0.5, { grav: -0.01 });
          }
          // committed to the wall: cancel any ranged telegraph that would root it and
          // drop the climb (the on/off flicker that read as helpless flailing).
          e.blink = 0;
          e.windup = 0;
          e.needleX = undefined;
          e.needleY = undefined;
          e.weaverClimbDir = climbDir;
          e.weaverClimbT = (e.weaverClimbT ?? 0) + 1;
          e.weaverFallT = 0; // it is holding the wall, not falling
          // refresh the crest window so that, the moment it mounts the top, the chase
          // can still drag it ACROSS and off the far lip before footing-recovery would
          // otherwise strand it on a too-narrow crest.
          e.weaverCrest = 26;
        } else {
          e.weaverClimbDir = 0;
          e.weaverClimbT = 0;
        }
        // Cresting: just came off a climb and is scrabbling over the top. Footing
        // reads unstable here (legs splayed across the lip), but recovery must NOT own
        // movement — the chase has to carry it over and down toward the quarry.
        // It also can't "settle" on a top narrower than its own body, so while it's
        // perched above a quarry that's across AND below, keep the crest alive: the
        // chase then flows it over the thin lip and down the far face instead of
        // teetering in place and re-centring forever.
        // ONLY sustains a crest a CLIMB actually started (weaverCrest already >0):
        // it must never invent one during a footing-loss recovery (cut-away floor),
        // where the weaver has to recentre onto solid ground, not chase off the lip.
        const onNarrowCrest =
          !climbing &&
          (e.weaverCrest ?? 0) > 0 &&
          unstable &&
          e.grounded &&
          pdy > 10 &&
          Math.abs(pdx) > def.halfW + 2 &&
          e.y < player.y - 16;
        if (onNarrowCrest) e.weaverCrest = Math.max(e.weaverCrest ?? 0, 12);
        const cresting = !climbing && (e.weaverCrest ?? 0) > 0;

        if (unstable && !climbing && !cresting) {
          // Only when truly STRANDED (nothing load-bearing under it) does it lunge
          // for a far anchor to bridge to; partial footing is handled by the
          // continuous balance above, which pulls it back over solid ground.
          // (Suppressed while cresting — there the chase, not recovery, owns motion.)
          const hasFooting = anchorCount >= 1 || physicalSupport > 0.1;
          const anchor = this.findWeaverAnchor(e);
          if (anchor) {
            const dx = anchor.x - e.x;
            const dy = anchor.y - e.y;
            const d = Math.hypot(dx, dy) || 1;
            const seekK = hasFooting ? 0.05 : 0.14; // lunge hard only when stranded over the void
            e.vx += (dx / d) * (seekK + panic * 0.09);
            if (anchorCount >= 4 && physicalSupport > 0.48 && e.vy > 0) {
              e.vy *= 0.9;
            } else if (dy < -4 && e.timer % 10 === 0) {
              e.vy -= 0.04 + panic * 0.055;
            }
            if (Math.abs(dx) > 18) e.vx += Math.sign(dx) * 0.03 * panic;
            if (e.timer % 15 === 0) this.weaveFootTrail(e, support);
          } else if (e.timer % 7 === 0) {
            this.weaveFootTrail(e, support);
          }
          if (unsupported) {
            e.attackCd = Math.max(e.attackCd, 28);
            e.webPulse = Math.max(e.webPulse ?? 0, 6);
            if (visualSupport < 0.26) {
              e.grounded = false;
              e.vy += 0.16 + panic * 0.16;
              e.vx *= 0.88;
            }
            if ((e.windup ?? 0) > 0) {
              e.windup = 0;
              e.needleX = undefined;
              e.needleY = undefined;
            }
            if ((e.blink ?? 0) > 0) e.blink = 0;
          }
          if (e.timer % 34 === 0) {
            e.recoil = Math.max(e.recoil ?? 0, 8);
            e.webPulse = Math.max(e.webPulse ?? 0, 10);
            e.vx *= unsupported ? 0.72 : 0.48;
            e.attackCd = Math.max(e.attackCd, 24);
            ctx.particles.burst(e.x, e.y - 3, 5, Cell.Smoke, smokeColor, 0.65, { grav: 0.02 });
          }
        }

        if (e.blink > 0) {
          // Thread-spit telegraph: rooted, then a sagging vine line appears
          // through the air near the alchemist.
          e.vx *= 0.62;
          if (!debugEnemyAttacksSuppressed) e.blink--;
          if (!debugEnemyAttacksSuppressed && e.timer % 3 === 0) {
            ctx.particles.spawn(
              e.x + (Math.random() - 0.5) * 14,
              e.y - 10 - Math.random() * 6,
              (Math.random() - 0.5) * 0.2,
              -0.25,
              null,
              vineColor(),
              18,
              { grav: -0.01, glow: 0.4 },
            );
          }
          if (e.blink === 0 && canAttackTarget) {
            const side = Math.sign(pdx || 1);
            this.weaveThread(e, player.x - side * 10, player.y - 12);
            e.attackCd = 115 + Math.floor(Math.random() * 45);
          }
        } else if ((e.windup ?? 0) > 0) {
          // Needle Step: one foreleg lifts; the sprite exaggerates the poised
          // leg while this countdown holds the body still.
          e.vx *= 0.55;
          if (!debugEnemyAttacksSuppressed) e.windup = (e.windup ?? 1) - 1;
          if (!debugEnemyAttacksSuppressed && e.timer % 4 === 0) {
            ctx.particles.spawn(
              e.needleX ?? player.x,
              e.needleY ?? player.y - 8,
              (Math.random() - 0.5) * 0.12,
              -0.08,
              null,
              vineColor(),
              10,
              { grav: -0.005, glow: 0.35 },
            );
          }
          if (e.windup === 0 && canAttackTarget) {
            this.weaverNeedleStrike(e, e.needleX ?? player.x, e.needleY ?? player.y - 8);
            e.needleX = undefined;
            e.needleY = undefined;
            e.recoil = 12;
            e.attackCd = 95 + Math.floor(Math.random() * 35);
          }
        } else {
          // An irritated (cranky) Weaver is hunting YOU — it won't break off to snack
          // on ambient prey, which previously let it idle-feed instead of giving chase.
          const feeding = !cranky && (!e.alerted || !targetAlive || pDist > 130) && this.weaverFeed(e);
          if (feeding) {
            e.bobPhase += 0.08;
          } else if (!e.alerted && e.patrol && e.patrol.length > 0) {
            const wp = e.patrol[(e.patrolIdx ?? 0) % e.patrol.length];
            if (Math.abs(wp[0] - e.x) < 12) e.patrolIdx = ((e.patrolIdx ?? 0) + 1) % e.patrol.length;
            else if (e.timer % 3 === 0) e.vx += Math.sign(wp[0] - e.x) * 0.07 * confidence;
          } else if (targetAlive && !climbing && (!unstable || cresting) && (cranky || e.timer % 2 === 0)) {
            // Chase pressure yields to footing: while unstable, recovery owns
            // horizontal intent — EXCEPT while cresting, where the chase must carry the
            // body over a narrow top and down the far side toward the quarry.
            // It never strides out over a drop it can't step down
            // into — it stops at the lip and reaches instead of walking into the void.
            const tooClose = pDist < 46;
            let dir = tooClose ? -Math.sign(pdx || 1) : Math.sign(pdx || 1);
            if (!tooClose && Math.abs(pdx) <= 12) dir = 0; // overhead: stand and rear
            // QUARRY OVERHEAD with no horizontal lead to follow: don't just rear and
            // paw — find the nearest wall its claws can grip and march to its base to
            // climb. Only when dir is already 0 (truly overhead); a sideways chase
            // already walks it into the wall on the way, and must NOT be flipped
            // toward some far wall on the OPPOSITE side of the quarry.
            if (dir === 0 && pdy < -18) {
              dir = this.weaverSeekWall(e, def, 70, Math.sign(pdx || 1));
            }
            // Edge-wary so it won't stride into a void it gains nothing from — but a
            // spider WILL go over the lip to chase prey that's down below in that
            // direction (it crests an obstacle then drops/climbs down the far face).
            // Without this it crested a barrier and then froze at the top edge,
            // refusing to descend toward a quarry waiting at the bottom.
            const chasingDownOverEdge = pdy > 10 && Math.sign(pdx || 1) === dir;
            if (dir !== 0 && !chasingDownOverEdge && this.dropAhead(e, def, dir)) dir = 0;
            // PREDATORY STALK: at a stand-off it hunts in deliberate pulses — gather
            // (coil, ease the pace) then surge forward — instead of one flat creep. A
            // cranky Weaver loses the patience and rushes flat-out. weaverStalk carries
            // the wave to the renderer so the body's coil/lunge matches the footwork.
            const stalking = dir !== 0 && !cranky && !tooClose && pDist > 58 && pDist < 260;
            const surgeWave = Math.sin(e.timer * 0.06);
            e.weaverStalk = (e.weaverStalk ?? 0) + ((stalking ? surgeWave : 0) - (e.weaverStalk ?? 0)) * 0.2;
            e.vx += dir * 0.06 * confidence * (stalking ? 1 + 0.75 * surgeWave : 1);
            // a firm extra shove while cresting, to break free of a narrow top instead
            // of teetering on it, and commit to the descent toward the quarry.
            if (cresting && dir !== 0) e.vx += dir * 0.16;
          }

          if (canAttackTarget && e.attackCd === 0 && e.alerted && !unstable) {
            if (Math.abs(pdx) < 13 && Math.abs(pdy) < 20) {
              // Point-blank contact bite: instant (no telegraph this close) and it
              // claims the cooldown, so the needle windup can't also fire this frame.
              // Allowed mid-climb — it can still bite prey it has clung up beside.
              ctx.playerCtl.damage(10 * (e.dmgK ?? 1), Math.sign(pdx || 1) * -3.0, -2.0);
              e.attackCd = 80;
            } else if (!climbing && pDist < 92 && Math.abs(pdy) < 62) {
              // Rooted telegraphs need footing — never start one mid-climb (it would
              // freeze the ascent and drop the Weaver back down the wall).
              e.windup = e.status.burning > 0 ? 10 : cranky ? 12 : 18;
              e.needleX = player.x;
              e.needleY = player.y - 8;
              if (this.findWeaverAnchor(e)) e.webPulse = Math.max(e.webPulse ?? 0, 8);
              ctx.audio.tone(180, 90, 0.35, 'triangle', 0.09);
            } else if (!climbing && pDist < 285) {
              e.blink = e.status.burning > 0 ? 10 : cranky ? 9 : 18;
              ctx.audio.noiseBurst(0.08, 1300, 0.08, true);
            }
          }
        }

        if ((e.grounded || unsupported) && (cranky || support < 0.55) && e.timer % WEAVER_TRAIL_WEB_COOLDOWN === 0) {
          this.weaveFootTrail(e, support);
        }
        e.vx *= e.grounded ? 0.86 : 0.97 - panic * 0.05;
        // While recovering footing the body needs its legs back under it FAST, so
        // a teetering Weaver gets a temporary scramble-speed bump to relocate
        // instead of inching off the lip at the panic-throttled crawl.
        const recovering = unstable && (anchorCount >= 1 || physicalSupport > 0.1);
        const maxWeaverSpeed =
          (e.status.burning > 0 ? 1.0 : 0.72) +
          support * 0.28 +
          physicalSupport * 0.18 +
          (cranky ? 0.22 : 0) +
          (recovering ? 0.5 : 0) -
          panic * 0.16;
        if (climbing) {
          // Haul up the face while there's still wall beside the body; once the foot
          // crests above the wall top (climbWall falls away) hold height and let the
          // lean carry the body over the lip — the integrator's 6-cell step-up mounts.
          // Ascending keys off the WALL, not the quarry's height: a giant spider scales
          // a barrier to reach prey that's level with it on the FAR side (climb up,
          // crest, come down the other side), not only one perched directly overhead.
          const climbSpeed = cranky ? 1.4 : 1.1;
          const ascending = climbWall > 3; // wall still beside the foot to grip and rise
          const vyTarget = ascending ? -climbSpeed : 0;
          e.vy += (vyTarget - e.vy) * (vyTarget < 0 ? 0.6 : 0.4);
          e.vy = clamp(e.vy, -climbSpeed, 0.6);
          e.vx += climbDir * 0.14 * (cranky ? 1.2 : 1); // hug / lean over the wall
          if (e.timer % 8 === 0) this.weaveFootTrail(e, support); // silk anchors up the wall
        }
        e.vx = clamp(e.vx, -maxWeaverSpeed, maxWeaverSpeed);
      } else if (e.kind === 'imp') {
        // Hover at a standoff distance, strafe, lob fireballs
        e.bobPhase += 0.09;
        if (targetAlive) {
          const standoff = 130;
          // (original computed an unused `desiredX` here:
          //  player.x + (pdx >= 0 ? -1 : 1) * -standoff * Math.sign(pdx || 1))
          const dirX = Math.abs(pdx) > standoff ? Math.sign(pdx) : -Math.sign(pdx);
          e.vx += dirX * 0.1;
          const desiredY = player.y - 75;
          e.vy += Math.sign(desiredY - e.y) * 0.09;
        } else {
          e.vx += (Math.random() - 0.5) * 0.05;
          e.vy += (Math.random() - 0.5) * 0.05;
        }
        e.vy += Math.sin(e.bobPhase) * 0.04;
        e.vx = clamp(e.vx, -1.3, 1.3);
        e.vy = clamp(e.vy, -1.15, 1.15);
        // Escape solids upward
        if (!ctx.physics.entityFree(e.x, e.y, def.halfW, def.h)) {
          e.y -= 1;
          e.vy = -0.5;
        }
        if (canAttackTarget && e.attackCd === 0 && pDist < 300) {
          const fa = Math.atan2(pdy, pdx) + (Math.random() - 0.5) * 0.16;
          ctx.projectiles.push({
            x: e.x,
            y: e.y - 5,
            vx: Math.cos(fa) * 3.6,
            vy: Math.sin(fa) * 3.6,
            type: 'fireball',
            life: 180,
            age: 0,
            charging: false,
            hostile: true,
          });
          ctx.audio.zap();
          e.attackCd = 130 + Math.floor(Math.random() * 70);
        }
      } else if (e.kind === 'wisp') {
        // Frost wisp: hovers high off the player's shoulder (no gravity at all),
        // flees when cornered, and radiates real cold into the grid beneath it
        e.bobPhase += 0.08;
        const cornered = targetAlive && pDist < 60;
        if (targetAlive) {
          const standoff = 110;
          const dirX = Math.abs(pdx) > standoff ? Math.sign(pdx) : -Math.sign(pdx);
          // retreat at 1.4x when the alchemist closes in
          e.vx += (cornered ? -Math.sign(pdx || 1) * 1.4 : dirX) * 0.1;
          const desiredY = player.y - 60;
          e.vy += Math.sign(desiredY - e.y) * 0.08;
        } else {
          e.vx += (Math.random() - 0.5) * 0.05;
          e.vy += (Math.random() - 0.5) * 0.05;
        }
        e.vy += Math.sin(e.bobPhase) * 0.03; // gentle bob
        e.vx = clamp(e.vx, cornered ? -1.54 : -1.1, cornered ? 1.54 : 1.1);
        e.vy = clamp(e.vy, -1.0, 1.0);
        // Escape solids upward
        if (!ctx.physics.entityFree(e.x, e.y, def.halfW, def.h)) {
          e.y -= 1;
          e.vy = -0.5;
        }
        if (canAttackTarget && e.attackCd === 0 && pDist < 320) {
          const fa = Math.atan2(pdy, pdx) + (Math.random() - 0.5) * 0.14;
          ctx.projectiles.push({
            x: e.x,
            y: e.y - 5,
            vx: Math.cos(fa) * 3.2,
            vy: Math.sin(fa) * 3.2,
            type: 'frostbolt',
            life: 200,
            age: 0,
            charging: false,
            hostile: true,
          });
          ctx.audio.tone(820, 1300, 0.12, 'sine', 0.09);
          e.attackCd = 140 + Math.floor(Math.random() * 60);
        }
        // Every 8th frame the cold soaks downward: water below locks into real
        // ice, lava occasionally skins over into stone
        if (e.timer % 8 === 0) {
          const wx = Math.floor(e.x),
            wy = Math.floor(e.y);
          let frozen = 0;
          for (let dy = 0; dy <= 6 && frozen < 10; dy++) {
            for (let dx = -6; dx <= 6 && frozen < 10; dx++) {
              if (dx * dx + dy * dy > 36) continue;
              const nx = wx + dx,
                ny = wy + dy;
              if (!ctx.world.inBounds(nx, ny)) continue;
              const ci = ctx.world.idx(nx, ny);
              const c = ctx.world.types[ci];
              if (c === Cell.Water) {
                ctx.world.replaceCellAt(ci, Cell.Ice, iceColor());
                frozen++;
              } else if (c === Cell.Lava && Math.random() < 0.1) {
                ctx.world.replaceCellAt(ci, Cell.Stone, stoneColor());
                frozen++;
              }
            }
          }
        }
      } else if (e.kind === 'mage') {
        // Powder Mage (pillar 9): a slow walker that throws the level at you.
        // e.blink doubles as the telekinesis telegraph countdown (the sprite
        // reads it to flare the hands); e.jetFuel doubles as the spent flag
        // for its one-time emergency teleport.
        e.vy += 0.3;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);

        if (e.blink > 0) {
          // Telegraph window: rooted, purple motes rise off the robe
          e.vx *= 0.7;
          if (!debugEnemyAttacksSuppressed) e.blink--;
          if (!debugEnemyAttacksSuppressed && e.timer % 2 === 0) {
            ctx.particles.spawn(
              e.x + ((Math.random() * 13) | 0) - 6,
              e.y - ((Math.random() * def.h) | 0),
              (Math.random() - 0.5) * 0.3,
              -0.5 - Math.random() * 0.7,
              null,
              packRGB(150 + ((Math.random() * 70) | 0), 60, 255),
              20,
              { grav: -0.02, glow: 1.9 },
            );
          }
          if (e.blink === 0 && canAttackTarget) this.telekinesisVolley(e);
        } else {
          if (targetAlive) e.vx += Math.sign(pdx) * 0.04;
          e.vx = clamp(e.vx, -0.45, 0.45);
          if (canAttackTarget && e.attackCd === 0 && pDist < 340) {
            e.blink = 20; // begin the 20-frame telegraph
            e.attackCd = 180 + Math.floor(Math.random() * 80);
          }
        }

        // One-time emergency blink once bloodied: 40-80 cells away, both ends
        // marked with purple bursts
        if (e.jetFuel === 0 && e.hp < e.maxHp * 0.5) {
          e.jetFuel = 1;
          const burstCol = (): number => packRGB(180 + ((Math.random() * 60) | 0), 70, 255);
          for (let attempt = 0; attempt < 20; attempt++) {
            const a = Math.random() * Math.PI * 2;
            const r = 40 + Math.random() * 40;
            const nx = Math.floor(clamp(e.x + Math.cos(a) * r, def.halfW + 2, WIDTH - def.halfW - 3));
            const ny = Math.floor(clamp(e.y + Math.sin(a) * r, def.h + 1, HEIGHT - 3));
            if (ctx.physics.entityFree(nx, ny, def.halfW, def.h)) {
              ctx.particles.burst(e.x, e.y - 7, 14, null, burstCol, 2.4, { glow: 2.2, grav: -0.01 });
              e.x = nx;
              e.y = ny;
              e.vx = 0;
              e.vy = 0;
              e.fx = 0;
              e.fy = 0;
              ctx.particles.burst(nx, ny - 7, 14, null, burstCol, 2.4, { glow: 2.2, grav: -0.01 });
              ctx.audio.zap();
              break;
            }
          }
        }
      } else if (e.kind === 'colossus') {
        // ===== THE KILN COLOSSUS =====
        // A slow furnace of living stone. Stomps, slams, lobs molten rock.
        // Water is the strategy: a doused kiln takes thermal-shock damage and
        // staggers; lightning also stuns it. The arena ceiling holds a sealed
        // water tank for exactly this reason.
        e.vy += 0.36;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);

        const doused = e.status.wet > 0;
        const shocked = e.status.electrified > 0;
        if (doused) {
          // THERMAL SHOCK: the furnace cracks — heavy damage, visible steam
          this.damage(e, 1.4, 0, 0);
          if (e.hp <= 0) continue; // damage() may have killed it
          if (ctx.state.frameCount % 4 === 0) {
            ctx.particles.burst(
              e.x + (Math.random() - 0.5) * 20,
              e.y - 10 - Math.random() * 14,
              2,
              Cell.Steam,
              () => packRGB(220, 228, 236),
              1.4,
            );
          }
          e.attackCd = Math.max(e.attackCd, 36); // staggered: no attacks
        }
        if (shocked) e.attackCd = Math.max(e.attackCd, 30);

        // March: slow, implacable, screen-shaking footfalls
        if (targetAlive && !doused && e.timer % 2 === 0) {
          e.vx += Math.sign(pdx) * 0.06;
        }
        e.vx = clamp(e.vx, -0.42, 0.42);
        if (e.grounded && !e.prevG) {
          this.shakeAt(e.x, e.y, 0.02, 0.05);
          ctx.audio.hollowKnock();
        }
        // The colossus owns its own landing edge: the renderer only writes prevG
        // for slimes/bomber, so without this the footfall would fire every grounded
        // frame instead of once per landing. Keep this gating in the sim.
        e.prevG = e.grounded;

        // Furnace breath: embers rise off the shoulders
        if (ctx.state.frameCount % 5 === 0 && !doused) {
          ctx.particles.spawn(
            e.x + (Math.random() - 0.5) * 18,
            e.y - def.h + 2,
            (Math.random() - 0.5) * 0.4,
            -0.6 - Math.random() * 0.5,
            null,
            packRGB(255, 120 + Math.floor(Math.random() * 100), 20),
            18,
            { glow: 2.0, grav: -0.01 },
          );
        }

        if (canAttackTarget && e.attackCd === 0) {
          if (Math.abs(pdx) < 32 && Math.abs(pdy) < 32) {
            // GROUND SLAM: a real explosion at the fist — far enough out that
            // the blast radius (r*1.5) cannot reach the colossus's own body
            ctx.explosions.trigger(e.x + Math.sign(pdx) * 18, e.y - 2, 11);
            ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.03, 0.06);
            e.attackCd = 150 + Math.floor(Math.random() * 40);
          } else if (Math.abs(pdx) < 300) {
            // MOLTEN VOLLEY: three lobbed gobs of kiln-fire
            for (let v = -1; v <= 1; v++) {
              ctx.projectiles.push({
                x: e.x + Math.sign(pdx) * 8,
                y: e.y - def.h + 4,
                vx: pdx * 0.014 + v * 0.5 + (Math.random() - 0.5) * 0.4,
                vy: -1.3 - Math.random() * 0.5,
                type: 'fireball',
                life: 240,
                age: 0,
                charging: false,
                hostile: true,
              });
            }
            ctx.audio.tone(90, 220, 0.4, 'sawtooth', 0.16);
            e.attackCd = 170 + Math.floor(Math.random() * 50);
          }
        }
      } else if (e.kind === 'leviathan') {
        // ===== THE SUNKEN LEVIATHAN =====
        // d4's mid-boss, the Kiln's mirror: WATER IS ITS ARMOR. Submerged it
        // shrugs off hits (damage() reads e.submerged), swims fast, lunges,
        // and throws its own pool at you. The cistern floor carries three
        // sealed drain plugs — empty the basin and it is just meat gasping
        // on the tiles. The pool is also one big conductor (so is the blood
        // it sheds into it): a spark in the water cooks it from inside.
        if (e.timer % 4 === 0) {
          let waterN = 0;
          for (let dy = 0; dy < def.h; dy += 3) {
            for (let dx = -def.halfW; dx <= def.halfW; dx += 3) {
              const X = e.x + dx,
                Y = e.y - dy;
              if (ctx.world.inBounds(X, Y) && ctx.world.types[ctx.world.idx(X, Y)] === Cell.Water)
                waterN++;
            }
          }
          e.submerged = waterN >= 8;
        }
        const sub = e.submerged === true;

        // ELECTROCUTION: the doused-kiln mirror. Direct hp (bypasses the
        // submersion shield — the water IS the delivery), visible arcs.
        if (sub && e.status.electrified > 0) {
          e.hp -= 1.1;
          e.flash = Math.max(e.flash, 2);
          if (e.hp <= 0) {
            this.killAt(i, e, 0, 0);
            continue;
          }
          e.attackCd = Math.max(e.attackCd, 30);
        }

        if (sub) {
          // weightless pursuit; a slow patrol sway when unaware
          e.vx *= 0.96;
          e.vy = e.vy * 0.9;
          if (targetAlive && e.alerted && (e.windup ?? 0) === 0) {
            if (e.timer % 2 === 0) {
              e.vx += Math.sign(pdx) * 0.09;
              e.vy += Math.sign(player.y - 6 - e.y) * 0.07;
            }
          } else {
            e.vx += Math.cos(e.timer * 0.02 + e.bobPhase) * 0.02;
            e.vy += Math.sin(e.timer * 0.05 + e.bobPhase) * 0.015;
          }
          e.vx = clamp(e.vx, -1.5, 1.5);
          e.vy = clamp(e.vy, -0.9, 0.9);
          // wake bubbles when it moves with intent
          if (ctx.state.frameCount % 7 === 0 && Math.abs(e.vx) > 0.5) {
            ctx.particles.spawn(
              e.x - Math.sign(e.vx) * def.halfW,
              e.y - 6 - Math.random() * 6,
              -e.vx * 0.2,
              -0.3 - Math.random() * 0.3,
              null,
              packRGB(170, 220, 250),
              14,
              { grav: -0.04 },
            );
          }
        } else {
          // BEACHED: gravity owns it. Heaving flops, each one a dying gasp.
          e.vy += 0.34;
          e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
          e.vx *= 0.92;
          if (e.grounded && e.timer % 38 === 0) {
            e.vy = -1.8;
            e.vx = (targetAlive ? Math.sign(pdx) || 1 : Math.random() < 0.5 ? -1 : 1) * 0.85;
            ctx.audio.squelch();
            this.shakeAt(e.x, e.y, 0.012, 0.04);
          }
          if (ctx.state.frameCount % 11 === 0) {
            ctx.particles.spawn(
              e.x + (Math.random() - 0.5) * 10,
              e.y - def.h + 2,
              (Math.random() - 0.5) * 0.4,
              -0.4,
              null,
              packRGB(150, 200, 230),
              16,
              { grav: -0.02 },
            );
          }
        }

        // LUNGE: a coiled flare, then a committed dart (can breach the
        // surface — gravity reels the leap back into the pool)
        if (
          sub &&
          canAttackTarget &&
          e.attackCd === 0 &&
          pDist < 90 &&
          (e.windup ?? 0) === 0 &&
          (e.swoop ?? 0) === 0
        ) {
          e.windup = 16;
          ctx.audio.tone(70, 160, 0.5, 'sawtooth', 0.14);
        }
        if ((e.windup ?? 0) > 0) {
          e.vx *= 0.8;
          e.vy *= 0.8;
          if (!debugEnemyAttacksSuppressed) e.windup = (e.windup ?? 1) - 1;
          if (e.windup === 0 && canAttackTarget) {
            e.swoop = 18;
            const a = Math.atan2(player.y - 8 - e.y, player.x - e.x);
            e.vx = Math.cos(a) * 3.4;
            e.vy = Math.sin(a) * 2.6;
            ctx.audio.noiseBurst(0.18, 700, 0.12, true);
          }
        }
        if ((e.swoop ?? 0) > 0) {
          if (!debugEnemyAttacksSuppressed) e.swoop = (e.swoop ?? 1) - 1;
          if (!sub) e.vy += 0.12; // a breaching arc falls back home
          if (canAttackTarget && e.attackCd === 0 && Math.abs(pdx) < 12 && Math.abs(pdy) < 16) {
            // THE BITE
            ctx.playerCtl.damage(16 * (e.dmgK ?? 1), Math.sign(pdx) * -4.2, -2.8);
            e.attackCd = 140;
            e.swoop = 0;
          } else if (e.swoop === 0) {
            e.attackCd = Math.max(e.attackCd, 90 + Math.floor(Math.random() * 40));
          }
        }

        // POOL VOLLEY: the ranged arm — only while it HAS a pool
        if (
          sub &&
          canAttackTarget &&
          e.alerted &&
          e.attackCd === 0 &&
          pDist >= 90 &&
          pDist < 320 &&
          (e.windup ?? 0) === 0 &&
          (e.swoop ?? 0) === 0
        ) {
          this.poolVolley(e);
          e.attackCd = 150 + Math.floor(Math.random() * 40);
        }

        // contact graze outside the committed bite
        if (
          canAttackTarget &&
          (e.swoop ?? 0) === 0 &&
          e.attackCd < 100 &&
          Math.abs(pdx) < 11 &&
          Math.abs(pdy) < 14
        ) {
          ctx.playerCtl.damage(10 * (e.dmgK ?? 1), Math.sign(pdx) * -3.0, -2.0);
          e.attackCd = Math.max(e.attackCd, 120);
        }
      } else if (e.kind === 'golem') {
        e.vy += 0.33;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if (e.punching !== undefined && e.punching > 0) e.punching--;
        if (!e.alerted && e.patrol && e.patrol.length > 0) {
          // PATROL (Builder-authored): pace the waypoint loop until alerted
          const wp = e.patrol[(e.patrolIdx ?? 0) % e.patrol.length];
          if (Math.abs(wp[0] - e.x) < 10) e.patrolIdx = ((e.patrolIdx ?? 0) + 1) % e.patrol.length;
          else if (e.timer % 3 === 0) e.vx += Math.sign(wp[0] - e.x) * 0.1;
        } else if (targetAlive && e.timer % 3 === 0) {
          e.vx += Math.sign(pdx) * 0.12;
        }
        e.vx = clamp(e.vx, -0.78, 0.78);

        // Jet propulsion: temporary thrusters for pit recovery and reaching high ledges
        if (e.jetCd > 0) e.jetCd--;
        if (e.jetFuel > 0) {
          e.jetFuel--;
          e.vy -= 0.58;
          if (e.vy < -2.4) e.vy = -2.4;
          e.vx += Math.sign(pdx) * 0.05;
          // exhaust flame + smoke
          if (ctx.state.frameCount % 2 === 0) {
            ctx.particles.spawn(
              e.x + Math.floor(Math.random() * 5) - 2,
              e.y + 1,
              (Math.random() - 0.5) * 0.6,
              1.3 + Math.random() * 0.8,
              null,
              packRGB(255, 130 + Math.floor(Math.random() * 90), 25),
              14,
              { glow: 2.2, grav: -0.02 },
            );
          }
          if (ctx.state.frameCount % 7 === 0)
            ctx.particles.burst(e.x, e.y + 2, 1, Cell.Smoke, smokeColor, 0.5);
          // cut thrust once level with the wizard or back on solid ground
          if (targetAlive && player.y > e.y - 12) e.jetFuel = Math.min(e.jetFuel, 6);
          if (e.grounded && e.vy >= 0) e.jetFuel = 0;
        } else if (e.jetCd === 0 && targetAlive) {
          const needLift = player.y < e.y - 28 && Math.abs(pdx) < 230; // wizard is up on a ledge
          const fallingHard = !e.grounded && e.vy > 2.3; // tumbling into a pit
          if (needLift || fallingHard) {
            e.jetFuel = 95 + Math.floor(Math.random() * 50);
            e.jetCd = 280;
            ctx.audio.tone(110 + Math.random() * 30, 260, 0.35, 'sawtooth', 0.11);
          }
        }

        // Pathing: vault low ledges; if a wall keeps it from the wizard, pound through
        if (targetAlive && e.grounded && Math.abs(pdx) > 12) {
          const dir = Math.sign(pdx) || 1;
          const ahead = !ctx.physics.entityFree(e.x + dir * (def.halfW + 2), e.y, def.halfW, def.h);
          if (ahead) {
            let clearH = -1;
            for (let hh = 3; hh <= 12; hh++) {
              if (ctx.physics.entityFree(e.x + dir * (def.halfW + 3), e.y - hh, def.halfW, def.h)) {
                clearH = hh;
                break;
              }
            }
            if (clearH > 0) {
              // vault the ledge
              e.vy = -2.0 - clearH * 0.17;
              e.vx = dir * 0.95;
              e.stuckT = 0;
            } else if (e.jetCd === 0) {
              // too tall to vault — fire the thrusters and go over
              e.jetFuel = 115;
              e.jetCd = 280;
              e.stuckT = 0;
              ctx.audio.tone(110 + Math.random() * 30, 260, 0.35, 'sawtooth', 0.11);
            } else {
              e.stuckT = (e.stuckT || 0) + 1;
              if (e.stuckT > 50) {
                // stone fists vs stone wall: the wall loses
                const fx2 = Math.floor(e.x + dir * (def.halfW + 3));
                const fy2 = Math.floor(e.y - 8);
                ctx.spells.erodeAt(fx2, fy2, 6);
                ctx.particles.burst(fx2, fy2, 9, Cell.Sand, stoneColor, 1.9);
                e.punching = 16; // wind-up + haymaker (sprite reads this)
                // The thud is only felt where it is SEEN: no off-screen
                // rumble, and a gentler hand than before.
                const camX = Math.floor(ctx.camera.x),
                  camY = Math.floor(ctx.camera.y);
                const visible =
                  e.x > camX - 8 &&
                  e.x < camX + VIEW_W + 8 &&
                  e.y > camY - 8 &&
                  e.y < camY + VIEW_H + 8;
                if (visible) ctx.audio.tone(60 + Math.random() * 25, 90, 0.2, 'square', 0.16);
                this.shakeAt(e.x, e.y, 0.006, 0.03);
                e.stuckT = 4; // a slower, heavier pounding rhythm (~46 frames)
              }
            }
          } else {
            e.stuckT = 0;
          }
        }
        // Smash through powders in path
        const aheadX = e.x + Math.sign(e.vx) * (def.halfW + 1);
        for (let dy = 0; dy < def.h; dy++) {
          if (ctx.world.inBounds(aheadX, e.y - dy)) {
            const ci = ctx.world.idx(aheadX, e.y - dy);
            const c = ctx.world.types[ci];
            if (c === Cell.Sand || c === Cell.Gold || c === Cell.Gunpowder) {
              ctx.particles.spawn(
                aheadX,
                e.y - dy,
                Math.sign(e.vx) * 1.2 + (Math.random() - 0.5),
                -0.8 - Math.random(),
                c,
                ctx.world.colors[ci],
                80,
              );
              ctx.world.clearCellAt(ci);
            }
          }
        }
        // Rock throw
        if (canAttackTarget && e.attackCd === 0 && pDist > 50 && pDist < 360) {
          for (let r = 0; r < 3; r++) {
            const ta = Math.atan2(pdy - 38 - r * 7, pdx);
            const spd = 4.0 + Math.random() * 1.2;
            ctx.particles.spawn(
              e.x,
              e.y - def.h,
              Math.cos(ta) * spd,
              Math.sin(ta) * spd - 0.6,
              Cell.Stone,
              stoneColor(),
              200,
              { hostileDmg: 9 },
            );
          }
          ctx.audio.boom(4);
          e.attackCd = 240;
        }
        if (canAttackTarget && e.attackCd < 200 && Math.abs(pdx) < 15 && Math.abs(pdy) < 22) {
          // dmgK so depth + difficulty scale this slam like every other attack.
          ctx.playerCtl.damage(20 * (e.dmgK ?? 1), Math.sign(pdx) * -5.0, -3.6);
          e.attackCd = 220;
        }
      }

      // Burning foes PANIC — flail erratically instead of marching their line.
      if (e.status.burning > 0 && e.grounded) e.vx += (Math.random() - 0.5) * 1.3;

      // ELECTROCUTED — any foe touching a live conductor is STUCK to it: the
      // current overrides its AI, so a slime can't leap away and a walker can't
      // march off. It just convulses in place (the violent shake + crawling arcs
      // are drawn in EnemySprites). Cancel this frame's intended motion entirely;
      // the status's own 1-2s timer (status.ts) frees it once the metal stops
      // conducting. Knockback still bypasses (tickKnock ran earlier).
      if (e.status.electrified > 0) {
        e.vx = 0;
        e.vy = 0;
        e.fx = 0;
        e.fy = 0;
      }

      // Integrate movement (slimes/golems/mages collide; imps/wisps/bats drift).
      // Difficulty scales the step distance = effective speed (level 3 = ×1).
      const spd = difficultyMods(ctx.state).enemySpeed;
      if (e.kind === 'imp' || e.kind === 'wisp' || e.kind === 'bat') {
        // Drift via sub-cell accumulators so e.x / e.y stay integers (grid indices)
        e.fx += e.vx * spd;
        e.fy += e.vy * spd;
        const sx = Math.trunc(e.fx),
          sy = Math.trunc(e.fy);
        if (sx !== 0) {
          e.x = Math.floor(clamp(e.x + sx, 6, WIDTH - 7));
          e.fx -= sx;
        }
        if (sy !== 0) {
          e.y = Math.floor(clamp(e.y + sy, 14, HEIGHT - 7));
          e.fy -= sy;
        }
      } else {
        const stepUp =
          e.kind === 'weaver' ? 6 : e.kind === 'colossus' ? 3 : e.kind === 'golem' || e.kind === 'leviathan' ? 2 : 1;
        // WARY OF THE EDGE: a grounded walker won't voluntarily step into a cell
        // that's lethal to it (lava/fire/acid). Fail-open — it only cancels this
        // frame's step and re-aims next frame, so it never hard-locks a path.
        // (Knockback bypasses this entirely — tickKnock continues above — so the
        //  kick can still launch foes into the lava.)
        if (e.grounded && e.vx !== 0 && this.lethalAhead(e, def, e.vx > 0 ? 1 : -1)) {
          e.vx = 0;
          e.fx = 0;
          e.wary = 24;
        }
        e.fx += e.vx * spd;
        while (e.fx >= 1) {
          if (!ctx.physics.tryMoveEntity(e, 1, 0, def.halfW, def.h, stepUp)) {
            e.vx = 0;
            e.fx = 0;
            break;
          }
          e.fx -= 1;
        }
        while (e.fx <= -1) {
          if (!ctx.physics.tryMoveEntity(e, -1, 0, def.halfW, def.h, stepUp)) {
            e.vx = 0;
            e.fx = 0;
            break;
          }
          e.fx += 1;
        }
        e.fy += e.vy * spd;
        while (e.fy >= 1) {
          if (!ctx.physics.tryMoveEntity(e, 0, 1, def.halfW, def.h, 0)) {
            e.vy = 0;
            e.fy = 0;
            break;
          }
          e.fy -= 1;
        }
        while (e.fy <= -1) {
          if (!ctx.physics.tryMoveEntity(e, 0, -1, def.halfW, def.h, 0)) {
            e.vy = 0;
            e.fy = 0;
            break;
          }
          e.fy += 1;
        }
        if (e.y > HEIGHT - 2) {
          e.y = HEIGHT - 2;
          e.vy = 0;
        }
      }
    }
  }
}
