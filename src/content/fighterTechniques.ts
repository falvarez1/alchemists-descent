import type { YardStation } from '@/content/fighterArena';
import type { FighterId } from '@/content/fighters';

/**
 * The ten movement techniques (docs/arena/ROSTER-IDENTITY.md "movement technique", docs/arena/FIGHTER-PHYSICS.md 3): one way of
 * getting around that no other fighter has, built on the fighter's body (core/fighterBody) and its running modifiers. The rules
 * live in `fighters/techniques.ts`; this is the copy the Yard's panel and the roster show.
 */
export interface TechniqueCopy {
  name: string;
  /** How to do it, in the player's words. */
  how: string;
  /** What it is for. */
  why: string;
  /** Where in the Proving Yard to try it. */
  where: YardStation;
}

export const FIGHTER_TECHNIQUES: Readonly<Record<FighterId, TechniqueCopy>> = {
  'ilyra-voss': {
    name: 'Cinder Dash',
    how: 'In the air, tap a direction twice.',
    why: 'A 19-cell air dash that costs a little levitation and leaves embers. Chain a hit into a dash into a kick.',
    where: 'cistern',
  },
  'brann-rook': {
    name: 'Piston Stomp',
    how: 'Press down in the air to plunge.',
    why: 'You plunge heavier than anything, and the landing is a shockwave that hurts and stuns what is near.',
    where: 'ring',
  },
  'sable-fen': {
    name: 'Wall-cling',
    how: 'Fall against a wall holding toward it; jump to kick off.',
    why: 'A slow slide down any wall for about 1.5 s a landing, and a wall-jump away from it.',
    where: 'bluff',
  },
  'mara-quell': {
    name: 'Glide',
    how: 'Hold jump while falling with the jet nearly dry.',
    why: 'She never really falls: when the tank runs low she glides, slowly and far, for free.',
    where: 'bluff',
  },
  'kest-rel': {
    name: 'Wall-run',
    how: 'Run at a wall at speed (the hall wall by the Muster) and hold jump toward it.',
    why: 'Run up the wall for about 0.7 s, then vault off it with a push.',
    where: 'muster',
  },
  'nox-calder': {
    name: 'Shadow-step',
    how: 'Move while hidden in smoke or darkness.',
    why: 'Faster and better in the air while unseen: the smoke is also his road.',
    where: 'ring',
  },
  'edda-morrow': {
    name: 'Hover',
    how: 'Hold jump to rise gently; hold up and jump to stay at your height.',
    why: 'A third of the climb speed and a third of the fuel: a halo that waits where it is.',
    where: 'bluff',
  },
  'selene-wraith': {
    name: 'Carry',
    how: 'Jump again right after you land.',
    why: 'Landing speed rides into the next jump with a little extra: hop-chain to outrun everything.',
    where: 'cistern',
  },
  'rusk-emberjaw': {
    name: 'Skid',
    how: 'Run, then brake or reverse hard.',
    why: 'He drags embers behind him as he stops: real cells that light oil and powder.',
    where: 'kiln',
  },
  'father-thorne': {
    name: 'Root-walk',
    how: 'Stand in moss, vines, leaves or roots.',
    why: 'Inside his own growth he is half again as fast and climbs it like a wall.',
    where: 'cistern',
  },
};
