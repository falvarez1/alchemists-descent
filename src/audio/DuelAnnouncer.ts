import type { Ctx, DuelAudioApi, DuelMenuSound } from '@/core/types';
import type { EventMap } from '@/core/events';
import type { StreamHost } from '@/audio/streamHost';
import type { FighterId } from '@/content/fighters';
import type { StockStageId } from '@/config/stockStage';
import type { SfxId } from '@/content/audio/sfxCues';
import { DUEL_CLIPS } from '@/content/audio/duelAnnouncer.generated';
import { DUEL_LINES, duelFighterLine, duelStageLine, type DuelLineGroup } from '@/content/audio/duelLines';
import { failSafe } from '@/audio/failSafe';
import {
  DUEL_PRIORITY, beatCall, downCall, lobbyCalls, lobbyView, shieldBreakCall,
  type DuelCall, type LobbyView,
} from '@/audio/duelCalls';

/** Between the lines of one call ("Game!" … "Brann wins!"). */
const LINE_GAP_MS = 220;
/**
 * A clip still loading this long after its moment is not played. A newer call cancels an older one anyway
 * (a name the player cycled past is never said), and a select-screen call is dropped once the lobby has
 * closed; this only drops a call nothing replaced that has gone stale. Generous on purpose: on a cold
 * page the clips queue behind the sample packs' first downloads ("Choose your fighter!" took seconds).
 */
const STALE_MS = 6000;
/** A cut call fades this fast: the next name is already on its way. */
const CUT_FADE_S = 0.05;
/** After the last word, the score comes back up after this. */
const DUCK_RELEASE_MS = 250;
const LOG = 40;
const LINE_GROUP: ReadonlyMap<string, DuelLineGroup> = new Map(DUEL_LINES.map((l) => [l.id, l.group]));
const MENU: Readonly<Record<DuelMenuSound, SfxId>> = { move: 'duel.ui.move', confirm: 'duel.ui.confirm', back: 'duel.ui.back' };

interface Speaking {
  call: DuelCall;
  cancelled: boolean;
  node: AudioBufferSourceNode | null;
  gain: GainNode | null;
  /** The `said` entry of the line playing now (marked when it is cut). */
  entry: SaidLine | null;
}

interface SaidLine { line: string; at: number; ended?: number; cut?: boolean }

/**
 * THE DUEL'S ANNOUNCER: an arcade cabinet's voice (a sports-arena announcer, every call shouted;
 * scripts/audio/gen-duel-announcer.mjs) and its sounds, for the Duel only. The descent's narrator
 * keeps out of the arena (audio/arenaAudio inArena); this is the one that talks here.
 *
 * It listens, never polls: the select screen's session (`versusChanged`: Choose your fighter, a
 * fighter's or stage's name the moment it is chosen, a player locking in, a challenger's coin), the
 * stock match's beats (`stockMatchBeat`: Three, Two, One on the countdown's own beats, FIGHT,
 * GAME or TIME and the winner), a ring-out (`fighterDown`: the KO blast, Ring out / K.O. / Self-
 * destruct, Last stock) and a broken shield. audio/duelCalls decides; this plays.
 *
 * One call at a time on the engine's `voice` bus, ducking the score while it talks. A call cuts the
 * one in progress when it ranks as high (a new name cuts the last one: the player cycles fast);
 * a lower one is not made, but its sound still plays. The screens' own menu sounds come through
 * `menu()` (ctx.audio.duel).
 */
export class DuelAnnouncer implements DuelAudioApi {
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly offs: Array<() => void> = [];
  private readonly timers = new Set<number>();
  private readonly said: SaidLine[] = [];
  private readonly sounds: Array<{ sfx: SfxId; at: number }> = [];
  private lobby: LobbyView | null = null;
  private speaking: Speaking | null = null;
  private talking = false;
  /** A match ended since the last reset: the next countdown opens with "Rematch!". */
  private finished = false;
  private downs = 0;

