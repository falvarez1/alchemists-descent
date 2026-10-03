import type { AudioStinger, AudioStingerOptions, EnemyKind, SfxOptions } from '@/core/types';
import { AudioEngine } from '@/audio/AudioEngine';
import { LoopVoice } from '@/audio/LoopVoice';
import { SampleBank, type PackState } from '@/audio/SampleBank';
import { CATEGORY_FALLBACKS, SFX_FALLBACKS, type ProceduralKit } from '@/audio/sfxFallbacks';
import { chainPitch } from '@/audio/mix';
import { audioFault } from '@/audio/failSafe';
import { CORE_SFX_PACKS, isSfxId, type CreatureSfxAction, type SfxId } from '@/content/audio/sfxCues';
import { sfxCue, type ResolvedSfxCue } from '@/content/audio/sfxCatalog';
import type { ArenaHurtSound } from '@/audio/arenaAudio';

/**
 * The game's sound: ElevenLabs-generated samples through the procedural
 * engine's own mix graph, placement and probe trace (audio/AudioEngine.ts).
 *
 * Every `AudioApi` preset plays its sample(s) here; `sfx(id)` plays any named
 * cue from content/audio/sfxCues.ts. Until a cue's pack has decoded (or if a
 * file fails), the preset falls through to the procedural voice it replaced —
 * never silence, never an error.
 *
 * Mix hygiene, per voice:
 * - a random take that is never the one just played, with a small pitch and
 *   gain spread, so a repeated cue does not machine-gun;
 * - a per-cue cooldown (retriggers inside it are dropped) and instance cap
 *   (the oldest instance is stolen with a 30 ms fade);
 * - a global pool of SAMPLE_VOICE_CAP voices: when it is full a newcomer
 *   steals the quietest-ranked, oldest voice that does not outrank it, and
 *   is dropped if every voice does. The glue compressor, limiter and soft
 *   clip downstream catch whatever still sums hot.
 * Loop cues sustain while their callers keep calling (`LoopVoice`), and the
 * floor's ambience bed crossfades when the floor changes.
 */
const SAMPLE_VOICE_CAP = 40;
const MAX_LOOPS = 14;
const undb = (d: number): number => 10 ** (d / 20);

interface SampleVoice {
  id: SfxId;
  src: AudioBufferSourceNode;
  env: GainNode;
  priority: number;
  started: number;
  ctx: BaseAudioContext;
  done: boolean;
}

export interface SampleDebug {
  started: boolean;
  packs: Record<string, PackState | undefined>;
  decodedBytes: number;
  filesDecoded: number;
  filesFailed: number;
  bytesFetched: number;
  played: number;
  fellBack: number;
  dropped: number;
  stolen: number;
  activeVoices: number;
  loops: string[];
  bed: string | null;
  lastPlayed: string[];
}

export class SfxAudioEngine extends AudioEngine {
  readonly bank = new SampleBank();
  private readonly active: SampleVoice[] = [];
  private readonly lastPlay = new Map<SfxId, number>();
  private readonly lastTake = new Map<SfxId, number>();
  private readonly lastFallback = new Map<string, number>();
  private readonly loops = new Map<string, LoopVoice>();
  /** performance.now() of the last request per pack (the director releases what nobody has asked for lately). */
  private readonly packAskedAt = new Map<string, number>();
  private bed: { id: SfxId; voice: LoopVoice } | null = null;
  private wantedBed: SfxId | null = null;
  private lastChimeAt = -1e9;
  private readonly proc: ProceduralKit;
  // ---- probe counters ----
  private played = 0;
  private fellBack = 0;
  private dropped = 0;
  private stolen = 0;
  private readonly recent: string[] = [];
  private arenaHurt: (() => ArenaHurtSound | null) | null = null;

  /** Director supplies current slot facts; hurt() is called while that slot is bound. */
  setArenaHurtProvider(provider: (() => ArenaHurtSound | null) | null): void { this.arenaHurt = provider; }

