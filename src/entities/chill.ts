import type { ChillTuning } from '@/config/params';
import type { ChillMomentKind } from '@/core/events';
import type { PlayerChill } from '@/core/types';

/**
 * THE CHILL — the model. A graded body cold, 0..1, in place of the old binary
 * "frozen" timer (which painted an ice oval over the alchemist). The grid puts
 * cold in (game/Chill samples brine, nitrogen, cold water, ice; frost bolts and
 * the Rime Warden land blows of it) and heat takes it out (fire, lava, embers,
 * a burning coat, the Warm Refuge). Pure: no ctx, no world — the system feeds
 * it what the cells said this tick and acts on the moments it returns.
 *
 * - `level` is the cold. Movement, jump, the lens and the score all read
 *   curves of it (below), each with a small dead zone so a frozen biome's
 *   ambient cold (0.12) shows as breath and a faint rime, never as a slow.
 * - `rime` is the frost ON the body. It climbs after the level (each 0.045 of
 *   it accreted is a crackle), and on the way down it HOLDS — ice does not
 *   un-accrete — melting only slowly, until the level has fallen `thawGap`
 *   under it: then it cracks off at once (the thaw beat: real snow and ice
 *   shed, steam, the score snapping back).
 * - At full chill the body freezes solid for `shellTicks` (fail-open: short,
 *   a fresh press cracks `shellMash` ticks off it, a real blow bursts it, heat
 *   melts it faster), then bursts back to `shellAfter`, and cannot freeze
 *   again for `shellCooldown` ticks (the level is held under the lock).
 */

/** What the grid said about the body this tick. */
export interface ChillInputs {
  /** Continuous cold from the cells touching the body, per tick. */
  cold: number;
  /** A cold source touches the body (warming slows to `decayInCold`). */
  touching: boolean;
  /** 0..1 heat nearby (weighted hot cells over `heatFull`). */
  warmth: number;
  /** The body is alight. */
  burning: boolean;
  /** The biome's cold air: the body is held at least this cold (0 outside frozen places). */
  ambientFloor: number;
  /** Blows of cold landed since the last tick. */
  impulse: number;
  /** A fresh movement press this tick (cracks a shell). */
  press: boolean;
  /** A real blow landed this tick (bursts a shell). */
  blow: boolean;
}

export interface ChillMoment {
  kind: ChillMomentKind;
  /** 0..1: how much frost, how hard. */
  strength: number;
  /** Heat did it (a crack melted through, a thaw by the fire). */
  warm: boolean;
}

/** Past this the docent remarks, the heart slows, the breath turns to real vapour. */
export const DEEP_CHILL = 0.6;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createPlayerChill(): PlayerChill {
  return {
    level: 0, rime: 0, shell: 0, cracks: 0, cooldown: 0, moveK: 1, jumpK: 1, screen: 0,
    musicRate: 1, musicCutoff: 20000, thawAt: -1, crackle: 0, deep: false,
    breathAt: -1, breathX: 0, breathY: 0, breathDir: 1, breathK: 0,
  };
}

/** Back to a warm body (respawn, a new floor). */
export function resetPlayerChill(c: PlayerChill): void {
  Object.assign(c, createPlayerChill());
}

/**
 * The cost to movement: speed and acceleration (the pace multiplier), with a
 * dead zone under 0.08 and an ease-in, so the first bite is gentle and the
 * last is heavy: 0.25 → 0.94, 0.5 → 0.81, 0.75 → 0.64, 1 → moveMin (0.45).
 */
export function chillMoveK(level: number, t: ChillTuning): number {
  const m = clamp01((level - 0.08) / 0.92);
  return 1 - (1 - t.moveMin) * m ** 1.35;
}

/**
 * The cost to the jump: much gentler than the run (a jump that cannot clear a
 * gutter's lip would trap a freezing body in the brine): 0.5 → 0.94, 1 → jumpMin (0.82).
 */
export function chillJumpK(level: number, t: ChillTuning): number {
  const m = clamp01((level - 0.08) / 0.92);
  return 1 - (1 - t.jumpMin) * m ** 1.6;
}

/** How much of the chill the score hears (a dead zone under 0.15: the ambient cold never detunes it). */
function musicShare(level: number): number {
  return clamp01((level - 0.15) / 0.85);
}

/** The tape running down: 0.5 → ~0.93, 0.75 → ~0.87, 1 → musicRateMin (0.8). */
export function chillMusicRate(level: number, t: ChillTuning): number {
  return 1 - (1 - t.musicRateMin) * musicShare(level) ** 1.25;
}

/** The lowpass closing in, exponential in Hz: 0.25 → ~13 kHz, 0.5 → ~5.9 kHz, 0.75 → ~2.6 kHz, 1 → musicCutoffMin. */
export function chillMusicCutoff(level: number, t: ChillTuning): number {
  return 20000 * (t.musicCutoffMin / 20000) ** (musicShare(level) ** 1.1);
}

