import type { Ctx, NarratorApi } from '@/core/types';
import type { StorySpeakOptions, StorySpeaker, StorySpokenLine } from '@/core/story';
import type { StreamHost } from '@/audio/streamHost';
import type { NarrationClip } from '@/content/audio/narrationTypes';
import { NARRATION_CLIPS } from '@/content/audio/narration.generated';
import { arrivalLine, narrationKey, readingSeconds, speakerKey } from '@/audio/narrationText';
import { NARRATION_LINE_GAP_MS, NarrationGate, type NarrationPriority } from '@/audio/narrationRules';
import { GAME_TAGLINE } from '@/config/brand';
import { FLOOR_LOOKS } from '@/config/floorLooks';
import { LEVELS, floorDisplayName, floorOf, nextDoors } from '@/config/worldgraph';
import { FLOOR_LORE, TWO_DOORS_LINE } from '@/content/floorLore';

/** The second doors' guardians, by the name that rises over them as they wake → their floor's lore. */
const GUARDIAN_NAMES: Readonly<Record<string, string>> = { 'THE RIME WARDEN': 'd2b', 'THE LENSWRIGHT': 'd3b' };
import { TEA_COMPLETE_STAGE } from '@/world/teaMachine';
import { deathLineFor, deathTitle } from '@/ui/deathCauses';
import { runHeadline } from '@/game/runRules';
import { failSafe } from '@/audio/failSafe';

/** The HUD reveals a floor's title card this long after the curtain lifts (ui/Hud), or after this fallback. */
const TITLE_CARD_AFTER_CURTAIN_MS = 120;
const TITLE_CARD_FALLBACK_MS = 1600;
/** Never over a title card's first second. */
const AFTER_TITLE_CARD_MS = 1100;
/** On a level change what was speaking fades over this (s) rather than clicking off. */
const LEVEL_CHANGE_FADE_S = 0.45;
/** The title card's span after a level change (curtain, rise, 3.6 s hold): only high lines speak. */
const TITLE_QUIET_MS = 6000;
/** Decoded clips kept (a clip is a few seconds of mono: a dozen stay under ~8 MB). */
const BUFFER_CACHE = 12;
/** A fetch this slow means the moment has passed. */
const STALE_FETCH_MS = 2500;

interface Utterance {
  keys: string[];
  texts: string[];
  priority: NarrationPriority;
  source: string;
  /** Wall time after which the moment has passed and the line is not started. */
  expiresAt: number;
  /** STORY: each line's speaker (the caption's name plate). */
  speakers?: Array<StorySpeaker | undefined>;
  /** STORY: lines with no recording (or with the voice off) — their caption holds for a reading time instead. */
  silent?: boolean[];
  /** STORY: force the caption on (lines with no text of their own on screen). */
  captioned?: boolean;
}

interface Speaking {
  u: Utterance;
  index: number;
  node: AudioBufferSourceNode | null;
  gain: GainNode | null;
  cancelled: boolean;
  /** A silent line's wait, released early by a cut. */
  wake?: () => void;
}

/**
 * The narrator: a wry old docent of the refinery, voicing the lines the game
 * already shows (the title tagline, a floor's arrival, the Sanctum's look
 * below, the Tea Engine's acts and faults, a death's title and cause, the
 * ledger's verdict, a new case on the rack, a boss's name and its phase
 * beats). It listens to the
 * same events the UI does and looks each text up by narrationKey: a line with
 * no recording is simply not spoken.
 *
 * Sparing by rule (audio/narrationRules): one line at a time, a cooldown,
 * never the same words twice a session, and never over a title card's first
 * second. It speaks on the engine's `voice` bus, ducks the score and the
 * cave's bed while it talks, and respects the Narration setting.
 */
