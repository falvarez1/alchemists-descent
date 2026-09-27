import type { SfxCategory, SfxId } from '@/content/audio/sfxCues';
import { packCues, sfxCue, sfxUrls } from '@/content/audio/sfxManifest';

/**
 * Decoded sound-effect buffers, loaded lazily in packs.
 *
 * Nothing is fetched before `start()` — the engine calls it on the first user
 * gesture — so the first page load transfers no audio at all. Packs load in
 * request order (the core packs first, then the current floor's creatures and
 * bed, then the next floor's when the Sanctum prefetches it), a few files at a
 * time. A pack that is no longer needed can be released to give its decoded
 * PCM back; core packs are never released.
 *
 * A cue is playable as soon as ONE of its takes has decoded; callers fall back
 * to the procedural voice until then, so loading is never silence.
 */
export type PackState = 'queued' | 'loading' | 'ready' | 'failed';

/**
 * Pace the load. Decoding the core packs in one burst right after the first
 * gesture held the new AudioContext's clock at zero for most of a second
 * (the device pull starved), delaying the very click that started it. So:
 * a short grace before the first fetch, three lanes, and a breath between
 * files. The whole core still arrives in about two seconds, and the
 * procedural fallback covers anything asked for sooner.
 */
const PARALLEL_FETCHES = 3;
const START_GRACE_MS = 300;
const BETWEEN_FILES_MS = 6;

/**
 * Decoded PCM is the memory cost of sampled audio (float32 at the device rate
 * would hold the core packs alone near 60 MB). The mastered MP3s are already
 * band-limited around 15 kHz, so most cues decode at 32 kHz with nothing
 * audible lost; the sparkly families (UI, pickups, spells, glass and sizzle)
 * keep 44.1 kHz for their top octave; the long stereo beds sit under
 * everything and decode at 24 kHz. Buffers play at any context rate (the
 * source node resamples).
 */
const DECODE_RATE: Readonly<Record<SfxCategory, number>> = {
  ui: 44100, pickup: 44100, spell: 44100, material: 44100,
  stinger: 32000, player: 32000, step: 32000, impact: 32000, explosion: 32000, loop: 32000, mechanism: 32000,
  tea: 32000, creature: 32000, boss: 32000, critter: 32000, bed: 24000,
};

export class SampleBank {
  private context: BaseAudioContext | null = null;
  /** Fetching has begun (START_GRACE_MS after `start`). */
  private pumping = false;
  /** One silent offline context per decode rate (decodeAudioData resamples to its context's rate). */
  private readonly decoders = new Map<number, BaseAudioContext>();
  private readonly buffers = new Map<SfxId, AudioBuffer[]>();
  private readonly states = new Map<string, PackState>();
  private readonly queue: string[] = [];
  /** Per-pack generation: a release during a load discards the late arrivals. */
  private readonly epoch = new Map<string, number>();
  private inFlight = 0;
  private readonly pending: Array<() => Promise<void>> = [];
  // ---- probe counters ----
  decodedBytes = 0;
  filesDecoded = 0;
  filesFailed = 0;
  bytesFetched = 0;

  get started(): boolean {
    return this.context !== null;
  }

  /** Begin loading (idempotent). Must follow a user gesture: this is when the network is first touched. */
  start(context: BaseAudioContext): void {
    if (this.context) return;
    this.context = context;
    setTimeout(() => {
      this.pumping = true;
      for (const pack of [...this.queue]) this.load(pack);
    }, START_GRACE_MS);
  }

  /** Ask for packs (queued until `start`). Already requested packs are left as they are. */
  request(packs: readonly string[]): void {
    for (const pack of packs) {
      const state = this.states.get(pack);
      if (state === 'ready' || state === 'loading' || state === 'queued') continue;
      this.states.set(pack, 'queued');
      this.queue.push(pack);
      if (this.pumping) this.load(pack);
    }
  }

  /** Drop a pack's decoded buffers (it can be requested again later). */
  release(pack: string): void {
    if (!this.states.has(pack)) return;
    this.states.delete(pack);
    this.epoch.set(pack, (this.epoch.get(pack) ?? 0) + 1);
    const q = this.queue.indexOf(pack);
    if (q >= 0) this.queue.splice(q, 1);
    for (const id of packCues(pack)) {
      const list = this.buffers.get(id);
      if (!list) continue;
      for (const b of list) this.decodedBytes -= b.length * b.numberOfChannels * 4;
      this.buffers.delete(id);
    }
  }

  state(pack: string): PackState | undefined {
    return this.states.get(pack);
  }

  /** Packs currently held or on their way. */
  packs(): string[] {
    return [...this.states.keys()];
  }

  /** Decoded takes of a cue (undefined until at least one has decoded). */
  get(id: SfxId): readonly AudioBuffer[] | undefined {
    return this.buffers.get(id);
  }

  has(id: SfxId): boolean {
    return (this.buffers.get(id)?.length ?? 0) > 0;
  }

  private load(pack: string): void {
    if (this.states.get(pack) !== 'queued') return;
    this.states.set(pack, 'loading');
    const epoch = this.epoch.get(pack) ?? 0;
    const jobs: Array<Promise<boolean>> = [];
    for (const id of packCues(pack)) {
      for (const url of sfxUrls(id)) jobs.push(this.schedule(() => this.fetchOne(id, url, pack, epoch)));
    }
    void Promise.all(jobs).then((results) => {
      if ((this.epoch.get(pack) ?? 0) !== epoch) return;
      this.states.set(pack, results.length > 0 && results.every((ok) => !ok) ? 'failed' : 'ready');
    });
  }

  /** Run fetch jobs a few at a time so a floor's worth of files does not open 80 connections at once. */
  private schedule(job: () => Promise<boolean>): Promise<boolean> {
    return new Promise((resolve) => {
      const run = async (): Promise<void> => {
        this.inFlight++;
        try { resolve(await job()); } catch { resolve(false); } finally {
          this.inFlight--;
          const next = this.pending.shift();
          if (next) setTimeout(next, BETWEEN_FILES_MS);
        }
      };
      if (this.inFlight < PARALLEL_FETCHES) void run();
      else this.pending.push(run);
    });
  }

  private decoderFor(id: SfxId, fallback: BaseAudioContext): BaseAudioContext {
    const cue = sfxCue(id);
    // Big ambient one-shots (the Breathing Chamber's breaths) are bodies, not sparkle.
    const rate = cue.cat === 'material' && cue.bus === 'ambience' ? 32000 : DECODE_RATE[cue.cat];
    let decoder = this.decoders.get(rate);
    if (!decoder) {
      try {
        decoder = new OfflineAudioContext(1, 1, rate);
      } catch {
        decoder = fallback; // a browser without that rate: decode at the device rate
      }
      this.decoders.set(rate, decoder);
    }
    return decoder;
  }

  private async fetchOne(id: SfxId, url: string, pack: string, epoch: number): Promise<boolean> {
    const context = this.context;
    if (!context || (this.epoch.get(pack) ?? 0) !== epoch) return false;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.arrayBuffer();
      this.bytesFetched += data.byteLength;
      const buffer = await this.decoderFor(id, context).decodeAudioData(data);
      if ((this.epoch.get(pack) ?? 0) !== epoch || !this.states.has(pack)) return false;
      const list = this.buffers.get(id) ?? [];
      list.push(buffer);
      this.buffers.set(id, list);
      this.decodedBytes += buffer.length * buffer.numberOfChannels * 4;
      this.filesDecoded++;
      return true;
    } catch {
      // Fail-open: the procedural voice keeps covering this cue.
      this.filesFailed++;
      return false;
    }
  }
}
