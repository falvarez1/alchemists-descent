import { setFightSink } from '@/core/fightSink';
import type { FightSink, FightTag } from '@/core/fightSink';
import type { AbilitySlot, FighterView } from '@/core/fighters';
import type { Ctx, Enemy, EnemyDamageSource } from '@/core/types';

/**
 * THE FIGHT RECORDER (docs/arena/TELEMETRY-AND-BALANCE.md 3.1): every fight, human or bot, leaves a record that
 * can be reviewed afterwards and analysed in bulk. Authoring builds only: nothing installs one in a player
 * build, and with none installed every instrumentation site is a single null check (`core/fightSink`).
 *
 * SCHEMA v1, JSONL, one fight per file. Lines, in time order:
 *   {"k":"h", ...}                       the header: who fought, on what seed, with which overrides, from which commit
 *   {"k":"s","t":N,"f":[[...],...],"foes":[[...],...]}   a sample, every `sampleEvery` ticks (default 6 = 10 Hz)
 *   {"k":"e","t":N,"e":"hit"|"hurt"|"ability"|"end", ...}  an event, at the tick it happened
 *
 * `t` is the tick since the fight began (0 = the starting sample). Fighters are addressed by SLOT index from
 * day one (`src` / `dst` / `who`), so a second fighter (PvP, bots) drops in without a schema change; a foe is
 * slot -1 in `src` / `dst` and carries its own `foe` id, `kind`. The per-fighter sample tuple is FIGHTER_COLUMNS,
 * a foe's is FOE_COLUMNS. Sampling is columnar in memory (one growable typed array per column), so a 60 Hz
 * debug recording costs no per-sample allocation.
 */

export const FIGHT_SCHEMA_VERSION = 1;

/** Names of the per-fighter sample tuple, in order. */
export const FIGHTER_COLUMNS = ['x', 'y', 'vx', 'vy', 'hp', 'armor', 'charge', 'tCd', 'tAct', 'uAct', 'flags'] as const;
/** Names of a foe's sample tuple, in order. */
export const FOE_COLUMNS = ['id', 'kind', 'x', 'y', 'hp'] as const;

/** Bits of a fighter sample's `flags`. */
export const FIGHT_FLAG = {
  grounded: 1,
  climbing: 2,
  crawling: 4,
  stunned: 8,
  invuln: 16,
  concealed: 32,
  liquid: 64,
  dead: 128,
} as const;

export interface FightFighterHeader {
  slot: number;
  /** null = the classic Alchemist. */
  id: string | null;
  /** Who decides: `scripted:1` (the gauntlet driver), `human`, `kiter:2` ... Every number in a report is per brain. */
  brain: string;
  hp: number;
  maxHp: number;
}

export interface FightHeader {
  k: 'h';
  v: typeof FIGHT_SCHEMA_VERSION;
  runId: string;
  fight: number;
  seed: number;
  yard: string;
  fighters: FightFighterHeader[];
  /** The sparse diff of tuning overrides in force (`ParamOverrideApi.snapshot()`). */
  overrides: Record<string, number | boolean>;
  git: string;
  dirty: boolean;
  /** `paused-step` (a batch page stepping by hand), `live` (a person or two bots in the real-time loop). */
  regime: string;
  tickHz: number;
  sampleEvery: number;
  fighterColumns: readonly string[];
  foeColumns: readonly string[];
  /** What was staged: the foe mix and where each stands, the tick cap ... (free-form, per harness). */
  scenario?: Record<string, unknown>;
}

export type FightHeaderInput = Omit<FightHeader, 'k' | 'v' | 'tickHz' | 'sampleEvery' | 'fighterColumns' | 'foeColumns' | 'overrides' | 'git' | 'dirty' | 'regime'> &
  Partial<Pick<FightHeader, 'overrides' | 'git' | 'dirty' | 'regime'>>;

export interface HitEvent {
  k: 'e';
  t: number;
  e: 'hit';
  /** The fighter slot that dealt it. */
  src: number;
  /** Always -1: a foe took it. */
  dst: -1;
  foe: number;
  kind: string;
  /** What `Enemies.damage` was given (after the Complications multiplier and a boss's own adjustments). */
  amount: number;
  /** What the foe could actually lose: the amount, capped at the hp it had left (overkill is not damage dealt). */
  eff: number;
  /** What the blow belongs to: spell, kick, ability.tactical, ability.ultimate, passive, world. */
  source: FightTag;
  /** The engine's own tag: `direct`, or the world's cause (`fire`, `explosion` ...). */
  cause: EnemyDamageSource;
  kx: number;
  ky: number;
  hpAfter: number;
  killed: boolean;
}

