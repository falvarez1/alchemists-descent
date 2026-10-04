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
  DUEL_PRIORITY, beatCall, downCall, lobbyCalls, lobbyView, shieldBreakCall, ultimateCall, versusCall,
  type DuelCall, type LobbyView,
} from '@/audio/duelCalls';

/** Between the lines of one call ("Mara Quell!" … "Versus!"): arcade pace. */
const LINE_GAP_MS = 60;
/**
 * A clip still loading this long after its moment is not played. A newer call cancels an older one anyway
 * (a name the player cycled past is never said), and a select-screen call is dropped once the lobby has
 * closed; this only drops a call nothing replaced that has gone stale. Generous on purpose: on a cold
 * page the clips queue behind the sample packs' first downloads ("Choose your fighter!" took seconds).
 */
const STALE_MS = 6000;
/** A cut call fades this fast: the next name is already on its way. */
const CUT_FADE_S = 0.05;
/** A skipped VS card's call fades a touch slower: nothing replaces it, so it must not click off. */
const SKIP_FADE_S = 0.12;
/** After the last word, the score comes back up after this. */
const DUCK_RELEASE_MS = 250;
/** The same VS card asked for twice (the session, then a screen) within this is one call. */
const VERSUS_REPEAT_MS = 3000;
const LOG = 48;
const LINE_GROUP: ReadonlyMap<string, DuelLineGroup> = new Map(DUEL_LINES.map((l) => [l.id, l.group]));
const MENU: Readonly<Record<DuelMenuSound, SfxId>> = { move: 'duel.ui.move', confirm: 'duel.ui.confirm', back: 'duel.ui.back' };

interface SaidLine { line: string; at: number; ended?: number; cut?: boolean }

/** One line of a call, already on the audio clock. */
interface Scheduled { node: AudioBufferSourceNode; gain: GainNode; entry: SaidLine; start: number; end: number }

interface Speaking {
  call: DuelCall;
  cancelled: boolean;
  scheduled: Scheduled[];
}

/**
 * THE DUEL'S ANNOUNCER: an arcade cabinet's voice (a sports-arena announcer, every call shouted fast;
 * scripts/audio/gen-duel-announcer.mjs) and its sounds, for the Duel only. The descent's narrator
 * keeps out of the arena (audio/arenaAudio inArena); this is the one that talks here.
 *
 * It listens, never polls: the select screen's session (`versusChanged`: Choose your fighter, a
 * fighter's or stage's name the moment it is chosen, a player locking in, a challenger's coin, and the
 * VS card as the match loads), the stock match's beats (`stockMatchBeat`: Three, Two, One on the
 * countdown's own beats, FIGHT, GAME or TIME and the winner on the HUD's banner), a ring-out
 * (`fighterDown`: the KO blast, Ring out / K.O. / Self-destruct, Last stock), an ultimate
 * (`stockUltimate`: the super sting and its name) and a broken shield. audio/duelCalls decides.
 *
 * Every call is laid on the AudioContext's clock the moment it is made, all its lines at once: the VS
 * card's names keep their timing while the stage build blocks the main thread, and the winner's name
 * lands on the banner's beat. One call at a time on the engine's `voice` bus, ducking the score while
 * it talks. A call cuts the one in progress when it ranks as high (a new name cuts the last one: the
 * player cycles fast); a lower one is not made, but its sound still plays. The screens' own menu
 * sounds come through `menu()` (ctx.audio.duel).
 */
export class DuelAnnouncer implements DuelAudioApi {
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** Clips already decoded: a call made of these is scheduled synchronously, before anything can block. */
  private readonly decoded = new Map<string, AudioBuffer>();
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
  private lastVersus = { key: '', at: -Infinity };

  constructor(private readonly ctx: Ctx, private readonly host: StreamHost, private readonly clips: Readonly<Record<string, { readonly url: string }>> = DUEL_CLIPS) {
    const on: typeof ctx.events.on = (event, handler) => ctx.events.on(event, failSafe(`DuelAnnouncer on ${String(event)}`, handler));
    this.offs.push(
      on('versusChanged', () => this.onVersus()),
      on('arenaReset', () => this.onReset()),
      on('stockMatchBeat', (beat) => this.onBeat(beat)),
      on('fighterDown', (ev) => this.onDown(ev)),
      on('stockUltimate', ({ fighter }) => { if (this.ctx.arena?.stockMatch) this.call(ultimateCall(fighter)); }),
      on('stockShieldBreak', () => { if (this.ctx.arena?.stockMatch) this.call(shieldBreakCall()); }),
    );
  }

