import type { AudioApi, EnemyKind } from '@/core/types';
import type { CorpseMomentKind, EventBus, EventMap, OrganismAction, TelekinesisPhase } from '@/core/events';
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
 * - Flora (game/Flora, sim/elements/flora): a notched trunk straining, the
 *   crack, the hold and lean, the hinge tearing (or a sapling snapping), the
 *   crown's rush, the fall in the floor's own wood, the canopy thrown down,
 *   the log settling; leaves shaken, pods dropping; a thirsty seed drinking,
 *   sprouting, its root ladder creaking up rung by rung and opening its crown.
 *
 * - Telekinesis (combat/Telekinesis): the wand's grip taking hold, the hum
 *   of the brass thread while a body hangs on it (louder for a heavier one),
 *   the letting go, the whip-crack of a hurl, the fizzle of a failing grip
 *   and the groan of a wand straining at something far too heavy.
 * - Corpses (creatures/corpseWorld): the dead as mass — a thud (light or
 *   heavy by the body), a body bowled into a creature, a belly-flop, catching
 *   fire and being put out, lava taking it, acid eating it, frost racing over
 *   it, shattering frozen, and the galvanic twitch.
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
  frostmite: { curl: [{ sfx: 'organism.frostmite.curl' }], eat: [{ sfx: 'organism.frostmite.eat' }] },
  snowmoth: { flare: [{ sfx: 'organism.snowmoth.flare' }] },
  brineskater: { scatter: [{ sfx: 'organism.brineskater.scatter' }] },
  glassbeetle: { curl: [{ sfx: 'organism.glassbeetle.curl' }] },
  prismmoth: { flare: [{ sfx: 'organism.prismmoth.flare' }] },
  lensmite: { curl: [{ sfx: 'organism.lensmite.curl' }], eat: [{ sfx: 'organism.lensmite.eat' }] },
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
  rimewarden: {
    slam: [{ sfx: 'creature.rimewarden.creak' }],
    stomp: [{ sfx: 'creature.rimewarden.creak', pitch: -3 }],
    throw: [{ sfx: 'creature.rimewarden.creak', pitch: 2 }],
    vent: [{ sfx: 'creature.rimewarden.inhale' }],
    roar: [{ sfx: 'creature.rimewarden.roar' }],
  },
  lenswright: {
    lance: [{ sfx: 'creature.lenswright.iris' }],
    sweep: [{ sfx: 'creature.lenswright.iris', pitch: -2 }],
    flare: [{ sfx: 'creature.lenswright.iris', pitch: 3 }],
    roar: [{ sfx: 'creature.lenswright.roar' }],
  },
  leviathan: {
    lunge: [{ sfx: 'creature.leviathan.dim' }, { sfx: 'creature.leviathan.windup', delay: 0.12 }],
    thrash: [{ sfx: 'creature.leviathan.windup' }],
    dive: [{ sfx: 'creature.leviathan.dive' }, { sfx: 'creature.leviathan.dim', gain: 0.7 }],
  },
};

/** A flora cue: its level can follow the moment's strength, and a range picks between cues. */
export interface FloraCue extends EventCue {
  /** Plays only when the moment's strength is at least this… */
  min?: number;
  /** …and below this. */
  max?: number;
  /** How much of the level follows strength (0 = fixed; 0.4 = strength 0 plays at 60 %). */
  byStrength?: number;
}

type FloraKind = EventMap['floraMoment']['kind'];