export class Narrator implements NarratorApi {
  private readonly gate = new NarrationGate();
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly disposers: Array<() => void> = [];
  private readonly timers = new Set<number>();
  private readonly queue: Utterance[] = [];
  private readonly spoken: Array<{ text: string; at: number; priority: NarrationPriority; source: string }> = [];
  private speaking: Speaking | null = null;
  private on = true;
  private death: { title: string; line: string } | null = null;
  private arrival: { text: string; timer: number } | null = null;
  private teaView = '';
  private sanctumWasOpen = false;
  /** The Sanctum door last spoken for (the branching descent reads the chosen floor's line). */
  private doorSpoken: string | null = null;
  private lastPreview = 0;
  private talking = false;
  /** No low/normal line while a floor's title card is up (performance.now ms). */
  private titleQuietUntil = 0;

  constructor(private readonly ctx: Ctx, private readonly host: StreamHost, private readonly clips: Readonly<Record<string, NarrationClip>> = NARRATION_CLIPS) {
    // Fail-safe listeners: the narrator hears playerDied, toasts and callouts from inside the game tick.
    const on: typeof ctx.events.on = (event, handler) => ctx.events.on(event, failSafe(`Narrator on ${String(event)}`, handler));
    this.disposers.push(
      on('musicCue', ({ cue, previous }) => this.onCue(cue, previous)),
      on('levelChanged', () => this.onLevelChanged()),
      on('levelCurtain', ({ visible, holdMs = 0 }) => {
        if (visible || !this.arrival) return;
        this.scheduleArrival(holdMs + TITLE_CARD_AFTER_CURTAIN_MS + AFTER_TITLE_CARD_MS);
      }),
      on('contraptionView', view => this.onTeaView(view)),
      on('playerDied', ({ cause }) => {
        // The same line the death screen, the ledger and the clip card use: one pick per death (ui/deathCauses).
        this.death = { title: deathTitle(cause), line: deathLineFor(cause, ctx.state.frameCount) };
      }),
      on('deathCinema', ({ phase }) => {
        if (phase !== 'title' || !this.death) return;
        const { title, line } = this.death;
        this.death = null;
        this.later(AFTER_TITLE_CARD_MS, () => this.say([title, line], 'high', 'death', 6000));
      }),
      on('runLedger', ({ open }) => {
        // A line belongs to its screen: leaving the ledger ends its reading.
        if (!open) { this.cutSource('ledger'); return; }
        const summary = ctx.run?.lastResult?.summary;
        if (summary) this.later(1000, () => this.say([runHeadline(summary), summary.epitaph], 'high', 'ledger', 6000));
      }),
      on('playerRespawned', () => this.cutSource('death')),
      on('toast', ({ text }) => this.say([text], 'normal', 'toast', 2500)),
      // A boss's phase beat (THE CORE IS BARE, SHORTED): only callouts with a recording are said.
      on('combatCallout', ({ text }) => {
        // The second doors' guardians have no boss cue of their own (they fight to
        // the floor's hunted cue): their name rising over them is the moment.
        const floor = GUARDIAN_NAMES[text];
        const lore = floor ? FLOOR_LORE[floor] : undefined;
        if (lore) this.later(700, () => this.say([lore.resident], 'high', 'boss', 5000));
        else this.say([text], 'normal', 'callout', 2000);
      }),
      on('objectiveChanged', ({ text }) => this.say([text], 'low', 'objective', 2500)),
    );
    const visibility = failSafe('Narrator visibility', () => { if (document.hidden) this.silence(true); });
    document.addEventListener('visibilitychange', visibility);
    this.disposers.push(() => document.removeEventListener('visibilitychange', visibility));
    // The Sanctum has no event of its own; a light look at its state is enough.
    const poll = window.setInterval(failSafe('Narrator sanctum', () => this.watchSanctum()), 300);
    this.disposers.push(() => window.clearInterval(poll));
  }

  get enabled(): boolean { return this.on; }

  /** Something is being said, or waits its turn. */
  get busy(): boolean { return this.speaking !== null || this.queue.length > 0; }

