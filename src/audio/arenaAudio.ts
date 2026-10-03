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
