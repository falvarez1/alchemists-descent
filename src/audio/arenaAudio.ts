import type { FighterId } from '@/content/fighters';
import type { SfxId } from '@/content/audio/sfxCues';

export interface ArenaHurtSound { cue: SfxId; pitch: number; x: number; y: number; impact: boolean }
/** Three original performances, tuned per fighter without large cartoon pitch shifts. */
export function arenaHurtVoice(fighter: FighterId | null): { cue: SfxId; pitch: number } {
  switch (fighter) {
    case 'brann-rook': return { cue: 'arena.hurt.armored', pitch: -1 };
    case 'rusk-emberjaw': return { cue: 'arena.hurt.armored', pitch: -2 };
    case 'father-thorne': return { cue: 'arena.hurt.armored', pitch: 1 };
    case 'nox-calder': return { cue: 'arena.hurt.armored', pitch: 2 };
    case 'mara-quell': return { cue: 'arena.hurt.duelist', pitch: 0 };
    case 'edda-morrow': return { cue: 'arena.hurt.duelist', pitch: -1 };
    case 'selene-wraith': return { cue: 'arena.hurt.duelist', pitch: 1 };
    case 'sable-fen': return { cue: 'arena.hurt.agile', pitch: -1 };
    case 'kest-rel': return { cue: 'arena.hurt.agile', pitch: 1 };
    default: return { cue: 'arena.hurt.agile', pitch: 0 };
  }
}

/** Stock contact and throws have their own precise contact cue at resolution. */
export function needsArenaHurtImpact(stock: boolean, tag: string | undefined): boolean {
  return !stock || !(tag?.startsWith('melee.') || tag?.startsWith('throw.'));
}

/** The arena's own levels (the Proving Yard, the Duel stage): never a floor of the descent, whatever biome they borrow. */
export const ARENA_LEVEL_IDS: readonly string[] = ['fighter-test', 'fighter-duel'];

/** The facts that place the game in the arena rather than the descent (a narrow view of Ctx). */
export interface ArenaAudioFacts {
  readonly state: { readonly mode: string };
  readonly versus?: { readonly active: boolean } | null;
  readonly arena?: { readonly active: boolean } | null;
  readonly levels?: { readonly current?: { readonly def: { readonly id: string } } | null } | null;
}

/**
 * The Duel (its lobby, a stock match) or an arena level in play. Here the descent's voice and
 * furniture stay out: the narrator, the floor beds and the run's UI cues (QA: the Bellows' arrival
 * line, scheduled before the player left the descent, was read out over the Duel lobby).
 */
export function inArena(f: ArenaAudioFacts): boolean {
  if (f.versus?.active) return true;
  if (f.state.mode !== 'play') return false;
  return f.arena?.active === true || ARENA_LEVEL_IDS.includes(f.levels?.current?.def.id ?? '');
}