/** What each plant moment sounds like (events.ts floraMoment). The call sites stay silent: this is the map. */
export const FLORA_CUES: Readonly<Record<FloraKind, readonly FloraCue[]>> = {
  // The warning: a trunk notched past half its width strains (strength 0.6, or 1 when nearly through).
  creak: [{ sfx: 'flora.creak', byStrength: 0.4 }],
  crack: [{ sfx: 'flora.crack', byStrength: 0.4 }],
  lean: [{ sfx: 'flora.lean' }],
  // The hinge fibres letting go (0.8) or a sapling snapping at the boot (0.4).
  snap: [{ sfx: 'flora.hinge', min: 0.6 }, { sfx: 'flora.sapling', max: 0.6 }],
  whoosh: [{ sfx: 'flora.whoosh', byStrength: 0.5 }],
  shed: [{ sfx: 'flora.canopy', byStrength: 0.5 }],
  settle: [{ sfx: 'flora.settle', byStrength: 0.4 }],
  rustle: [{ sfx: 'flora.rustle', byStrength: 0.3 }],
  podDrop: [{ sfx: 'flora.pod.drop', byStrength: 0.3 }],
  soak: [{ sfx: 'flora.seed.soak' }],
  // The root ladder: each moment of growth keeps the creaking growth loop alive until the crown opens.
  sprout: [{ sfx: 'flora.seed.sprout', byStrength: 0.3 }, { sfx: 'flora.ladder.grow.loop' }],
  rung: [{ sfx: 'flora.ladder.rung' }, { sfx: 'flora.ladder.grow.loop' }],
  bloom: [{ sfx: 'flora.ladder.bloom' }],
};

/**
 * A felled tree's fall, in the floor's own wood: world/floraPass plants each
 * floor's species (the Bellows' birch, the Rot Gardens' giant mushroom, the
 * Cisterns' mangrove, the Kiln's ember-bark), so the biome names the wood.
 */
export const TREE_FALL_CUES: Readonly<Record<string, EventCue>> = {
  earthen: { sfx: 'flora.fall.birch' },
  fungal: { sfx: 'flora.fall.mushroom' },
  flooded: { sfx: 'flora.fall.mangrove' },
  volcanic: { sfx: 'flora.fall.emberbark' },
};

/** The fall cue for a biome (birch where no species of its own grows). */
export function treeFallCue(biome: string | undefined): EventCue {
  return (biome && TREE_FALL_CUES[biome]) || TREE_FALL_CUES.earthen;
}

/** Where the moments happen, for the cues that depend on it (the Game wires it; tests pass their own). */
export interface EventCueWorld {
  /** The current level's biome (the fall's wood). */
  biome?: () => string | undefined;
}

export const LIGHT_CUES = {
  hood: { sfx: 'light.lantern.hood', centred: true },
  unhood: { sfx: 'light.lantern.unhood', centred: true },
  dark: { sfx: 'light.dark', centred: true },
  eyeshine: { sfx: 'light.eyeshine' },
  photocell: { sfx: 'light.photocell.latch' },
  'bloom-open': { sfx: 'light.bloom.open' },
  'bloom-furl': { sfx: 'light.bloom.furl' },
} as const satisfies Record<string, EventCue>;

/**
 * The wand's grip. The gesture is the alchemist's own (centred); the hum sits
 * on the held body. A crate keeps its own lift/throw/drop sounds
 * (entities/RigidBodies) and shares only the hum.
 */
export const TELEKINESIS_CUES: Readonly<Record<TelekinesisPhase, readonly EventCue[]>> = {
  grab: [{ sfx: 'tk.grab', centred: true }],
  hold: [{ sfx: 'tk.hold.loop' }],
  release: [{ sfx: 'tk.release', centred: true }],
  hurl: [{ sfx: 'tk.hurl', centred: true }],
  fizzle: [{ sfx: 'tk.fizzle', centred: true }],
  strain: [{ sfx: 'tk.strain', centred: true }],
};

/** How a telekinesis phase sounds for a body of `mass` (the hum grows with weight; a heavy hurl is lower). */
export function telekinesisCues(phase: TelekinesisPhase, mass: number, target: 'corpse' | 'crate'): readonly EventCue[] {
  if (target === 'crate' && phase !== 'hold') return [];
  const k = Math.min(4, Math.max(0.3, Number.isFinite(mass) ? mass : 1));
  if (phase === 'hold') return [{ ...TELEKINESIS_CUES.hold[0], gain: 0.55 + 0.12 * k }];
  if (phase === 'hurl') return [{ ...TELEKINESIS_CUES.hurl[0], pitch: Math.max(-3, Math.min(2, (1.2 - k) * 1.5)) }];
  return TELEKINESIS_CUES[phase];
}