  constructor() {
    super();
    // The core packs go first in the queue; nothing is fetched until the first gesture.
    this.bank.request(CORE_SFX_PACKS);
    // The procedural voices, reached through `super` so a fallback can never
    // re-enter the sampled override that asked for it.
    this.proc = {
      tone: (f, e, d, t, v) => super.tone(f, e, d, t, v),
      noiseBurst: (d, f, v, hp) => super.noiseBurst(d, f, v, hp),
      later: (ms, fn) => this.schedule(ms, fn),
      chitin: (i) => super.chitin(i),
      chirr: (d, p, v) => super.chirr(d, p, v),
      slither: (i) => super.slither(i),
      creak: (i) => super.creak(i),
      grind: (i) => super.grind(i),
      squeak: () => super.squeak(),
      hop: (s) => super.hop(s),
      skitter: () => super.skitter(),
      squelch: () => super.squelch(),
      zap: () => super.zap(),
      hollowKnock: () => super.hollowKnock(),
      bubble: () => super.bubble(),
      shatter: () => super.shatter(),
      groan: () => super.groan(),
      flame: () => super.flame(),
      sizzle: () => super.sizzle(),
      steam: () => super.steam(),
      boom: (s) => super.boom(s),
      landThud: (k) => super.landThud(k),
      splash: (k) => super.splash(k),
      lever: () => super.lever(),
      brazier: () => super.brazier(),
      chest: () => super.chest(),
      pickup: () => super.pickup(),
      gong: () => super.gong(),
      portalWhoosh: () => super.portalWhoosh(),
      dig: () => super.dig(),
      alert: () => super.alert(),
      learn: () => super.learn(),
      coin: (s) => super.coin(s),
      keyJingle: () => super.keyJingle(),
      dryFire: () => super.dryFire(),
    };
  }

  // ------------------------------------------------------------ lifecycle

  override ensure(): void {
    super.ensure();
    const live = this.outputContext;
    if (live && !this.bank.started) this.bank.start(live);
    this.syncBed();
  }

  override toggle(): boolean {
    const on = super.toggle();
    if (!on) this.stopLoops(0.05);
    return on;
  }

  override dispose(): void {
    this.stopLoops(0);
    this.bed?.voice.stop(0);
    this.bed = null;
    super.dispose();
  }

  /** Load packs (queued until the first gesture). Asking again keeps a loaded pack from being released. */
  requestPacks(packs: readonly string[]): void {
    const now = performance.now();
    for (const p of packs) this.packAskedAt.set(p, now);
    this.bank.request(packs);
  }

  /** When a pack was last asked for (undefined: never through requestPacks). */
  packLastAsked(pack: string): number | undefined {
    return this.packAskedAt.get(pack);
  }

  releasePack(pack: string): void {
    this.bank.release(pack);
  }

  // ------------------------------------------------------------- the API

  /**
   * Play a cue. Gameplay calls this from inside its tick, so it is fail-safe:
   * an audio error is reported (audio/failSafe) and never reaches the caller.
   */
  sfx(id: SfxId, x?: number, y?: number, opts: SfxOptions = {}): void {
    try {
      const cue = sfxCue(id);
      if (cue.loop) { this.sustain(cue, x, y, opts); return; }
      if (x !== undefined && y !== undefined && cue.range > 0) {
        this.at(x, y, () => this.play(cue, opts), cue.range);
        return;
      }
      this.play(cue, opts);
    } catch (error) {
      audioFault(`sfx ${id}`, error);
    }
  }

  creature(kind: EnemyKind, action: CreatureSfxAction): void {
    try {
      const own = `creature.${kind}.${action}`;
      const generic = `creature.generic.${action}`;
      const id = isSfxId(own) ? own : isSfxId(generic) ? generic : null;
      if (id && this.bank.has(id)) { this.sfx(id); return; }
      if (!this.voiceContext) return;
      // Loading (or no sample at all): the procedural voice this kind always had.
      this.fellBack++;
      this.routeTo('voices', () => this.creatureFallback(kind, action));
    } catch (error) {
      audioFault(`creature ${kind}.${action}`, error);
    }
  }

  /** The floor's ambience bed (null = none); crossfades from whatever was playing. */
  setAmbience(id: SfxId | null): void {
    this.wantedBed = id;
    try { this.syncBed(); } catch (error) { audioFault('ambience', error); }
  }

  /** True while a sustained cue instance is alive. */
  isSustaining(key: string): boolean {
    return this.loops.get(key)?.running === true;
  }

  // ------------------------------------------------------------ playback

  private play(cue: ResolvedSfxCue, opts: SfxOptions): void {
    if (!this.voiceContext) return;
    if (!this.playSample(cue, opts)) this.fallback(cue.id, cue.cat, cue.bus, opts, cue.cooldownMs);
  }

