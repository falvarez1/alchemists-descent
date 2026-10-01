import type { EnemyKind } from '@/core/types';
import type { FighterId } from '@/content/fighters';

/**
 * THE PROVING YARD's copy (docs/FIGHTERS.md "The Proving Yard"): what to try with each fighter's three
 * abilities and WHERE in the yard to try it. Content only; the terrain is `world/fighterArena`, the panel
 * that shows this is `ui/FighterArenaPanel`.
 */

/** The yard's stations, left to right: ids the tips and the terrain share. */
export type YardStation = 'muster' | 'ring' | 'gallery' | 'kiln' | 'bluff' | 'cistern' | 'cell';

export const YARD_STATIONS: Readonly<Record<YardStation, { name: string; blurb: string }>> = {
  muster: { name: 'The Muster', blurb: 'The start: open floor, a dais and two potions.' },
  ring: { name: 'The Sparring Ring', blurb: 'Open floor between two cover pillars; foes spawn here.' },
  gallery: { name: 'The Gallery', blurb: 'A ledge over the ring where shooters stand.' },
  kiln: { name: 'The Kiln Wall', blurb: 'A bay 30 up (climb or levitate onto its lip): a wooden barricade over a powder keg; then an oil lane and a torch on the floor.' },
  bluff: { name: 'The Bluff', blurb: 'A block 96 high to climb (the floor runs under it), with a ledge 34 higher beside it.' },
  cistern: { name: 'The Cistern', blurb: 'A pool 40 deep with a grating bridge across it.' },
  cell: { name: 'The Locked Cell', blurb: 'A sealed stone cell 30 up with foes inside and a wooden door (stand on its lip).' },
};

export interface AbilityTip {
  /** Where to try it. */
  where: YardStation;
  /** What to do, and what you should see. */
  try: string;
}

export interface FighterTips {
  passive: AbilityTip;
  tactical: AbilityTip;
  ultimate: AbilityTip;
}

