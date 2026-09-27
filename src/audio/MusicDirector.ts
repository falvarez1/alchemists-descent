import type { Ctx, MusicApi } from '@/core/types';
import type { StreamHost } from '@/audio/streamHost';
import type { ScoreTrack } from '@/content/audio/scoreTypes';
import { SCORE_TRACKS } from '@/content/audio/score.generated';
import { TEA_COMPLETE_STAGE } from '@/world/teaMachine';
import { failSafe } from '@/audio/failSafe';
import { equalPowerRamp } from '@/audio/paramRamps';
import {
  BossGate, TensionGate, bossAlive, chooseCue, cueLevel, dipFor, engagedBoss, fadeSeconds,
  floorForLevel, inDeepDark, loopFadeSeconds, phaseDipActive, rampValue, threatScore, type DirectorInput, type Ramp, type Verdict,
} from '@/audio/musicRules';

/** How often the director looks at the world (ms). Crossfades are scheduled on the audio clock, not this. */
const TICK_MS = 250;
/** The verdict waits for the procedural stinger to speak first (audio/Stingers). */
const VERDICT_DELAY_MS: Record<Verdict, number> = { victory: 2300, fallen: 1500 };
/** A calm cue resumes where it left off if it comes back within this long (hunted → calm keeps the floor's place). */
const RESUME_WINDOW_MS = 90_000;

/** One playing copy of a track: a streamed media element on its own gain. */
interface Voice {
  track: ScoreTrack;
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  gain: GainNode;
  ramp: Ramp;
  /** Scheduled to stop (fading out); no longer the current cue's voice. */
  stopping: boolean;
  /** Its loop crossfade has already been started. */
  wrapped: boolean;
  started: boolean;
  /** Where it was asked to start (s). */
  offset: number;
}

/**
 * The music director (Breathing Works score). A small state machine over the
 * game's own facts: the title theme on the entrance, each floor's exploration
 * cue crossfading to its same-key "hunted" layer while a creature is actively
 * hunting nearby (creatures/perception intent), the boss themes while a boss
 * is awake and engaged, the Sanctum between floors, the Tea Engine cue while
 * the engine runs, the Workshop cue in the material sandbox, and the victory
 * or fallen verdict when a run ends.
 *
 * - Nothing plays, and nothing is fetched, before the first user gesture.
 * - Tracks stream through media elements (a 3-minute cue decoded would hold
 *   ~60 MB of PCM; streamed it holds a few hundred KB) into the engine's
 *   `music` bus, so the sliders, the narrator duck and the limiter all apply.
 * - Every change is a scheduled equal-power crossfade on the audio clock;
 *   loops wrap by crossfading their tail into their head at measured points
 *   (score.generated.ts headSec/tailSec), never by a gapless-MP3 jump.
 * - A hidden tab fades out and pauses; showing it again resumes and fades in.
 * - Fail-safe: its listeners, timers and ramps can never throw into the game
 *   (audio/failSafe), and its fades are overlap-proof linear segments
 *   (audio/paramRamps) — a stale or frozen audio clock (a suspended context, a
 *   blocked main thread, a hidden tab) cannot make two of them collide.
 */
export class MusicDirector implements MusicApi {
  private readonly tracks = new Map<string, ScoreTrack>();
  private readonly voices: Voice[] = [];
  private readonly tension = new TensionGate();
  private readonly bossGate = new BossGate();
  private readonly disposers: Array<() => void> = [];
  private readonly resumeAt = new Map<string, { pos: number; at: number }>();
  private readonly log: Array<{ at: number; from: string | null; to: string | null; fade: number }> = [];
  private timer: number | null = null;
  private master: GainNode | null = null;
  private masterCtx: AudioContext | null = null;
  private masterRamp: Ramp = { from: 1, to: 1, t0: 0, t1: 0 };
  private masterTarget = 1;
  private current: string | null = null;
  private gestured = false;
  private hiddenPaused = false;
  private verdict: { id: Verdict; startAt: number; playing: boolean; done: boolean } | null = null;
  private teaActive = false;
  private ledgerOpen = false;
  private playerDead = false;
  private previewUntil = 0;
  private lastThreat = 0;
  /** The alchemist is in a deep-dark zone (hysteresis: musicRules.inDeepDark). */
  private dark = false;
  /** Each living boss's phase as last seen, and when one last broke into a new phase. */
  private readonly bossPhase = new WeakMap<object, number>();
  private phaseAt = -Infinity;