  /** Play a take now. False only when the cue has no decoded take yet. */
  private playSample(cue: ResolvedSfxCue, opts: SfxOptions): boolean {
    const buffers = this.bank.get(cue.id);
    const ac = this.voiceContext;
    if (!ac || !buffers || buffers.length === 0) return false;
    const live = ac === this.outputContext;
    const nowMs = performance.now();
    const last = this.lastPlay.get(cue.id);
    if (live && last !== undefined && nowMs - last < cue.cooldownMs) { this.dropped++; return true; }
    const place = this.currentPlacement();
    const vol = cue.gain * (opts.gain ?? 1) * place.gain * undb((Math.random() * 2 - 1) * 1.2);
    if (vol < 0.0008) return true;
    if (!this.makeRoom(cue, ac)) { this.dropped++; return true; }
    let take = Math.floor(Math.random() * buffers.length);
    if (buffers.length > 1 && take === this.lastTake.get(cue.id)) {
      take = (take + 1 + Math.floor(Math.random() * (buffers.length - 1))) % buffers.length;
    }
    this.lastTake.set(cue.id, take);
    if (live) this.lastPlay.set(cue.id, nowMs);
    const t = this.startTime() + Math.max(0, opts.delay ?? 0);
    const src = ac.createBufferSource();
    src.buffer = buffers[take];
    const cents = (Math.random() * 2 - 1) * cue.pitchCents + (opts.pitch ?? 0) * 100;
    src.playbackRate.value = 2 ** (cents / 1200) * (opts.rate ?? 1);
    const env = ac.createGain();
    env.gain.value = vol;
    src.connect(env);
    const nodes: AudioNode[] = [src, env];
    this.routeTo(cue.bus, () => this.sinkVoice(env, nodes, vol));
    const voice: SampleVoice = { id: cue.id, src, env, priority: cue.priority, started: t, ctx: ac, done: false };
    this.active.push(voice);
    src.onended = () => {
      voice.done = true;
      const i = this.active.indexOf(voice);
      if (i >= 0) this.active.splice(i, 1);
      for (const node of nodes) node.disconnect();
    };
    src.start(t);
    this.played++;
    if (this.recent.length >= 24) this.recent.shift();
    this.recent.push(cue.id);
    return true;
  }

  /** Enforce the cue's instance cap and the global pool; false = drop the newcomer. */
  private makeRoom(cue: ResolvedSfxCue, ac: BaseAudioContext): boolean {
    let mine = 0, oldestMine: SampleVoice | null = null, count = 0, victim: SampleVoice | null = null;
    for (const v of this.active) {
      if (v.done || v.ctx !== ac) continue;
      count++;
      if (v.id === cue.id) { mine++; if (!oldestMine) oldestMine = v; }
      if (v.priority <= cue.priority && (!victim || v.priority < victim.priority)) victim = v;
    }
    if (mine >= cue.voices && oldestMine) { this.steal(oldestMine); return true; }
    if (count < SAMPLE_VOICE_CAP) return true;
    if (!victim) return false;
    this.steal(victim);
    return true;
  }

  private steal(v: SampleVoice): void {
    v.done = true;
    this.stolen++;
    const t = v.ctx.currentTime;
    try {
      v.env.gain.cancelScheduledValues(t);
      v.env.gain.setValueAtTime(v.env.gain.value, t);
      v.env.gain.linearRampToValueAtTime(0, t + 0.03);
      v.src.stop(t + 0.035);
    } catch { /* already ended */ }
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
  }

  private fallback(id: SfxId, cat: ResolvedSfxCue['cat'], bus: ResolvedSfxCue['bus'], opts: SfxOptions, cooldownMs: number): void {
    const recipe = SFX_FALLBACKS[id] ?? CATEGORY_FALLBACKS[cat];
    if (!recipe) return;
    const now = performance.now();
    const last = this.lastFallback.get(id) ?? -1e9;
    if (now - last < Math.max(60, cooldownMs)) return;
    this.lastFallback.set(id, now);
    this.fellBack++;
    this.routeTo(bus, () => recipe(this.proc, opts));
  }

