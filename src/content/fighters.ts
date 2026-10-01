/**
 * The ten fighters (docs/FIGHTERS.md). IDENTITY ONLY: who they are, what their kit is called and
 * says, and how they read at a glance. What each ability DOES lives in `src/fighters/` (one
 * module per fighter, its tuning numbers beside the code that reads them), and how each fighter
 * LOOKS in the world lives in `src/render/player/fighterLooks.ts`.
 *
 * The copy below is the design document's (alchemists_descent_fighter_roster.html), verbatim.
 * Weapons come from loot; a fighter brings the edge: movement, information, survival or control.
 * Every kit is one passive, one tactical ability and one ultimate.
 */

export type FighterRole = 'Duelist' | 'Bulwark' | 'Hunter' | 'Controller' | 'Support';

export const FIGHTER_ROLES: readonly FighterRole[] = ['Duelist', 'Bulwark', 'Hunter', 'Controller', 'Support'];

export type FighterId =
  | 'ilyra-voss'
  | 'brann-rook'
  | 'sable-fen'
  | 'mara-quell'
  | 'kest-rel'
  | 'nox-calder'
  | 'edda-morrow'
  | 'selene-wraith'
  | 'rusk-emberjaw'
  | 'father-thorne';

export type FighterStatName = 'Offense' | 'Mobility' | 'Survival' | 'Utility';

export interface FighterAbilityCopy {
  name: string;
  description: string;
}

export interface FighterDef {
  id: FighterId;
  /** 1-based roster number (the dossier's "01 / 10"). */
  number: number;
  name: string;
  title: string;
  role: FighterRole;
  /** The fighter's signature colour, for chips and the dossier. */
  accent: string;
  tags: readonly [string, string];
  lore: string;
  playstyle: string;
  passive: FighterAbilityCopy;
  tactical: FighterAbilityCopy;
  ultimate: FighterAbilityCopy;
  /** Design-doc ratings out of 10. Presentation only: no system reads them. */
  stats: Readonly<Record<FighterStatName, number>>;
}

export const FIGHTER_ORDER: readonly FighterId[] = [
  'ilyra-voss',
  'brann-rook',
  'sable-fen',
  'mara-quell',
  'kest-rel',
  'nox-calder',
  'edda-morrow',
  'selene-wraith',
  'rusk-emberjaw',
  'father-thorne',
];