/** What remains sound like when they do something physical (strength 0..1; lighter bodies ring higher). */
export function corpseCues(kind: CorpseMomentKind, strength: number, mass: number): readonly EventCue[] {
  const s = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1));
  const m = Number.isFinite(mass) ? mass : 1;
  const pitch = Math.max(-4, Math.min(3, (1.2 - m) * 2));
  switch (kind) {
    case 'thud': return m >= 2 || s > 0.75
      ? [{ sfx: 'corpse.thud.heavy', gain: 0.45 + 0.55 * s, pitch }]
      : [{ sfx: 'corpse.thud.light', gain: 0.45 + 0.55 * s, pitch }];
    case 'bowl': return [{ sfx: 'corpse.bowl', gain: 0.6 + 0.4 * s, pitch }];
    case 'splash': return [{ sfx: 'corpse.splash', gain: 0.4 + 0.6 * s }];
    case 'ignite': return [{ sfx: 'corpse.ignite', gain: 0.6 + 0.4 * s }];
    case 'douse': return [{ sfx: 'mat.sizzle' }];
    case 'consume': return [{ sfx: 'corpse.consume', gain: 0.7 + 0.3 * s }];
    case 'dissolve': return [{ sfx: 'corpse.dissolve', gain: 0.6 + 0.4 * s }];
    case 'freeze': return [{ sfx: 'corpse.freeze', gain: 0.6 + 0.4 * s }];
    case 'shatter': return [{ sfx: 'corpse.shatter', gain: 0.7 + 0.3 * s, pitch: pitch * 0.5 }];
    case 'twitch': return [{ sfx: 'corpse.twitch', gain: 0.5 + 0.5 * s }];
  }
}

export function installEventCues(events: EventBus, audio: Pick<AudioApi, 'sfx'>, world: EventCueWorld = {}): () => void {
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
  const playFlora = (kind: FloraKind, x: number, y: number, strength: number): void => {
    const s = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1));
    for (const cue of FLORA_CUES[kind] ?? []) {
      if ((cue.min !== undefined && s < cue.min) || (cue.max !== undefined && s >= cue.max)) continue;
      const k = cue.byStrength ?? 0;
      play(k > 0 ? { ...cue, gain: (cue.gain ?? 1) * (1 - k + k * s) } : cue, x, y);
    }
  };
  const off = [
    listen(events, 'lanternHooded', ({ hooded, x, y, quiet }) => { if (!quiet) play(hooded ? LIGHT_CUES.hood : LIGHT_CUES.unhood, x, y); }),
    listen(events, 'darkZoneEntered', ({ x, y }) => play(LIGHT_CUES.dark, x, y)),
    listen(events, 'eyeshineCaught', ({ x, y }) => play(LIGHT_CUES.eyeshine, x, y)),
    listen(events, 'lightDevice', ({ kind, x, y }) => play(LIGHT_CUES[kind], x, y)),
    listen(events, 'organism', ({ kind, action, x, y }) => playAll(ORGANISM_CUES[kind]?.[action], x, y)),
    listen(events, 'bossMove', ({ kind, move, x, y }) => playAll(BOSS_MOVE_CUES[kind]?.[move], x, y - 10)),
    listen(events, 'floraMoment', ({ kind, x, y, strength }) => playFlora(kind, x, y, strength)),
    listen(events, 'telekinesis', ({ phase, x, y, mass, target }) => playAll(telekinesisCues(phase, mass, target), x, y)),
    listen(events, 'corpseMoment', ({ kind, x, y, strength, mass }) => playAll(corpseCues(kind, strength, mass), x, y)),
    // The fall: the first strike is the big one; a bounce after it is the same wood, lighter.
    listen(events, 'treeLanded', ({ x, y, strength, first }) => {
      const cue = treeFallCue(world.biome?.());
      const s = Math.max(0, Math.min(1, strength));
      if (first) play({ ...cue, gain: 0.6 + 0.4 * s }, x, y);
      else if (s > 0.25) play({ ...cue, gain: 0.15 + 0.35 * s, pitch: 3 }, x, y);
    }),
  ];
  return () => { for (const dispose of off) dispose(); };
}