  /** Whose line is being said right now (its source tag), or null. */
  get speakingSource(): string | null { return this.speaking?.u.source ?? null; }

  /**
   * STORY lines (the Docent's pipes, Pell, Matron Ash, an echo, a prologue):
   * speaker-tagged, gated by the story director (never by "heard this
   * session"), and never over another line — a line that outranks what is
   * speaking cuts it, anything else waits its turn (up to three waiting).
   * A line with no recording, or with the Narration setting off, still runs
   * silently for its reading time so its caption shows; only a hidden tab
   * drops it.
   */
  speak(lines: readonly StorySpokenLine[], opts: StorySpeakOptions): boolean {
    if (document.hidden) return false;
    const list = lines.filter(l => l.text.trim());
    if (list.length === 0) return false;
    const voiced = this.on && this.host.streamContext() !== null;
    const now = performance.now();
    const u: Utterance = {
      keys: list.map(l => speakerKey(l.speaker, l.text)),
      texts: list.map(l => l.text),
      priority: opts.priority,
      source: opts.source,
      expiresAt: now + (opts.ttlMs ?? 6000),
      speakers: list.map(l => l.speaker),
      silent: list.map(l => !voiced || !this.clips[speakerKey(l.speaker, l.text)]),
      captioned: opts.captioned,
    };
    const rank = { low: 0, normal: 1, high: 2 } as const;
    if (this.speaking) {
      if (rank[opts.priority] > rank[this.speaking.u.priority]) this.cut();
      else if (this.queue.length < 3) { this.queue.push(u); return true; }
      else return false;
    }
    void this.run(u);
    return true;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.silence(true);
  }

  /** The Voice slider's preview: one short line at the level just chosen (throttled; ignores the manners). */
  preview(): void {
    const now = performance.now();
    if (now - this.lastPreview < 1500 || this.speaking) return;
    this.lastPreview = now;
    const key = narrationKey('Please mind the duck') in this.clips ? narrationKey('Please mind the duck') : Object.keys(this.clips)[0];
    if (!key) return;
    void this.playOne({ keys: [key], texts: ['Please mind the duck'], priority: 'high', source: 'preview', expiresAt: now + 3000 }, key, false);
  }

  dispose(): void {
    this.silence(true);
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    for (const d of this.disposers.splice(0)) d();
  }

  /* ---------------- the moments ---------------- */

  private onCue(cue: string | null, previous: string | null): void {
    if (cue === 'title' && previous !== 'title' && document.body.classList.contains('entry-active')) {
      // After the theme has opened, and only while the entrance is still up.
      this.later(3500, () => { if (document.body.classList.contains('entry-active')) this.say([GAME_TAGLINE], 'normal', 'title', 4000); });
    } else if (cue === 'workshop' && previous !== 'workshop') {
      const note = document.querySelector('[data-entry="workshop"] .entry-note')?.textContent;
      const inWorkshop = (): boolean => this.ctx.state.mode !== 'play' && !document.body.classList.contains('entry-active');
      if (note) this.later(1500, () => this.say([note], 'normal', 'workshop', 12000, inWorkshop));
    } else if (cue === 'boss-leviathan' || cue === 'boss-colossus') {
      const lore = FLOOR_LORE[cue === 'boss-leviathan' ? 'd3' : 'd4'];
      if (lore) this.later(700, () => this.say([lore.resident], 'high', 'boss', 5000));
    }
  }