  private creatureFallback(kind: EnemyKind, action: CreatureSfxAction): void {
    const p = this.proc;
    if (action === 'death') { super.deathCry(kind); return; }
    if (action === 'hop') { p.hop(kind === 'leviathan' ? 1.6 : 1); return; }
    if (action === 'alert') {
      if (kind === 'weaver') p.chirr(0.22, 1.1, 0.06);
      else if (kind === 'rillback') p.slither(1.2);
      else if (kind === 'rootloper') p.creak(1);
      else if (kind === 'stonemaw') p.grind(1);
      else if (kind === 'bat') p.squeak();
      else p.alert();
      return;
    }
    if (action === 'step') {
      if (kind === 'colossus') { p.landThud(0.8); p.hollowKnock(); }
      else if (kind === 'golem') p.landThud(0.35);
      else if (kind === 'weaver') p.chitin(0.18);
      else if (kind === 'spitter') p.skitter();
      else if (kind === 'rootloper') p.creak(0.35);
    }
    // idle / hurt / attack were silent before the sampled layer: stay silent while loading.
  }

  // -------------------------------------------------------------- loops

  private sustain(cue: ResolvedSfxCue, x: number | undefined, y: number | undefined, opts: SfxOptions): void {
    const live = this.outputContext;
    if (!this.voiceContext || !live || this.voiceContext !== live) return;
    const key = opts.key ?? cue.id;
    let place = this.currentPlacement();
    if (x !== undefined && y !== undefined && cue.range > 0) {
      const p = this.placementAt(x, y, cue.range);
      if (!p) return; // out of range: stop refreshing and let it fade
      place = { pan: p.pan, gain: place.gain * p.gain, muffleHz: p.muffleHz };
    }
    const level = cue.gain * (opts.gain ?? 1) * place.gain;
    let loop = this.loops.get(key);
    if (!loop || !loop.running) {
      const buffers = this.bank.get(cue.id);
      if (!buffers || buffers.length === 0) {
        if (x !== undefined && y !== undefined && cue.range > 0) this.at(x, y, () => this.fallback(cue.id, cue.cat, cue.bus, opts, 90), cue.range);
        else this.fallback(cue.id, cue.cat, cue.bus, opts, 90);
        return;
      }
      if (level < 0.002) return;
      if (this.loops.size >= MAX_LOOPS) return;
      const bus = this.busNode(cue.bus);
      if (!bus) return;
      loop = new LoopVoice(live, buffers[Math.floor(Math.random() * buffers.length)], bus, { crossfade: 0.35, fadeIn: 0.06, randomStart: true });
      loop.keepAliveMs = cue.keepAliveMs;
      const made = loop;
      loop.onStopped = () => { if (this.loops.get(key) === made) this.loops.delete(key); };
      this.loops.set(key, loop);
      this.played++;
      if (this.recent.length >= 24) this.recent.shift();
      this.recent.push(cue.id);
    }
    loop.refresh(level, place.pan, place.muffleHz);
  }

  private stopLoops(fade: number): void {
    for (const loop of [...this.loops.values()]) loop.stop(fade);
    this.loops.clear();
  }

  private syncBed(): void {
    const live = this.outputContext;
    if (!live || !this.voiceContext) return;
    const want = this.wantedBed;
    if (this.bed && this.bed.id === want && this.bed.voice.running) return;
    if (this.bed && this.bed.id !== want) { this.bed.voice.stop(2.5); this.bed = null; }
    if (!want || this.bed) return;
    const buffers = this.bank.get(want);
    const bus = this.busNode(sfxCue(want).bus);
    if (!buffers || buffers.length === 0 || !bus) return; // the director retries once it has loaded
    const voice = new LoopVoice(live, buffers[0], bus, { crossfade: 2.5, fadeIn: 3, randomStart: true });
    voice.refresh(sfxCue(want).gain, 0, 0, 0.5);
    this.bed = { id: want, voice };
  }

  /** The director calls this on its cadence: retry a bed that was waiting for its file. */
  tickAmbience(): void {
    this.syncBed();
  }

  // ----------------------------------------------- sampled AudioApi presets

  /** Play `id` if it has decoded, else the procedural preset it replaced (fail-safe, like `sfx`). */
  private mapped(id: SfxId, x: number | undefined, y: number | undefined, fallback: () => void, opts?: SfxOptions): void {
    if (!this.voiceContext) return;
    if (this.bank.has(id)) { this.sfx(id, x, y, opts); return; }
    this.fellBack++;
    try { fallback(); } catch (error) { audioFault(`fallback ${id}`, error); }
  }