export interface HurtEvent {
  k: 'e';
  t: number;
  e: 'hurt';
  /** The fighter slot that landed it (the arena knows who); -1: a foe, a hazard or the world (Player.damage carries only a source string). */
  src: number;
  /** The fighter slot that took it. */
  dst: number;
  /** What the blow belongs to when another fighter landed it: spell, kick, ability.tactical, ability.ultimate, passive, world. Absent for a hazard or the world. */
  tag?: string;
  /** What arrived, and what reached health: the difference is what armor, overshields and the kit absorbed. */
  raw: number;
  taken: number;
  absorbed: number;
  source: string;
  kx: number;
  ky: number;
  hpAfter: number;
  killed: boolean;
  /** Set when the loss was inferred from the hp delta (a hazard's drip bypasses `Player.damage`). */
  inferred?: true;
}

export interface AbilityEvent {
  k: 'e';
  t: number;
  e: 'ability';
  who: number;
  slot: AbilitySlot;
  /** `again`: the press was answered while the tactical cooled (a plate lowered early). */
  res: 'fired' | 'refused' | 'again';
  x: number;
  y: number;
}

export interface EndEvent {
  k: 'e';
  t: number;
  e: 'end';
  /** The winning slot, -1 when the foes (or the world) won, null when nobody did. */
  winner: number | null;
  reason: 'ko' | 'ringout' | 'timeout' | 'stalemate';
  /** A gauntlet's own word for it. */
  result?: 'cleared' | 'died' | 'timeout';
  hp: number[];
}

export type FightEvent = HitEvent | HurtEvent | AbilityEvent | EndEvent;

export interface FightSampleLine {
  k: 's';
  t: number;
  f: number[][];
  foes: Array<Array<number | string>>;
}

export interface FightRecord {
  header: FightHeader;
  samples: FightSampleLine[];
  events: FightEvent[];
}

/** Totals a probe can hold up against the game's own counters. */
export interface FightTotals {
  /** Effective damage dealt to foes, by what it belonged to. */
  dealt: Record<string, number>;
  dealtTotal: number;
  /** Health lost by the fighter(s), by source. */
  taken: Record<string, number>;
  takenTotal: number;
  /** Per ability: how many times it fired, was refused, was answered while cooling. */
  abilities: Record<AbilitySlot, { fired: number; refused: number; again: number }>;
  kills: number;
  hits: number;
}

/** A growable typed column: pushes without allocating per sample. */
class Column {
  private data: Float32Array;
  length = 0;
  constructor(capacity = 256) {
    this.data = new Float32Array(capacity);
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = v;
  }
  at(i: number): number {
    return this.data[i];
  }
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** What the recorder reads of the fighter system (`FighterSystem` satisfies it; the engine-level `FighterApi` has no `attribute`). */
export interface FightFighters {
  readonly view: FighterView;
  concealment(): number;
  /** What the blow `Enemies.damage` is landing right now belongs to. */
  attribute(source: EnemyDamageSource): FightTag;
}

/** What the recorder reads of the game: the fighter's body, the foes, the clock and the fighter system (and, in a duel, every slot's). */
export interface FightCtx {
  player: Ctx['player'];
  enemies: Ctx['enemies'];
  state: Pick<Ctx['state'], 'frameCount'>;
  fighters?: FightFighters;
  /** A duel: the slots (their bundles), who is bound, and the blow being landed. */
  arena?: Pick<NonNullable<Ctx['arena']>, 'active' | 'slotCount' | 'bundle' | 'bound' | 'activeBlow'>;
}

/** One fighter as the recorder reads it. */
interface SlotRead {
  player: Ctx['player'];
  fighters?: FightFighters;
}

export interface FightRecorderOptions {
  /** Sample every this many ticks (6 = 10 Hz). 1 = a 60 Hz debug recording. */
  sampleEvery?: number;
}

export class FightRecorder implements FightSink {
  private header: FightHeader | null = null;
  private startFrame = 0;
  private tickNo = 0;
  private readonly sampleEvery: number;