  /* ---------------- the screens' API ---------------- */

  menu(kind: DuelMenuSound): void {
    this.sfx(MENU[kind]);
  }

  announceFighter(id: FighterId): void {
    this.call({ steps: [{ line: duelFighterLine(id) }], priority: DUEL_PRIORITY.select, lobbyOnly: true });
  }

  announceStage(id: StockStageId): void {
    this.call({ steps: [{ line: duelStageLine(id) }], priority: DUEL_PRIORITY.select, lobbyOnly: true });
  }

  announceVersus(p1: FighterId, p2: FighterId): void {
    const key = `${p1}|${p2}`, now = performance.now();
    if (key === this.lastVersus.key && now - this.lastVersus.at < VERSUS_REPEAT_MS) return;
    this.lastVersus = { key, at: now };
    this.call(versusCall(p1, p2));
  }

  cutVersus(): void {
    if (this.speaking?.call.tag !== 'versus') return;
    this.cut(SKIP_FADE_S);
    this.duck(false);
  }

  /* ---------------- the moments ---------------- */

  private onVersus(): void {
    const v = this.ctx.versus;
    if (!v) return;
    const next = lobbyView(v);
    if (next.phase === 'lobby' && this.lobby?.phase !== 'lobby') this.preload(['select']);
    if (next.phase === 'loading' || next.phase === 'playing') this.preload(['match', 'result']);
    // A new screen (the select screen opening, or READY starting a match): what the last screen was saying
    // ("<Name> wins!" as Change fighters is pressed) gives way, and a match started from the select screen
    // is a new one, not a rematch (QA: it opened with "Rematch!" and lost "Choose your fighter!" and the VS call).
    if ((next.phase === 'lobby' || next.phase === 'loading') && this.lobby?.phase !== next.phase) {
      this.finished = false;
      // The VS repeat guard is for one load: a lobby opening starts the next.
      if (next.phase === 'lobby') this.lastVersus = { key: '', at: -Infinity };
      if (this.speaking) { this.cut(); this.duck(false); }
    }
    const calls = lobbyCalls(this.lobby, next);
    if (calls.length) this.call({ steps: calls.flatMap((c) => c.steps), priority: Math.max(...calls.map((c) => c.priority)), lobbyOnly: true });
    // READY pressed: the VS card is up while the stage builds.
    if (next.phase === 'loading' && this.lobby?.phase === 'lobby') this.announceVersus(next.seats[0].fighter, next.seats[1].fighter);
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
    this.finished = beat.state === 'finished';
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
    if (!call.steps.some((s) => s.line) || document.hidden || !this.host.streamContext() || this.closedLobby(call)) return;
    const current = this.speaking;
    if (current) {
      if (call.priority < current.call.priority) return;
      // The same name asked for again (a cursor's preview, then the choice): it is already being said.
      if (call.steps.length === 1 && current.call.steps.length === 1 && call.steps[0].line === current.call.steps[0].line && !call.steps[0].sfx) return;
      this.cut();
    }
    const me: Speaking = { call, cancelled: false, scheduled: [] };
    this.speaking = me;
    const lines = call.steps.flatMap((s) => (s.line && this.clips[s.line] ? [s.line] : []));
    if (lines.every((l) => this.decoded.has(l))) { this.schedule(me); return; }
    // Still loading (a cold page): lay the call down once its clips are in, if its moment has not passed.
    const ac = this.host.streamContext()!, asked = performance.now();
    void Promise.all(lines.map((l) => this.buffer(ac, l))).then(() => {
      if (me.cancelled || this.speaking !== me) return;
      if (performance.now() - asked > STALE_MS || this.closedLobby(call)) { this.finish(me); return; }
      this.schedule(me);
    });
  }

  /** A select-screen call whose lobby has closed (the match is loading): not made. */
  private closedLobby(call: DuelCall): boolean {
    return call.lobbyOnly === true && !!this.ctx.versus && this.ctx.versus.phase !== 'lobby';
  }