  constructor(private readonly ctx: Ctx, private readonly host: StreamHost, tracks: readonly ScoreTrack[] = SCORE_TRACKS) {
    for (const t of tracks) this.tracks.set(t.id, t);
    // Every listener runs fail-safe: the director is reached from inside the game tick
    // (a playerDied emit), and a sound must never abort the tick that asked for it.
    const on: typeof ctx.events.on = (event, handler) => ctx.events.on(event, failSafe(`MusicDirector on ${String(event)}`, handler));
    this.disposers.push(
      on('runEnded', ({ outcome }) => {
        if (outcome !== 'victory' && outcome !== 'fallen') return;
        this.verdict = { id: outcome, startAt: performance.now() + VERDICT_DELAY_MS[outcome], playing: false, done: false };
        this.update();
      }),
      on('runLedger', ({ open }) => {
        this.ledgerOpen = open;
        // Leaving the ledger (descend again, or the title) is the end of the verdict too.
        if (!open && this.verdict) this.verdict.done = true;
        this.update();
      }),
      on('contraptionView', ({ visible, stage, stalled }) => {
        const active = visible && stage > 0 && stage < TEA_COMPLETE_STAGE && !stalled;
        if (active !== this.teaActive) { this.teaActive = active; this.update(); }
      }),
      on('playerDied', () => { this.playerDead = true; this.update(); }),
      on('playerRespawned', () => { this.playerDead = false; this.update(); }),
      on('playerDeathCleared', () => { this.playerDead = false; this.update(); }),
      on('levelChanged', () => { this.tension.reset(); this.bossGate.reset(); this.teaActive = false; this.dark = false; this.phaseAt = -Infinity; this.update(); }),
      on('modeChanged', () => this.update()),
    );
    // Autoplay policy: the first real gesture unlocks the score (and the engine's context with it).
    const gesture = failSafe('MusicDirector gesture', () => this.onGesture());
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(type, gesture, { capture: true });
    this.disposers.push(() => { for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(type, gesture, { capture: true }); });
    const look = failSafe('MusicDirector update', () => this.update());
    document.addEventListener('visibilitychange', look);
    this.disposers.push(() => document.removeEventListener('visibilitychange', look));
    this.timer = window.setInterval(look, TICK_MS);
  }

  /** The cue playing (or fading in) now. */
  get cue(): string | null { return this.current; }

  /** A settings slider moved: let the score be heard for a few seconds even if nothing else is playing. */
  preview(): void {
    this.previewUntil = performance.now() + 4000;
    this.update();
  }