  override worldSound(kind: 'stone' | 'metal' | 'water' | 'weaver' | 'rillback' | 'pressure', x: number, y: number): void {
    const fallback = (): void => super.worldSound(kind, x, y);
    if (kind === 'pressure') {
      // The Breathing Chamber's jets: a sustained roar while the Works exhale,
      // announced by the exhale itself the moment the jets start.
      if (!this.bank.has('amb.breath.jet')) { fallback(); return; }
      if (!this.isSustaining('amb.breath.jet') && this.bank.has('amb.breath.exhale')) this.sfx('amb.breath.exhale', x, y + 40);
      this.sfx('amb.breath.jet', x, y);
      return;
    }
    const id: SfxId = kind === 'stone' ? 'player.gear' : kind === 'metal' ? 'player.step.metal' : kind === 'water' ? 'player.wade'
      : kind === 'weaver' ? 'creature.weaver.step' : 'creature.rillback.move';
    this.mapped(id, x, y, fallback);
  }

  override boom(size: number, x?: number, y?: number): void {
    const tier: SfxId = size >= 14 ? 'boom.large' : size >= 6 ? 'boom.medium' : 'boom.small';
    const within = tier === 'boom.small' ? 0.55 + 0.45 * Math.min(1, size / 6) : tier === 'boom.medium' ? 0.8 + 0.2 * ((size - 6) / 8) : 1;
    const pitch = Math.max(-3, Math.min(2, -(size - 8) / 6));
    this.mapped(tier, x, y, () => super.boom(size, x, y), { gain: within, pitch });
  }

  override zap(x?: number, y?: number): void { this.mapped('mat.zap', x, y, () => super.zap(x, y)); }
  override lightning(x?: number, y?: number): void { this.mapped('spell.lightning', x, y, () => super.lightning(x, y)); }
  override hollowKnock(x?: number, y?: number): void { this.mapped('mat.hollow', x, y, () => super.hollowKnock(x, y)); }
  override bubble(x?: number, y?: number): void { this.mapped('mat.bubble', x, y, () => super.bubble(x, y)); }
  override shatter(x?: number, y?: number): void { this.mapped('mat.shatter', x, y, () => super.shatter(x, y)); }
  override squelch(x?: number, y?: number): void { this.mapped('mat.squelch', x, y, () => super.squelch(x, y)); }
  override doorGrind(x?: number, y?: number): void { this.mapped('mech.door', x, y, () => super.doorGrind(x, y)); }
  override brazier(x?: number, y?: number): void { this.mapped('mat.ignite', x, y, () => super.brazier(x, y)); }
  override sizzle(x?: number, y?: number): void { this.mapped('mat.sizzle', x, y, () => super.sizzle(x, y)); }
  override steam(x?: number, y?: number): void { this.mapped('mat.steam', x, y, () => super.steam(x, y)); }
  override groan(x?: number, y?: number): void { this.mapped('mech.groan', x, y, () => super.groan(x, y)); }
  override chirp(x?: number, y?: number): void { this.mapped('critter.chirp', x, y, () => super.chirp(x, y)); }
  override skitter(x?: number, y?: number): void { this.mapped('critter.skitter', x, y, () => super.skitter(x, y)); }
  override drip(x?: number, y?: number): void { this.mapped('mat.drip', x, y, () => super.drip(x, y)); }
  override implode(x?: number, y?: number): void { this.mapped('spell.blackhole.implode', x, y, () => super.implode(x, y)); }

  override splash(intensity: number, x?: number, y?: number): void {
    const k = Math.max(0.2, Math.min(1, intensity));
    this.mapped(k >= 0.5 ? 'mat.splash.big' : 'mat.splash.small', x, y, () => super.splash(intensity, x, y), { gain: 0.55 + 0.45 * k });
  }

  override flame(x?: number, y?: number): void {
    if (x !== undefined && y !== undefined) { this.mapped('mat.ignite', x, y, () => super.flame(x, y), { gain: 0.6 }); return; }
    // The player's stream: a sustained roar, lit with a whoomp.
    if (!this.voiceContext) return;
    if (!this.bank.has('spell.flame.loop')) { this.fellBack++; super.flame(); return; }
    if (!this.isSustaining('spell.flame.loop')) this.sfx('spell.flame.ignite');
    this.sfx('spell.flame.loop');
  }

  override dig(x?: number, y?: number): void {
    if (x !== undefined && y !== undefined) { this.mapped('player.staff', x, y, () => super.dig(x, y)); return; }
    this.mapped('spell.dig.loop', undefined, undefined, () => super.dig());
  }