  // columnar samples: one column per fighter field, foes flattened with a count per sample
  private readonly sampleT = new Column();
  /** One set of columns per fighter slot (grown on demand): a duel samples both, a gauntlet one. */
  private readonly fighterCols: Column[][] = [];
  private readonly foeCount = new Column();
  private readonly foeCols: Column[] = FOE_COLUMNS.map(() => new Column());
  private readonly kindIds = new Map<string, number>();
  private readonly kindNames: string[] = [];

  private readonly events: FightEvent[] = [];
  private readonly foeIds = new WeakMap<Enemy, number>();
  private nextFoe = 0;
  private prevHp: number[] = [];
  private accounted: number[] = [];
  private ended = false;

  private readonly sums: FightTotals = {
    dealt: {}, dealtTotal: 0, taken: {}, takenTotal: 0,
    abilities: { tactical: { fired: 0, refused: 0, again: 0 }, ultimate: { fired: 0, refused: 0, again: 0 } },
    kills: 0, hits: 0,
  };

  constructor(private readonly ctx: FightCtx, options: FightRecorderOptions = {}) {
    this.sampleEvery = Math.max(1, Math.floor(options.sampleEvery ?? 6));
  }

  /** True between `start` and `end`. */
  get recording(): boolean {
    return this.header !== null && !this.ended;
  }

  /** Make this recorder the one the game's instrumentation sites report to (authoring builds only). */
  install(): void {
    setFightSink(this);
  }

  uninstall(): void {
    setFightSink(null);
  }

  /** Begin a fight: write the header, take the starting sample. */
  start(input: FightHeaderInput): void {
    const ctx = this.ctx;
    this.header = {
      k: 'h',
      v: FIGHT_SCHEMA_VERSION,
      runId: input.runId,
      fight: input.fight,
      seed: input.seed >>> 0,
      yard: input.yard,
      fighters: input.fighters,
      overrides: input.overrides ?? {},
      git: input.git ?? 'unknown',
      dirty: input.dirty ?? false,
      regime: input.regime ?? 'paused-step',
      tickHz: 60,
      sampleEvery: this.sampleEvery,
      fighterColumns: FIGHTER_COLUMNS,
      foeColumns: FOE_COLUMNS,
      ...(input.scenario ? { scenario: input.scenario } : {}),
    };
    this.startFrame = ctx.state.frameCount;
    this.tickNo = 0;
    this.ended = false;
    const slots = this.slots();
    this.prevHp = slots.map((s) => s.player.hp);
    this.accounted = slots.map(() => 0);
    this.sample();
  }

  /** Every fighter in the fight, slot 0 first. */
  private slots(): SlotRead[] {
    const ctx = this.ctx;
    const arena = ctx.arena;
    if (arena !== undefined && arena.active) {
      const out: SlotRead[] = [];
      for (let s = 0; s < arena.slotCount; s++) {
        const b = arena.bundle(s);
        if (b) out.push({ player: b.player, fighters: b.fighters as unknown as FightFighters });
      }
      return out;
    }
    return [{ player: ctx.player, fighters: ctx.fighters }];
  }

  /** The slot whose bundle is on the Ctx right now (the one acting, or the one a blow is landing on). */
  private bound(): number {
    const arena = this.ctx.arena;
    return arena !== undefined && arena.active ? arena.bound : 0;
  }

  // ======================================================================== the FightSink

  tick(): void {
    if (this.header === null || this.ended) return;
    this.tickNo = this.ctx.state.frameCount - this.startFrame;
    // Health lost by a road that never touched Player.damage (a hazard's drip, a status): inferred from the delta, per fighter.
    const slots = this.slots();
    for (let s = 0; s < slots.length; s++) {
      const p = slots[s].player;
      const lost = (this.prevHp[s] ?? p.hp) - p.hp - (this.accounted[s] ?? 0);
      if (lost > 0.01) {
        const source = p.lastDamageSource ?? 'hazard';
        this.noteTaken(source, lost);
        this.events.push({ k: 'e', t: this.tickNo, e: 'hurt', src: -1, dst: s, raw: r2(lost), taken: r2(lost), absorbed: 0, source, kx: 0, ky: 0, hpAfter: r2(Math.max(0, p.hp)), killed: p.hp <= 0, inferred: true });
      }
      this.prevHp[s] = p.hp;
      this.accounted[s] = 0;
    }
    if (this.tickNo % this.sampleEvery === 0) this.sample();
  }

