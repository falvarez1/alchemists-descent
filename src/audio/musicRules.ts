import type { BiomeId, EnemyKind } from '@/core/types';
import { DARKNESS } from '@/config/darkness';

/**
 * The music director's rules, pure (tests/music-director.test.ts): which cue
 * a moment wants, how a floor's calm turns to "hunted" and back without
 * flapping, how long each crossfade takes, and the equal-power fade shape.
 * No WebAudio and no DOM in here.
 */

/** A campaign floor's pair: exploration and its same-key/tempo tension layer. */
export const FLOOR_CUES: Readonly<Record<string, { explore: string; tension: string }>> = {
  d1: { explore: 'bellows', tension: 'bellows-tension' },
  d2: { explore: 'rot', tension: 'rot-tension' },
  d3: { explore: 'cisterns', tension: 'cisterns-tension' },
  d4: { explore: 'kiln', tension: 'kiln-tension' },
};

/** Off-spine levels (test arenas, the Vault, authored playtests) borrow the floor whose organ they resemble. */
const BIOME_FLOOR: Readonly<Record<BiomeId, string>> = {
  earthen: 'd1', timber: 'd1', gilded: 'd1',
  fungal: 'd2',
  flooded: 'd3', frozen: 'd3', crystal: 'd3',
  volcanic: 'd4', scorched: 'd4',
};

export function floorForLevel(levelId: string | null | undefined, biome: BiomeId | null | undefined): string | null {
  if (levelId && FLOOR_CUES[levelId]) return levelId;
  return biome ? BIOME_FLOOR[biome] ?? 'd1' : null;
}

export type BossKind = 'leviathan' | 'colossus';
export const BOSS_CUES: Readonly<Record<BossKind, string>> = { leviathan: 'boss-leviathan', colossus: 'boss-colossus' };
export type Verdict = 'victory' | 'fallen';

/* ---------------- threat: is the alchemist being hunted? ---------------- */

/** Anything farther than this (cells, vertical weighted like the mix) is not part of the moment. */
export const THREAT_RANGE = 260;
const VERTICAL_WEIGHT = 1.35;

/** How much one hunting creature counts: fodder alone is not a hunt; one predator is. */
export function threatWeight(kind: EnemyKind): number {
  switch (kind) {
    case 'eggs': case 'leviathan': case 'colossus': return 0; // eggs don't hunt; bosses have their own cue
    case 'slime': case 'acidslime': case 'bat': case 'bomber': case 'wisp': return 0.55;
    default: return 1;
  }
}

export interface ThreatSubject {
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  alerted?: boolean;
  sleeping?: boolean;
  mind?: { intent: string; visible: boolean };
}

/** Is this creature actively after the alchemist right now? Its own perception decides (creatures/perception). */
export function isHunting(e: ThreatSubject): boolean {
  if (e.hp <= 0 || e.sleeping) return false;
  if (e.mind) return e.mind.intent === 'hunt' || (e.alerted === true && e.mind.visible);
  return e.alerted === true;
}

export function threatScore(enemies: readonly ThreatSubject[], px: number, py: number): number {
  let score = 0;
  for (const e of enemies) {
    if (!isHunting(e)) continue;
    if (Math.hypot(e.x - px, (e.y - py) * VERTICAL_WEIGHT) > THREAT_RANGE) continue;
    score += threatWeight(e.kind);
  }
  return score;
}

/**
 * Hysteresis between calm and hunted: a threat must hold for `enterMs` to
 * raise the tension layer (a creature glancing over does not), and the layer
 * holds `holdMs` after the last threat (a hunt that breaks off for a breath
 * does not drop the music to calm and straight back up).
 */
export class TensionGate {
  private active = false;
  private since = -1;
  private lastThreat = -Infinity;

  constructor(readonly enterScore = 1, readonly exitScore = 0.5, readonly enterMs = 700, readonly holdMs = 7000) {}

  update(score: number, nowMs: number): boolean {
    if (score >= this.exitScore) this.lastThreat = nowMs;
    if (!this.active) {
      if (score >= this.enterScore) {
        if (this.since < 0) this.since = nowMs;
        if (nowMs - this.since >= this.enterMs) this.active = true;
      } else this.since = -1;
    } else if (nowMs - this.lastThreat >= this.holdMs) {
      this.active = false;
      this.since = -1;
    }
    return this.active;
  }

  get tense(): boolean { return this.active; }