  private onLevelChanged(): void {
    if (this.arrival) window.clearTimeout(this.arrival.timer);
    this.arrival = null;
    // A new floor's title card has the air: whatever was still being said on the
    // floor behind (Matron Ash in the Sanctum, a pipe's last line) fades out, and
    // what was waiting is dropped (QA: Ash talked on over the next title card).
    this.silence(true, LEVEL_CHANGE_FADE_S);
    this.titleQuietUntil = performance.now() + TITLE_QUIET_MS;
    this.teaView = '';
    const id = this.ctx.levels.current?.def.id;
    if (this.ctx.state.mode !== 'play' || !id || floorOf(id) <= 0) return;
    const text = arrivalLine(floorDisplayName(id), FLOOR_LOOKS[LEVELS[id].biome].epigraph);
    this.arrival = { text, timer: 0 };
    this.scheduleArrival(TITLE_CARD_FALLBACK_MS + AFTER_TITLE_CARD_MS);
  }

  private scheduleArrival(delayMs: number): void {
    const arrival = this.arrival;
    if (!arrival) return;
    window.clearTimeout(arrival.timer);
    arrival.timer = this.later(delayMs, () => {
      if (this.arrival !== arrival) return;
      this.arrival = null;
      // The story's opening has the floor (its last plate is the welcome to the Works).
      if (this.ctx.story?.cinematic) return;
      this.say([arrival.text], 'high', 'arrival', 5000);
    });
  }

  private onTeaView(view: { visible: boolean; title: string; detail: string; stage: number; stalled: boolean; fault: { prompt: string; verb: string } | null }): void {
    if (!view.visible) return;
    const state = `${view.stage}|${view.stalled}|${view.fault?.verb ?? ''}`;
    if (state === this.teaView) return;
    this.teaView = state;
    // Instructions are worth saying whole; a passing act is only its title.
    if (view.stalled || view.stage === 0 || view.stage >= TEA_COMPLETE_STAGE) this.say([view.title, view.detail], 'normal', 'tea', 3000);
    else if (view.fault) this.say([view.title, view.fault.prompt], 'normal', 'tea', 3000);
    else this.say([view.title], 'low', 'tea', 2500);
  }

  private watchSanctum(): void {
    const open = this.ctx.sanctum?.isOpen === true;
    if (open && !this.sanctumWasOpen) {
      this.doorSpoken = null;
      const doors = nextDoors(this.ctx.levels.current?.def.id);
      const next = doors[0] ?? this.ctx.levels.current?.def.nextLevelId;
      const lore = next ? FLOOR_LORE[next] : undefined;
      // Two doors: the Docent names the choice; picking one reads its floor.
      const line = doors.length > 1 ? TWO_DOORS_LINE : lore?.line;
      if (line) this.later(1200, () => this.say([line], 'normal', 'sanctum', 15000, () => this.ctx.sanctum.isOpen));
    }
    const door = open ? this.ctx.sanctum?.chosenDoor ?? null : null;
    if (door && door !== this.doorSpoken && nextDoors(this.ctx.levels.current?.def.id).length > 1) {
      this.doorSpoken = door;
      const lore = FLOOR_LORE[door];
      if (lore) this.say([lore.line], 'normal', 'sanctum', 12000, () => this.ctx.sanctum.isOpen && this.ctx.sanctum.chosenDoor === door);
    }
    this.sanctumWasOpen = open;
  }

  /* ---------------- speaking ---------------- */