  /** Lay every line (and every later step's sound) of the call on the audio clock, now. */
  private schedule(me: Speaking): void {
    const ac = this.host.streamContext(), bus = this.host.streamBus('voice');
    if (!ac || !bus) { this.finish(me); return; }
    const t0 = ac.currentTime + 0.01, nowMs = performance.now();
    const clockToMs = (t: number): number => Math.round(nowMs + (t - ac.currentTime) * 1000);
    let prevEnd = t0;
    me.call.steps.forEach((step, i) => {
      const start = step.atMs !== undefined ? t0 + step.atMs / 1000 : i === 0 ? t0 : prevEnd + LINE_GAP_MS / 1000;
      if (i > 0 && step.sfx) this.sfx(step.sfx, Math.max(0, start - ac.currentTime));
      const buffer = step.line ? this.decoded.get(step.line) : undefined;
      if (!step.line || !buffer) { prevEnd = Math.max(prevEnd, start); return; }
      // A line with its own beat cuts the one before it short rather than waiting for it.
      const last = me.scheduled.at(-1);
      if (last && last.end > start) {
        last.gain.gain.setValueAtTime(1, Math.max(last.start, start - CUT_FADE_S));
        last.gain.gain.linearRampToValueAtTime(0, start);
        last.node.stop(start + 0.01);
        last.end = start;
      }
      const node = ac.createBufferSource();
      node.buffer = buffer;
      const gain = ac.createGain();
      node.connect(gain);
      gain.connect(bus);
      const entry: SaidLine = { line: step.line, at: clockToMs(start) };
      const s: Scheduled = { node, gain, entry, start, end: start + buffer.duration };
      node.onended = () => { node.disconnect(); gain.disconnect(); entry.ended ??= Math.round(performance.now()); this.ended(me); };
      node.start(start);
      me.scheduled.push(s);
      this.log(this.said, entry);
      prevEnd = s.end;
    });
    if (me.scheduled.length === 0) { this.finish(me); return; }
    this.duck(true);
  }

  /** A line of the call ended: the call is over once the last of its lines has. */
  private ended(me: Speaking): void {
    if (me.scheduled.every((s) => s.entry.ended !== undefined)) this.finish(me);
  }

  private finish(me: Speaking): void {
    if (this.speaking !== me) return;
    this.speaking = null;
    this.duck(false);
  }

  /** Stop the call in progress quickly (a newer call has the floor); its lines not yet begun are never said. */
  private cut(fadeS = CUT_FADE_S): void {
    const s = this.speaking;
    if (!s) return;
    s.cancelled = true;
    this.speaking = null;
    const ac = this.host.streamContext();
    const t = ac?.currentTime ?? 0;
    for (const line of s.scheduled) {
      if (line.entry.ended !== undefined) continue;
      if (line.start > t) {
        // Never begun: it was not said.
        const i = this.said.indexOf(line.entry);
        if (i >= 0) this.said.splice(i, 1);
        line.entry.ended = line.entry.at;
        try { line.node.stop(); } catch { /* not started */ }
        continue;
      }
      line.entry.cut = true;
      line.entry.ended = Math.round(performance.now());
      try {
        line.gain.gain.cancelScheduledValues(t);
        line.gain.gain.setValueAtTime(line.gain.gain.value, t);
        line.gain.gain.linearRampToValueAtTime(0, t + fadeS);
        line.node.stop(t + fadeS + 0.01);
      } catch { /* already stopped */ }
    }
  }

  private stop(): void {
    this.cut();
    this.duck(false);
  }

  private sfx(id: SfxId, delay = 0): void {
    this.ctx.audio.sfx(id, undefined, undefined, delay > 0 ? { delay } : undefined);
    this.log(this.sounds, { sfx: id, at: Math.round(performance.now() + delay * 1000) });
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
        .then((decoded) => { this.decoded.set(line, decoded); return decoded; })
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
    const ac = this.host.streamContext(), t = ac?.currentTime ?? 0;
    const now = this.speaking?.scheduled.find((s) => s.entry.ended === undefined && s.start <= t && t < s.end);
    return {
      speaking: now?.entry.line ?? null,
      busy: this.speaking !== null,
      said: this.said.map((s) => ({ ...s, line: s.line, group: LINE_GROUP.get(s.line) })),
      sounds: this.sounds.map((s) => ({ ...s })),
      talking: this.talking,
      lobby: this.lobby?.phase ?? null,
      clips: Object.keys(this.clips).length,
      buffers: this.buffers.size,
      decoded: this.decoded.size,
    };
  }
}