export const ARENA_TIPS: Readonly<Record<FighterId, FighterTips>> = {
  'ilyra-voss': {
    passive: { where: 'ring', try: 'Hit one foe with a spell, then kick it (F) within 4 s: your next hit sets it alight (Scorch).' },
    tactical: { where: 'ring', try: 'Z lobs a vial: it bursts on the first solid or after a short fuse, knocking foes outward. Throw one at the powder keg behind the Kiln barricade.' },
    ultimate: { where: 'kiln', try: 'T: faster casting, fire-proof, and a burning trail. Run through the oil lane and the torch; foes that follow you burn.' },
  },
  'brann-rook': {
    passive: { where: 'ring', try: 'Take hard hits (the Hurt button, or let a golem hit you): Pressure fills; at full you get brief knockback immunity.' },
    tactical: { where: 'gallery', try: 'Z raises the iron plate in front of you: stand under the Gallery while shooters fire, and shots are eaten. Z again lowers it.' },
    ultimate: { where: 'ring', try: 'T: half damage, no knockback, steam around you that scalds foes within reach. Wade into a wave.' },
  },
  'sable-fen': {
    passive: { where: 'ring', try: 'Wound a foe: it is marked and leaves a green spoor you can read through walls. Hit one and let it run.' },
    tactical: { where: 'bluff', try: 'Z fires a hooked tether: on rock it hauls you to the hook (haul yourself up the Bluff); on a foe it yanks it to you, stunned.' },
    ultimate: { where: 'cell', try: 'T reveals every wounded foe through walls. Wound the foes in the Cell through the door (or the Hurt-foes button), then press T outside.' },
  },
  'mara-quell': {
    passive: { where: 'cell', try: 'Walking foes you cannot see leave purple ripples. Stand outside the Cell while the foes inside pace.' },
    tactical: { where: 'ring', try: 'Z plants a bell (two at a time). A foe that comes near it rings it and every foe nearby is revealed.' },
    ultimate: { where: 'gallery', try: 'T: a wave that slows foes, stuns the shooters on the Gallery and wipes hostile shots in range. Spawn shooters first.' },
  },
  'kest-rel': {
    passive: { where: 'bluff', try: 'Wall climbs and mantles are faster. Climb (Shift) the Bluff and compare with another fighter.' },
    tactical: { where: 'ring', try: 'Z dashes 36 cells along your aim in a puff of soot, with brief invulnerability and a hazy silhouette. Dash through a foe.' },
    ultimate: { where: 'bluff', try: 'T drops a furnace that blasts a column of hot air straight up. Stand in it under the ledge-tower and ride it to the top.' },
  },
  'nox-calder': {
    passive: { where: 'cell', try: 'In smoke or dark you see foes as faint silhouettes. Throw a Blackglass canister (Z) and watch the Cell\'s foes through the cloud.' },
    tactical: { where: 'ring', try: 'Z throws a canister of dense smoke: stand in it and foes lose you. The cloud burns away if lit; try the oil lane.' },
    ultimate: { where: 'ring', try: 'T puts out nearby lights and drops a dark zone around you. Foes lose you; your lantern still burns.' },
  },
  'edda-morrow': {
    passive: { where: 'muster', try: 'Drink a potion (walk into one) or sip the flask (X): each use adds an overshield you can see on the bar.' },
    tactical: { where: 'ring', try: 'Z sends a glass shard to shield you (x0.6 damage for 6 s). Press it, then take a hit from a golem.' },
    ultimate: { where: 'gallery', try: 'T plants a stained-glass prism: it heals you and turns hostile shots aside. Stand in it under the shooters.' },
  },
  'selene-wraith': {
    passive: { where: 'ring', try: 'Run, then press down (S): you slide with your speed instead of creeping. Slide through the tunnel under the Bluff.' },
    tactical: { where: 'bluff', try: 'Z blinks up to 40 cells and leaves an echo; Z again returns you. Blink up onto the Bluff, then back.' },
    ultimate: { where: 'ring', try: 'T sends two decoys ahead and behind you; foes may hunt them and are stunned when they pop one. Spawn a wave.' },
  },
  'rusk-emberjaw': {
    passive: { where: 'ring', try: 'Kick (F) a foe to death: a melee kill restores armor. Start by hurting your armor with the Hurt button.' },
    tactical: { where: 'kiln', try: 'Z charges along your facing: foes are shoved and stunned and Wood breaks. Ram the barricade, then the Cell door.' },
    ultimate: { where: 'kiln', try: 'T: a bigger armor pool, less damage taken, and embers burst when a foe hurts you. Stand in the torch light with a golem next to you.' },
  },
  'father-thorne': {
    passive: { where: 'cistern', try: 'Stand still beside moss or vines for a few seconds and your silhouette fades. Move, and it returns at once.' },
    tactical: { where: 'bluff', try: 'Z grows thorned vines along the surface you aim at, up to 60 cells: grow them up the Bluff and climb them; foes caught in them slow and bleed.' },
    ultimate: { where: 'ring', try: 'T covers a wide zone in climbable roots, moss and hanging vines; foes inside slow down. Climb a root to the Gallery.' },
  },
};

/** The buttons that fill the yard with foes (the panel's "Foes" row). */
export interface FoePreset {
  id: string;
  label: string;
  kind: EnemyKind;
  /** How many are placed. */
  count: number;
  /** Where: the ring floor, the gallery ledge, or inside the sealed cell. */
  at: 'ring' | 'gallery' | 'cell';
}

export const FOE_PRESETS: readonly FoePreset[] = [
  { id: 'slime', label: 'Slime', kind: 'slime', count: 2, at: 'ring' },
  { id: 'golem', label: 'Golem', kind: 'golem', count: 1, at: 'ring' },
  { id: 'imp', label: 'Imp', kind: 'imp', count: 2, at: 'ring' },
  { id: 'bat', label: 'Bat', kind: 'bat', count: 2, at: 'ring' },
  { id: 'shooters', label: 'Shooters', kind: 'spitter', count: 2, at: 'gallery' },
  { id: 'mage', label: 'Mage', kind: 'mage', count: 1, at: 'gallery' },
  { id: 'cell', label: 'Fill the Cell', kind: 'slime', count: 3, at: 'cell' },
];
