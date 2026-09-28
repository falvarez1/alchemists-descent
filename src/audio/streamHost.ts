/**
 * What the streamed-audio layers (audio/MusicDirector, audio/Narrator) need
 * from the engine: its live context and a bus to feed, never a context of
 * their own. AudioEngine implements it; Game wires the two together.
 */
export interface StreamHost {
  /** Present (and required) sound switch. */
  readonly enabled: boolean;
  /** The live AudioContext, or null before the first user gesture / with sound off. Never creates one. */
  streamContext(): AudioContext | null;
  /** The mix bus a stream feeds; null whenever `streamContext()` is. */
  streamBus(bus: 'music' | 'voice'): AudioNode | null;
  /** Narration ducking on/off (mix.ts TALK_DUCK). */
  talkDuck(active: boolean): void;
  /** Create/resume the context. Only ever called from inside a user gesture. */
  ensure(): void;
}