  constructor(private readonly ctx: Ctx, private readonly host: StreamHost, private readonly clips: Readonly<Record<string, { readonly url: string }>> = DUEL_CLIPS) {
    const on: typeof ctx.events.on = (event, handler) => ctx.events.on(event, failSafe(`DuelAnnouncer on ${String(event)}`, handler));
    this.offs.push(
      on('versusChanged', () => this.onVersus()),
      on('arenaReset', () => this.onReset()),
      on('stockMatchBeat', (beat) => this.onBeat(beat)),
      on('fighterDown', (ev) => this.onDown(ev)),
      on('stockShieldBreak', () => { if (this.ctx.arena?.stockMatch) this.call(shieldBreakCall()); }),
    );
  }

  /* ---------------- the screens' API ---------------- */

  menu(kind: DuelMenuSound): void {
    this.sfx(MENU[kind]);
  }

  announceFighter(id: FighterId): void {
    this.call({ steps: [{ line: duelFighterLine(id) }], priority: DUEL_PRIORITY.select });
  }

  announceStage(id: StockStageId): void {
    this.call({ steps: [{ line: duelStageLine(id) }], priority: DUEL_PRIORITY.select });
  }

  /* ---------------- the moments ---------------- */

  private onVersus(): void {
    const v = this.ctx.versus;
    if (!v) return;
    const next = lobbyView(v);
    if (next.phase === 'lobby' && this.lobby?.phase !== 'lobby') this.preload(['select']);
    if (next.phase === 'loading' || next.phase === 'playing') this.preload(['match', 'result']);
    const calls = lobbyCalls(this.lobby, next);
    if (calls.length) this.call({ steps: calls.flatMap((c) => c.steps), priority: Math.max(...calls.map((c) => c.priority)) });
    // Leaving the Duel: the cabinet goes quiet.
    if (next.phase === 'idle') this.stop();
    this.lobby = next.phase === 'idle' ? null : next;
  }

  /** A new countdown: its first beat (the first tick it holds) is the match's own stockMatchBeat. */
  private onReset(): void {
    this.downs = 0;
    if (this.ctx.arena?.stockMatch) this.preload(['match', 'result']);
  }

  private onBeat(beat: EventMap['stockMatchBeat']): void {
    const arena = this.ctx.arena, match = arena?.stockMatch;
    if (!arena || !match) return;
    // The first countdown beat after a finished match opens the rematch.
    const rematch = beat.state === 'countdown' && this.finished;
    if (beat.state !== 'finished') this.finished = false;
    else this.finished = true;
    const winner = beat.winner !== null ? arena.fighterId(beat.winner) : null;
    const call = beatCall(beat, { winner, timeUp: match.remainingTicks <= 0, rematch });
    if (call) this.call(call);
  }

  private onDown(ev: EventMap['fighterDown']): void {
    const match = this.ctx.arena?.stockMatch;
    // The health duel (the Proving Yard's bout) has no stocks and no cabinet.
    if (!match) return;
    this.call(downCall(ev, { stocksLeft: match.fighters[ev.slot]?.stocks ?? 0, finished: match.state === 'finished', downsSoFar: this.downs++ }));
  }

  /* ---------------- calling ---------------- */

  private call(call: DuelCall): void {
    // The moment's own sound always plays; the voice may not.
    const first = call.steps[0];
    if (first?.sfx) this.sfx(first.sfx);
    if (!call.steps.some((s) => s.line) || document.hidden || !this.host.streamContext()) return;
    const current = this.speaking;
    if (current) {
      if (call.priority < current.call.priority) return;
      // The same name asked for again (a cursor's preview, then the choice): it is already being said.
      if (call.steps.length === 1 && current.call.steps.length === 1 && call.steps[0].line === current.call.steps[0].line && !call.steps[0].sfx) return;
      this.cut();
    }
    const me: Speaking = { call, cancelled: false, node: null, gain: null, entry: null };
    this.speaking = me;
    void this.run(me);
  }

  private async run(me: Speaking): Promise<void> {
    const steps = me.call.steps;
    for (let i = 0; i < steps.length && !me.cancelled; i++) {
      const step = steps[i];
      if (i > 0) {
        await this.wait(LINE_GAP_MS);
        if (me.cancelled) break;
        if (step.sfx) this.sfx(step.sfx);
      }
      if (step.line) await this.play(me, step.line);
    }
    if (this.speaking === me) {
      this.speaking = null;
      this.duck(false);
    }
  }

