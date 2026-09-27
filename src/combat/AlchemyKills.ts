import type { AlchemyCause, AlchemyKillInfo } from '@/core/run';
import type { AlchemyKillsApi, Ctx, Enemy, EnemyDamageSource, StatusBlow } from '@/core/types';
import { GOLD_CELL_VALUE } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { goldColor, packRGB } from '@/sim/colors';
import { fxRandom } from '@/core/simRandom';

export { causeForCell, causeForExplosion } from '@/core/alchemyCause';

/**
 * Kill attribution and the alchemical kill.
 *
 * Every damage path reports what dealt the blow (`noteHit`) just before a
 * creature's hp changes; when it dies, the last blow decides who killed it.
 * A wand bolt or a boot is a DIRECT kill and pays the ordinary bounty. When the
 * killing blow was the world's — fire, lava, steam, a shorted pool, acid, a
 * drowning, a frozen body broken, debris, a blast the wand did not cast, poison,
 * a wall met at speed — and the player plausibly set it in motion, the kill is
 * ALCHEMICAL: it is announced (`alchemyKill`), chains with the ones before it,
 * and pays out grid-honestly: real gold grains cough out of the body and settle
 * as gold powder, the wand drinks a draught of mana, and the alchemist a sip of
 * life. Credit is generous by design — a material kill in engagement range, or
 * one the player touched recently, is his.
 *
 * A status is judged by where its fire or current came from (`noteStatus`): the
 * flame and live air a wand bolt leaves on the creature it was cast at are the
 * spell's own, so a spark that sets a slime alight or leaves it crackling on dry
 * stone is still a spell kill. The world's fire has fuel (oil on the body, oil
 * or lava touching it) or was walked into; the world's current came through a
 * conductor (a wet body, charged water or metal), or crossed another liquid
 * (blood, slime) to reach a creature the wand never struck.
 */

/** Alchemical kills within 3 s (ticks) of the last one stack into a chain. */
export const ALCHEMY_CHAIN_TICKS = 180;
/** The killing blow is the blow noted this tick; the slack covers the 2-tick
 *  status cadence so a burning body that dies between samples still counts. */
export const KILLING_BLOW_TICKS = 3;
/** A material kill this close to the alchemist is his doing. */
export const ALCHEMY_ENGAGE_CELLS = 280;
/** ...and so is one he struck within this many ticks (the fire he lit, the pool he shorted). */
export const ALCHEMY_TOUCH_TICKS = 20 * 60;
/** A kick launch credits whatever the body meets for this long. */
export const ALCHEMY_KICK_TICKS = 180;
/** Share of the active wand's tank refilled per alchemical kill. */
export const ALCHEMY_MANA_REFILL = 0.35;
/** Hit points restored per alchemical kill (a sip, not a potion). */
export const ALCHEMY_HEAL = 3;
/** Each gold grain the body coughs up is one real Gold cell, worth this much when harvested. */
export const GOLD_PER_GRAIN = GOLD_CELL_VALUE;

/**
 * A burning or electrified status that takes hold within this many ticks of the
 * wand striking the creature is the wand's own (its blast leaves flame and live
 * air around the body for ~10–35 ticks, and a status sample lands every 2).
 */
export const SPELL_STATUS_TICKS = 45;

/** Whose fire or current a status is: the wand's own, cast at this creature, or the world's. */
export type StatusOrigin = 'spell' | 'world';

export interface HitMemory {
  source: EnemyDamageSource;
  /** Tick of the last blow of any kind. */
  frame: number;
  /** Tick the player last struck this creature directly. */
  touchFrame: number;
  /** Tick the player's kick last launched it. */
  kickFrame: number;
  /** The last noted blow was a sim-sampled status tick, not a strike (a status tick never shatters). */
  statusBlow?: boolean;
  /** Whose fire the burning status is (null while not alight). */
  burnOrigin?: StatusOrigin | null;
  /** Whose current the electrified status is (null while not electrified). */
  shockOrigin?: StatusOrigin | null;
}

