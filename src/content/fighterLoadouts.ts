import type { FighterId } from '@/content/fighters';
import type { CardId, WandLoadoutSave } from '@/core/types';
import { Cell } from '@/sim/CellType';

/**
 * THE SIGNATURE LOADOUTS (docs/arena/MOVESETS-V2.md 6a): in a duel, each fighter carries the wands, cards and flasks that are THEIRS,
 * not the run's. The measurement behind it (docs/arena/TELEMETRY-AND-BALANCE.md 9): 80% of all damage in a fight is the primary attack,
 * and while every fighter carried the same Spark Bolt the fights were decided by the body's health and power multipliers, never by the
 * kit. A fighter's primary is where its style lives: this is data, so the telemetry tuner turns it like any number.
 *
 * Rules a loadout keeps (`tests/fighter-loadouts.test.ts`): wand I is the main weapon (a bot holds the active wand: it starts on wand I);
 * cards fit the frame's slots; no two fighters share wand I; the modifiers precede what they modify.
 */

export interface FlaskBelt {
  material: number;
  count: number;
}

export interface FighterLoadout {
  /** One line: the idea (what the primary is for, how it plays). */
  idea: string;
  wands: [
    { frameId: string; cards: (CardId | null)[] },
    { frameId: string; cards: (CardId | null)[] },
  ];
  flasks: FlaskBelt[];
}

export const FIGHTER_LOADOUTS: Readonly<Record<FighterId, FighterLoadout>> = {
  'ilyra-voss': {
    idea: 'a fast two-weapon rushdown: sparks in pairs from a rapid needle, a flame jet that hits harder on what already burns',
    wands: [{ frameId: 'quill', cards: ['double', 'spark', 'spark'] }, { frameId: 'bone', cards: ['pyrecrit', 'flame', null, null] }],
    flasks: [{ material: Cell.Oil, count: 300 }, { material: Cell.Gunpowder, count: 120 }],
  },
  'brann-rook': {
    idea: 'point-blank heavy shots: slow, hard, with a long recharge; the body walks them in',
    wands: [{ frameId: 'mortar', cards: ['heavy', 'spark', null, null, null, null] }, { frameId: 'bone', cards: ['kickback', 'spark', null, null] }],
    flasks: [{ material: Cell.Water, count: 300 }],
  },
  'sable-fen': {
    idea: 'homing pokes that keep the wounds coming: motes that hunt, a spread of sparks to finish',
    wands: [{ frameId: 'oak', cards: ['shorthoming', 'wisp', null] }, { frameId: 'bone', cards: ['spread', 'spark', null, null] }],
    flasks: [{ material: Cell.Slime, count: 200 }],
  },
  'mara-quell': {
    idea: 'electrified bolts from a big tank that charge what they touch; the bells and the chime do the controlling, the arcs wait in the second wand',
    wands: [{ frameId: 'samovar', cards: ['electriccharge', 'spark', null, null] }, { frameId: 'bone', cards: ['lightning', 'bounce', null, null] }],
    flasks: [{ material: Cell.Water, count: 300 }],
  },
  'kest-rel': {
    idea: 'darts on the move: three fast sparks, a shotgun of needles, always moving',
    wands: [{ frameId: 'pepperpot', cards: ['triple', 'speed', 'spark', 'spark'] }, { frameId: 'bone', cards: ['dig', null, null, null] }],
    flasks: [{ material: Cell.Oil, count: 200 }],
  },
  'nox-calder': {
    idea: 'the trap shot: a spark that releases a chain of lightning where it lands; acid and a black hole in the second wand for denial',
    wands: [{ frameId: 'bone', cards: ['trigger', 'spark', 'lightning', null] }, { frameId: 'oak', cards: ['vitriol', 'blackhole', null] }],
    flasks: [{ material: Cell.Nitrogen, count: 200 }],
  },
  'edda-morrow': {
    idea: 'precise piercing lances that hit harder on the frozen; the shard defence and a frosted answer',
    wands: [{ frameId: 'void', cards: ['frostcharge', 'icelance', 'shattercrit', 'icelance', null] }, { frameId: 'bone', cards: ['frostshard', null, null, null] }],
    flasks: [{ material: Cell.Healium, count: 200 }],
  },
  'selene-wraith': {
    idea: 'ricochets and the blink: sparks that bounce and fan, a warp bolt to be somewhere else',
    wands: [{ frameId: 'oak', cards: ['bounce', 'spread', 'spark'] }, { frameId: 'bone', cards: ['warp', null, null, null] }],
    flasks: [{ material: Cell.Water, count: 300 }],
  },
  'rusk-emberjaw': {
    idea: 'close and loud: a cast bomb that hits twice as hard; the flame jet that lights what it blows up waits in the second wand',
    wands: [{ frameId: 'brass', cards: ['kickback', 'bomb', null, null, null] }, { frameId: 'bone', cards: ['pyrecrit', 'flame', null, null] }],
    flasks: [{ material: Cell.Oil, count: 300 }],
  },
  'father-thorne': {
    idea: 'a thorn that rebounds: a heavy bolt off the walls; a conjured disc of stone to wall a lane in the second wand',
    wands: [{ frameId: 'oak', cards: ['bounce', 'millstone', 'spark'] }, { frameId: 'bone', cards: ['conjure', 'wisp', null, null] }],
    flasks: [{ material: Cell.Water, count: 300 }, { material: Cell.Slime, count: 200 }],
  },
};

/** A loadout as the wand system's own save shape (full mana): `WandsApi.loadLoadout` installs it. */
export function loadoutSave(id: FighterId): WandLoadoutSave {
  const l = FIGHTER_LOADOUTS[id];
  const collection = [...new Set(l.wands.flatMap((w) => w.cards).filter((c): c is CardId => c !== null))];
  return {
    active: 0,
    collection,
    wands: l.wands.map((w) => ({ frameId: w.frameId, cards: [...w.cards], mana: 1e9 })),
  };
}