  /**
   * Voice these lines (in order) if the manners allow. Returns whether anything
   * was started, queued or deferred. `guard` is re-checked if the line has to wait.
   */
  say(texts: readonly string[], priority: NarrationPriority, source: string, ttlMs = 4000, guard?: () => boolean): boolean {
    if (!this.on || document.hidden || !this.host.streamContext() || (guard && !guard())) return false;
    // A floor's title card is the arrival's to voice: a passing line waits it out (or lapses).
    const titleWait = this.titleQuietUntil - performance.now();
    if (priority !== 'high' && titleWait > 0) {
      if (priority === 'normal' && titleWait + 200 < ttlMs) this.later(titleWait, () => this.say(texts, priority, source, ttlMs - titleWait, guard));
      return priority === 'normal' && titleWait + 200 < ttlMs;
    }
    const pairs = texts.filter(Boolean).map(t => ({ t, k: narrationKey(t) })).filter(p => this.clips[p.k]);
    const keys = this.gate.unheard(pairs.map(p => p.k));
    if (keys.length === 0) return false;
    const now = performance.now();
    const u: Utterance = { keys, texts: keys.map(k => pairs.find(p => p.k === k)!.t), priority, source, expiresAt: now + ttlMs };
    const decision = this.gate.decide(priority, now, this.speaking?.u.priority ?? null, this.queue.length);
    if (decision === 'drop') {
      // A normal line whose moment lasts (the Sanctum, the Workshop) waits its turn instead of being lost:
      // it tries again until its time runs out. A passing toast's moment is too short to wait.
      const wait = this.speaking ? 1000 : this.gate.cooldownLeft(now) + 50;
      if (priority === 'normal' && wait + 200 < ttlMs) {
        this.later(wait, () => this.say(texts, priority, source, ttlMs - wait, guard));
        return true;
      }
      return false;
    }
    if (decision === 'queue') { this.queue.push(u); return true; }
    if (decision === 'interrupt') this.cut();
    void this.run(u);
    return true;
  }

  private async run(u: Utterance): Promise<void> {
    const me: Speaking = { u, index: 0, node: null, gain: null, cancelled: false };
    this.speaking = me;
    if (!u.silent || u.silent.some(s => !s)) this.duck(true);
    let played = 0;
    for (let i = 0; i < u.keys.length && !me.cancelled; i++) {
      me.index = i;
      if (i > 0) await new Promise<void>(r => this.later(NARRATION_LINE_GAP_MS, r));
      if (me.cancelled) break;
      if (u.silent?.[i]) {
        // A story line with no recording: its caption holds for a reading time.
        if (i === 0 && performance.now() > u.expiresAt) break;
        const seconds = readingSeconds(u.texts[i]);
        this.ctx.events.emit('narration', { text: u.texts[i], seconds, captioned: u.captioned ?? true, speaker: u.speakers?.[i], silent: true });
        this.spoken.push({ text: u.texts[i], at: Math.round(performance.now()), priority: u.priority, source: u.source });
        if (this.spoken.length > 30) this.spoken.shift();
        await new Promise<void>(r => { me.wake = r; this.later(seconds * 1000, r); });
        me.wake = undefined;
        played++;
        continue;
      }
      // Only the first line of an utterance can be too late; the rest follow it.
      const ok = await this.playOne(u, u.keys[i], i === 0, me);
      if (ok) played++;
      else if (i === 0) break;
    }
    if (this.speaking === me) {
      this.speaking = null;
      // A line that never started (its moment passed) costs no cooldown.
      if (played > 0) this.gate.finished(performance.now());
      // The next that may still run (a lapsed one no longer blocks the lines queued behind it).
      const next = this.nextRunnable();
      if (next) void this.run(next);
      else this.duck(false);
    }
  }

  /** Play one clip to its end. Resolves false when it could not start in time. */
  private async playOne(u: Utterance, key: string, mustBeTimely: boolean, me?: Speaking): Promise<boolean> {
    const ac = this.host.streamContext(), bus = this.host.streamBus('voice');
    const clip = this.clips[key];
    if (!ac || !bus || !clip) return false;
    const asked = performance.now();
    const buffer = await this.buffer(ac, key, clip);
    if (!buffer || (me && me.cancelled)) return false;
    const now = performance.now();
    if (mustBeTimely && (now > u.expiresAt || now - asked > STALE_FETCH_MS)) return false;
    const node = ac.createBufferSource();
    node.buffer = buffer;
    const gain = ac.createGain();
    node.connect(gain);
    gain.connect(bus);
    if (me) { me.node = node; me.gain = gain; }
    if (u.source !== 'preview') {
      this.gate.markHeard(key);
      const text = u.texts[u.keys.indexOf(key)] ?? '';
      this.spoken.push({ text, at: Math.round(now), priority: u.priority, source: u.source });
      if (this.spoken.length > 30) this.spoken.shift();
      const index = u.keys.indexOf(key);
      const speaker = u.speakers?.[index];
      this.ctx.events.emit('narration', { text, seconds: buffer.duration, captioned: u.captioned ?? clip.captioned === true, ...(speaker ? { speaker } : {}) });
    }
    return new Promise<boolean>(resolve => {
      node.onended = () => { node.disconnect(); gain.disconnect(); resolve(true); };
      node.start();
    });
  }

