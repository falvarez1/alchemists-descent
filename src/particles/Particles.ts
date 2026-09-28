import type { Ctx, FlyingParticle, ParticleOpts, ParticlesApi } from '@/core/types';
import { EntityPool } from '@/entities/ecs';
import { GOLD_CELL_VALUE, MAX_PARTICLES } from '@/config/constants';
import { Cell, blocksEntity, isGas, isLiquid } from '@/sim/CellType';
import { ashColor } from '@/sim/colors';
import { stainCell } from '@/sim/stains';
import { particleRandom } from '@/core/simRandom';

/*
 * COIN FLIGHT. A homing coin is the ANIMATION of a payment, never the payment:
 * gold is only ever in two honest places — a real Gold cell in the grid, or the
 * purse (`state.score`) — and whoever moves it between them (a kill's bounty, the
 * harvester field lifting a grain) credits the purse at that instant. The mote
 * then flies to the wizard and rings the loot cascade when it lands. A flight
 * that carried the value lost it to everything a particle meets: a stone lip in
 * its path, an overshoot orbit (3.75 cells/tick vs a 2.5-cell catch), a full
 * pool, a death, a save, the run-ending Colossus blow. So the flight is steered
 * to ARRIVE (a braking-curve speed profile, never an orbit), sweeps its catch
 * radius along each step, and passes through rock like the magnet pull it is.
 */
/** Top coin speed, cells/tick — outruns a falling wizard. */
const COIN_MAX_SPEED = 5.2;
/** Steering authority per tick; also the braking deceleration the arrive curve assumes. */
const COIN_STEER = 0.45;
/** Speed kept at the very end of the flight so the coin snaps into the purse instead of drifting. */
const COIN_ARRIVE_FLOOR = 1.2;
/** Catch radius around the purse, swept along the step (≥ the arrival speed, so nothing tunnels). */
const COIN_CATCH_R = 3;
/** Cells above the feet where the purse rides. */
const COIN_TARGET_LIFT = 6;
/** Loot cascade window: coins landing within this many ticks of each other climb the scale. */
const COIN_STREAK_GAP = 24;
/** Where a liquid that struck the player lands: the strike cell, then around it (up first — he stands in the rest). */
const SPILL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, -1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, -2], [-2, 0], [2, 0], [0, 1],
];

/** Squared distance from (px,py) to the segment (ax,ay)→(bx,by). */
function segmentDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const sx = bx - ax;
  const sy = by - ay;
  const len2 = sx * sx + sy * sy;
  let t = len2 > 0 ? ((px - ax) * sx + (py - ay) * sy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + sx * t - px;
  const dy = ay + sy * t - py;
  return dx * dx + dy * dy;
}

/**
 * Ballistic flying particles: explosion debris, gore, sparks, homing coins,
 * hostile thrown rocks. Ported from spawnFlyingParticle / burstParticles /
 * updateFlyingParticles (noita-sandbox.html lines 649-716).
 */