  reset(): void { this.active = false; this.since = -1; this.lastThreat = -Infinity; }
}

/** A boss is engaged when it is alive, has noticed the alchemist, and is near enough to matter. */
export const BOSS_RANGE = 480;
export function engagedBoss(enemies: readonly ThreatSubject[], px: number, py: number): BossKind | null {
  for (const e of enemies) {
    if ((e.kind !== 'leviathan' && e.kind !== 'colossus') || e.hp <= 0 || !e.alerted) continue;
    if (Math.hypot(e.x - px, (e.y - py) * VERTICAL_WEIGHT) <= BOSS_RANGE) return e.kind;
  }
  return null;
}

/** Whether any boss of a kind is still alive (a dead boss releases its cue at once). */
export function bossAlive(enemies: readonly ThreatSubject[], kind: BossKind): boolean {
  return enemies.some(e => e.kind === kind && e.hp > 0);
}

/** Holds the boss cue through a short disengagement (the Leviathan dives; the player backs off). */
export class BossGate {
  private kind: BossKind | null = null;
  private lastSeen = -Infinity;

  constructor(readonly holdMs = 15000) {}

  update(engaged: BossKind | null, alive: (kind: BossKind) => boolean, nowMs: number): BossKind | null {
    if (engaged) { this.kind = engaged; this.lastSeen = nowMs; return engaged; }
    if (this.kind && (!alive(this.kind) || nowMs - this.lastSeen > this.holdMs)) this.kind = null;
    return this.kind;
  }

  reset(): void { this.kind = null; this.lastSeen = -Infinity; }
}

/* ---------------- which cue does this moment want? ---------------- */

export interface DirectorInput {
  /** A user gesture has happened (autoplay policy): nothing plays before one. */
  gestured: boolean;
  /** The engine has a running context to play into. */
  soundOn: boolean;
  /** A verdict cue that is due and not yet finished; `pending` = scheduled, the old music clears the air first. */
  verdict: Verdict | null;
  verdictPending: boolean;
  builderOpen: boolean;
  entryActive: boolean;
  ledgerOpen: boolean;
  sanctumOpen: boolean;
  mode: 'build' | 'play';
  /** The run ended on this floor (a final fall): the floor's music does not come back underneath. */
  runOver: boolean;
  teaActive: boolean;
  boss: BossKind | null;
  floor: string | null;
  tension: boolean;
  /** A settings slider asked to hear the score while nothing else plays. */
  preview: boolean;
  /** STORY: the cue a story moment wants (the Kiln escape, the ending), already resolved to a track that exists. */
  story?: string | null;
}

export function chooseCue(i: DirectorInput): string | null {
  if (!i.gestured || !i.soundOn) return null;
  if (i.verdictPending) return null;
  if (i.verdict) return i.verdict;
  const want = ((): string | null => {
    if (i.builderOpen) return null;
    // The story's set pieces lead: the escape's urgent theme, the ending's resolution.
    if (i.story) return i.story;
    if (i.entryActive) return 'title';
    // The Works carry on under the ledger: the theme, softly (see dipFor).
    if (i.ledgerOpen) return 'title';
    if (i.sanctumOpen) return 'sanctum';
    if (i.mode !== 'play') return 'workshop';
    if (i.runOver) return null;
    if (i.boss) return BOSS_CUES[i.boss];
    if (i.teaActive) return 'tea-engine';
    const pair = i.floor ? FLOOR_CUES[i.floor] : undefined;
    if (!pair) return null;
    return i.tension ? pair.tension : pair.explore;
  })();
  return want ?? (i.preview ? 'title' : null);
}

export interface DipInput {
  hidden: boolean;
  paused: boolean;
  playerDead: boolean;
  ledgerOpen: boolean;
  mode: 'build' | 'play';
  /** The alchemist stands in a designed deep-dark zone (see `inDeepDark`). */
  dark?: boolean;
  /** The cue playing now: the dark thins only a floor's calm cue, never a hunt or a boss. */
  cue?: string | null;
  /** Ms since a boss broke into a new phase (undefined: none lately). */
  sincePhaseMs?: number;
}

/** The floor's calm cue sits back this far in the deep dark: the Works go quiet where no lamp reaches. */
export const DARK_THIN = 0.62;
/** Under a boss's phase roar the score holds its breath this low, for this long, then swells back. */
export const PHASE_DIP = 0.42;
export const PHASE_DIP_MS = 1500;