  dispose(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const v of this.voices.splice(0)) this.release(v);
    this.master?.disconnect();
    this.master = null;
  }

  private onGesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    // Inside the gesture: create/resume the engine's context. The score starts on the next look.
    this.host.ensure();
    queueMicrotask(failSafe('MusicDirector update', () => this.update()));
  }

  private track(id: string): ScoreTrack | undefined { return this.tracks.get(id); }

  /* ---------------- the look: what does this moment want? ---------------- */

  private input(now: number): DirectorInput {
    const ctx = this.ctx, body = document.body.classList;
    const player = ctx.player;
    const play = ctx.state.mode === 'play';
    const enemies = play && ctx.enemies ? ctx.enemies : [];
    this.lastThreat = play && !player.dead ? threatScore(enemies, player.x, player.y) : 0;
    const tension = this.tension.update(this.lastThreat, now);
    const engaged = play && !player.dead ? engagedBoss(enemies, player.x, player.y) : null;
    const boss = this.bossGate.update(engaged, kind => bossAlive(enemies, kind), now);
    // A boss breaking into a new phase (its roar, its armour bursting): the score holds its breath.
    for (const e of enemies) {
      if (!e.boss || e.hp <= 0) continue;
      const seen = this.bossPhase.get(e);
      if (seen !== undefined && e.boss.phase > seen && boss !== null) this.phaseAt = now;
      this.bossPhase.set(e, e.boss.phase);
    }
    // The deep dark thins the floor's calm cue (the light wave's zones: the same thresholds).
    const q = play && !player.dead ? ctx.lightQuery : undefined;
    this.dark = q ? inDeepDark(this.dark, q.darkness(player.x, player.y - 9)) : false;
    const level = ctx.levels?.current;
    let verdict: Verdict | null = null, verdictPending = false;
    if (this.verdict && !this.verdict.done) {
      if (now < this.verdict.startAt) verdictPending = true;
      else verdict = this.verdict.id;
    }
    return {
      gestured: this.gestured,
      soundOn: this.host.streamContext() !== null,
      verdict, verdictPending,
      builderOpen: body.contains('builder-open'),
      entryActive: body.contains('entry-active'),
      ledgerOpen: this.ledgerOpen,
      sanctumOpen: ctx.sanctum?.isOpen === true,
      mode: play ? 'play' : 'build',
      runOver: ctx.run?.over === true,
      teaActive: this.teaActive,
      boss,
      floor: level ? floorForLevel(level.def.id, level.def.biome) : null,
      tension,
      preview: now < this.previewUntil,
    };
  }

  /** One look at the world: pick the cue, crossfade if it changed, keep loops wrapping, set the overall level. */
  update(): void {
    const now = performance.now();
    const ac = this.host.streamContext();
    const bus = this.host.streamBus('music');
    if (!ac || !bus) {
      // Sound switched off (or no gesture yet): drop everything at once; it resumes from the top later.
      if (this.voices.length > 0) for (const v of this.voices.splice(0)) this.release(v);
      this.current = null;
      return;
    }
    if (this.masterCtx !== ac || !this.master) {
      this.master?.disconnect();
      this.master = ac.createGain();
      this.master.gain.value = 0;
      this.master.connect(bus);
      this.masterCtx = ac;
      this.masterRamp = { from: 0, to: 0, t0: ac.currentTime, t1: ac.currentTime };
      this.masterTarget = -1;
    }

    const hidden = document.hidden;
    const i = this.input(now);
    const sincePhaseMs = now - this.phaseAt;
    const dip = dipFor({
      hidden, paused: this.ctx.state.paused, playerDead: this.playerDead || this.ctx.player.dead, ledgerOpen: this.ledgerOpen, mode: i.mode,
      dark: this.dark, cue: this.current, sincePhaseMs,
    });
    // Under a phase roar the score drops at once and swells back over the usual glide; the dark thins slowly.
    this.setMaster(ac, dip, hidden ? 0.3 : phaseDipActive(sincePhaseMs) ? 0.2 : this.dark ? 2.5 : 1.2);
    if (hidden) {
      if (!this.hiddenPaused) {
        this.hiddenPaused = true;
        window.setTimeout(() => { if (document.hidden) for (const v of this.voices) v.el.pause(); }, 350);
      }
      return;
    }
    if (this.hiddenPaused) {
      this.hiddenPaused = false;
      for (const v of this.voices) if (v.started) void v.el.play().catch(() => undefined);
    }

    const want = chooseCue(i);
    if (want !== this.current) this.transition(ac, this.current, want);
    this.maintain(ac, now);
  }

  private setMaster(ac: AudioContext, target: number, seconds: number): void {
    if (Math.abs(target - this.masterTarget) < 1e-3 || !this.master) return;
    const t = ac.currentTime, from = rampValue(this.masterRamp, t);
    this.masterTarget = target;
    this.masterRamp = { from, to: target, t0: t, t1: t + seconds };
    this.schedule(this.master.gain, from, target, t, seconds);
  }

  /**
   * Equal-power ramp on the audio clock, as linear segments (audio/paramRamps):
   * a value curve here could overlap one scheduled from a stale clock reading
   * and throw inside whichever listener asked for the fade.
   */
  private schedule(param: AudioParam, from: number, to: number, t: number, seconds: number): void {
    equalPowerRamp(param, from, to, t, seconds);
  }

  private transition(ac: AudioContext, from: string | null, to: string | null): void {
    const fade = fadeSeconds(from, to);
    const now = performance.now();
    this.log.push({ at: Math.round(now), from, to, fade });
    if (this.log.length > 24) this.log.shift();
    // The outgoing voices stop counting as current now, but only begin to fade
    // when the incoming one actually sounds: both ramps then share one clock,
    // and the equal-power law holds (no hole while the first bytes arrive).
    const outgoing = this.voices.filter(v => !v.stopping);
    for (const v of outgoing) v.stopping = true;
    let faded = false;
    const fadeOutgoing = (): void => {
      if (faded) return;
      faded = true;
      for (const v of outgoing) this.fadeOut(ac, v, fade);
    };
    this.current = to;
    if (to === 'victory' || to === 'fallen') { if (this.verdict) this.verdict.playing = true; }
    const track = to ? this.track(to) : undefined;
    this.ctx.events.emit('musicCue', { cue: to, previous: from });
    if (!track) { fadeOutgoing(); return; }
    const resume = this.resumeAt.get(track.id);
    const offset = track.loop && resume && now - resume.at < RESUME_WINDOW_MS && resume.pos < track.seconds - track.tailSec - 12 ? resume.pos : track.headSec;
    this.start(ac, track, offset, fade, fadeOutgoing);
    // A stream that will not start must not hold the old cue forever.
    window.setTimeout(fadeOutgoing, 1500);
  }

  private start(ac: AudioContext, track: ScoreTrack, offset: number, fade: number, onSounding?: () => void): void {
    const el = new Audio();
    el.preload = 'auto';
    el.src = `${import.meta.env.BASE_URL}${track.url}`;
    try { el.currentTime = offset; } catch { /* set again once metadata arrives */ }
    el.addEventListener('loadedmetadata', () => { if (Math.abs(el.currentTime - offset) > 0.5 && el.currentTime < 0.5) el.currentTime = offset; }, { once: true });
    const src = ac.createMediaElementSource(el);
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(this.master!);
    const level = cueLevel(track.id);
    const voice: Voice = { track, el, src, gain, ramp: { from: 0, to: 0, t0: ac.currentTime, t1: ac.currentTime }, stopping: false, wrapped: false, started: false, offset };
    this.voices.push(voice);
    el.addEventListener('ended', failSafe('MusicDirector ended', () => {
      if (voice.track.id === 'victory' || voice.track.id === 'fallen') { if (this.verdict && this.verdict.id === voice.track.id) this.verdict.done = true; }
      this.drop(voice);
      this.update();
    }));
    // The fade starts when sound actually flows, so a slow first byte never becomes a gap in the crossfade.
    void el.play().then(() => {
      voice.started = true;
      if (voice.stopping) return;
      const t = ac.currentTime;
      voice.ramp = { from: 0, to: level, t0: t, t1: t + fade };
      this.schedule(gain.gain, 0, level, t, fade);
      onSounding?.();
    }).catch(() => {
      // Autoplay refused or the file is missing: stay silent rather than retry in a loop.
      this.drop(voice);
      onSounding?.();
    });
  }

  private fadeOut(ac: AudioContext, v: Voice, fade: number): void {
    v.stopping = true;
    if (!this.voices.includes(v)) return; // already gone
    const t = ac.currentTime, from = rampValue(v.ramp, t);
    if (v.track.loop && v.started) this.resumeAt.set(v.track.id, { pos: v.el.currentTime + fade, at: performance.now() });
    v.ramp = { from, to: 0, t0: t, t1: t + fade };
    this.schedule(v.gain.gain, from, 0, t, fade);
    window.setTimeout(() => this.drop(v), fade * 1000 + 150);
  }

  /** Loops: when the current voice reaches its way out, a fresh copy enters at the head and they crossfade. */
  private maintain(ac: AudioContext, now: number): void {
    for (const v of [...this.voices]) {
      if (v.stopping || v.wrapped || !v.started || !v.track.loop || v.track.id !== this.current) continue;
      const fade = loopFadeSeconds(v.track.id);
      const duration = Number.isFinite(v.el.duration) && v.el.duration > 0 ? v.el.duration : v.track.seconds;
      const out = duration - v.track.tailSec;
      if (v.el.currentTime < out - fade - 0.3) continue;
      v.wrapped = true;
      v.stopping = true;
      this.log.push({ at: Math.round(now), from: v.track.id, to: v.track.id, fade });
      this.resumeAt.delete(v.track.id);
      let faded = false;
      const fadeOld = (): void => { if (!faded) { faded = true; this.fadeOut(ac, v, fade); } };
      this.start(ac, v.track, v.track.headSec, fade, fadeOld);
      window.setTimeout(fadeOld, 1500);
    }
  }

  private drop(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    this.release(v);
  }

  private release(v: Voice): void {
    try { v.el.pause(); } catch { /* already gone */ }
    v.el.removeAttribute('src');
    try { v.el.load(); } catch { /* detached */ }
    v.src.disconnect();
    v.gain.disconnect();
  }

  /* ---------------- probing ---------------- */

  /** Read-only view for in-page probes (`window.__game.ctx.music.debugSnapshot()`). */
  debugSnapshot(): Record<string, unknown> {
    const ac = this.masterCtx;
    const t = ac?.currentTime ?? 0;
    return {
      cue: this.current,
      gestured: this.gestured,
      hidden: this.hiddenPaused,
      threat: this.lastThreat,
      tension: this.tension.tense,
      dark: this.dark,
      sincePhaseMs: Number.isFinite(this.phaseAt) ? Math.round(performance.now() - this.phaseAt) : null,
      verdict: this.verdict ? { ...this.verdict } : null,
      teaActive: this.teaActive,
      master: ac ? rampValue(this.masterRamp, t) : null,
      masterTarget: this.masterTarget,
      voices: this.voices.map(v => ({
        id: v.track.id, gain: rampValue(v.ramp, t), target: v.ramp.to, time: v.el.currentTime, offset: v.offset, paused: v.el.paused,
        stopping: v.stopping, started: v.started, wrapped: v.wrapped,
      })),
      transitions: this.log.map(e => ({ ...e })),
    };
  }
}