/**
 * Which alchemical cause, if any, finished a creature. Pure: the last noted blow,
 * whether the body was frozen solid, and the tick it died. A frozen body broken by
 * a direct blow, debris or a wall SHATTERS; any other direct blow is the wand's kill.
 */
export function killingCause(mem: HitMemory | undefined, frozen: boolean, frame: number): AlchemyCause | null {
  if (!mem || frame - mem.frame > KILLING_BLOW_TICKS) return null;
  const src = mem.source;
  if (frozen && mem.statusBlow !== true && (src === 'direct' || src === 'flattened' || src === 'impaled')) return 'shattered';
  return src === 'direct' ? null : src;
}

/** The wand (not the boot) struck this creature within SPELL_STATUS_TICKS. */
export function spellTouched(mem: HitMemory, frame: number): boolean {
  return mem.touchFrame !== mem.kickFrame && frame - mem.touchFrame <= SPELL_STATUS_TICKS;
}

/**
 * The origin of a burning/electrified status after this sample. Pure.
 * - Gone out: forgotten (null).
 * - The world forces it (the fire has oil or lava to eat; the current came
 *   through water, metal or a wet body): the world's.
 * - Once the world's, it stays the world's while it lasts — a bolt into a
 *   creature already burning in an oil fire does not take the fire over.
 * - Newly taken hold, or (re)lit/recharged by fresh contact: the wand's if the
 *   wand struck within SPELL_STATUS_TICKS (its own blast fire and live air);
 *   otherwise the world's when `strayIsWorld` (a fire walked into; a current
 *   that crossed some other liquid — blood, slime, oil — to reach it), else the
 *   wand's (bare blast residue in air or stone cannot travel: it is the bolt's).
 * - Otherwise it keeps its origin.
 */
export function resolveStatusOrigin(
  prev: StatusOrigin | null,
  active: boolean,
  worldForced: boolean,
  contact: boolean,
  strayIsWorld: boolean,
  touched: boolean,
): StatusOrigin | null {
  if (!active) return null;
  if (worldForced || prev === 'world') return 'world';
  if (prev === null || contact) return touched || !strayIsWorld ? 'spell' : 'world';
  return prev;
}

/**
 * What a harm tick counts as — who dealt the killing blow when fire, current
 * and sludge all land at once. The WORLD's shares (toxic sludge always; fire or
 * current whose origin is the world's) are weighed against the WAND's own: if
 * the world dealt at least as much, its largest share names the cause (a slime
 * burning in oil the spark lit is FLAMBÉED although the spark's current still
 * crackles on it); if the wand dealt more (its zap landing the killing tick, a
 * speck of cooked-gore sludge beside a body its own fire is eating), the tick is
 * a direct blow — the spell kill pays the ordinary bounty.
 */
export function statusBlowCause(
  blow: Pick<StatusBlow, 'burn' | 'shock' | 'toxic'>,
  burn: StatusOrigin | null,
  shock: StatusOrigin | null,
): EnemyDamageSource {
  let world = 0;
  let spell = 0;
  let cause: EnemyDamageSource = 'direct';
  let best = 0;
  if (blow.toxic > 0) {
    world += blow.toxic;
    best = blow.toxic;
    cause = 'poisoned';
  }
  if (burn === 'world') {
    world += blow.burn;
    if (blow.burn > best) {
      best = blow.burn;
      cause = 'burned';
    }
  } else spell += blow.burn;
  if (shock === 'world') {
    world += blow.shock;
    if (blow.shock > best) cause = 'shorted';
  } else spell += blow.shock;
  return world > 0 && world >= spell ? cause : 'direct';
}

/** Did the alchemist set this death in motion? Generous: engagement range, a recent touch or kick. */
export function creditedToPlayer(mem: HitMemory, distance: number, frame: number, playerAlive: boolean): boolean {
  if (!playerAlive) return false;
  if (distance <= ALCHEMY_ENGAGE_CELLS) return true;
  if (frame - mem.touchFrame <= ALCHEMY_TOUCH_TICKS) return true;
  return frame - mem.kickFrame <= ALCHEMY_KICK_TICKS;
}

