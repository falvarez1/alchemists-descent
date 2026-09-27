import type { AudioApi, EnemyKind } from '@/core/types';
import type { EventBus, OrganismAction } from '@/core/events';
import type { SfxId } from '@/content/audio/sfxCues';
import { listen } from '@/audio/failSafe';

/**
 * The world's announced moments, turned into sound (events outward, calls
 * inward): the systems that own the light devices, the organisms and the
 * bosses say what happened on the bus, and never know audio exists. This is
 * the one place that decides how those facts sound.
 *
 * - The light wave: the lantern's brass hood, stepping into the deep dark,
 *   eyes that flash back in the beam, a photocell latching, a lumen bloom
 *   opening and furling.
 * - Organisms (game/organisms): a snapjaw's snap and swallow, a puffer
 *   pulling tight and bursting, a glow-worm lowering, hauling up and
 *   snaring, a leech latching, drinking and letting go, an isopod curling,
 *   an ash moth flaring out, a fish school bolting, a bat roost scattering.
 * - Boss moves (creatures/bosses): the tell of every move as it commits —
 *   the Colossus heaving its fists up, scooping melt, opening its vents,
 *   roaring into a new phase, kneeling cracked, going down; the Leviathan's
 *   lure going dark, the coil before a thrash, the plunge before a surge.
 *   The blows themselves sound at the tick they land, in the boss modules.
 *
 * Every cue is placed at the event's position (the cue's own range), so a
 * crowd far off is quiet and a snap beside you is in your ear; each cue's
 * cooldown and instance cap (sfxCues.ts) keep a crowd from machine-gunning.
 *
 * Returns a disposer that unsubscribes everything.
 */

/** One cue a moment plays: the id, and optionally a level, a pitch (semitones) or a delay (s). */
export interface EventCue {
  sfx: SfxId;
  gain?: number;
  pitch?: number;
  delay?: number;
  /** Unplaced (centred): the moment is the alchemist's own (a lantern at his hand, the dark around him). */
  centred?: boolean;
}

type ActionCues = Partial<Record<OrganismAction, readonly EventCue[]>>;

/** What each organism's announced actions sound like (an action missing here is silent). */
export const ORGANISM_CUES: Readonly<Record<string, ActionCues>> = {
  snapjaw: {
    snap: [{ sfx: 'organism.snapjaw.snap' }],
    // Something small went down whole: the swallow follows the clack.
    eat: [{ sfx: 'organism.snapjaw.gulp', delay: 0.14 }],
  },
  puffer: {
    swell: [{ sfx: 'organism.puffer.swell' }],
    burst: [{ sfx: 'organism.puffer.burst' }],
  },
  glowworm: {
    lower: [{ sfx: 'organism.glowworm.lower' }],
    retract: [{ sfx: 'organism.glowworm.retract' }],
    snare: [{ sfx: 'organism.glowworm.snare' }],
  },
  leech: {
    latch: [{ sfx: 'organism.leech.latch' }],
    eat: [{ sfx: 'organism.leech.drink' }],
    shed: [{ sfx: 'organism.leech.shed' }],
  },
  isopod: { curl: [{ sfx: 'organism.isopod.curl' }] },
  // A gust balls an ember beetle up too: a small dry scuttle of shell.
  emberbeetle: { curl: [{ sfx: 'critter.skitter' }] },
  ashmoth: { flare: [{ sfx: 'organism.ashmoth.flare' }] },
  fish: { scatter: [{ sfx: 'organism.fish.scatter' }] },
  bat: { scatter: [{ sfx: 'creature.bat.scatter' }] },
  // An idle imp snaps an ash moth out of the lava glow: a smaller flare.
  imp: { eat: [{ sfx: 'organism.ashmoth.flare', gain: 0.6, pitch: -3 }] },
};

/** The tell each boss move sounds as it commits (the blow lands later, in the boss module). */
export const BOSS_MOVE_CUES: Readonly<Partial<Record<EnemyKind, Readonly<Record<string, readonly EventCue[]>>>>> = {
  colossus: {
    slam: [{ sfx: 'creature.colossus.heave' }],
    stomp: [{ sfx: 'creature.colossus.heave', pitch: -2 }],
    throw: [{ sfx: 'creature.colossus.scoop' }],
    vent: [{ sfx: 'creature.colossus.vent.tell' }],
    roar: [{ sfx: 'creature.colossus.roar' }],
    // Thermal shock: the crack is kilnQuench's; the kneel lands a beat after it.
    quench: [{ sfx: 'creature.colossus.kneel', delay: 0.28 }],
    dying: [{ sfx: 'creature.colossus.death.crack' }],
  },
  leviathan: {
    lunge: [{ sfx: 'creature.leviathan.dim' }, { sfx: 'creature.leviathan.windup', delay: 0.12 }],
    thrash: [{ sfx: 'creature.leviathan.windup' }],
    dive: [{ sfx: 'creature.leviathan.dive' }, { sfx: 'creature.leviathan.dim', gain: 0.7 }],
  },
};

export const LIGHT_CUES = {
  hood: { sfx: 'light.lantern.hood', centred: true },
  unhood: { sfx: 'light.lantern.unhood', centred: true },
  dark: { sfx: 'light.dark', centred: true },
  eyeshine: { sfx: 'light.eyeshine' },
  photocell: { sfx: 'light.photocell.latch' },
  'bloom-open': { sfx: 'light.bloom.open' },
  'bloom-furl': { sfx: 'light.bloom.furl' },
} as const satisfies Record<string, EventCue>;

export function installEventCues(events: EventBus, audio: Pick<AudioApi, 'sfx'>): () => void {
  const play = (cue: EventCue, x: number, y: number): void => {
    const opts = cue.gain !== undefined || cue.pitch !== undefined || cue.delay !== undefined
      ? { gain: cue.gain, pitch: cue.pitch, delay: cue.delay }
      : undefined;
    if (cue.centred) audio.sfx(cue.sfx, undefined, undefined, opts);
    else audio.sfx(cue.sfx, x, y, opts);
  };
  const playAll = (cues: readonly EventCue[] | undefined, x: number, y: number): void => {
    if (cues) for (const cue of cues) play(cue, x, y);
  };
  const off = [
    listen(events, 'lanternHooded', ({ hooded, x, y, quiet }) => { if (!quiet) play(hooded ? LIGHT_CUES.hood : LIGHT_CUES.unhood, x, y); }),
    listen(events, 'darkZoneEntered', ({ x, y }) => play(LIGHT_CUES.dark, x, y)),
    listen(events, 'eyeshineCaught', ({ x, y }) => play(LIGHT_CUES.eyeshine, x, y)),
    listen(events, 'lightDevice', ({ kind, x, y }) => play(LIGHT_CUES[kind], x, y)),
    listen(events, 'organism', ({ kind, action, x, y }) => playAll(ORGANISM_CUES[kind]?.[action], x, y)),
    listen(events, 'bossMove', ({ kind, move, x, y }) => playAll(BOSS_MOVE_CUES[kind]?.[move], x, y - 10)),
  ];
  return () => { for (const dispose of off) dispose(); };
}