  private buffer(ac: AudioContext, key: string, clip: NarrationClip): Promise<AudioBuffer | null> {
    let p = this.buffers.get(key);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}${clip.url}`)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then(bytes => ac.decodeAudioData(bytes))
        .catch(() => { this.buffers.delete(key); return null; });
      this.buffers.set(key, p);
      if (this.buffers.size > BUFFER_CACHE) this.buffers.delete(this.buffers.keys().next().value as string);
    }
    return p;
  }

  /** Stop the current line (quickly when a higher beat takes the floor; a slower fade when the floor changes). */
  private cut(fadeS = 0.12): void {
    const s = this.speaking;
    if (!s) return;
    s.cancelled = true;
    this.speaking = null;
    s.wake?.();
    const ac = this.host.streamContext();
    if (s.node && s.gain && ac) {
      const t = ac.currentTime;
      s.gain.gain.setValueAtTime(s.gain.gain.value, t);
      s.gain.gain.linearRampToValueAtTime(0, t + fadeS);
      try { s.node.stop(t + fadeS + 0.01); } catch { /* already stopped */ }
    }
  }

  /** Stop (and unqueue) lines that belonged to a screen that has closed (or a story beat that ended). */
  cutSource(source: string): void {
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].source === source) this.queue.splice(i, 1);
    if (this.speaking?.u.source === source) {
      this.cut();
      this.gate.finished(performance.now());
      // Whatever was waiting behind it (another source's line) takes its turn.
      const next = this.nextRunnable();
      if (next) void this.run(next);
      else this.duck(false);
    }
  }

  /** The first waiting utterance that may still start; lapsed ones ahead of it are dropped. */
  private nextRunnable(): Utterance | null {
    for (let u = this.queue.shift(); u; u = this.queue.shift()) if (this.canRun(u)) return u;
    return null;
  }

  /** A waiting utterance may still start: its moment has not passed, and it can be heard (or is caption-only). */
  private canRun(u: Utterance): boolean {
    return performance.now() < u.expiresAt && (this.on || (u.silent?.every(Boolean) ?? false));
  }

  /** Everything stops: the setting went off or the tab was hidden. */
  private silence(clearQueue: boolean, fadeS = 0.12): void {
    this.cut(fadeS);
    if (clearQueue) this.queue.length = 0;
    this.duck(false);
  }

  private duck(on: boolean): void {
    if (on === this.talking) return;
    this.talking = on;
    if (on) this.host.talkDuck(true);
    // Release a beat after the last word, unless another line has started meanwhile.
    else this.later(250, () => { if (!this.speaking) this.host.talkDuck(false); else this.talking = true; });
  }

  private later(ms: number, fn: () => void): number {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }

  /* ---------------- probing ---------------- */

  debugSnapshot(): Record<string, unknown> {
    const now = performance.now();
    return {
      enabled: this.on,
      speaking: this.speaking ? { texts: this.speaking.u.texts, index: this.speaking.index, priority: this.speaking.u.priority, source: this.speaking.u.source } : null,
      queued: this.queue.length,
      heard: this.gate.heardCount(),
      cooldownMs: Math.round(this.gate.cooldownLeft(now)),
      talking: this.talking,
      spoken: this.spoken.map(s => ({ ...s })),
      clips: Object.keys(this.clips).length,
      buffers: this.buffers.size,
    };
  }
}