  override levitate(): void { this.mapped('player.levitate.loop', undefined, undefined, () => super.levitate()); }
  override coin(streak = 0): void {
    this.mapped('pickup.coin', undefined, undefined, () => super.coin(streak), { pitch: Math.min(Math.max(0, streak - 1), 12) });
  }
  override hurt(): void {
    const arena = this.arenaHurt?.();
    if (!arena) { this.mapped('player.hurt', undefined, undefined, () => super.hurt()); return; }
    if (arena.impact) this.sfx('arena.hit.light', arena.x, arena.y);
    // Never layer the old generic hurt recording over a fighter performance.
    // Voice loading stays silent instead of substituting the old grunt.
    if (this.bank.has(arena.cue)) this.sfx(arena.cue, arena.x, arena.y, { pitch: arena.pitch });
  }
  override jump(): void { this.mapped('player.jump', undefined, undefined, () => super.jump()); }
  override pickup(): void { this.mapped('pickup.generic', undefined, undefined, () => super.pickup()); }
  override chest(): void { this.mapped('pickup.chest', undefined, undefined, () => super.chest()); }
  override keyJingle(): void { this.mapped('pickup.key', undefined, undefined, () => super.keyJingle()); }
  override portalWhoosh(): void { this.mapped('world.portal', undefined, undefined, () => super.portalWhoosh()); }
  override learn(): void { this.mapped('ui.learn', undefined, undefined, () => super.learn()); }
  override drinkPotion(): void { this.mapped('pickup.potion', undefined, undefined, () => super.drinkPotion()); }
  override lever(): void { this.mapped('mech.lever', undefined, undefined, () => super.lever()); }
  override dryFire(): void { this.mapped('wand.dry', undefined, undefined, () => super.dryFire()); }
  override wandSwap(): void { this.mapped('wand.swap', undefined, undefined, () => super.wandSwap()); }
  override sputter(): void { this.mapped('player.sputter', undefined, undefined, () => super.sputter()); }
  override heartbeat(): void { this.mapped('player.heartbeat', undefined, undefined, () => super.heartbeat()); }
  override cardPick(): void { this.mapped('ui.card.pick', undefined, undefined, () => super.cardPick()); }
  override cardSlot(): void { this.mapped('ui.card.slot', undefined, undefined, () => super.cardSlot()); }
  override crawlShuffle(): void { this.mapped('player.crawl', undefined, undefined, () => super.crawlShuffle()); }
  override crampedBump(): void { this.mapped('player.cramped', undefined, undefined, () => super.crampedBump()); }
  override gong(): void { this.mapped('world.gong', undefined, undefined, () => super.gong()); }
  override alert(): void { this.mapped('creature.generic.alert', undefined, undefined, () => super.alert()); }
  override finisherWhip(): void { this.mapped('trick.whip', undefined, undefined, () => super.finisherWhip()); }
  override shellCrack(): void { this.mapped('trick.shellcrack', undefined, undefined, () => super.shellCrack()); }

  override footstep(surface: 'stone' | 'soft' | 'wet' | 'wood'): void {
    this.mapped(`player.step.${surface}`, undefined, undefined, () => super.footstep(surface));
  }

  override landThud(intensity: number): void {
    const k = Math.max(0.15, Math.min(1, intensity));
    if (k >= 0.55) this.mapped('player.land.hard', undefined, undefined, () => super.landThud(intensity), { gain: 0.6 + 0.4 * k });
    else this.mapped('player.land.soft', undefined, undefined, () => super.landThud(intensity), { gain: 0.5 + k });
  }

