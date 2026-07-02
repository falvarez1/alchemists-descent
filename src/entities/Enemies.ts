import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { difficultyMods } from '@/config/difficulty';
import { RILLBACK_WET_THRESHOLD } from '@/core/enemyState';
import { clamp } from '@/core/math';
import type { Critter, CritterKind, Ctx, Enemy, EnemyControlApi, EnemyDef, EnemyKind, EnemySpawnOptions, WeaverIntent } from '@/core/types';
import { tickWeaverLocomotion, weaverKnockSync, weaverLeap } from '@/entities/weaverLocomotion';
import { ENEMY_DEFS } from '@/content/enemyDefs';
export { ENEMY_DEFS } from '@/content/enemyDefs';
import { createDefaultStatus, rollCatchFire, sampleAndTickStatus } from '@/entities/status';
import { makePickup, POTION_KINDS } from '@/core/pickupDefs';
import { LEVIATHAN_REWARD_POOL, randomCard } from '@/content/cardRewardPools';
import { enemyMovementPace } from '@/core/progressionPacing';
import { blocksEntity, Cell, isConductor, isSoftGrowth } from '@/sim/CellType';
import {
  acidColor,
  ashColor,
  bloodColor,
  COLOR_FN,
  fireColor,
  goldColor,
  iceColor,
  mossColor,
  packRGB,
  slimeColor,
  smokeColor,
  stoneColor,
  toxicColor,
  vineColor,
  waterColor,
} from '@/sim/colors';
import { splatterStain } from '@/sim/stains';

// ===================== Enemies =====================
interface CellCandidate {
  x: number;
  y: number;
  d2: number;
  over?: number;
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
const ROOT_LOPER_GROWTH_BUDGET = 34;
const ROOT_LOPER_LOCAL_GROWTH_BUDGET = 26;
const ROOT_LOPER_SUPPORT_SCAN = 18;
const STONE_MAW_CHEW_MAX_CELLS = 7;
const STONE_MAW_CHEW_COOLDOWN = 28;
const RILLBACK_CHARGE_WINDUP_FRAMES = 18;
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
const BAT_SLIME_GROUNDED_FRAMES = 7 * 60;
const MAGE_TELEKINESIS_CELLS = new Set<number>([
  Cell.Sand,
  Cell.Gold,
  Cell.Gunpowder,
  Cell.Snow,
  Cell.Coal,
  Cell.Ash,
  Cell.Catalyst,
  Cell.RawOre,
]);
const MAGE_CHIP_CELLS = new Set<number>([Cell.Wall, Cell.Stone, Cell.RawOre, Cell.Coal, Cell.Crystal]);
/** Cells around a rooted spitter that its habitat pass may seed (hoisted —
 *  this ran on a 30-frame cadence and allocated the list every call). */
const SPITTER_ROOT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [-2, 1],
  [2, 1],
  [-ENEMY_DEFS.spitter.halfW - 1, 0],
  [ENEMY_DEFS.spitter.halfW + 1, 0],
];

/** Cells a kind shrugs off when statuses are sampled: imps bathe in fire, wisps in cold. */
const STATUS_IMMUNE: Partial<
  Record<EnemyKind, Partial<Record<'burning' | 'frozen' | 'electrified' | 'wet' | 'oiled' | 'toxic' | 'healium' | 'teleportium', boolean>>>
> = {
  imp: { burning: true },
  wisp: { frozen: true },
  spitter: { toxic: true },
  // The kiln cannot burn or freeze — but it CAN be doused (wet = thermal shock)
  colossus: { burning: true, frozen: true, teleportium: true },
  // A soaked hide never catches — but cold stiffens it and charge cooks it
  leviathan: { burning: true, teleportium: true },
  // Rillbacks are the living conductor in their pool; their own charge pulse
  // should threaten the player, not instantly shock the eel to death.
  rillback: { electrified: true },
};

/** Per-kind TEMPERAMENT: how each foe weights the threat-aware behavior drives.
 *  - fear: how strongly sensed danger + low HP raise the fear drive (0 = fearless brute).
 *  - dodge: 0..1 reflex chance to actually twitch clear of an imminent hit.
 *  - fleeAt: fear level at which it commits to retreating (>=1 = never flees).
 *  - seekWater: when on fire, flee toward the nearest water to douse. */
interface Temperament {
  fear: number;
  dodge: number;
  fleeAt: number;
  seekWater: boolean;
}
const DEFAULT_TEMPERAMENT: Temperament = { fear: 0.7, dodge: 0.45, fleeAt: 0.7, seekWater: true };
const TEMPERAMENT: Partial<Record<EnemyKind, Temperament>> = {
  slime: { fear: 0.4, dodge: 0.12, fleeAt: 0.95, seekWater: false }, // dumb, barely flinches
  acidslime: { fear: 0.4, dodge: 0.12, fleeAt: 0.95, seekWater: false },
  eggs: { fear: 0, dodge: 0, fleeAt: 2, seekWater: false }, // inert
  bat: { fear: 1.3, dodge: 0.85, fleeAt: 0.45, seekWater: false }, // flighty, panics
  imp: { fear: 0.6, dodge: 0.72, fleeAt: 0.6, seekWater: false }, // smart kiter (fire-immune)
  wisp: { fear: 0.9, dodge: 0.7, fleeAt: 0.4, seekWater: false }, // skittish frost caster
  spitter: { fear: 0.85, dodge: 0.55, fleeAt: 0.5, seekWater: true }, // cowardly
  bomber: { fear: 0.2, dodge: 0.3, fleeAt: 1.5, seekWater: false }, // suicidal — WANTS to reach you
  mage: { fear: 0.9, dodge: 0.62, fleeAt: 0.45, seekWater: true }, // cowardly caster
  weaver: { fear: 0.5, dodge: 0.5, fleeAt: 0.72, seekWater: true }, // cunning but committed
  rootloper: { fear: 0.7, dodge: 0.4, fleeAt: 0.68, seekWater: false }, // anchor-first, fire-wary
  stonemaw: { fear: 0.1, dodge: 0.08, fleeAt: 1.6, seekWater: false }, // blind brute
  rillback: { fear: 0.35, dodge: 0.42, fleeAt: 0.9, seekWater: true }, // brave while wet
  golem: { fear: 0.18, dodge: 0.28, fleeAt: 1.5, seekWater: false }, // brute, shrugs it off
  colossus: { fear: 0, dodge: 0, fleeAt: 2, seekWater: false }, // fearless boss
  leviathan: { fear: 0, dodge: 0.12, fleeAt: 2, seekWater: false }, // fearless (water is its home)
};

const FIREPROOF: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['imp', 'colossus', 'leviathan']);

/** Does cell `c` deal environmental harm to `kind`? Single source of truth for
 *  wary look-ahead and threat scanning. Fire/lava burn everything but fireproof
 *  foes; acid eats everything but the acidslime; Toxic poisons everything but
 *  the spitter that carries it. */
export function enemyLethalCell(kind: EnemyKind, c: number): boolean {
  if ((c === Cell.Fire || c === Cell.Lava) && !FIREPROOF.has(kind)) return true;
  if (c === Cell.Acid && kind !== 'acidslime') return true;
  if (c === Cell.Toxic && kind !== 'spitter') return true;
  return false;
}

function directEnvironmentDamage(kind: EnemyKind, c: number): number {
  if ((c === Cell.Fire || c === Cell.Lava) && !FIREPROOF.has(kind)) return c === Cell.Lava ? 1.6 : 0.7;
  if (c === Cell.Acid && kind !== 'acidslime') return 0.9;
  return 0;
}

function weaverSupportGrowth(t: number): boolean {
  return isSoftGrowth(t) || t === Cell.Slime;
}

function rootLoperGrowth(t: number): boolean {
  return isSoftGrowth(t) || t === Cell.Wood;
}

function stoneMawChewable(t: number): boolean {
  return (
    t === Cell.Wall ||
    t === Cell.Stone ||
    t === Cell.RawOre ||
    t === Cell.Coal ||
    t === Cell.Sand ||
    t === Cell.Ash
  );
}

function rillbackPreferredLiquid(t: number): boolean {
  return t === Cell.Water || t === Cell.Blood || t === Cell.Slime || t === Cell.Healium || t === Cell.ElixirLife;
}

function rillbackChargeableLiquid(t: number): boolean {
  return (t === Cell.Water || t === Cell.Blood) && isConductor(t);
}

function colorForCell(t: number): number {
  return COLOR_FN[t]?.() ?? packRGB(120, 120, 120);
}

export { enemyStateLabel } from '@/core/enemyState';

export class Enemies implements EnemyControlApi {
  readonly defs: Record<EnemyKind, EnemyDef> = ENEMY_DEFS;

  private readonly disposers: Array<() => void> = [];
  private readonly rillbackLiquidSeek = { dx: 0, dy: 0 };
  /** Scratch intent handed to the Weaver's locomotion each tick (reused). */
  private readonly weaverIntent: WeaverIntent = {
    move: 'hold',
    tx: 0,
    ty: 0,
    urgency: 0,
    stance: 'normal',
    speedScale: 1,
  };

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

  private batTouchesSlime(e: Enemy, def: EnemyDef): boolean {
    const world = this.ctx.world;
    const cx = Math.floor(e.x);
    const bottom = Math.floor(e.y);
    for (let y = bottom - def.h - 1; y <= bottom + 1; y++) {
      for (let x = cx - def.halfW - 2; x <= cx + def.halfW + 2; x++) {
        if (!world.inBounds(x, y)) continue;
        if (world.types[world.idx(x, y)] === Cell.Slime) return true;
      }
    }
    return false;
  }

  private gumBatWingsWithSlime(e: Enemy, def: EnemyDef): void {
    if (e.kind !== 'bat' || !this.batTouchesSlime(e, def)) return;
    const wasSlimed = (e.slimed ?? 0) > 0;
    e.slimed = BAT_SLIME_GROUNDED_FRAMES;
    e.sleeping = false;
    e.windup = 0;
    e.swoop = 0;
    if (!wasSlimed) {
      e.tumble = Math.max(e.tumble ?? 0, 12);
      e.vx *= 0.45;
      e.vy = Math.max(e.vy, 0.7);
      this.ctx.particles.burst(e.x, e.y - def.h * 0.6, 10, Cell.Slime, slimeColor, 1.4, { grav: 0.08 });
      this.ctx.audio.squelch();
    }
  }

  private alertFromDamage(e: Enemy): void {
    if (e.kind === 'eggs') return;
    const wasSleeping = e.sleeping === true;
    e.alerted = true;
    e.sleeping = false;
    e.calmT = 0;
    if (e.kind === 'bat' && wasSleeping) {
      e.windup = 0;
      e.swoop = 0;
      e.vy = Math.max(e.vy, 1.0);
    } else if (e.kind === 'weaver' && wasSleeping) {
      e.cranky = Math.max(e.cranky ?? 0, WEAVER_CRANKY_FRAMES);
      e.webPulse = Math.max(e.webPulse ?? 0, 18);
    }
  }