  hit(e: Enemy, amount: number, source: EnemyDamageSource, killed: boolean, kx: number, ky: number): void {
    if (this.header === null || this.ended) return;
    const eff = Math.max(0, Math.min(amount, e.hp + amount));
    const tag: FightTag = this.ctx.fighters?.attribute(source) ?? (source === 'direct' ? 'spell' : 'world');
    if (e.fighter !== undefined) return; // a blow on a rival is recorded once, as the rival's `hurt`, with the blow's tag
    this.sums.hits++;
    this.sums.dealt[tag] = (this.sums.dealt[tag] ?? 0) + eff;
    this.sums.dealtTotal += eff;
    if (killed) this.sums.kills++;
    this.events.push({
      k: 'e', t: this.now(), e: 'hit', src: this.bound(), dst: -1, foe: this.foeId(e), kind: e.kind,
      amount: r2(amount), eff: r2(eff), source: tag, cause: source, kx: r2(kx), ky: r2(ky), hpAfter: r2(Math.max(0, e.hp)), killed,
    });
  }

  hurt(raw: number, taken: number, source: string, kx: number, ky: number): void {
    if (this.header === null || this.ended) return;
    const p = this.ctx.player;
    const dst = this.bound();
    const blow = this.ctx.arena?.activeBlow ?? null;
    this.accounted[dst] = (this.accounted[dst] ?? 0) + taken;
    this.noteTaken(source, taken);
    this.events.push({
      k: 'e', t: this.now(), e: 'hurt', src: blow ? blow.by : -1, dst, ...(blow ? { tag: blow.tag } : {}), raw: r2(raw), taken: r2(taken), absorbed: r2(Math.max(0, raw - taken)),
      source, kx: r2(kx), ky: r2(ky), hpAfter: r2(Math.max(0, p.hp)), killed: p.hp <= 0,
    });
  }

  ability(slot: AbilitySlot, result: 'fired' | 'refused' | 'again'): void {
    if (this.header === null || this.ended) return;
    const p = this.ctx.player;
    this.sums.abilities[slot][result]++;
    this.events.push({ k: 'e', t: this.now(), e: 'ability', who: this.bound(), slot, res: result, x: r2(p.x), y: r2(p.y) });
  }

  // ======================================================================== ending, reading back

  /** The fight is over: write the closing event and take a last sample. Idempotent. */
  end(outcome: { winner: number | null; reason: EndEvent['reason']; result?: EndEvent['result'] }): void {
    if (this.header === null || this.ended) return;
    this.tick();
    if (this.tickNo % this.sampleEvery !== 0) this.sample();
    this.events.push({
      k: 'e', t: this.now(), e: 'end', winner: outcome.winner, reason: outcome.reason,
      ...(outcome.result ? { result: outcome.result } : {}), hp: this.slots().map((s) => r2(Math.max(0, s.player.hp))),
    });
    this.ended = true;
  }

  /** Ticks since the fight began. */
  get ticks(): number {
    return this.now();
  }

  totals(): FightTotals {
    return JSON.parse(JSON.stringify(this.sums)) as FightTotals;
  }

  /** The recording as plain objects (what `toJSONL` writes, in time order). */
  toRecord(): FightRecord {
    if (this.header === null) throw new Error('FightRecorder.toRecord: no fight was started');
    const samples: FightSampleLine[] = [];
    let foeAt = 0;
    for (let i = 0; i < this.sampleT.length; i++) {
      const f: number[][] = [];
      for (let s = 0; s < this.fighterCols.length; s++) {
        const cols = this.fighterCols[s];
        if (i >= cols[0].length) continue;
        const row: number[] = [];
        for (let c = 0; c < FIGHTER_COLUMNS.length; c++) {
          const v = cols[c].at(i);
          row.push(c === FIGHTER_COLUMNS.length - 1 ? v : r3(v));
        }
        f.push(row);
      }
      const n = this.foeCount.at(i);
      const foes: Array<Array<number | string>> = [];
      for (let j = 0; j < n; j++, foeAt++) {
        foes.push([
          this.foeCols[0].at(foeAt), this.kindNames[this.foeCols[1].at(foeAt)] ?? '?',
          r2(this.foeCols[2].at(foeAt)), r2(this.foeCols[3].at(foeAt)), r2(this.foeCols[4].at(foeAt)),
        ]);
      }
      samples.push({ k: 's', t: this.sampleT.at(i), f, foes });
    }
    return { header: this.header, samples, events: this.events.slice() };
  }