  // ---- creature voices (callers place them with at()) ----
  override chitin(intensity = 1): void {
    this.mapped('creature.weaver.step', undefined, undefined, () => super.chitin(intensity), { gain: Math.max(0.2, Math.min(1.5, intensity)) });
  }
  override chirr(dur = 0.28, pitch = 1, vol = 0.07): void {
    this.mapped('creature.weaver.chirr', undefined, undefined, () => super.chirr(dur, pitch, vol), { rate: pitch, gain: Math.min(1.5, vol / 0.07) });
  }
  override slither(intensity = 1): void {
    this.mapped('creature.rillback.move', undefined, undefined, () => super.slither(intensity), { gain: Math.max(0.3, Math.min(1.6, intensity)) });
  }
  override creak(intensity = 1): void {
    this.mapped('creature.rootloper.step', undefined, undefined, () => super.creak(intensity), { gain: Math.max(0.3, Math.min(1.6, intensity)) });
  }
  override grind(intensity = 1): void {
    this.mapped('creature.stonemaw.chew', undefined, undefined, () => super.grind(intensity), { gain: Math.max(0.3, Math.min(1.6, intensity)) });
  }
  override squeak(): void { this.mapped('creature.bat.alert', undefined, undefined, () => super.squeak()); }
  override hop(size = 1): void {
    this.mapped('creature.hop', undefined, undefined, () => super.hop(size), { gain: Math.max(0.4, Math.min(1.6, size)), rate: 1 / Math.sqrt(Math.max(0.5, size)) });
  }
  override deathCry(kind: string): void {
    const own = `creature.${kind}.death`;
    const id: SfxId = isSfxId(own) ? own : 'creature.generic.death';
    this.mapped(id, undefined, undefined, () => super.deathCry(kind));
  }

  // ---- stingers ----
  override stinger(kind: AudioStinger, opts: AudioStingerOptions = {}): void {
    try {
      this.playStinger(kind, opts);
    } catch (error) {
      audioFault(`stinger ${kind}`, error);
    }
  }

  private playStinger(kind: AudioStinger, opts: AudioStingerOptions): void {
    const id: SfxId = `stinger.${kind}`;
    if (!this.voiceContext || !this.bank.has(id)) { super.stinger(kind, opts); return; }
    this.noteStinger(kind);
    // Pan with the event at half strength (a reward still feels central), never attenuate.
    const pan = opts.x !== undefined ? (this.placementAt(opts.x, this.listenerPos().y, Infinity)?.pan ?? 0) * 0.5 : 0;
    this.placed(pan, 1, 0, () => {
      if (kind === 'alchemy') this.sampledChime(opts.chain ?? 1, opts.cause);
      else {
        if (kind === 'victory') this.duck(0.35, 2600);
        else if (kind === 'fallen') this.duck(0.4, 2800);
        this.sfx(id);
      }
    });
  }

  /** The glass-and-brass chime climbing the pentatonic ladder with the chain. */
  private sampledChime(chain: number, cause?: string): void {
    const now = performance.now();
    const delay = now - this.lastChimeAt < 90 ? 0.07 : 0; // two kills in one blast arpeggiate
    this.lastChimeAt = now + delay * 1000;
    const rate = chainPitch(chain);
    const lift = Math.min(1, (chain - 1) / 6);
    // Bypass the cue cooldown: every link of a chain rings.
    this.lastPlay.delete('stinger.alchemy');
    this.sfx('stinger.alchemy', undefined, undefined, { rate, delay, gain: 0.9 + 0.3 * lift });
    if (chain >= 3) { this.lastPlay.delete('stinger.alchemy'); this.sfx('stinger.alchemy', undefined, undefined, { rate: rate * 2, delay: delay + 0.06, gain: 0.35 }); }
    // A tiny accent of the material that did it.
    const accent: SfxId | null = cause === 'burned' || cause === 'rendered' ? 'mat.sizzle' : cause === 'shorted' ? 'mat.zap'
      : cause === 'drowned' || cause === 'steeped' ? 'mat.bubble' : cause === 'shattered' ? 'mat.shatter' : null;
    if (accent && this.bank.has(accent)) this.routeTo('ui', () => this.playSample(sfxCue(accent), { gain: 0.35, delay }));
  }

  // ------------------------------------------------------------- probing

  /** Read-only view of the sampled layer for in-page probes. Not a gameplay API. */
  debugSamples(): SampleDebug {
    const packs: Record<string, PackState | undefined> = {};
    for (const p of this.bank.packs()) packs[p] = this.bank.state(p);
    return {
      started: this.bank.started,
      packs,
      decodedBytes: this.bank.decodedBytes,
      filesDecoded: this.bank.filesDecoded,
      filesFailed: this.bank.filesFailed,
      bytesFetched: this.bank.bytesFetched,
      played: this.played,
      fellBack: this.fellBack,
      dropped: this.dropped,
      stolen: this.stolen,
      activeVoices: this.active.filter((v) => !v.done).length,
      loops: [...this.loops.keys()],
      bed: this.bed?.id ?? null,
      lastPlayed: [...this.recent],
    };
  }
}