/** What the lens reads: 0 through the ambient cold, 1 at full chill. */
export function chillScreenTarget(level: number): number {
  return clamp01((level - 0.14) / 0.86) ** 0.9;
}

/** Refresh the derived multipliers and the eased perception from the state (once a tick). */
export function deriveChill(c: PlayerChill, t: ChillTuning, frame: number): void {
  const shelled = c.shell > 0;
  c.moveK = chillMoveK(c.level, t);
  c.jumpK = chillJumpK(c.level, t);
  c.musicRate = shelled ? t.musicRateMin : chillMusicRate(c.level, t);
  c.musicCutoff = shelled ? t.musicCutoffMin : chillMusicCutoff(c.level, t);
  const target = shelled ? 1 : chillScreenTarget(c.level);
  // Frost creeps in over ~1.4 s; it clears faster, and fastest right after a thaw.
  const k = target > c.screen ? 0.035 : c.thawAt >= 0 && frame - c.thawAt < 45 ? 0.09 : 0.045;
  c.screen += (target - c.screen) * k;
  if (Math.abs(target - c.screen) < 1e-4) c.screen = target;
}

/**
 * One fixed tick of the chill. Appends what happened (crackle, shell, crack,
 * shatter, thaw) to `out`; the caller turns those into cells, motes and sound.
 */
export function stepChill(c: PlayerChill, inp: ChillInputs, t: ChillTuning, frame: number, out: ChillMoment[]): void {
  const warm = inp.burning || inp.warmth > 0.25;
  if (c.shell > 0) {
    // FROZEN SOLID. The cold holds at full; every tick melts one off the lock,
    // a fresh press cracks `shellMash` off, heat melts it faster, a blow bursts it.
    let wear = 1;
    if (inp.press) wear += t.shellMash;
    if (warm) wear += 1 + Math.round(inp.warmth * 3) + (inp.burning ? 4 : 0);
    c.shell = inp.blow ? 0 : Math.max(0, c.shell - wear);
    c.level = 1;
    if (c.shell > 0 && (inp.press || (warm && (frame & 15) === 0))) {
      c.cracks++;
      out.push({ kind: 'crack', strength: clamp01(c.cracks / 5), warm: warm && !inp.press });
    }
    if (c.shell === 0) {
      out.push({ kind: 'shatter', strength: Math.max(0.6, c.rime), warm });
      c.level = t.shellAfter;
      c.rime = t.shellAfter;
      c.crackle = 0;
      c.cracks = 0;
      c.cooldown = t.shellCooldown;
      c.thawAt = frame;
    }
    deriveChill(c, t, frame);
    return;
  }

  // The cold: what touches the body, blows landed, the biome's air — less the heat.
  const loss = (inp.touching ? t.decayInCold : t.decay) + inp.warmth * t.heatRate + (inp.burning ? t.burningRate : 0);
  let next = c.level + inp.cold + inp.impulse - loss;
  if (inp.ambientFloor > 0 && !warm) {
    // A frozen place's air holds the body this cold, and brings it there.
    next = c.level >= inp.ambientFloor ? Math.max(next, inp.ambientFloor) : Math.max(next, Math.min(inp.ambientFloor, c.level + t.ambientRate));
  }
  if (c.cooldown > 0) {
    c.cooldown--;
    next = Math.min(next, 0.94); // a body that just burst free cannot re-freeze at once
  }
  c.level = clamp01(next);
  if (c.level >= DEEP_CHILL) c.deep = true;

  if (c.level >= 1 && c.cooldown === 0) {
    c.shell = t.shellTicks;
    c.cracks = 0;
    c.rime = 1;
    out.push({ kind: 'shell', strength: 1, warm: false });
    deriveChill(c, t, frame);
    return;
  }

  // The rime: accretes after the cold (a crackle per 0.045), holds and melts
  // slowly as it warms, and cracks off whole once the cold is well under it.
  if (c.level > c.rime) {
    const grow = Math.min(c.level - c.rime, 0.006 + (c.level - c.rime) * 0.06);
    c.rime += grow;
    c.crackle += grow;
    if (c.crackle >= 0.045) {
      c.crackle -= 0.045;
      out.push({ kind: 'crackle', strength: c.rime, warm: false });
    }
  } else {
    c.crackle = 0;
    const melt = t.rimeMelt + inp.warmth * t.rimeMeltHeat + (inp.burning ? 0.01 : 0);
    c.rime = Math.max(c.level, c.rime - melt);
    if (c.rime >= t.thawMin && c.rime - c.level >= t.thawGap) {
      out.push({ kind: 'thaw', strength: clamp01(c.rime - c.level + 0.3), warm });
      c.rime = c.level;
      c.thawAt = frame;
    }
  }
  deriveChill(c, t, frame);
}