export const FIGHTER_DEFS: Readonly<Record<FighterId, FighterDef>> = {
  'ilyra-voss': {
    id: 'ilyra-voss',
    number: 1,
    name: 'Ilyra Voss',
    title: 'The Cinder Alchemist',
    role: 'Duelist',
    accent: '#efa860',
    tags: ['Burst damage', 'Aggressive pressure'],
    lore: 'A disgraced court chemist who weaponized volatile salamander salts.',
    playstyle: 'Force an opening with a volatile burst, then keep moving while your opponent burns through their options.',
    passive: { name: 'Volatile Mixture', description: 'After damaging an enemy with two different weapons, your next hit briefly applies Scorch.' },
    tactical: { name: 'Flash Crucible', description: 'Throw a vial that bursts after a short fuse, damaging and knocking fighters outward.' },
    ultimate: { name: 'Phoenix Draft', description: 'Overcharge for 8 seconds: faster reloads, fire resistance, and a burning dash trail.' },
    stats: { Offense: 8, Mobility: 8, Survival: 4, Utility: 3 },
  },
  'brann-rook': {
    id: 'brann-rook',
    number: 2,
    name: 'Brann Rook',
    title: 'The Iron Pilgrim',
    role: 'Bulwark',
    accent: '#c5b493',
    tags: ['Frontline', 'Damage mitigation'],
    lore: 'A foundry survivor sealed inside a pressure-assisted mining harness.',
    playstyle: 'Advance behind your guard, absorb the first exchange, and turn stored pressure into a close-range counterattack.',
    passive: { name: 'Pressure Vessel', description: 'Taking heavy damage fills Pressure. At full Pressure, gain brief stagger resistance.' },
    tactical: { name: 'Boiler Guard', description: 'Raise a frontal iron plate that blocks incoming projectiles while walking.' },
    ultimate: { name: 'Redline', description: 'Vent the suit, gaining armor and knockback immunity while emitting damaging steam.' },
    stats: { Offense: 6, Mobility: 3, Survival: 9, Utility: 4 },
  },
  'sable-fen': {
    id: 'sable-fen',
    number: 3,
    name: 'Sable Fen',
    title: 'The Mire Stalker',
    role: 'Hunter',
    accent: '#a5bd7c',
    tags: ['Tracking', 'Vertical pursuit'],
    lore: 'A tracker from the drowned districts who hunts by vibration and scent.',
    playstyle: 'Follow wounded targets through the machinery and use your tether to close the distance before they can reset.',
    passive: { name: 'Wounded Spoor', description: 'Recently wounded enemies leave visible spoor for several seconds.' },
    tactical: { name: 'Bogline', description: 'Fire a hooked tether that pulls Sable toward terrain or lightly jerks enemies off balance.' },
    ultimate: { name: 'Bloodsense', description: 'Reveal wounded fighters in a large radius, even through structures.' },
    stats: { Offense: 8, Mobility: 9, Survival: 4, Utility: 6 },
  },
  'mara-quell': {
    id: 'mara-quell',
    number: 4,
    name: 'Mara Quell',
    title: 'The Bell Witch',
    role: 'Controller',
    accent: '#bb91df',
    tags: ['Detection', 'Disruption'],
    lore: 'A resonance scholar who learned the old sluice bells could fracture more than stone.',
    playstyle: 'Watch the approaches with resonance bells, then break an enemy position with a well-timed disruptive wave.',
    passive: { name: 'Keen Resonance', description: 'Enemy footsteps and climbing sounds are slightly easier to detect nearby.' },
    tactical: { name: 'Resonance Bell', description: 'Place a bell that rings when enemies enter its radius, briefly revealing them.' },
    ultimate: { name: 'Dead Chime', description: 'Send a resonance wave through nearby structures, slowing enemies and disabling placed gadgets.' },
    stats: { Offense: 4, Mobility: 5, Survival: 5, Utility: 10 },
  },
  'kest-rel': {
    id: 'kest-rel',
    number: 5,
    name: 'Kest Rel',
    title: 'The Chimney Jack',
    role: 'Duelist',
    accent: '#e38b6c',
    tags: ['Traversal', 'Rapid escape'],
    lore: 'A rooftop thief who treats the industrial city like one enormous climbing frame.',
    playstyle: 'Take the high route, strike from an unexpected angle, and disappear into soot before the fight turns against you.',
    passive: { name: 'Rooftop Runner', description: 'Mantles, ladders, and ledge grabs are faster.' },
    tactical: { name: 'Smoke Step', description: 'Burst forward through a cloud of soot, briefly obscuring your silhouette.' },
    ultimate: { name: 'Updraft', description: 'Deploy a compact furnace that launches nearby fighters upward for rapid vertical repositioning.' },
    stats: { Offense: 9, Mobility: 9, Survival: 3, Utility: 4 },
  },
  'nox-calder': {
    id: 'nox-calder',
    number: 6,
    name: 'Nox Calder',
    title: 'The Lampblack',
    role: 'Controller',
    accent: '#aebac4',
    tags: ['Concealment', 'Ambush'],
    lore: 'A saboteur whose chemical smoke swallows lamps, scopes, and courage alike.',
    playstyle: 'Cut the enemy’s sightlines, cross exposed space under cover, and dictate when the next exchange begins.',
    passive: { name: 'Soot Sight', description: 'You can see enemy silhouettes slightly better inside smoke and darkness.' },
    tactical: { name: 'Blackglass', description: 'Throw a canister that creates dense, vision-blocking smoke.' },
    ultimate: { name: 'Long Night', description: 'Extinguish artificial lights and darken a large local zone for 12 seconds.' },
    stats: { Offense: 5, Mobility: 6, Survival: 5, Utility: 10 },
  },
  'edda-morrow': {
    id: 'edda-morrow',
    number: 7,
    name: 'Edda Morrow',
    title: 'The Glass Saint',
    role: 'Support',
    accent: '#e2c682',
    tags: ['Protection', 'Squad sustain'],
    lore: 'A monastery artisan who discovered that stained alchemical glass could store life energy.',
    playstyle: 'Keep your squad standing with timely protection, then establish a rally point around your healing prism.',
    passive: { name: 'Stored Light', description: 'Shield consumables used by Edda grant a small overshield.' },
    tactical: { name: 'Mercy Shard', description: 'Send a floating shard to an ally, granting temporary damage reduction.' },
    ultimate: { name: 'Rose Window', description: 'Create a stationary prism that pulses healing and refracts enemy projectiles away from its center.' },
    stats: { Offense: 3, Mobility: 5, Survival: 6, Utility: 10 },
  },
  'selene-wraith': {
    id: 'selene-wraith',
    number: 8,
    name: 'Selene Wraith',
    title: 'The Mercury Twin',
    role: 'Duelist',
    accent: '#8fbee9',
    tags: ['Decoys', 'Repositioning'],
    lore: 'An assassin altered by forbidden mercury transmutation, never quite occupying one place.',
    playstyle: 'Bait a commitment with an echo, change your angle, and strike while your opponent is tracking the wrong silhouette.',
    passive: { name: 'Liquid Momentum', description: 'Sliding after a sprint travels farther and preserves more momentum.' },
    tactical: { name: 'Quicksilver Echo', description: 'Leave an echo and blink a short distance; reactivate quickly to return.' },
    ultimate: { name: 'Mirror Hunt', description: 'Create two harmless moving echoes that mimic your movement direction and weapon silhouette.' },
    stats: { Offense: 10, Mobility: 9, Survival: 2, Utility: 3 },
  },
  'rusk-emberjaw': {
    id: 'rusk-emberjaw',
    number: 9,
    name: 'Rusk Emberjaw',
    title: 'The Furnace Hound',
    role: 'Bulwark',
    accent: '#f09961',
    tags: ['Brawling', 'Close-range pressure'],
    lore: 'A pit fighter rebuilt with ceramic teeth, iron ribs, and an illegal furnace heart.',
    playstyle: 'Break through the entrance and stay in melee range, where your furnace turns incoming pressure into a threat of its own.',
    passive: { name: 'Scrap Recovery', description: 'Melee eliminations restore a small amount of armor.' },
    tactical: { name: 'Shoulder Ram', description: 'Charge a short distance, breaking doors and knocking enemies aside.' },
    ultimate: { name: 'Kiln Heart', description: 'Gain temporary maximum armor and leave damaging embers when hit at close range.' },
    stats: { Offense: 8, Mobility: 4, Survival: 10, Utility: 2 },
  },
  'father-thorne': {
    id: 'father-thorne',
    number: 10,
    name: 'Father Thorne',
    title: 'The Briar Heretic',
    role: 'Controller',
    accent: '#a5c77b',
    tags: ['Terrain control', 'Traps'],
    lore: 'A botanist-priest who cultivates aggressive flora in the cracks of abandoned machinery.',
    playstyle: 'Turn a useful position into hostile terrain, slowing incoming fighters while creating cover and climbing routes.',
    passive: { name: 'Rooted Camouflage', description: 'Remain still near natural cover to slowly reduce your visibility to distant enemies.' },
    tactical: { name: 'Ironvine', description: 'Grow thorny vines across a surface, slowing anyone crossing them.' },
    ultimate: { name: 'Overgrowth', description: 'Rapidly cover a zone in climbable roots, concealment, and slowing ground vegetation.' },
    stats: { Offense: 3, Mobility: 5, Survival: 7, Utility: 10 },
  },
};

export function isFighterId(value: unknown): value is FighterId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FIGHTER_DEFS, value);
}

/** The roster portrait (shipped, ~25 KB) and the concept sheet (lazy: ~150 KB, only the dossier asks). */
export function fighterPortraitUrl(id: FighterId): string {
  return `${import.meta.env.BASE_URL}assets/fighters/${id}.webp`;
}

export function fighterSheetUrl(id: FighterId): string {
  return `${import.meta.env.BASE_URL}assets/fighters/sheets/${id}.webp`;
}