/** Deep-dark hysteresis on the darkness under the alchemist (0..1): the light wave's own "you entered the dark" thresholds. */
export function inDeepDark(wasDark: boolean, darkness: number): boolean {
  return wasDark ? darkness >= DARKNESS.leaveDark : darkness >= DARKNESS.enterDark;
}

/** A boss's phase roar is playing: the score ducks under it (the director ramps down fast and swells back slowly). */
export function phaseDipActive(sincePhaseMs: number | undefined): boolean {
  return sincePhaseMs !== undefined && sincePhaseMs >= 0 && sincePhaseMs < PHASE_DIP_MS;
}

/**
 * The director's overall level on top of the cue: a hidden tab is silent, a
 * death is a breath out (the floor music sinks while the body settles), the
 * pause menu and the ledger sit back so the room can be read. In play, a
 * boss breaking into a new phase makes the score hold its breath under the
 * roar, and the deep dark thins a floor's calm cue.
 */
export function dipFor(d: DipInput): number {
  if (d.hidden) return 0;
  if (d.ledgerOpen) return 0.55;
  if (d.mode === 'play' && d.playerDead) return 0.3;
  if (d.mode === 'play' && d.paused) return 0.6;
  if (d.mode === 'play' && phaseDipActive(d.sincePhaseMs)) return PHASE_DIP;
  if (d.mode === 'play' && d.dark && d.cue && isCalmFloorCue(d.cue)) return DARK_THIN;
  return 1;
}

/** A floor's exploration cue (not its hunted layer, not a boss, the Sanctum or the Tea Engine). */
export function isCalmFloorCue(id: string): boolean {
  return Object.values(FLOOR_CUES).some(pair => pair.explore === id);
}

/** Cue loudness relative to its master: exploration sits under the action; hunted and boss cues lead. */
export function cueLevel(id: string): number {
  if (id.endsWith('-tension') || id.startsWith('boss-') || id === 'escape' || id === 'ending') return 1;
  if (id === 'victory' || id === 'fallen' || id === 'tea-engine') return 1;
  if (id === 'title') return 0.95;
  return 0.82;
}

const floorOfCue = (id: string): string | null => {
  for (const [floor, pair] of Object.entries(FLOOR_CUES)) if (pair.explore === id || pair.tension === id) return floor;
  return null;
};

/** Seconds to crossfade `from` into `to` (either may be silence). */
export function fadeSeconds(from: string | null, to: string | null): number {
  if (to === 'victory' || to === 'fallen') return 0.35; // the verdict enters on its own attack
  if (!from && !to) return 0;
  if (!to) return from === 'victory' || from === 'fallen' ? 3 : 1.6;
  if (!from) return 2.5;
  if (to.startsWith('boss-') || to === 'escape') return 1.2;
  const a = floorOfCue(from), b = floorOfCue(to);
  if (a && a === b) return 1.8; // calm <-> hunted on one floor: same key, same tempo
  return 2.5;
}

/** Seconds of crossfade when a looping cue wraps its tail into its head. */
export function loopFadeSeconds(id: string): number {
  if (id.endsWith('-tension') || id.startsWith('boss-') || id === 'tea-engine' || id === 'escape') return 3;
  return 5;
}

/** Equal-power fade shape: `n` samples from `from` to `to` (sin/cos law, so a crossfade never dips). */
export function equalPowerCurve(from: number, to: number, n = 32): Float32Array {
  const out = new Float32Array(Math.max(2, n));
  for (let i = 0; i < out.length; i++) {
    const t = i / (out.length - 1);
    // Rising: sin(t·π/2); falling: cos(t·π/2) — scaled between the endpoints.
    const w = to >= from ? Math.sin(t * Math.PI / 2) : 1 - Math.cos(t * Math.PI / 2);
    out[i] = from + (to - from) * w;
  }
  return out;
}

/** A gain ramp as the director scheduled it, readable at any instant (probes cannot trust AudioParam.value). */
export interface Ramp { from: number; to: number; t0: number; t1: number }

export function rampValue(r: Ramp, t: number): number {
  if (t <= r.t0) return r.from;
  if (t >= r.t1 || r.t1 <= r.t0) return r.to;
  const u = (t - r.t0) / (r.t1 - r.t0);
  const w = r.to >= r.from ? Math.sin(u * Math.PI / 2) : 1 - Math.cos(u * Math.PI / 2);
  return r.from + (r.to - r.from) * w;
}