/** The chain count for a kill at `frame`, given the previous chain and its last kill tick. */
export function nextChain(prevChain: number, lastKillFrame: number, frame: number): number {
  return prevChain > 0 && frame - lastKillFrame <= ALCHEMY_CHAIN_TICKS ? prevChain + 1 : 1;
}

/**
 * Bonus gold for an alchemical kill: 10 + 35% of the creature's bounty, scaled
 * ×1, ×1.5, ×2, ×2.5, ×3 by the chain (capped), rounded to whole grains.
 */
export function alchemyBonusGold(bounty: number, chain: number): number {
  const mult = 1 + Math.min(4, Math.max(0, chain - 1)) * 0.5;
  const raw = (10 + Math.max(0, bounty) * 0.35) * mult;
  return Math.max(GOLD_PER_GRAIN, Math.round(raw / GOLD_PER_GRAIN) * GOLD_PER_GRAIN);
}

export class AlchemyKills implements AlchemyKillsApi {
  private readonly memory = new WeakMap<Enemy, HitMemory>();
  private chainCount = 0;
  private lastKillFrame = -1e9;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    const off = ctx.events?.on('levelChanged', () => this.resetChain());
    if (off) this.disposers.push(off);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  get chain(): number {
    return this.ctx.state.frameCount - this.lastKillFrame <= ALCHEMY_CHAIN_TICKS ? this.chainCount : 0;
  }

  resetChain(): void {
    this.chainCount = 0;
    this.lastKillFrame = -1e9;
  }

  private remember(e: Enemy): HitMemory {
    let m = this.memory.get(e);
    if (!m) {
      m = { source: 'direct', frame: -1e9, touchFrame: -1e9, kickFrame: -1e9, statusBlow: false, burnOrigin: null, shockOrigin: null };
      this.memory.set(e, m);
    }
    return m;
  }

  noteHit(e: Enemy, source: EnemyDamageSource): void {
    const frame = this.ctx.state.frameCount;
    const m = this.remember(e);
    m.source = source;
    m.frame = frame;
    m.statusBlow = false;
    if (source === 'direct') m.touchFrame = frame;
  }

  noteStatus(e: Enemy, blow: StatusBlow): EnemyDamageSource {
    const frame = this.ctx.state.frameCount;
    const m = this.remember(e);
    const touched = spellTouched(m, frame);
    m.burnOrigin = resolveStatusOrigin(m.burnOrigin ?? null, blow.burning, blow.fueled, blow.heatContact, true, touched);
    m.shockOrigin = resolveStatusOrigin(m.shockOrigin ?? null, blow.electrified, blow.conducted, blow.chargeContact, blow.liquidCharge, touched);
    // A share with no status behind it (flame licking a body that has not
    // caught) is judged on the spot by the same rule.
    const burn = m.burnOrigin ?? (blow.burn > 0 ? resolveStatusOrigin(null, true, blow.fueled, true, true, touched) : null);
    const shock = m.shockOrigin ?? (blow.shock > 0 ? resolveStatusOrigin(null, true, blow.conducted, true, blow.liquidCharge, touched) : null);
    const cause = statusBlowCause(blow, burn, shock);
    if (blow.burn + blow.shock + blow.toxic > 0) {
      m.source = cause;
      m.frame = frame;
      m.statusBlow = true;
    }
    return cause;
  }

  noteKick(e: Enemy): void {
    const frame = this.ctx.state.frameCount;
    const m = this.remember(e);
    m.kickFrame = frame;
    m.touchFrame = frame;
  }