export class Particles implements ParticlesApi {
  // Highest-churn pool in the game; it only ever uses add/removeAt/list/full/
  // clear and never references particles by EntityId, so run it untracked to
  // skip the per-spawn id allocation + WeakMap/Map bookkeeping.
  private readonly pool = new EntityPool<FlyingParticle>({ max: MAX_PARTICLES, untracked: true });
  private readonly free: FlyingParticle[] = [];
  readonly list = this.pool.list;
  /** Loot cascade: coins vacuumed up in quick succession ring up the scale. */
  private coinStreak = 0;
  private lastCoinFrame = -999;

  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    type: number | null,
    color: number,
    life: number,
    opts?: ParticleOpts,
  ): void {
    // Real gold in flight (an alchemical payout's grains, blasted ore) is a cell
    // in transit: a full pool makes room by retiring a cosmetic mote instead of
    // silently deleting money that is about to land.
    if (this.pool.full && !(type === Cell.Gold && this.evictCosmetic())) return;
    const p = this.free.pop() ?? ({} as FlyingParticle);
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.type = type;
    p.color = color;
    p.life = life;
    p.grav = opts && opts.grav !== undefined ? opts.grav : 0.16;
    p.glow = (opts && opts.glow) || 0;
    p.homing = (opts && opts.homing) || false;
    p.value = opts && opts.value !== undefined ? Math.max(0, Math.floor(opts.value)) : 10;
    p.hostileDmg = (opts && opts.hostileDmg) || 0;
    p.hostileSource = opts?.hostileSource ?? null;
    p.looseDebris = opts?.looseDebris ?? false;
    p.deposit = (opts && opts.deposit) || false;
    this.pool.add(p);
  }

  /** Drop one purely visual particle (type null, not hostile) to free a slot. */
  private evictCosmetic(): boolean {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i];
      if (q.type === null && q.hostileDmg <= 0) {
        this.removeAt(i);
        return true;
      }
    }
    return false;
  }

  /**
   * A Gold grain that found no room where it landed settles in the nearest open
   * cell instead (a small spiral search); if the rock around it is solid, it
   * goes straight into the purse. Gold is never deleted by a particle.
   */
  private settleGold(ctx: Ctx, gx: number, gy: number, color: number): void {
    const world = ctx.world;
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = gx + dx;
          const y = gy + dy; // rows above first: a grain rests on top of what it hit
          if (!world.inBounds(x, y)) continue;
          const i = world.idx(x, y);
          const t = world.types[i];
          if (t === Cell.Empty || isGas(t)) {
            world.replaceCellAt(i, Cell.Gold, color);
            return;
          }
        }
      }
    }
    if (ctx.state.mode === 'play') {
      ctx.state.score += GOLD_CELL_VALUE;
      ctx.events.emit('scoreChanged', { score: ctx.state.score });
    }
  }

  /** Land a carried liquid cell in the first open (or gas) cell at or beside (gx, gy). */
  private spillNear(world: Ctx['world'], gx: number, gy: number, type: number, color: number): void {
    for (const [dx, dy] of SPILL_OFFSETS) {
      const x = gx + dx, y = gy + dy;
      if (!world.inBounds(x, y)) continue;
      const i = world.idx(x, y);
      if (world.types[i] === Cell.Empty || isGas(world.types[i])) {
        world.replaceCellAt(i, type, color);
        return;
      }
    }
  }

  private depositedType(p: FlyingParticle): { type: number; color: number } {
    if (p.looseDebris && p.type !== null && blocksEntity(p.type) && p.type !== Cell.Metal && p.type !== Cell.Gold) {
      return { type: Cell.Ash, color: ashColor() };
    }
    return { type: p.type!, color: p.color };
  }

  burst(
    cx: number,
    cy: number,
    count: number,
    type: number | null,
    colorFn: () => number,
    speed: number,
    opts?: ParticleOpts,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = particleRandom() * Math.PI * 2;
      const s = speed * (0.4 + particleRandom() * 0.8);
      this.spawn(
        cx,
        cy,
        Math.cos(a) * s,
        Math.sin(a) * s - speed * 0.4,
        type,
        colorFn(),
        60 + Math.floor(particleRandom() * 60),
        opts,
      );
    }
  }

  /** A wet mote hitting a pool throws up a few short-lived droplets — purely
   *  visual (type=null, so they never deposit or splash again, no feedback
   *  loop) plus an occasional soft splash sound. */
  private splash(ctx: Ctx, x: number, y: number, color: number): void {
    const n = 2 + ((particleRandom() * 3) | 0);
    for (let k = 0; k < n; k++) {
      this.spawn(
        x,
        y - 1,
        (particleRandom() - 0.5) * 1.8,
        -0.7 - particleRandom() * 1.4,
        null,
        color,
        16 + ((particleRandom() * 14) | 0),
        { grav: 0.22 },
      );
    }
    if (particleRandom() < 0.12) ctx.audio.splash(0.4 + particleRandom() * 0.3, x, y);
  }

  /**
   * O(1) removal: overwrite slot i with the tail and pop. Draw order of
   * ballistic debris is visually irrelevant, and the backward loop has
   * already processed the tail element this frame, so nothing is skipped.
   */
  private removeAt(i: number): void {
    const removed = this.pool.removeAt(i);
    if (removed && this.free.length < MAX_PARTICLES) this.free.push(removed);
  }

  update(ctx: Ctx): void {
    const world = ctx.world;
    const player = ctx.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life--;

      // A coin's flight (see COIN FLIGHT above): the purse was paid at harvest,
      // so this only has to LOOK right — arrive, ring, never orbit or vanish.
      if (p.homing && p.type === null) {
        if (player.dead) {
          // The wizard fell mid-flight: the coin gutters out as a falling glint.
          p.homing = false;
          p.grav = 0.12;
          if (p.life > 30) p.life = 30;
        } else {
          const tx = player.x;
          const ty = player.y - COIN_TARGET_LIFT;
          const ox = p.x;
          const oy = p.y;
          const dx = tx - ox;
          const dy = ty - oy;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          // ARRIVE: never faster than the speed it can still brake from before
          // the purse (v = sqrt(2·a·d)), so the burst-out arc bends into a clean
          // landing instead of the old overshoot orbit.
          const want = Math.min(COIN_MAX_SPEED, Math.sqrt(2 * COIN_STEER * d) + COIN_ARRIVE_FLOOR);
          const sx = (dx / d) * want - p.vx;
          const sy = (dy / d) * want - p.vy;
          const s = Math.sqrt(sx * sx + sy * sy);
          const k = s > COIN_STEER ? COIN_STEER / s : 1;
          p.vx += sx * k;
          p.vy += sy * k;
          p.x += p.vx;
          p.y += p.vy;
          if (segmentDist2(ox, oy, p.x, p.y, tx, ty) <= COIN_CATCH_R * COIN_CATCH_R) {
            // Loot cascade: coins landing in quick succession ring UP the scale
            // (a satisfying ching-ching-ching on a fat bounty shower) and pop a
            // gold sparkle at the wizard. The streak resets after a short gap.
            const frame = ctx.state.frameCount;
            if (frame - this.lastCoinFrame > COIN_STREAK_GAP) this.coinStreak = 0;
            this.lastCoinFrame = frame;
            this.coinStreak++;
            ctx.audio.coin(this.coinStreak);
            this.removeAt(i);
            this.spawn(
              tx + (particleRandom() - 0.5) * 4,
              ty + 3 - particleRandom() * 4,
              (particleRandom() - 0.5) * 0.6,
              -0.5 - particleRandom() * 0.5,
              null,
              0xffe078,
              8 + ((particleRandom() * 6) | 0),
              { grav: 0.05, glow: 1.4 },
            );
            continue;
          }
          // The pull is a magnet, not a throw: rock does not stop it. A coin that
          // never arrives (a teleport across the level) just fades — it is paid.
          if (p.life <= 0) this.removeAt(i);
          continue;
        }
      }
      p.vy += p.grav;

      p.x += p.vx;
      p.y += p.vy;
      let gx = Math.floor(p.x),
        gy = Math.floor(p.y);

      if (!world.inBounds(gx, gy)) {
        // a pour stream that flies off the map still drops its cell at the last
        // in-bounds step, so siphoned material is conserved
        if (p.type === Cell.Gold) {
          // gold that flies off the map settles at the edge it left by
          const bx = Math.max(0, Math.min(world.width - 1, Math.floor(p.x - p.vx)));
          const by = Math.max(0, Math.min(world.height - 1, Math.floor(p.y - p.vy)));
          this.settleGold(ctx, bx, by, p.color);
        } else if (p.deposit && p.type !== null) {
          const bx = Math.floor(p.x - p.vx),
            by = Math.floor(p.y - p.vy);
          if (world.inBounds(bx, by)) {
            const bi = world.idx(bx, by);
            if (world.types[bi] === Cell.Empty || isGas(world.types[bi])) {
              const deposit = this.depositedType(p);
              world.replaceCellAt(bi, deposit.type, deposit.color);
            }
          }
        }
        this.removeAt(i);
        continue;
      }
      if (p.life <= 0) {
        // a pour stream that runs out of arc mid-air drops its cell where it is
        if (p.type === Cell.Gold) this.settleGold(ctx, gx, gy, p.color);
        else if (p.deposit && p.type !== null) {
          const di = world.idx(gx, gy);
          if (world.types[di] === Cell.Empty || isGas(world.types[di])) {
            const deposit = this.depositedType(p);
            world.replaceCellAt(di, deposit.type, deposit.color);
          }
        }
        this.removeAt(i);
        continue;
      }

      // Hostile thrown debris (golem rocks, shrapnel) can strike the player —
      // SWEPT cell-by-cell: at 3-4 cells/frame the single-step test could jump
      // a thin wall between frames (hitting through cover), and it tested the
      // player BEFORE terrain, landing hits on the same step the shot entered
      // a wall. Terrain is now tested first at every substep; a wall strike
      // stops the shot at the entry cell and falls through to the ordinary
      // terrain handling (splash/stain/deposit) below.
      if (p.hostileDmg > 0 && ctx.state.mode === 'play' && !player.dead) {
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy))));
        let struckPlayer = false;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const sx = p.x - p.vx * (1 - t);
          const sy = p.y - p.vy * (1 - t);
          const cgx = Math.floor(sx);
          const cgy = Math.floor(sy);
          if (world.inBounds(cgx, cgy)) {
            const c = world.types[world.idx(cgx, cgy)];
            if (c !== Cell.Empty && !isGas(c)) {
              p.x = sx;
              p.y = sy;
              gx = cgx;
              gy = cgy;
              break; // cover holds — the shot dies on the wall, not the player
            }
          }
          const dx = player.x - sx;
          const dy = player.y - 3 - sy;
          if (dx * dx + dy * dy < 9) {
            struckPlayer = true;
            break;
          }
        }
        if (struckPlayer) {
          ctx.playerCtl.damage(p.hostileDmg, p.vx * 1.5, -1, p.hostileSource ?? 'hostile-debris');
          // A thrown LIQUID (the Leviathan's volleys and tail-slams are its own
          // pool) splashes off him and lands, rather than vanishing on contact:
          // every hit used to delete the water it was made of.
          if (p.type !== null && isLiquid(p.type)) this.spillNear(world, Math.floor(p.x), Math.floor(p.y), p.type, p.color);
          this.removeAt(i);
          continue;
        }
      }

      // A poured/sprayed HAZARD droplet (lava/fire/acid) that strikes a foe
      // splashes its material onto it — the stream burns enemies it hits.
      if (
        p.deposit &&
        (p.type === Cell.Lava || p.type === Cell.Fire || p.type === Cell.Acid) &&
        ctx.enemyCtl.splashHazard(p.x, p.y, p.type)
      ) {
        this.removeAt(i);
        continue;
      }

      const cell = world.types[world.idx(gx, gy)];
      if (cell !== Cell.Empty && !isGas(cell)) {
        const hitLiquid = isLiquid(cell);
        // A wet mote (a liquid particle) striking a pool kicks up a small splash.
        // ONLY liquid-typed motes splash — the purely-visual droplets splash()
        // itself spawns are type=null, so they never splash again (no runaway
        // feedback loop that would make any disturbed pool roar forever).
        if (hitLiquid && p.type !== null && isLiquid(p.type)) {
          this.splash(ctx, p.x, p.y, p.color);
        }
        // Blood spatter marks the surface it strikes — a red stain soaked into
        // the wall (stainCell only takes on sturdy materials; sand/etc. churn).
        if (p.type === Cell.Blood) stainCell(world, gx, gy, 118, 14, 20, 0.35 + particleRandom() * 0.25);
        // Deposit at last free position behind us
        if (p.type !== null) {
          const blockingDebris = blocksEntity(p.type);
          // Gold still settles on a pool: the powder sim sinks it to the bed
          // (an alchemical kill in a cistern pays out into the water, honestly).
          if (!(hitLiquid && blockingDebris) || p.type === Cell.Gold) {
            const bx = Math.floor(p.x - p.vx),
              by = Math.floor(p.y - p.vy);
            let placed = false;
            if (world.inBounds(bx, by)) {
              const bi = world.idx(bx, by);
              if (world.types[bi] === Cell.Empty || isGas(world.types[bi])) {
                const deposit = this.depositedType(p);
                world.replaceCellAt(bi, deposit.type, deposit.color);
                if (deposit.type === Cell.Fire) world.life[bi] = 18 + Math.floor(particleRandom() * 18);
                if (deposit.type === Cell.Smoke) world.life[bi] = 30 + Math.floor(particleRandom() * 30);
                placed = true;
              }
            }
            // Pour streams CONSERVE: if the spot behind was full (a dense stream
            // piling up), drop the carried cell into a nearby empty cell instead
            // of losing the siphoned material.
            if (!placed && p.deposit) {
              const cand: ReadonlyArray<readonly [number, number]> = [
                [gx, gy - 1], [gx - 1, gy], [gx + 1, gy], [gx, gy - 2],
              ];
              for (const [cxp, cyp] of cand) {
                if (!world.inBounds(cxp, cyp)) continue;
                const cidx = world.idx(cxp, cyp);
                if (world.types[cidx] === Cell.Empty || isGas(world.types[cidx])) {
                  const deposit = this.depositedType(p);
                  world.replaceCellAt(cidx, deposit.type, deposit.color);
                  placed = true;
                  break;
                }
              }
            }
            // Gold is never deleted by a particle: no room here, the nearest
            // open cell (or, walled in, the purse) takes it.
            if (!placed && p.type === Cell.Gold) this.settleGold(ctx, gx, gy, p.color);
          }
        }
        this.removeAt(i);
      }
    }
  }

  clear(): void {
    for (const p of this.list) {
      if (this.free.length >= MAX_PARTICLES) break;
      this.free.push(p);
    }
    this.pool.clear();
  }
}