  /** One fight, one JSONL document: the header, then samples and events merged in time order (an event before the sample of its tick). */
  toJSONL(): string {
    const { header, samples, events } = this.toRecord();
    const lines: string[] = [JSON.stringify(header)];
    let e = 0;
    for (const s of samples) {
      while (e < events.length && events[e].t <= s.t) lines.push(JSON.stringify(events[e++]));
      lines.push(JSON.stringify(s));
    }
    while (e < events.length) lines.push(JSON.stringify(events[e++]));
    return lines.join('\n') + '\n';
  }

  // ======================================================================== internals

  private now(): number {
    return this.ctx.state.frameCount - this.startFrame;
  }

  private noteTaken(source: string, amount: number): void {
    this.sums.taken[source] = (this.sums.taken[source] ?? 0) + amount;
    this.sums.takenTotal += amount;
  }

  private foeId(e: Enemy): number {
    let id = this.foeIds.get(e);
    if (id === undefined) {
      id = this.nextFoe++;
      this.foeIds.set(e, id);
    }
    return id;
  }

  private kindId(kind: string): number {
    let id = this.kindIds.get(kind);
    if (id === undefined) {
      id = this.kindNames.length;
      this.kindNames.push(kind);
      this.kindIds.set(kind, id);
    }
    return id;
  }

  /** One sample: the fighter's body and ability state, every living foe. */
  private sample(): void {
    const ctx = this.ctx;
    const at = this.now();
    if (this.sampleT.length > 0 && this.sampleT.at(this.sampleT.length - 1) === at) return; // one sample per tick (end() asks again at the last tick)
    this.sampleT.push(at);
    const slots = this.slots();
    for (let s = 0; s < slots.length; s++) {
      const p = slots[s].player;
      const fighters = slots[s].fighters;
      const view = fighters?.view;
      let flags = 0;
      if (p.grounded) flags |= FIGHT_FLAG.grounded;
      if (p.climbing) flags |= FIGHT_FLAG.climbing;
      if (p.crawling) flags |= FIGHT_FLAG.crawling;
      if (p.staggerT > 0 || p.stunT > 0) flags |= FIGHT_FLAG.stunned;
      if (p.invuln > 0) flags |= FIGHT_FLAG.invuln;
      if ((fighters?.concealment() ?? 0) > 0.3) flags |= FIGHT_FLAG.concealed;
      if (p.inLiquid) flags |= FIGHT_FLAG.liquid;
      if (p.dead) flags |= FIGHT_FLAG.dead;
      const cols = (this.fighterCols[s] ??= FIGHTER_COLUMNS.map(() => new Column()));
      cols[0].push(p.x);
      cols[1].push(p.y);
      cols[2].push(p.vx);
      cols[3].push(p.vy);
      cols[4].push(p.hp);
      cols[5].push(view?.armor ?? 0);
      cols[6].push(view?.ultimate.charge ?? 0);
      cols[7].push(view?.tactical.cooldown ?? 0);
      cols[8].push(view?.tactical.active ?? 0);
      cols[9].push(view?.ultimate.active ?? 0);
      cols[10].push(flags);
    }
    let n = 0;
    for (const e of ctx.enemies) {
      if (e.hp <= 0 || e.fighter !== undefined) continue;
      this.foeCols[0].push(this.foeId(e));
      this.foeCols[1].push(this.kindId(e.kind));
      this.foeCols[2].push(e.x);
      this.foeCols[3].push(e.y);
      this.foeCols[4].push(e.hp);
      n++;
    }
    this.foeCount.push(n);
  }
}

/** Parse a fight file written by `toJSONL` (a probe re-reads what the recorder wrote; the analyser has its own copy in plain JS). */
export function parseFightJSONL(text: string): FightRecord {
  let header: FightHeader | null = null;
  const samples: FightSampleLine[] = [];
  const events: FightEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as { k: string };
    if (row.k === 'h') header = row as FightHeader;
    else if (row.k === 's') samples.push(row as FightSampleLine);
    else if (row.k === 'e') events.push(row as FightEvent);
  }
  if (header === null) throw new Error('parseFightJSONL: no header line');
  return { header, samples, events };
}