  /** One line to its end (or its cut). False when it could not start in time. */
  private async play(me: Speaking, line: string): Promise<boolean> {
    const ac = this.host.streamContext(), bus = this.host.streamBus('voice');
    if (!ac || !bus || !this.clips[line]) return false;
    const asked = performance.now();
    const buffer = await this.buffer(ac, line);
    if (!buffer || me.cancelled || performance.now() - asked > STALE_MS) return false;
    // The select screen's calls belong to the lobby: once the match is loading they are not said.
    if (LINE_GROUP.get(line) === 'select' && this.ctx.versus && this.ctx.versus.phase !== 'lobby') return false;
    const node = ac.createBufferSource();
    node.buffer = buffer;
    const gain = ac.createGain();
    node.connect(gain);
    gain.connect(bus);
    const entry: SaidLine = { line, at: Math.round(performance.now()) };
    me.node = node; me.gain = gain; me.entry = entry;
    this.log(this.said, entry);
    this.duck(true);
    return new Promise<boolean>((resolve) => {
      node.onended = () => {
        node.disconnect(); gain.disconnect();
        entry.ended ??= Math.round(performance.now());
        if (me.node === node) { me.node = null; me.gain = null; }
        resolve(true);
      };
      node.start();
    });
  }

  /** Stop the call in progress quickly (a newer call has the floor). */
  private cut(): void {
    const s = this.speaking;
    if (!s) return;
    s.cancelled = true;
    this.speaking = null;
    const ac = this.host.streamContext();
    if (s.entry && s.node) { s.entry.cut = true; s.entry.ended = Math.round(performance.now()); }
    if (s.node && s.gain && ac) {
      const t = ac.currentTime;
      s.gain.gain.setValueAtTime(s.gain.gain.value, t);
      s.gain.gain.linearRampToValueAtTime(0, t + CUT_FADE_S);
      try { s.node.stop(t + CUT_FADE_S + 0.01); } catch { /* already stopped */ }
    }
  }

  private stop(): void {
    this.cut();
    this.duck(false);
  }

  private sfx(id: SfxId): void {
    this.ctx.audio.sfx(id);
    this.log(this.sounds, { sfx: id, at: Math.round(performance.now()) });
  }

  private preload(groups: readonly DuelLineGroup[]): void {
    const ac = this.host.streamContext();
    if (!ac) return;
    for (const line of DUEL_LINES) if (groups.includes(line.group) && this.clips[line.id]) void this.buffer(ac, line.id);
  }

  private buffer(ac: AudioContext, line: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(line);
    if (!p) {
      const clip = this.clips[line];
      p = fetch(`${import.meta.env.BASE_URL}${clip.url}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((bytes) => ac.decodeAudioData(bytes))
        .catch(() => { this.buffers.delete(line); return null; });
      this.buffers.set(line, p);
    }
    return p;
  }

  private duck(on: boolean): void {
    if (on === this.talking) return;
    this.talking = on;
    if (on) this.host.talkDuck(true);
    else this.later(DUCK_RELEASE_MS, () => { if (!this.speaking) this.host.talkDuck(false); else this.talking = true; });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.later(ms, resolve));
  }

  private later(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
  }

  private log<T>(list: T[], item: T): void {
    list.push(item);
    if (list.length > LOG) list.shift();
  }

  dispose(): void {
    this.stop();
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    for (const off of this.offs.splice(0)) off();
  }

  /* ---------------- probing ---------------- */

  debugSnapshot(): Record<string, unknown> {
    return {
      speaking: this.speaking?.entry && !this.speaking.entry.ended ? this.speaking.entry.line : null,
      said: this.said.map((s) => ({ ...s })),
      sounds: this.sounds.map((s) => ({ ...s })),
      talking: this.talking,
      lobby: this.lobby?.phase ?? null,
      clips: Object.keys(this.clips).length,
      buffers: this.buffers.size,
    };
  }
}