  spawn(kind: EnemyKind, x: number, y: number, opts: EnemySpawnOptions = {}): Enemy | null {
    const ctx = this.ctx;
    const def = (this.defs as Partial<Record<EnemyKind, EnemyDef>>)[kind];
    if (!def) return null;
    const rng = opts.rng ?? Math.random;
    // Find an open pocket: scan downward from the requested point, retrying nearby columns
    let sx = Math.floor(opts.exact === true ? x : clamp(x, def.halfW + 2, WIDTH - def.halfW - 3));
    let sy = -1;
    if (opts.exact === true) {
      const ey = Math.floor(y);
      if (ctx.physics.entityFree(sx, ey, def.halfW, def.h)) sy = ey;
    } else {
      for (let attempt = 0; attempt < 10 && sy < 0; attempt++) {
        const tx =
          attempt === 0
            ? sx
            : Math.floor(clamp(sx + (rng() - 0.5) * 240, def.halfW + 2, WIDTH - def.halfW - 3));
        for (let yy = Math.max(def.h, Math.floor(y)); yy < HEIGHT - 2; yy++) {
          if (ctx.physics.entityFree(tx, yy, def.halfW, def.h)) {
            sx = tx;
            sy = yy;
            break;
          }
        }
      }
    }
    if (sy < 0) return null;
    // Depth scaling: tougher and harder-hitting the deeper you descend; difficulty
    // multiplies both on top (level 3 = ×1, so the shipped curve is untouched).
    const depth = ctx.state.mode === 'play' ? (ctx.levels.current?.def.depth ?? 1) : 1;
    const diff = difficultyMods(ctx.state);
    const hpMul = (1 + (depth - 1) * 0.16) * diff.enemyHp;
    const dmgK = (1 + (depth - 1) * 0.1) * diff.enemyDamage;
    const enemy: Enemy = {
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
      timer: Math.floor(rng() * 80),
      attackCd: 60,
      bobPhase: rng() * Math.PI * 2,
      grounded: false,
      stride: 0,
      splat: 0,
      prevG: false,
      blink: 0,
      jetFuel: 0,
      jetCd: 0,
      stuckT: 0,
      status: createDefaultStatus(),
    };
    ctx.enemies.push(enemy);
    ctx.particles.burst(sx, sy, 6, Cell.Smoke, smokeColor, 0.9);
    return enemy;
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

  /** A hazard cell (lava/fire/acid/toxic) splashes (x,y): if a foe harmed by `cell`
   *  overlaps the point, deal the matching env damage (and ignite it for
   *  fire/lava) and return true. Lets poured/sprayed material strike foes. */
  splashHazard(x: number, y: number, cell: number): boolean {
    if (this.ctx.state.mode !== 'play') return false;
    for (const e of this.ctx.enemies) {
      const def = this.defs[e.kind];
      if (Math.abs(x - e.x) > def.halfW + 1) continue;
      if (y > e.y + 2 || y < e.y - def.h - 2) continue;
      if (!enemyLethalCell(e.kind, cell)) continue;
      const dmg = cell === Cell.Toxic ? 0.7 : directEnvironmentDamage(e.kind, cell);
      if (dmg <= 0) continue;
      this.damage(e, dmg, (Math.random() - 0.5) * 0.6, -0.3);
      if (cell === Cell.Lava || cell === Cell.Fire) {
        // Same percentage-based catch as passive exposure: a single lava splash
        // is much likelier to ignite than a fire splash; a stream re-rolls each hit.
        rollCatchFire(e.status, cell === Cell.Fire ? 1 : 0, cell === Cell.Lava ? 1 : 0, STATUS_IMMUNE[e.kind]?.burning === true);
      }
      return true;
    }
    return false;
  }

  damage(e: Enemy, amount: number, kx: number, ky: number): void {
    const ctx = this.ctx;
    if (amount > 0) this.alertFromDamage(e);
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
    e.alerted = true;
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
    if (e.kind === 'weaver') weaverKnockSync(e);
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
      ctx.explosions.trigger(e.x, e.y - 4, 24 + Math.floor(Math.random() * 3), { playerDamageSource: 'bomber' });
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
        runtime.pickups.push(makePickup('heart', e.x - 5, e.y - 8));
        runtime.pickups.push(
          makePickup('tome', e.x + 5, e.y - 8, {
            card: randomCard(LEVIATHAN_REWARD_POOL),
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
      ctx.explosions.trigger(e.x, e.y - 10, 28, { playerDamageSource: 'colossus-death' });
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
    if (e.kind === 'stonemaw') {
      const w = ctx.world;
      const cx = Math.floor(e.x);
      const cy = Math.floor(e.y - def.h * 0.45);
      let opened = 0;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          if (dx * dx * 0.55 + dy * dy > 16) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!w.inBounds(x, y) || this.stoneMawProtectedCell(x, y)) continue;
          const idx = w.idx(x, y);
          if (!stoneMawChewable(w.types[idx])) continue;
          w.clearCellAt(idx);
          opened++;
        }
      }
      if (opened > 0) ctx.particles.burst(cx, cy, Math.min(16, opened), Cell.Sand, stoneColor, 1.4);
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
    // A felled foe goes out in the colour of whatever was killing it.
    this.elementalDeathFlourish(e, def);
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
   * A felled foe goes out in the colour of whatever was killing it: frozen bodies
   * SHATTER into ice, burning ones BURST into a final whoosh, the shocked DISCHARGE,
   * the soaked SPLASH. Reads the real status, so it caps the elemental combo loop
   * (prime → see it → punish it → finish it). Layered over the gib but dominant
   * enough to read; audio/lightning guarded (`?.`) for minimal test stubs.
   */
  private elementalDeathFlourish(e: Enemy, def: EnemyDef): void {
    const ctx = this.ctx;
    const st = e.status;
    if (st.frozen > 0) {
      ctx.particles.burst(e.x, e.y - 5, this.goreCount(e, 20, Cell.Ice), Cell.Ice, iceColor, 3.8);
      ctx.particles.burst(e.x, e.y - 6, 12, null, () => packRGB(225, 245, 255), 2.6, { glow: 2.3, grav: 0.05 });
      ctx.audio.shatter?.();
      ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick ?? 0, 0.6);
    } else if (st.burning > 0) {
      ctx.particles.burst(e.x, e.y - 6, 22, null, () => fireColor(), 3.4, { glow: 2.6, grav: -0.05 });
      ctx.particles.burst(e.x, e.y - 5, this.goreCount(e, 12, Cell.Fire), Cell.Fire, fireColor, 2.6);
      ctx.audio.brazier?.();
      ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick ?? 0, 0.7);
    } else if (st.electrified > 0) {
      ctx.particles.burst(e.x, e.y - 5, 16, null, () => packRGB(120, 240, 255), 3.0, { glow: 2.6, grav: 0 });
      ctx.lightning?.spark?.(e.x - def.halfW, e.y - def.h, e.x + def.halfW, e.y - 2);
      ctx.audio.zap?.();
    } else if (st.wet > 0) {
      ctx.particles.burst(e.x, e.y - 5, 16, null, () => packRGB(110, 180, 235), 3.0, { glow: 0.5, grav: 0.1 });
      ctx.audio.splash?.(0.6);
    }
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
   * Powder Mage telekinesis: tear up to 14 loose cells (powders, ore, ash, snow,
   * coal; nearest-first within 40 cells) OUT of the grid and hurl them at the
   * player as hostile debris. The level itself is the ammunition — whatever
   * misses re-deposits as real cells where it lands.
   */
  private telekinesisVolley(e: Enemy): boolean {
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
        if (MAGE_TELEKINESIS_CELLS.has(t)) {
          addNearestCandidate(found, 14, nx, ny, d2);
        }
      }
    }
    found.sort((a, b) => a.d2 - b.d2);
    const n = Math.min(14, found.length);
    if (n === 0) return false;
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
        hostileSource: 'powder-mage-debris',
        glow: 0.6,
        grav: 0.015,
      });
    }
    ctx.audio.tone(240, 70, 0.3, 'sawtooth', 0.12);
    this.shakeAt(e.x, e.y, 0.006, 0.04);
    return true;
  }

  private mageChipVolley(e: Enemy): boolean {
    const ctx = this.ctx;
    const world = ctx.world;
    const player = ctx.player;
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y) - 7;
    const found: CellCandidate[] = [];
    for (let dy = -34; dy <= 34; dy++) {
      for (let dx = -34; dx <= 34; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 1156 || d2 < 36) continue;
        const nx = ex + dx;
        const ny = ey + dy;
        if (!world.inBounds(nx, ny) || this.stoneMawProtectedCell(nx, ny)) continue;
        const t = world.types[world.idx(nx, ny)];
        if (MAGE_CHIP_CELLS.has(t)) addNearestCandidate(found, 5, nx, ny, d2);
      }
    }
    found.sort((a, b) => a.d2 - b.d2);
    const n = Math.min(5, found.length);
    if (n === 0) return false;
    for (let k = 0; k < n; k++) {
      const c = found[k];
      const ci = world.idx(c.x, c.y);
      const t = world.types[ci];
      const color = world.colors[ci] || colorForCell(t);
      world.clearCellAt(ci);
      const aim = Math.atan2(player.y - 9 - c.y, player.x - c.x) + (Math.random() - 0.5) * 0.18;
      const spd = 3.2 + Math.random() * 0.7;
      ctx.particles.spawn(c.x, c.y, Math.cos(aim) * spd, Math.sin(aim) * spd - 0.15, t, color, 150, {
        hostileDmg: 5,
        hostileSource: 'powder-mage-shard',
        grav: 0.025,
      });
    }
    ctx.audio.tone(180, 90, 0.22, 'sawtooth', 0.1);
    this.shakeAt(e.x, e.y, 0.004, 0.025);
    return true;
  }

  private mageVolley(e: Enemy): boolean {
    return this.telekinesisVolley(e) || this.mageChipVolley(e);
  }

  private spitterRootHabitat(e: Enemy, def: EnemyDef): void {
    if (!e.grounded || e.timer % 30 !== 0) return;
    const ctx = this.ctx;
    const w = ctx.world;
    const cx = Math.floor(e.x);
    const foot = Math.floor(e.y);
    let growthNearby = false;
    for (let dy = -def.h; dy <= 2 && !growthNearby; dy++) {
      for (let dx = -def.halfW - 2; dx <= def.halfW + 2; dx++) {
        const x = cx + dx;
        const y = foot + dy;
        if (!w.inBounds(x, y)) continue;
        const t = w.types[w.idx(x, y)];
        if (isSoftGrowth(t) || t === Cell.Slime || t === Cell.Toxic) {
          growthNearby = true;
          break;
        }
      }
    }
    for (const [dx, dy] of SPITTER_ROOT_OFFSETS) {
      const x = cx + dx;
      const y = foot + dy;
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      if (w.types[i] !== Cell.Empty) continue;
      const below = w.inBounds(x, y + 1) ? w.types[w.idx(x, y + 1)] : Cell.Empty;
      const clings = blocksEntity(below) || isSoftGrowth(below) || below === Cell.Slime || below === Cell.Toxic;
      if (!clings) continue;
      const cell = growthNearby && Math.random() < 0.45 ? Cell.Vines : Cell.Toxic;
      w.replaceCellAt(i, cell, cell === Cell.Vines ? vineColor() : toxicColor());
      w.life[i] = cell === Cell.Toxic ? 260 : 220;
      if (ctx.state.frameCount % 3 === 0) ctx.particles.burst(x, y, 2, cell, cell === Cell.Vines ? vineColor : toxicColor, 0.45);
      return;
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
        hostileSource: 'leviathan-water',
        glow: 0.5,
        grav: 0.03,
      });
    }
    if (n > 0) {
      ctx.audio.noiseBurst(0.14, 900, 0.1, true);
      this.shakeAt(e.x, e.y, 0.005, 0.03);
    }
  }

  private rootLoperFooting(e: Enemy, def: EnemyDef): { support: number; growth: number; hazard: number; seekDir: number } {
    const w = this.ctx.world;
    const cx = Math.floor(e.x);
    const foot = Math.floor(e.y);
    let growth = 0;
    let load = 0;
    let hazard = 0;
    let left = 0;
    let right = 0;
    for (let dy = -def.h; dy <= 5; dy += 3) {
      for (let dx = -ROOT_LOPER_SUPPORT_SCAN; dx <= ROOT_LOPER_SUPPORT_SCAN; dx += 3) {
        const x = cx + dx;
        const y = foot + dy;
        if (!w.inBounds(x, y)) continue;
        const t = w.types[w.idx(x, y)];
        const isGrowth = rootLoperGrowth(t);
        if (isGrowth) {
          growth++;
          if (dx < 0) left += 1.4;
          else if (dx > 0) right += 1.4;
        } else if (this.ctx.physics.cellBlocks(x, y) || blocksEntity(t)) {
          load += 0.35;
          if (dx < 0) left += 0.25;
          else if (dx > 0) right += 0.25;
        } else if (enemyLethalCell(e.kind, t)) {
          hazard++;
        }
      }
    }
    const support = clamp((growth * 1.2 + load - hazard * 1.8) / 13, 0, 1);
    const seekDir = Math.abs(left - right) < 1 ? 0 : right > left ? 1 : -1;
    return { support, growth, hazard, seekDir };
  }

  private stampRootLoperGrowth(e: Enemy, support: number): number {
    if ((e.rootGrowthBudget ?? ROOT_LOPER_GROWTH_BUDGET) <= 0) return 0;
    const ctx = this.ctx;
    const w = ctx.world;
    const cx = Math.floor(e.x);
    const foot = Math.floor(e.y);
    let localGrowth = 0;
    for (let y = foot - 9; y <= foot + 6; y += 2) {
      for (let x = cx - 18; x <= cx + 18; x += 2) {
        if (w.inBounds(x, y) && rootLoperGrowth(w.types[w.idx(x, y)])) localGrowth++;
      }
    }
    if (localGrowth >= ROOT_LOPER_LOCAL_GROWTH_BUDGET) return 0;

    let placed = 0;
    for (let attempt = 0; attempt < 10 && placed < 2; attempt++) {
      const x = cx + Math.floor((Math.random() * 2 - 1) * (support > 0.45 ? 16 : 10));
      const y = foot - 3 + Math.floor(Math.random() * 9);
      if (!w.inBounds(x, y)) continue;
      if (Math.abs(x - ctx.player.x) <= 7 && y <= ctx.player.y + 2 && y >= ctx.player.y - 20) continue;
      const i = w.idx(x, y);
      if (w.types[i] !== Cell.Empty) continue;
      const below = w.inBounds(x, y + 1) ? w.types[w.idx(x, y + 1)] : Cell.Empty;
      const above = w.inBounds(x, y - 1) ? w.types[w.idx(x, y - 1)] : Cell.Empty;
      const left = w.inBounds(x - 1, y) ? w.types[w.idx(x - 1, y)] : Cell.Empty;
      const right = w.inBounds(x + 1, y) ? w.types[w.idx(x + 1, y)] : Cell.Empty;
      const cling =
        blocksEntity(below) ||
        blocksEntity(above) ||
        blocksEntity(left) ||
        blocksEntity(right) ||
        rootLoperGrowth(below) ||
        rootLoperGrowth(above) ||
        rootLoperGrowth(left) ||
        rootLoperGrowth(right);
      if (!cling) continue;
      const material =
        rootLoperGrowth(left) || rootLoperGrowth(right) || rootLoperGrowth(above)
          ? Cell.Vines
          : support > 0.55 && Math.random() < 0.45
            ? Cell.Fungus
            : Cell.Moss;
      w.replaceCellAt(i, material, material === Cell.Vines ? vineColor() : material === Cell.Fungus ? COLOR_FN[Cell.Fungus]() : mossColor());
      w.life[i] = 180 + Math.floor(Math.random() * 120);
      e.rootGrowthBudget = Math.max(0, (e.rootGrowthBudget ?? ROOT_LOPER_GROWTH_BUDGET) - 1);
      placed++;
    }
    if (placed > 0) ctx.particles.burst(e.x, e.y - 5, placed + 2, Cell.Vines, vineColor, 0.65, { grav: -0.01 });
    return placed;
  }

  private stoneMawProtectedCell(x: number, y: number): boolean {
    const rt = this.ctx.levels?.current;
    if (!rt) return false;
    const near = (px: number, py: number, r: number): boolean => {
      const dx = x - px;
      const dy = y - py;
      return dx * dx + dy * dy <= r * r;
    };
    if (near(rt.spawn.x, rt.spawn.y, 42)) return true;
    if (rt.cauldron && near(rt.cauldron.x, rt.cauldron.y, 30)) return true;
    if (rt.portal && near(rt.portal.x, rt.portal.y, 38)) return true;
    if (rt.exit) {
      if (Math.abs(x - rt.exit.x) <= rt.exit.halfW + 14 && Math.abs(y - rt.exit.sealY) <= 38) return true;
    }
    for (const ws of rt.waystones ?? []) if (near(ws.x, ws.y, 34)) return true;
    for (const m of rt.mechanisms ?? []) {
      if (x >= m.x - 10 && x <= m.x + m.w + 10 && y >= m.y - m.h - 10 && y <= m.y + 10) return true;
    }
    for (const rv of rt.runeVaults ?? []) {
      for (const [dx, dy] of rv.door) if (Math.abs(x - dx) <= 8 && Math.abs(y - dy) <= 8) return true;
      if (near(rv.rx, rv.ry, 18)) return true;
    }
    return false;
  }

  private protectedCellInRadius(cx: number, cy: number, radius: number): boolean {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        if (this.stoneMawProtectedCell(cx + dx, cy + dy)) return true;
      }
    }
    return false;
  }

  private stoneMawChewBrush(e: Enemy, def: EnemyDef): number {
    const ctx = this.ctx;
    const w = ctx.world;
    const dir = e.mawDir === -1 || e.mawDir === 1 ? e.mawDir : Math.sign(ctx.player.x - e.x || e.vx || 1);
    e.mawDir = dir;
    const mouthX = Math.floor(e.x + dir * (def.halfW + 1));
    const mouthY = Math.floor(e.y - def.h * 0.45);
    let chewed = 0;
    for (let ax = 0; ax <= 6 && chewed < STONE_MAW_CHEW_MAX_CELLS; ax++) {
      const x = mouthX + dir * ax;
      for (let dy = -3; dy <= 3 && chewed < STONE_MAW_CHEW_MAX_CELLS; dy++) {
        if (ax * ax * 0.55 + dy * dy > 14) continue;
        const y = mouthY + dy;
        if (!w.inBounds(x, y) || this.stoneMawProtectedCell(x, y)) continue;
        const i = w.idx(x, y);
        const t = w.types[i];
        if (!stoneMawChewable(t)) continue;
        const color = w.colors[i];
        w.clearCellAt(i);
        chewed++;
        if (Math.random() < 0.5) {
          ctx.particles.spawn(x, y, -dir * (0.25 + Math.random() * 0.7), -0.2 - Math.random() * 0.7, t, color, 70, {
            grav: 0.09,
          });
        }
        const spoilY = y + 1;
        if (chewed <= 3 && w.inBounds(x - dir, spoilY)) {
          const si = w.idx(x - dir, spoilY);
          if (w.types[si] === Cell.Empty && Math.random() < 0.35) {
            const spoil = t === Cell.Ash || Math.random() < 0.25 ? Cell.Ash : Cell.Sand;
            w.replaceCellAt(si, spoil, spoil === Cell.Ash ? ashColor() : colorForCell(Cell.Sand));
          }
        }
      }
    }
    if (chewed > 0) {
      e.mawChewT = Math.max(e.mawChewT ?? 0, 14);
      e.mawChewCd = STONE_MAW_CHEW_COOLDOWN + Math.floor(Math.random() * 10);
      ctx.audio.hollowKnock();
      ctx.particles.burst(mouthX, mouthY, Math.min(10, chewed + 2), Cell.Sand, stoneColor, 1.1);
      this.shakeAt(mouthX, mouthY, 0.004, 0.025);
    }
    return chewed;
  }

  private stoneMawMouthHazard(e: Enemy, def: EnemyDef): boolean {
    const w = this.ctx.world;
    const dir = e.mawDir === -1 || e.mawDir === 1 ? e.mawDir : Math.sign(this.ctx.player.x - e.x || e.vx || 1);
    const mouthX = Math.floor(e.x + dir * (def.halfW + 1));
    const mouthY = Math.floor(e.y - def.h * 0.45);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -1; dx <= 3; dx++) {
        const x = mouthX + dir * dx;
        const y = mouthY + dy;
        if (!w.inBounds(x, y)) continue;
        const t = w.types[w.idx(x, y)];
        if (t === Cell.Acid || t === Cell.Toxic || t === Cell.Nitrogen || t === Cell.Ice) return true;
      }
    }
    return false;
  }

  private rillbackLiquidFooting(e: Enemy, def: EnemyDef): { wet: number; hazard: number; conductor: number } {
    const w = this.ctx.world;
    let wet = 0;
    let hazard = 0;
    let conductor = 0;
    let samples = 0;
    for (let dy = 0; dy < def.h; dy += 2) {
      for (let dx = -def.halfW; dx <= def.halfW; dx += 2) {
        const x = Math.floor(e.x) + dx;
        const y = Math.floor(e.y) - dy;
        if (!w.inBounds(x, y)) continue;
        samples++;
        const t = w.types[w.idx(x, y)];
        if (rillbackPreferredLiquid(t)) wet++;
        else if (t === Cell.Lava || t === Cell.Acid || t === Cell.Toxic) hazard++;
        if (rillbackChargeableLiquid(t)) conductor++;
      }
    }
    const denom = Math.max(1, samples);
    return { wet: wet / denom, hazard: hazard / denom, conductor };
  }

  private findRillbackLiquidSeek(e: Enemy, def: EnemyDef, radius: number): boolean {
    const w = this.ctx.world;
    const cx = Math.floor(e.x);
    const cy = Math.floor(e.y - def.h * 0.45);
    const r2 = radius * radius;
    let bestD2 = Infinity;
    let bestX = cx;
    let bestY = cy;
    for (let dy = -radius; dy <= radius; dy += 3) {
      for (let dx = -radius; dx <= radius; dx += 3) {
        const d2 = dx * dx + dy * dy;
        if (d2 === 0 || d2 > r2 || d2 >= bestD2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!w.inBounds(x, y)) continue;
        if (!rillbackPreferredLiquid(w.types[w.idx(x, y)])) continue;
        bestD2 = d2;
        bestX = x;
        bestY = y;
      }
    }
    if (!Number.isFinite(bestD2)) return false;
    const dist = Math.sqrt(bestD2) || 1;
    this.rillbackLiquidSeek.dx = (bestX - cx) / dist;
    this.rillbackLiquidSeek.dy = (bestY - cy) / dist;
    return true;
  }

  private rillbackChargePulse(e: Enemy, def: EnemyDef): number {
    if ((e.rillChargeCd ?? 0) > 0) return 0;
    const ctx = this.ctx;
    const w = ctx.world;
    const cx = Math.floor(e.x);
    const cy = Math.floor(e.y - def.h * 0.45);
    let charged = 0;
    for (let dy = -5; dy <= 5 && charged < 8; dy++) {
      for (let dx = -7; dx <= 7 && charged < 8; dx++) {
        if (dx * dx + dy * dy > 48) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        const t = w.types[i];
        if (!rillbackChargeableLiquid(t)) continue;
        w.setChargeAt(i, Math.max(w.charge[i], 6));
        charged++;
      }
    }
    if (charged > 0) {
      e.rillChargeCd = 95 + Math.floor(Math.random() * 45);
      e.blink = Math.max(e.blink, 10);
      ctx.audio.zap();
      ctx.particles.burst(e.x, e.y - def.h * 0.5, Math.min(10, charged + 2), null, () => packRGB(120, 230, 255), 1.3, {
        glow: 2.0,
        grav: -0.03,
      });
    }
    return charged;
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
        if (weaverSupportGrowth(t)) {
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
        if (blocksEntity(t) || weaverSupportGrowth(t)) {
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
        weaverSupportGrowth(below) ||
        weaverSupportGrowth(above) ||
        weaverSupportGrowth(left) ||
        weaverSupportGrowth(right);
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
      ctx.playerCtl.damage(18 * (e.dmgK ?? 1), Math.sign(ctx.player.x - e.x || 1) * 4.0, -2.2, 'weaver-needle');
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
    const wakeRush = disturbed ? WEAVER_CRANKY_FRAMES : source === 'harm' ? 180 : 130;
    e.cranky = Math.max(e.cranky ?? 0, wakeRush);
    if (disturbed) {
      e.recoil = Math.max(e.recoil ?? 0, 10);
      e.attackCd = Math.min(e.attackCd, 24);
      const dir = Math.sign(tx - e.x || ctx.player.x - e.x || 1);
      e.vx += dir * 0.42;
      this.disturbLair(e, tx, ty);
    } else {
      const dir = Math.sign(ctx.player.x - e.x || tx - e.x || 1);
      e.vx += dir * (source === 'harm' ? 0.52 : 0.38);
      e.windup = Math.max(e.windup ?? 0, source === 'harm' ? 6 : 0);
      e.attackCd = Math.max(e.attackCd, source === 'harm' ? 22 : 18);
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

  /** Eat a critter the crawl has carried it onto (approach comes from the
   *  locomotion intent; this only handles the contact snap + the heal). */
  private weaverTryEat(e: Enemy, prey: Critter): void {
    const dx = prey.x - e.x;
    const dy = prey.y - (e.y - 8);
    const d = Math.hypot(dx, dy);
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
    } else if (d < 34) {
      e.weaverFeedT = Math.max(e.weaverFeedT ?? 0, 8);
    }
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

  private traceCellsClear(x0: number, y0: number, x1: number, y1: number, ignoreNear = 8): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps <= ignoreNear * 2) return true;
    for (let s = ignoreNear; s <= steps - ignoreNear; s += 3) {
      const t = s / steps;
      const x = Math.floor(x0 + dx * t);
      const y = Math.floor(y0 + dy * t);
      if (this.ctx.physics.cellBlocks(x, y)) return false;
    }
    return true;
  }

  private hasAttackLine(e: Enemy, def: EnemyDef, lob = false): boolean {
    const sx = e.x;
    const sy = e.y - def.h * 0.65;
    const tx = this.ctx.player.x;
    const ty = this.ctx.player.y - 9;
    if (!lob) return this.traceCellsClear(sx, sy, tx, ty);
    const apexY = Math.min(sy, ty) - Math.min(54, 20 + Math.abs(tx - sx) * 0.12);
    return this.traceCellsClear(sx, sy, (sx + tx) * 0.5, apexY, 6) && this.traceCellsClear((sx + tx) * 0.5, apexY, tx, ty, 6);
  }

  private integrateFlying(e: Enemy, def: EnemyDef, spd: number): void {
    const ctx = this.ctx;
    e.fx += e.vx * spd;
    while (e.fx >= 1) {
      if (!ctx.physics.tryMoveEntity(e, 1, 0, def.halfW, def.h, 0, 3)) {
        e.vx = 0;
        e.fx = 0;
        break;
      }
      e.fx -= 1;
    }
    while (e.fx <= -1) {
      if (!ctx.physics.tryMoveEntity(e, -1, 0, def.halfW, def.h, 0, 3)) {
        e.vx = 0;
        e.fx = 0;
        break;
      }
      e.fx += 1;
    }
    e.fy += e.vy * spd;
    while (e.fy >= 1) {
      if (!ctx.physics.tryMoveEntity(e, 0, 1, def.halfW, def.h, 0, 4)) {
        e.vy = Math.min(0, e.vy);
        e.fy = 0;
        break;
      }
      e.fy -= 1;
    }
    while (e.fy <= -1) {
      if (!ctx.physics.tryMoveEntity(e, 0, -1, def.halfW, def.h, 0, 4)) {
        e.vy = Math.max(0, e.vy);
        e.fy = 0;
        break;
      }
      e.fy += 1;
    }
    e.x = Math.floor(clamp(e.x, def.halfW + 2, WIDTH - def.halfW - 3));
    e.y = Math.floor(clamp(e.y, def.h + 1, HEIGHT - 3));
  }

  /* ============================================================
   * THREAT-AWARE BEHAVIOR (drives + reflexes). Bolted on top of the per-kind AI:
   * updateBehavior() runs BEFORE the per-kind branch (senses danger, integrates
   * the fear/aggression drives, decides a dodge/flee reflex); the integration
   * seam then OVERRIDES the per-kind vx/vy with that reflex. Per-kind TEMPERAMENT
   * weights make a slime dumb and a bat flighty. Fail-open: reflexes are short,
   * timed, and never hard-lock — a stuck foe re-decides next frame.
   * ============================================================ */

  /** Reused per-frame threat read (no per-enemy allocation on the hot path).
   *  tvx/tvy = unit velocity of the single most-urgent imminent threat (for the
   *  perpendicular dodge); fleeX/fleeY = aggregate "away from danger" direction. */
  private readonly threat = { level: 0, fleeX: 0, fleeY: 0, imminent: false, tvx: 0, tvy: 0 };
  /** The player's active Flame Jet cone this frame (sampled once in update), or null. */
  private flameStream: { x: number; y: number; angle: number; reach: number; cone: number } | null = null;

  /** Scan the foe's surroundings for danger and fill this.threat: nearby lethal
   *  cells (lava/fire/acid pools), fast rigid bodies on a collision course
   *  (thrown/pulled crates, blast debris), incoming player projectiles, and self
   *  harm (on fire / low HP). `fleeX/fleeY` point AWAY from the danger. */
  private senseThreat(e: Enemy, def: EnemyDef): void {
    const t = this.threat;
    t.level = 0;
    t.fleeX = 0;
    t.fleeY = 0;
    t.imminent = false;
    t.tvx = 0;
    t.tvy = 0;
    let bestU = 0; // urgency of the most pressing imminent threat (drives the dodge axis)
    const ctx = this.ctx;
    const w = ctx.world;
    const ex = e.x;
    const ey = e.y - def.h * 0.5;

    // (a) HAZARD CELLS in a small box → flee away from the nearest lethal cell.
    const R = def.halfW + 9;
    let hzX = 0,
      hzY = 0,
      hzN = 0,
      hzNear = 0;
    for (let dy = -def.h - 2; dy <= 3; dy += 2) {
      for (let dx = -R; dx <= R; dx += 2) {
        const X = Math.floor(e.x) + dx;
        const Y = Math.floor(e.y) + dy;
        if (!w.inBounds(X, Y) || !enemyLethalCell(e.kind, w.types[w.idx(X, Y)])) continue;
        const d = Math.hypot(dx, dy) || 1;
        hzX += -dx / d;
        hzY += -dy / d;
        hzN++;
        const prox = 1 - Math.min(1, d / R);
        if (prox > hzNear) hzNear = prox;
      }
    }
    if (hzN > 0) {
      const m = Math.hypot(hzX, hzY) || 1;
      t.fleeX += (hzX / m) * (0.5 + hzNear * 0.5);
      t.fleeY += (hzY / m) * 0.3;
      t.level = Math.max(t.level, 0.35 + hzNear * 0.55);
    }

    // (b) FAST RIGID BODIES on a collision course (thrown/pulled crate, debris).
    for (const b of ctx.rigidBodies.bodies) {
      if (b.kind !== 'dynamic') continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 2.2) continue;
      const rdx = ex - b.x;
      const rdy = ey - b.y;
      const dist = Math.hypot(rdx, rdy);
      if (dist > 60 || dist < 0.5) continue;
      const toward = (b.vx * rdx + b.vy * rdy) / (sp * dist); // body velocity · body→me
      if (toward < 0.4) continue;
      const tti = dist / sp;
      if (tti > 26) continue;
      const urgency = (1 - tti / 26) * Math.min(1, toward);
      t.fleeX += rdx / dist;
      t.fleeY += (rdy / dist) * 0.4;
      t.level = Math.max(t.level, 0.55 + urgency * 0.45);
      if (tti < 14 && urgency > bestU) {
        t.imminent = true;
        bestU = urgency;
        t.tvx = b.vx / sp;
        t.tvy = b.vy / sp;
      }
    }

    // (c) INCOMING PLAYER PROJECTILES headed at me.
    for (const pr of ctx.projectiles) {
      if (pr.hostile) continue; // its own kind's shots
      const sp = Math.hypot(pr.vx, pr.vy);
      if (sp < 1) continue;
      const rdx = ex - pr.x;
      const rdy = ey - pr.y;
      const dist = Math.hypot(rdx, rdy);
      if (dist > 70 || dist < 0.5) continue;
      const toward = (pr.vx * rdx + pr.vy * rdy) / (sp * dist);
      if (toward < 0.6) continue;
      const tti = dist / sp;
      if (tti > 22) continue;
      t.fleeX += (rdx / dist) * 0.8;
      t.level = Math.max(t.level, 0.5 + (1 - tti / 22) * 0.4);
      const purg = (1 - tti / 22) * toward;
      if (tti < 12 && purg > bestU) {
        t.imminent = true;
        bestU = purg;
        t.tvx = pr.vx / sp;
        t.tvy = pr.vy / sp;
      }
    }

    // (d) SELF: on fire, or badly wounded.
    if (e.status.burning > 0) t.level = Math.max(t.level, 0.85);
    const hpFrac = e.hp / Math.max(1, e.maxHp);
    if (hpFrac < 0.35) t.level = Math.max(t.level, 0.4 + (0.35 - hpFrac) * 1.2);

    // (e) THE PLAYER'S FLAME-JET CONE — sidestep ACROSS the stream to get out of
    //     its line (only foes fire actually harms; an imp basks in it).
    const fs = this.flameStream;
    if (fs && enemyLethalCell(e.kind, Cell.Fire)) {
      const dx = ex - fs.x;
      const dy = ey - fs.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5 && dist < fs.reach) {
        let da = Math.atan2(dy, dx) - fs.angle;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) < fs.cone + 0.3) {
          const ax = Math.cos(fs.angle);
          const ay = Math.sin(fs.angle);
          let perpX = -ay; // sidestep perpendicular to the stream axis
          let perpY = ax;
          if (perpX * dx + perpY * dy < 0) {
            perpX = -perpX; // toward whichever side the foe is already on
            perpY = -perpY;
          }
          t.fleeX += perpX;
          t.fleeY += perpY * 0.5;
          const urg = 1 - dist / fs.reach;
          t.level = Math.max(t.level, 0.6 + urg * 0.4);
          if (Math.abs(da) < fs.cone && urg > bestU) {
            t.imminent = true;
            bestU = urg;
            t.tvx = ax;
            t.tvy = ay;
          }
        }
      }
    }
  }

  /** The arbiter: sense danger, integrate the fear/aggression drives, and commit
   *  a dodge or flee reflex. Mutates the drive/reflex fields on `e`; the
   *  integration seam reads them to override the per-kind movement this frame. */
  private updateBehavior(e: Enemy, def: EnemyDef, pdx: number, _pdy: number, pDist: number): void {
    if ((e.dodgeT ?? 0) > 0) e.dodgeT = (e.dodgeT ?? 0) - 1;
    if ((e.dodgeCd ?? 0) > 0) e.dodgeCd = (e.dodgeCd ?? 0) - 1;
    if ((e.fleeT ?? 0) > 0) e.fleeT = (e.fleeT ?? 0) - 1;
    if (e.kind === 'eggs') return;
    // The full danger sweep (hazard box + every rigid body + every projectile,
    // per foe) is the dominant AI cost, and it ran even for idle foes. Run it
    // every OTHER tick, staggered by each foe's own timer: threat TTI windows
    // are 12-26 ticks, so a ≤1-tick reflex delay is imperceptible. The drive
    // integration rates below are DOUBLED to keep the same per-second tuning.
    if (e.timer % 2 === 1) return;
    const temp = TEMPERAMENT[e.kind] ?? DEFAULT_TEMPERAMENT;

    this.senseThreat(e, def);
    const t = this.threat;
    const threat = Math.min(1, t.level * temp.fear);

    // FEAR rises fast toward the sensed threat, ebbs slowly when safe.
    const fear0 = e.fear ?? 0;
    e.fear = threat > fear0 ? threat : Math.max(threat, fear0 - 0.04);

    // AGGRESSION rises near the player + when freshly hit (vengeance), bleeds off
    // when scared or alone. (Rates are 2x the original per-tick values — this
    // integrator now runs on the 2-tick cadence above.)
    const close = pDist < 200 ? 1 - pDist / 200 : 0;
    const vengeance = (e.flash ?? 0) > 0 ? 0.08 : 0;
    e.aggression = Math.max(
      0,
      Math.min(1, (e.aggression ?? 0) + close * 0.04 + vengeance - (e.fear ?? 0) * 0.06 - 0.01),
    );

    // CHASE SCALE: fear makes a foe hesitate; aggression only offsets that (never
    // a speed-up past normal, so boss/per-kind tuning is preserved).
    e.chaseScale = Math.max(0.25, Math.min(1, 1 - (e.fear ?? 0) * 0.7 + (e.aggression ?? 0) * 0.15));

    // REFLEX DODGE: an imminent crate/bolt → SIDESTEP perpendicular to its path
    // (fleeing straight away can't outrun a fast projectile; a jink across its
    // line does). Gated by the kind's dodge skill.
    if (t.imminent && (e.dodgeT ?? 0) <= 0 && (e.dodgeCd ?? 0) <= 0 && e.alerted) {
      e.dodgeCd = 22; // one roll per incoming threat (set whether it dodges or not)
      if (Math.random() >= temp.dodge) {
        // declined this jink — a brute tanks it
      } else {
      let px = -t.tvy; // perpendicular to the threat's velocity
      let py = t.tvx;
      if (px * t.fleeX + py * t.fleeY < 0) {
        px = -px; // pick the side that also leans away from the threat
        py = -py;
      }
      if (e.grounded && py > 0.2) py = -Math.abs(py); // can't dodge into the floor — hop up
      const pm = Math.hypot(px, py) || 1;
      e.dodgeT = 12;
      e.dodgeVX = (px / pm) * 2.7;
      e.dodgeVY = (py / pm) * 2.7;
      e.fear = Math.max(e.fear ?? 0, 0.5);
      // a soft airy whiff on the commit — gated to near the alchemist so a
      // swarm jinking at once doesn't roar (off-screen foes are frozen anyway).
      if (pDist < 160) this.ctx.audio.noiseBurst(0.05, 1500, 0.045, true);
      }
    }

    // FLEE: high fear → commit to retreating; seek water if on fire and hates it.
    if ((e.fear ?? 0) >= temp.fleeAt && (e.fleeT ?? 0) <= 0) {
      let dir = t.fleeX !== 0 ? Math.sign(t.fleeX) : -Math.sign(pdx || 1);
      if (e.status.burning > 0 && temp.seekWater) {
        const wdir = this.nearestWaterDir(e, def);
        if (wdir !== 0) dir = wdir;
      }
      e.fleeT = 26;
      e.fleeDir = dir;
    }
  }

  /** Horizontal direction (-1/+1) toward the nearest water within reach, else 0.
   *  A burning foe that hates fire uses this to bolt for a douse. */
  private nearestWaterDir(e: Enemy, def: EnemyDef): number {
    const w = this.ctx.world;
    for (let r = 3; r <= 42; r += 3) {
      for (const dir of [-1, 1] as const) {
        const X = Math.floor(e.x) + dir * r;
        for (let dy = -def.h; dy <= 4; dy += 2) {
          const Y = Math.floor(e.y) + dy;
          if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === Cell.Water) return dir;
        }
      }
    }
    return 0;
  }

  private enemyEnvironmentDamage(e: Enemy, index?: number): void {
    const ctx = this.ctx;
    const def = this.defs[e.kind];
    let dmg = 0;
    for (let dy = 0; dy < def.h; dy += 2) {
      let rowDmg = 0;
      for (let dx = -def.halfW; dx <= def.halfW; dx += 2) {
        const X = Math.floor(e.x) + dx,
          Y = Math.floor(e.y) - dy;
        if (!ctx.world.inBounds(X, Y)) continue;
        rowDmg = Math.max(rowDmg, directEnvironmentDamage(e.kind, ctx.world.types[ctx.world.idx(X, Y)]));
      }
      dmg += rowDmg;
    }
    if (dmg <= 0) return;
    if ((e.envDamageFeedbackCd ?? 0) <= 0) {
      e.envDamageFeedbackCd = ENV_DAMAGE_FEEDBACK_COOLDOWN;
      e.flash = Math.max(e.flash, 2);
      ctx.particles.burst(e.x, e.y - 5, 3, Cell.Smoke, smokeColor, 0.7, { grav: 0.02 });
    }
    this.alertFromDamage(e);
    e.hp -= dmg;
    if (e.hp <= 0) {
      if (index === undefined) this.kill(e, 0, 0);
      else this.killAt(index, e, 0, 0);
    }
  }

  private teleportEnemy(e: Enemy, def: EnemyDef): void {
    const ctx = this.ctx;
    e.tpCool = 120;
    const color = (): number => packRGB(185, 110, 255);
    ctx.particles.burst(e.x, e.y - def.h * 0.5, 12, null, color, 2.0, { glow: 2.2, grav: 0 });
    for (let attempt = 0; attempt < 32; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 28 + Math.random() * 68;
      const nx = Math.floor(clamp(e.x + Math.cos(a) * r, def.halfW + 2, WIDTH - def.halfW - 3));
      const ny = Math.floor(clamp(e.y + Math.sin(a) * r, def.h + 1, HEIGHT - 3));
      if (!ctx.physics.entityFree(nx, ny, def.halfW, def.h)) continue;
      e.x = nx;
      e.y = ny;
      e.vx = 0;
      e.vy = 0;
      e.fx = 0;
      e.fy = 0;
      ctx.particles.burst(nx, ny - def.h * 0.5, 12, null, color, 2.0, { glow: 2.2, grav: 0 });
      ctx.audio.tone(660, 1320, 0.14, 'sine', 0.12);
      return;
    }
  }

  private hatchEggClutchAt(index: number, e: Enemy, noisy: boolean): void {
    const ctx = this.ctx;
    const brood = 2 + (e.bobPhase > Math.PI ? 1 : 0);
    for (let b2 = 0; b2 < brood; b2++) {
      ctx.enemyCtl.spawn('slime', e.x + (b2 - 1) * 4, e.y - 2);
    }
    if (noisy) {
      ctx.particles.burst(e.x, e.y - 3, 14, Cell.Slime, slimeColor, 2.0);
      ctx.audio.squelch();
      ctx.events.emit('toast', { text: 'AN EGG CLUTCH HATCHES' });
    }
    this.removeEnemyAt(index);
  }

  private tickOffscreenLifecycle(index: number, e: Enemy, debugEnemyAttacksSuppressed: boolean): void {
    if (e.flash > 0) e.flash--;
    if ((e.envDamageFeedbackCd ?? 0) > 0) e.envDamageFeedbackCd = (e.envDamageFeedbackCd ?? 0) - 1;
    if ((e.fusing ?? 0) > 0 && !debugEnemyAttacksSuppressed) {
      e.fusing = (e.fusing ?? 0) - 1;
      if (e.fusing === 0) this.killAt(index, e, 0, 0);
      return;
    }
    if (e.kind !== 'eggs' || debugEnemyAttacksSuppressed) return;
    e.timer++;
    if (e.timer > 1400 + e.bobPhase * 220) this.hatchEggClutchAt(index, e, false);
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const enemies = ctx.enemies;
    const player = ctx.player;
    const targetAlive = !player.dead;
    const debugEnemyAttacksSuppressed = ctx.debug?.active === true;
    // The player's active Flame Jet cone this frame, sampled once so every foe's
    // threat scan can sidestep out of it (the stream is the same for all of them).
    this.flameStream = ctx.wands?.streamFlameInfo?.(ctx) ?? null;

    const sim = ctx.world.simBounds;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e) continue;
      // A mid-loop swap-remove (e.g. a bomber's death explosion killing a foe
      // at a lower index) can move an ALREADY-UPDATED element into a slot this
      // backwards sweep hasn't reached yet — the stamp turns that second visit
      // into a no-op instead of a double update.
      if (e._tickStamp === ctx.state.frameCount) continue;
      e._tickStamp = ctx.state.frameCount;
      const def = this.defs[e.kind];
      // Debug freeze (Runtime panel): a posed/dragged foe skips its AI entirely
      // while the renderer keeps drawing it (and solving a held Weaver's legs).
      if (ctx.debug.frozenEnemy(e)) {
        // a HELD weaver still poses its rig (legs grab at passing surfaces)
        if (e.kind === 'weaver' && ctx.debug.dragRef === e) {
          const intent = this.weaverIntent;
          intent.move = 'hold';
          intent.tx = e.x;
          intent.ty = e.y;
          intent.urgency = 0;
          intent.stance = 'normal';
          intent.speedScale = 1;
          tickWeaverLocomotion(ctx, e, def, intent);
        }
        continue;
      }
      // Keep expensive combat AI inside the simulation window, but let ecology
      // timers with consequences age offscreen so clutches and lit fuses do not
      // pause forever just because the camera moved away.
      if (e.x < sim.x0 - 60 || e.x > sim.x1 + 60 || e.y < sim.y0 - 60 || e.y > sim.y1 + 60) {
        this.tickOffscreenLifecycle(i, e, debugEnemyAttacksSuppressed);
        continue;
      }
      if (e.flash > 0) e.flash--;
      if ((e.envDamageFeedbackCd ?? 0) > 0) e.envDamageFeedbackCd = (e.envDamageFeedbackCd ?? 0) - 1;
      if ((e.wary ?? 0) > 0) e.wary = (e.wary ?? 0) - 1;
      if ((e.cranky ?? 0) > 0) e.cranky = (e.cranky ?? 0) - 1;
      if ((e.webPulse ?? 0) > 0) e.webPulse = (e.webPulse ?? 0) - 1;
      if ((e.weaverFeedT ?? 0) > 0) e.weaverFeedT = (e.weaverFeedT ?? 0) - 1;
      if ((e.slimed ?? 0) > 0 && !debugEnemyAttacksSuppressed) e.slimed = (e.slimed ?? 0) - 1;
      if ((e.tpCool ?? 0) > 0) e.tpCool = (e.tpCool ?? 0) - 1;
      e.timer++;
      if (e.attackCd > 0 && !debugEnemyAttacksSuppressed) e.attackCd--;
      this.enemyEnvironmentDamage(e, i);
      if (enemies[i] !== e) continue; // died from environment
      this.gumBatWingsWithSlime(e, def);

      // Sim-sampled statuses (DESIGN pillar 5/9): every 2nd frame the cells
      // touching the body ARE the status — damage lands straight on hp (no
      // flash), and a frozen body's horizontal speed is scaled once per sample.
      if (e.timer % 2 === 0) {
        const eff = sampleAndTickStatus(ctx, e, def.halfW, def.h, STATUS_IMMUNE[e.kind], 2);
        if (eff.healing > 0 && e.hp < e.maxHp) {
          e.hp = Math.min(e.maxHp, e.hp + eff.healing);
          if (ctx.state.frameCount % 10 === 0) {
            ctx.particles.spawn(
              e.x + (Math.random() - 0.5) * def.halfW,
              e.y - def.h * 0.5 - Math.random() * def.h * 0.4,
              (Math.random() - 0.5) * 0.25,
              -0.45 - Math.random() * 0.3,
              null,
              packRGB(255, 150, 195),
              22,
              { glow: 1.8, grav: -0.01 },
            );
          }
        }
        if (eff.damage > 0) e.hp -= eff.damage;
        if (e.hp <= 0) {
          this.killAt(i, e, 0, 0);
          continue;
        }
        if (eff.teleportTouch && (e.tpCool ?? 0) <= 0) this.teleportEnemy(e, def);
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

      // THREAT-AWARE REFLEXES: sense danger, run the fear/aggression drives, and
      // arm a dodge/flee. The per-kind branch below still decides chase/attack as
      // before; the integration seam lets an armed reflex override it this frame.
      this.updateBehavior(e, def, pdx, pdy, pDist);

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
            e.kind === 'acidslime' ? 'acidslime-bite' : 'slime-bite',
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
          this.hatchEggClutchAt(i, e, true);
          continue;
        }
      } else if (e.kind === 'bat') {
        const wingsSlimed = (e.slimed ?? 0) > 0;
        // Roosting (Wave F): hangs dormant from the ceiling until disturbed
        if (e.sleeping && !wingsSlimed) {
          e.vx = 0;
          e.vy = 0;
          if (targetAlive && pDist < 70) {
            e.sleeping = false;
            e.vy = 1.2; // drop off the ceiling
            ctx.audio.tone(1900 + Math.random() * 600, 2600, 0.08, 'square', 0.06);
          }
          continue;
        }
        if (wingsSlimed) e.sleeping = false;
        // Erratic flying swarmer: darts at the wizard, contact bites.
        // Wave F predation: a moth nearby is easier prey than the wizard.
        e.bobPhase += 0.22;
        let hunting = false;
        if (!wingsSlimed && (!targetAlive || pDist > 120)) {
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
        if (!wingsSlimed && e.hp / e.maxHp < 0.4 && !e.tumble && Math.random() < 0.012) e.tumble = 14;
        if (wingsSlimed) {
          e.windup = 0;
          e.swoop = 0;
          e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
          e.vy += 0.34;
          e.vx *= e.grounded ? 0.78 : 0.94;
          e.vx += (Math.random() - 0.5) * (e.grounded ? 0.18 : 0.1);
          if (e.grounded && e.timer % 13 === 0) e.vy = -0.55 - Math.random() * 0.2;
          if ((e.tumble ?? 0) > 0 && !debugEnemyAttacksSuppressed) e.tumble = (e.tumble ?? 0) - 1;
        } else if (e.tumble) {
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
        e.vy += Math.sin(e.bobPhase) * (wingsSlimed ? 0.02 : 0.08);
        // a committed dart briefly outruns the normal flight cap; slimed wings only twitch
        const batMax = wingsSlimed ? 1.0 : e.swoop ? 2.6 : 1.7;
        e.vx = clamp(e.vx, -batMax, batMax);
        e.vy = clamp(e.vy, wingsSlimed ? -0.85 : -batMax, wingsSlimed ? 2.0 : batMax);
        if (!wingsSlimed && !ctx.physics.entityFree(e.x, e.y, def.halfW, def.h)) {
          e.y -= 1;
          e.vy = -0.6;
        }
        if (!wingsSlimed && canAttackTarget && e.attackCd === 0 && Math.abs(pdx) < 8 && Math.abs(pdy) < 12) {
          ctx.playerCtl.damage(6 * (e.dmgK ?? 1), Math.sign(pdx) * -2.2, -1.6, 'bat-bite');
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
        this.spitterRootHabitat(e, def);
        if ((e.recoil ?? 0) > 0) e.recoil = (e.recoil ?? 0) - 1;
        // Ranged openers are gated on `alerted` so the notice blip always
        // precedes the first shot (attack ranges exceed the sense radius at
        // low difficulties — nothing may fire on a player it hasn't clocked).
        if (canAttackTarget && e.alerted && e.attackCd === 0 && pDist < 280 && this.hasAttackLine(e, def, true)) {
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
            source: 'acidglob',
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
      } else if (e.kind === 'rootloper') {
        // Tanglewrist Root Loper: an overgrowth predator that moves best when
        // real vines/moss/fungus/wood give its tendrils something to plant in.
        e.vy += 0.31;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        if ((e.rootPanic ?? 0) > 0) e.rootPanic = (e.rootPanic ?? 0) - 1;
        if (e.status.burning > 0) e.rootPanic = Math.max(e.rootPanic ?? 0, 42);
        if (e.timer % 6 === 0) {
          const footing = this.rootLoperFooting(e, def);
          e.rootSupport = footing.support;
          e.rootSeekDir = footing.seekDir;
          if (footing.hazard > 0 || footing.support < 0.18) e.rootPanic = Math.max(e.rootPanic ?? 0, 18);
        }
        const support = e.rootSupport ?? (e.grounded ? 0.25 : 0);
        const panicked = (e.rootPanic ?? 0) > 0;

        if ((e.windup ?? 0) > 0) {
          e.vx *= 0.68;
          if (!debugEnemyAttacksSuppressed) e.windup = (e.windup ?? 1) - 1;
          if (e.windup === 0 && canAttackTarget) {
            const tx = e.rootLashX ?? ctx.player.x;
            const ty = e.rootLashY ?? ctx.player.y - 9;
            const dx = ctx.player.x - tx;
            const dy = ctx.player.y - 9 - ty;
            if (Math.abs(ctx.player.x - e.x) < 62 && Math.abs(ctx.player.y - 9 - (e.y - 7)) < 34 && dx * dx + dy * dy < 28 * 28) {
              ctx.playerCtl.damage(13 * (e.dmgK ?? 1), Math.sign(ctx.player.x - e.x || 1) * -3.2, -1.8, 'rootloper-lash');
              ctx.particles.burst(ctx.player.x, ctx.player.y - 10, 5, Cell.Vines, vineColor, 1.0);
            }
            e.attackCd = 70;
            e.rootLashX = undefined;
            e.rootLashY = undefined;
          }
        } else if (canAttackTarget && e.attackCd === 0 && pDist < 62 && Math.abs(pdy) < 36 && support > 0.12) {
          e.windup = 13;
          e.rootLashX = ctx.player.x;
          e.rootLashY = ctx.player.y - 9;
          e.attackCd = 18;
          ctx.audio.tone(220, 120, 0.12, 'triangle', 0.06);
        }

        if (e.grounded) {
          e.vx *= panicked ? 0.72 : 0.84;
          if (panicked) {
            e.vx += (Math.random() - 0.5) * 0.6 - Math.sign(pdx || 1) * 0.06;
          } else if (!e.alerted && e.patrol && e.patrol.length > 0) {
            const wp = e.patrol[(e.patrolIdx ?? 0) % e.patrol.length];
            if (Math.abs(wp[0] - e.x) < 10) e.patrolIdx = ((e.patrolIdx ?? 0) + 1) % e.patrol.length;
            e.vx += Math.sign(wp[0] - e.x || 1) * (0.035 + support * 0.045);
          } else if (targetAlive) {
            e.vx += Math.sign(pdx || e.rootSeekDir || 1) * (0.04 + support * 0.075);
            if (Math.abs(pdx) < 18) e.vx *= 0.4;
            if (pdy < -24 && support > 0.36 && e.timer % 44 === 0) e.vy = -1.7 - support * 0.45;
          } else {
            e.vx += (e.rootSeekDir ?? 0) * 0.035;
          }
        } else {
          e.vx += (e.rootSeekDir ?? 0) * 0.018;
        }

        if (!panicked && support > 0.22 && e.timer % 18 === 0) this.stampRootLoperGrowth(e, support);
        const maxRootSpeed = panicked ? 0.75 : 0.55 + support * 0.85;
        e.vx = clamp(e.vx, -maxRootSpeed, maxRootSpeed);
      } else if (e.kind === 'weaver') {
        // The Weaver reads its web-footing for CONFIDENCE (webs are a highway
        // and a comfort blanket — burning them shows), writes real vine
        // strands to control the room, and hands movement to the
        // surface-crawler locomotion (entities/weaverLocomotion): a body
        // suspended from load-bearing feet, one code path for floors, walls,
        // ceilings and platform lips. Gaps are crossed by real ballistic
        // pounces; a miss is just a fall and anything a leg catches re-attaches.
        if (e.timer % 6 === 0) e.weaverSupport = this.weaverFooting(e, def);
        const support = e.weaverSupport ?? 0;
        const cranky = (e.cranky ?? 0) > 0;
        const loco = e.weaverLoco;
        const attached = loco?.mode === 'attached';
        const readBlocked = loco?.blocked ?? 0;
        const recovering = (loco?.recoverT ?? 0) > 0;
        const intent = this.weaverIntent;
        intent.move = 'hold';
        intent.tx = player.x;
        intent.ty = player.y - 9;
        intent.urgency = cranky ? 1 : e.alerted ? 0.5 + support * 0.3 : 0.15;
        intent.stance = 'normal';
        intent.speedScale = 1;
        if ((e.recoil ?? 0) > 0) e.recoil = (e.recoil ?? 0) - 1;
        if ((e.weaverPounceCd ?? 0) > 0) e.weaverPounceCd = (e.weaverPounceCd ?? 0) - 1;

        if (e.sleeping) {
          intent.stance = 'sleep';
          const forcedAwake = e.hp < e.maxHp || e.status.burning > 0 || e.status.electrified > 0;
          if (forcedAwake || (targetAlive && pDist < 82)) {
            this.wakeWeaver(e, forcedAwake ? 'harm' : 'proximity');
          } else if (!debugEnemyAttacksSuppressed && e.timer % 180 === 0) {
            this.weaveThread(e, e.x + (Math.random() - 0.5) * 28, e.y - 18 - Math.random() * 18);
          }
        } else if (e.blink > 0) {
          // Thread-spit telegraph: rooted (the crawl coils to a stop), then a
          // sagging vine line appears through the air near the alchemist.
          intent.stance = 'crouch';
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
          // leg while this countdown holds the body coiled and still.
          intent.stance = 'crouch';
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
          // A weaver that has CLOCKED you commits to the hunt — only an
          // UNAWARE/idle weaver breaks off to snack on ambient critters.
          const prey = !cranky && (!e.alerted || !targetAlive) ? this.findWeaverPrey(e) : null;
          if (prey) {
            intent.move = 'toward';
            intent.tx = prey.x;
            intent.ty = prey.y;
            intent.urgency = 0.25;
            this.weaverTryEat(e, prey);
            e.bobPhase += 0.08;
          } else if (!e.alerted && e.patrol && e.patrol.length > 0) {
            const wp = e.patrol[(e.patrolIdx ?? 0) % e.patrol.length];
            if (Math.abs(wp[0] - e.x) < 12) e.patrolIdx = ((e.patrolIdx ?? 0) + 1) % e.patrol.length;
            intent.move = 'toward';
            intent.tx = wp[0];
            intent.ty = wp[1];
            intent.urgency = 0.2;
          } else if (targetAlive && e.alerted) {
            // THE HUNT: crawl the terrain contour toward the quarry — walls,
            // ceilings and lips are all the same road to a surface crawler.
            intent.move = 'toward';
            // rear up and reach when the quarry hovers just overhead
            if (attached && pdy < -20 && Math.abs(pdx) < 60 && pDist < 90 && !recovering) {
              intent.stance = 'rear';
            }
            // PREDATOR IMPATIENCE: chasing with a clear line but barely
            // closing (the contour is a long detour — down a chasm and back
            // up, around a floating platform) — take the shortcut instead.
            if (e.timer % 36 === 0) {
              const ref = e.weaverProgressRef ?? Infinity;
              e.weaverProgressRef = pDist;
              if (pDist > 70 && pDist > ref - 6) {
                e.weaverImpatience = (e.weaverImpatience ?? 0) + 1;
              } else {
                e.weaverImpatience = 0;
              }
            }
            // POUNCE: the contour can't get there (the crawl is blocked by a
            // gap), the detour is wasting the hunt (impatience), or crankiness
            // boils over — and the line is clear. A real ballistic leap.
            const impatient = (e.weaverImpatience ?? 0) >= 2;
            const pounceReady =
              attached && !recovering && (e.weaverPounceCd ?? 0) === 0 && canAttackTarget;
            // A blocked/impatient crawl may pounce from farther out — the leap
            // has real range, so an out-of-reach quarry gets a committed jump
            // that lands short (often on the far lip of a gap) and re-attaches.
            const farPounce = readBlocked > 20 || impatient;
            const lineClear =
              pounceReady &&
              pDist > 26 &&
              pDist < (farPounce ? 190 : 130) &&
              pdy > -70 &&
              this.traceCellsClear(e.x, e.y - def.h * 0.5, player.x, player.y - 9);
            if (lineClear && (farPounce || (cranky && pDist < 100))) {
              e.weaverImpatience = 0;
              e.weaverProgressRef = undefined;
              weaverLeap(e, player.x + clamp(player.vx * 6, -14, 14), player.y - 12);
              e.weaverPounceCd = cranky ? 55 : 95;
              e.webPulse = Math.max(e.webPulse ?? 0, 10);
              ctx.audio.tone(210, 60, 0.28, 'triangle', 0.08);
              ctx.particles.burst(e.x, e.y - 6, 6, Cell.Vines, vineColor, 0.8, { grav: -0.01 });
            }
          }

          if (canAttackTarget && e.attackCd === 0 && e.alerted && !recovering) {
            if (Math.abs(pdx) < 13 && Math.abs(pdy) < 20) {
              // Point-blank contact bite: instant (no telegraph this close) and
              // it claims the cooldown. Works mid-air too — a pounce that lands.
              ctx.playerCtl.damage(10 * (e.dmgK ?? 1), Math.sign(pdx || 1) * -3.0, -2.0, 'weaver-bite');
              e.attackCd = 80;
            } else if (attached && pDist < 92 && Math.abs(pdy) < 62) {
              // Rooted telegraphs need footing.
              e.windup = e.status.burning > 0 ? 10 : cranky ? 12 : 18;
              e.needleX = player.x;
              e.needleY = player.y - 8;
              e.webPulse = Math.max(e.webPulse ?? 0, 8);
              ctx.audio.tone(180, 90, 0.35, 'triangle', 0.09);
            } else if (attached && Math.abs(pdy) > 50 && pDist < 285 && readBlocked > 12) {
              // Thread-spit is the reach for prey the contour genuinely can't
              // deliver (vertically separated AND the crawl is stalled) — a
              // same-level quarry gets closed on and bitten, never stalled at.
              e.blink = e.status.burning > 0 ? 10 : cranky ? 9 : 18;
              ctx.audio.noiseBurst(0.08, 1300, 0.08, true);
            }
          }
        }

        // silk trail: anchor the room it moves through (webs = future highway)
        if (!e.sleeping && attached && (cranky || support < 0.55) && e.timer % WEAVER_TRAIL_WEB_COOLDOWN === 0) {
          this.weaveFootTrail(e, support);
        }
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
        if (canAttackTarget && e.alerted && e.attackCd === 0 && pDist < 300 && this.hasAttackLine(e, def)) {
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
            source: 'hostile-fireball',
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
        if (canAttackTarget && e.alerted && e.attackCd === 0 && pDist < 320 && this.hasAttackLine(e, def)) {
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
            source: 'frostbolt',
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
          if (e.blink === 0 && canAttackTarget && (!this.hasAttackLine(e, def, true) || !this.mageVolley(e)))
            e.attackCd = Math.max(e.attackCd, 95);
        } else {
          if (targetAlive) e.vx += Math.sign(pdx) * 0.04;
          e.vx = clamp(e.vx, -0.45, 0.45);
          if (canAttackTarget && e.alerted && e.attackCd === 0 && pDist < 340 && this.hasAttackLine(e, def, true)) {
            e.blink = 20; // begin the 20-frame telegraph
            e.attackCd = 180 + Math.floor(Math.random() * 80);
          }
        }

        // One-time emergency blink once bloodied: 40-80 cells away, both ends
        // marked with purple bursts. The blink is only SPENT when a landing
        // actually exists — in a cramped room every attempt can fail, and
        // burning the charge without moving lost the escape forever, exactly
        // when it was needed most.
        if (e.jetFuel === 0 && e.hp < e.maxHp * 0.5) {
          const burstCol = (): number => packRGB(180 + ((Math.random() * 60) | 0), 70, 255);
          for (let attempt = 0; attempt < 20; attempt++) {
            const a = Math.random() * Math.PI * 2;
            const r = 40 + Math.random() * 40;
            const nx = Math.floor(clamp(e.x + Math.cos(a) * r, def.halfW + 2, WIDTH - def.halfW - 3));
            const ny = Math.floor(clamp(e.y + Math.sin(a) * r, def.h + 1, HEIGHT - 3));
            if (ctx.physics.entityFree(nx, ny, def.halfW, def.h)) {
              e.jetFuel = 1;
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
          // THERMAL SHOCK: the furnace cracks — heavy damage whose tell is the
          // steam below plus a hurt flash. A direct decrement (the leviathan's
          // electro-shock pattern): the full damage() path would spray blood
          // and stain walls off a stone boss EVERY wet frame.
          this.alertFromDamage(e);
          e.hp -= 1.4;
          e.flash = Math.max(e.flash, 2);
          if (e.hp <= 0) {
            this.kill(e, 0, 0);
            continue;
          }
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
            ctx.explosions.trigger(e.x + Math.sign(pdx) * 18, e.y - 2, 11, { playerDamageSource: 'colossus-slam' });
            ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.03, 0.06);
            e.attackCd = 150 + Math.floor(Math.random() * 40);
          } else if (Math.abs(pdx) < 300 && this.hasAttackLine(e, def, true)) {
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
                source: 'colossus-fireball',
              });
            }
            ctx.audio.tone(90, 220, 0.4, 'sawtooth', 0.16);
            e.attackCd = 170 + Math.floor(Math.random() * 50);
          }
        }
      } else if (e.kind === 'rillback') {
        // Rillback Silt Eel: a small pool predator. Wet body = fluid S-curve
        // steering and a short living-conductor pulse; dry body = weak flops.
        if ((e.rillChargeCd ?? 0) > 0) e.rillChargeCd = (e.rillChargeCd ?? 0) - 1;
        const chargeWinding = (e.rillChargeWindup ?? 0) > 0;
        if ((e.rillChargeWindup ?? 0) > 0) e.rillChargeWindup = (e.rillChargeWindup ?? 0) - 1;
        const chargeReady = chargeWinding && (e.rillChargeWindup ?? 0) <= 0;
        if ((e.blink ?? 0) > 0) e.blink--;
        if (e.timer % 4 === 0) {
          const footing = this.rillbackLiquidFooting(e, def);
          e.rillWet = footing.wet;
          if (footing.hazard > 0) {
            e.hp -= footing.hazard * 1.2;
            e.flash = Math.max(e.flash, 2);
            if (e.hp <= 0) {
              this.killAt(i, e, 0, 0);
              continue;
            }
          }
        }
        const wet = e.rillWet ?? 0;
        const swimming = wet >= RILLBACK_WET_THRESHOLD;
        if (!swimming) e.rillChargeWindup = 0;
        if (swimming) {
          e.grounded = false;
          e.vx *= 0.95;
          e.vy *= 0.9;
          if (wet < 0.85 && this.findRillbackLiquidSeek(e, def, 46)) {
            e.vx += this.rillbackLiquidSeek.dx * 0.14;
            e.vy += this.rillbackLiquidSeek.dy * 0.12;
          }
          if (targetAlive && e.alerted && (e.windup ?? 0) === 0 && (e.swoop ?? 0) === 0) {
            const d = pDist || 1;
            e.vx += (pdx / d) * (0.07 + wet * 0.08);
            e.vy += (pdy / d) * (0.05 + wet * 0.05);
          } else {
            e.vx += Math.cos(e.timer * 0.035 + e.bobPhase) * 0.025;
            e.vy += Math.sin(e.timer * 0.06 + e.bobPhase) * 0.02;
          }
          if (canAttackTarget && e.attackCd === 0 && pDist < 72 && (e.windup ?? 0) === 0 && (e.swoop ?? 0) === 0) {
            e.windup = 10;
            ctx.audio.tone(95, 170, 0.22, 'sine', 0.08);
          }
          if (
            canAttackTarget &&
            e.alerted &&
            pDist < 220 &&
            (e.rillChargeCd ?? 0) <= 0 &&
            (e.rillChargeWindup ?? 0) <= 0 &&
            e.timer % 25 === 0
          ) {
            e.rillChargeWindup = RILLBACK_CHARGE_WINDUP_FRAMES;
            e.blink = Math.max(e.blink, RILLBACK_CHARGE_WINDUP_FRAMES);
            ctx.audio.tone(280, 520, 0.18, 'sine', 0.07);
          }
          if (chargeReady && (e.rillChargeCd ?? 0) <= 0) {
            this.rillbackChargePulse(e, def);
          }
          if (ctx.state.frameCount % 9 === 0) {
            ctx.particles.spawn(e.x - Math.sign(e.vx || pdx || 1) * 5, e.y - 4, -e.vx * 0.12, -0.25, null, waterColor(), 12, {
              grav: -0.03,
            });
          }
        } else {
          e.vy += 0.34;
          e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
          e.vx *= e.grounded ? 0.8 : 0.94;
          if (this.findRillbackLiquidSeek(e, def, 64)) {
            e.vx += this.rillbackLiquidSeek.dx * 0.24;
            e.vy += this.rillbackLiquidSeek.dy * 0.18;
          }
          if (e.grounded && e.timer % 34 === 0) {
            e.vy = -1.1 - Math.random() * 0.4;
            e.vx += (targetAlive ? Math.sign(pdx || 1) : Math.random() < 0.5 ? -1 : 1) * 0.45;
            ctx.audio.squelch();
          }
        }

        if ((e.windup ?? 0) > 0) {
          e.vx *= 0.82;
          e.vy *= 0.82;
          if (!debugEnemyAttacksSuppressed) e.windup = (e.windup ?? 1) - 1;
          if (e.windup === 0 && canAttackTarget && swimming) {
            const a = Math.atan2(ctx.player.y - 9 - e.y, ctx.player.x - e.x);
            e.swoop = 12;
            e.vx = Math.cos(a) * 2.45;
            e.vy = Math.sin(a) * 1.85;
            ctx.audio.noiseBurst(0.08, 850, 0.08, true);
          }
        }
        if ((e.swoop ?? 0) > 0) {
          if (!debugEnemyAttacksSuppressed) e.swoop = (e.swoop ?? 1) - 1;
          if (canAttackTarget && e.attackCd === 0 && Math.abs(pdx) < 10 && Math.abs(pdy) < 13) {
            ctx.playerCtl.damage(10 * (e.dmgK ?? 1), Math.sign(pdx) * -3.1, -1.9, 'rillback-bite');
            e.attackCd = 85;
            e.swoop = 0;
          } else if (e.swoop === 0) {
            e.attackCd = Math.max(e.attackCd, 55);
          }
        }
        if (!swimming && canAttackTarget && e.attackCd === 0 && Math.abs(pdx) < 9 && Math.abs(pdy) < 12) {
          ctx.playerCtl.damage(4 * (e.dmgK ?? 1), Math.sign(pdx) * -1.4, -0.7, 'rillback-flop');
          e.attackCd = 55;
        }
        const maxRill = swimming ? 1.25 + wet * 0.75 : 0.7;
        e.vx = clamp(e.vx, -maxRill, maxRill);
        e.vy = clamp(e.vy, swimming ? -1.2 : -1.7, swimming ? 1.2 : 2.4);
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
            ctx.playerCtl.damage(16 * (e.dmgK ?? 1), Math.sign(pdx) * -4.2, -2.8, 'leviathan-bite');
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
          this.hasAttackLine(e, def, true) &&
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
          ctx.playerCtl.damage(10 * (e.dmgK ?? 1), Math.sign(pdx) * -3.0, -2.0, 'leviathan-graze');
          e.attackCd = Math.max(e.attackCd, 120);
        }
      } else if (e.kind === 'stonemaw') {
        // Stone Maw: listens through the rock, commits to tiny chew bursts,
        // and only opens terrain. It never writes blockers or eats Metal/Glass.
        if ((e.mawChewCd ?? 0) > 0) e.mawChewCd = (e.mawChewCd ?? 0) - 1;
        if ((e.mawChewT ?? 0) > 0) e.mawChewT = (e.mawChewT ?? 0) - 1;
        if ((e.mawStun ?? 0) > 0) e.mawStun = (e.mawStun ?? 0) - 1;
        e.vy += 0.34;
        e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
        const mouthStunned = e.status.frozen > 0 || e.status.electrified > 0 || this.stoneMawMouthHazard(e, def);
        if (mouthStunned) {
          e.mawStun = Math.max(e.mawStun ?? 0, 34);
          e.mawChewT = 0;
          e.mawChewCd = Math.max(e.mawChewCd ?? 0, 28);
        }

        if ((e.mawStun ?? 0) > 0) {
          e.vx *= 0.55;
          e.windup = 0;
          if (ctx.state.frameCount % 6 === 0) {
            ctx.particles.burst(e.x, e.y - def.h * 0.4, 2, Cell.Sand, stoneColor, 0.7);
          }
        } else if ((e.windup ?? 0) > 0) {
          e.vx *= 0.62;
          if (!debugEnemyAttacksSuppressed) e.windup = (e.windup ?? 1) - 1;
          if (e.windup === 0 && canAttackTarget && Math.abs(pdx) < 18 && Math.abs(pdy) < 19) {
            ctx.playerCtl.damage(18 * (e.dmgK ?? 1), Math.sign(pdx) * -4.1, -2.4, 'stonemaw-bite');
            e.attackCd = 115;
            e.mawChewT = Math.max(e.mawChewT ?? 0, 10);
            ctx.audio.hollowKnock();
          }
        } else {
          const dir = Math.sign(pdx || e.mawDir || 1);
          e.mawDir = dir;
          if (targetAlive && e.timer % 3 === 0) e.vx += dir * 0.055;
          e.vx *= e.grounded ? 0.88 : 0.96;
          const blockedAhead =
            !ctx.physics.entityFree(e.x + dir * (def.halfW + 2), e.y, def.halfW, def.h) ||
            (!e.grounded && Math.abs(pdy) < 24 && Math.abs(pdx) < 80);
          if (
            (e.mawChewCd ?? 0) <= 0 &&
            (e.mawChewT ?? 0) <= 0 &&
            (blockedAhead || (targetAlive && pDist < 92 && e.timer % 46 === 0))
          ) {
            const chewed = this.stoneMawChewBrush(e, def);
            if (chewed === 0) {
              e.mawChewCd = 26;
              e.mawStun = Math.max(e.mawStun ?? 0, 8);
            }
          }
        }

        if (
          canAttackTarget &&
          e.attackCd === 0 &&
          (e.windup ?? 0) <= 0 &&
          (e.mawStun ?? 0) <= 0 &&
          Math.abs(pdx) < 17 &&
          Math.abs(pdy) < 18
        ) {
          e.windup = 12;
          e.attackCd = 20;
          e.mawChewT = Math.max(e.mawChewT ?? 0, 8);
          ctx.audio.tone(82, 150, 0.2, 'sawtooth', 0.08);
        }
        e.vx = clamp(e.vx, -0.82, 0.82);
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
          // Cut thrust once level with the wizard, but ONLY with ground under us
          // to land on — still out over a gap, keep burning so we actually clear
          // it instead of stalling at his height and dropping straight in.
          const landingBelow = !ctx.physics.entityFree(e.x, e.y + 4, def.halfW, 4);
          if (targetAlive && player.y > e.y - 12 && landingBelow) e.jetFuel = Math.min(e.jetFuel, 6);
          if (e.grounded && e.vy >= 0) e.jetFuel = 0;
        } else if (e.jetCd === 0 && targetAlive) {
          const dir = Math.sign(pdx) || 1;
          // Wizard perched on a ledge above us (lower bar than before so a normal
          // platform — not just a sheer climb — pulls the golem up after you).
          const perchedAbove = player.y < e.y - 14 && Math.abs(pdx) < 260;
          // ...or an open gap/pit between us and the wizard: the way ahead is clear
          // at body height but the floor falls away there, so we can't walk across.
          const gapAhead =
            e.grounded &&
            Math.abs(pdx) > 10 &&
            Math.abs(pdx) < 260 &&
            player.y <= e.y + 28 &&
            ctx.physics.entityFree(e.x + dir * (def.halfW + 2), e.y, def.halfW, def.h) &&
            ctx.physics.entityFree(e.x + dir * (def.halfW + 3), e.y + 5, def.halfW, 5);
          const fallingHard = !e.grounded && e.vy > 2.3; // tumbling into a pit
          if (perchedAbove || gapAhead || fallingHard) {
            e.jetFuel = 95 + Math.floor(Math.random() * 50);
            e.jetCd = 190;
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
                e.punching = 16; // wind-up + haymaker (sprite reads this)
                let futile = false;
                if (!this.protectedCellInRadius(fx2, fy2, 6)) {
                  ctx.spells.erodeAt(fx2, fy2, 6);
                  ctx.particles.burst(fx2, fy2, 9, Cell.Sand, stoneColor, 1.9);
                } else {
                  // fists vs a PROTECTED wall: nothing will ever give — after a
                  // couple of demonstrative pounds it gives up for a long beat
                  // instead of being cheesed into pounding forever.
                  e.wary = Math.max(e.wary ?? 0, 18);
                  futile = true;
                }
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
                e.stuckT = futile ? -420 : 4; // futile: back off ~7s before retrying
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
        if (canAttackTarget && e.alerted && e.attackCd === 0 && pDist > 50 && pDist < 360 && this.hasAttackLine(e, def, true)) {
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
              { hostileDmg: 9, hostileSource: 'golem-rock' },
            );
          }
          ctx.audio.boom(4);
          e.attackCd = 240;
        }
        if (canAttackTarget && e.attackCd < 200 && Math.abs(pdx) < 15 && Math.abs(pdy) < 22) {
          // dmgK so depth + difficulty scale this slam like every other attack.
          ctx.playerCtl.damage(20 * (e.dmgK ?? 1), Math.sign(pdx) * -5.0, -3.6, 'golem-slam');
          e.attackCd = 220;
        }
      }

      // THREAT REFLEXES OVERRIDE the per-kind decision this frame: a committed
      // dodge twitches the body clear of an incoming hit; a flee retreats;
      // otherwise fear just scales the chase back. Fearless bosses' weights make
      // this a near-no-op. (Electrocution below still wins — it zeroes motion.)
      const fleeingNow = (e.fleeT ?? 0) > 0;
      if ((e.dodgeT ?? 0) > 0) {
        e.vx = e.dodgeVX ?? e.vx;
        // Fliers sustain the vertical jink (they steer freely); grounded foes get
        // a single upward HOP (then gravity arcs them back down over the threat).
        const flier = e.kind === 'imp' || e.kind === 'wisp' || (e.kind === 'bat' && (e.slimed ?? 0) <= 0);
        if (flier) {
          e.vy = e.dodgeVY ?? e.vy;
        } else if (e.dodgeVY) {
          e.vy = e.dodgeVY;
          e.dodgeVY = 0;
        }
      } else if (fleeingNow) {
        e.vx = (e.fleeDir ?? -Math.sign(pdx || 1)) * 1.7;
      } else if ((e.chaseScale ?? 1) !== 1) {
        e.vx *= e.chaseScale ?? 1;
      }

      // Burning foes that AREN'T fleeing flail erratically (panic); a directed
      // flee (bolting for water) replaces the random thrash.
      if (e.status.burning > 0 && e.grounded && !fleeingNow) e.vx += (Math.random() - 0.5) * 1.3;

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

      // Integrate movement (walkers step; flyers collide and slip around small nubs).
      // Difficulty and descent pacing scale the step distance = effective speed.
      const spd = difficultyMods(ctx.state).enemySpeed * enemyMovementPace(ctx);
      if (e.kind === 'imp' || e.kind === 'wisp' || (e.kind === 'bat' && (e.slimed ?? 0) <= 0)) {
        this.integrateFlying(e, def, spd);
      } else if (e.kind === 'weaver') {
        // The surface crawler owns Weaver movement. Threat reflexes fold into
        // its intent; electrocution convulses in place (loco untouched, the
        // status timer frees it). Difficulty/pacing scale the crawl speed.
        if (e.status.electrified <= 0) {
          const intent = this.weaverIntent;
          if (fleeingNow) {
            intent.move = 'toward';
            intent.tx = e.x + (e.fleeDir ?? -Math.sign(pdx || 1)) * 140;
            intent.ty = e.y;
            intent.urgency = 1;
            intent.stance = 'normal';
          } else if (e.status.burning > 0) {
            intent.urgency = 1;
          }
          intent.speedScale = spd * (e.status.frozen > 0 ? 0.5 : 1);
          tickWeaverLocomotion(ctx, e, def, intent);
        }
      } else {
        const stepUp =
          e.kind === 'colossus'
            ? 3
            : e.kind === 'golem' || e.kind === 'leviathan' || e.kind === 'stonemaw'
              ? 2
              : e.kind === 'rootloper'
                ? (e.rootSupport ?? 0) > 0.42
                  ? 4
                  : 2
                : e.kind === 'rillback'
                  ? (e.rillWet ?? 0) >= RILLBACK_WET_THRESHOLD
                    ? 0
                    : 1
                  : 1;
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