  onKill(e: Enemy): AlchemyKillInfo | null {
    const ctx = this.ctx;
    const mem = this.memory.get(e);
    this.memory.delete(e);
    if (ctx.state.mode !== 'play' || !mem) return null;
    const frame = ctx.state.frameCount;
    const cause = killingCause(mem, e.status.frozen > 0, frame);
    if (!cause) return null;
    const player = ctx.player;
    const distance = Math.hypot(e.x - player.x, e.y - player.y);
    if (!creditedToPlayer(mem, distance, frame, !player.dead)) return null;
    const chain = nextChain(this.chainCount, this.lastKillFrame, frame);
    this.chainCount = chain;
    this.lastKillFrame = frame;
    const def = ctx.enemyCtl.defs[e.kind];
    const info: AlchemyKillInfo = {
      kind: e.kind,
      cause,
      x: e.x,
      y: e.y - def.h * 0.6,
      chain,
      bonusGold: alchemyBonusGold(def.bounty, chain),
    };
    this.payout(info);
    ctx.telemetry?.count(`alchemy.kill.${cause}`);
    ctx.events.emit('alchemyKill', info);
    return info;
  }

  /** The grid pays: real gold grains, a draught of mana into the wand, a sip of life. */
  private payout(info: AlchemyKillInfo): void {
    const ctx = this.ctx;
    const { x, y, chain } = info;
    // GOLD: grains fountain out of the body as REAL Gold cells (deposit particles);
    // they settle as a glittering pile the harvester field pulls in when the
    // alchemist comes near. Launched from the first open cell above the body so a
    // drowned or shorted carcass in a pool still throws its gold clear of the water.
    const world = ctx.world;
    let sy = Math.floor(y);
    for (let k = 0; k < 30 && world.inBounds(Math.floor(x), sy - 1); k++) {
      const t = world.types[world.idx(Math.floor(x), sy)];
      if (t === Cell.Empty) break;
      sy--;
    }
    // A low fountain (apex ~10-36 cells, a few dozen wide): the pile must land
    // where walking over the kill brings it inside the harvester's 30-cell pull.
    // The old 66-cell geyser parked grains on ledges no one would ever climb to,
    // which read as a promised bonus that never arrived.
    const grains = Math.round(info.bonusGold / GOLD_PER_GRAIN);
    for (let i = 0; i < grains; i++) {
      ctx.particles.spawn(
        x + (fxRandom() - 0.5) * 4,
        sy,
        (fxRandom() - 0.5) * 2.2,
        -1.8 - fxRandom() * 1.6,
        Cell.Gold,
        goldColor(),
        240,
        { deposit: true, glow: 1.8, grav: 0.16 },
      );
    }
    // Brass glitter over the kill: more with the chain.
    ctx.particles.burst(x, y, 8 + Math.min(5, chain) * 4, null, () => packRGB(255, 206 + ((fxRandom() * 40) | 0), 110), 2.4, {
      glow: 2.4,
      grav: -0.02,
    });
    // MANA: the wand drinks the release. Cyan motes run from the body to the staff.
    const wands = ctx.wands;
    const wand = wands?.wands?.[wands.active];
    if (wand) wand.mana = Math.min(wand.frame.manaMax, wand.mana + wand.frame.manaMax * ALCHEMY_MANA_REFILL);
    const player = ctx.player;
    if (!player.dead) {
      player.hp = Math.min(player.maxHp, player.hp + ALCHEMY_HEAL);
      const tx = player.x;
      const ty = player.y - 10;
      const dx = tx - x;
      const dy = ty - y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = Math.min(4.5, 1.2 + d / 28);
      const life = Math.max(8, Math.min(60, Math.round(d / speed)));
      for (let i = 0; i < 7; i++) {
        const jitter = (fxRandom() - 0.5) * 0.5;
        ctx.particles.spawn(
          x + (fxRandom() - 0.5) * 6,
          y + (fxRandom() - 0.5) * 6,
          (dx / d + jitter) * speed,
          (dy / d - jitter) * speed,
          null,
          i < 5 ? packRGB(120, 220, 255) : packRGB(255, 120, 150),
          life,
          { glow: 2.2, grav: 0 },
        );
      }
    }
    if (!ctx.state.reduceFlashes) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick ?? 0, 0.45 + Math.min(4, chain) * 0.12);
    // The sound is audio/Stingers' glass-and-brass chime, which listens to
    // `alchemyKill` and climbs with the chain; nothing plays here.
  }
}
