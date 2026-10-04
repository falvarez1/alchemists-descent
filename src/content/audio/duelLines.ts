/**
 * THE DUEL ANNOUNCER'S LINES: every call the arcade announcer can make, each
 * tied to a real moment (audio/duelCalls decides which; audio/DuelAnnouncer
 * plays them). The recordings are made by scripts/audio/gen-duel-announcer.mjs,
 * which reads this table, checks every take with speech-to-text and writes
 * content/audio/duelAnnouncer.generated.ts.
 *
 * Plain data with type-only imports, so the Node generator can import it
 * directly. The names are written out here for that reason; the tests hold
 * them to content/fighters and config/stockStage.
 */
import type { FighterId } from '@/content/fighters';
import type { StockStageId } from '@/config/stockStage';

export type DuelLineGroup = 'select' | 'match' | 'result';

export interface DuelLine {
  /** Stable id: the clip's file name and its key in the manifest. */
  id: string;
  /** The words: what the caption would show and what speech-to-text must hear back. */
  text: string;
  /** The delivery sent to the voice (eleven_v3 audio tags, emphasis); defaults to `text`. */
  say?: string;
  group: DuelLineGroup;
  /** eleven_v3 speed for this line when it differs from the generator's (1 = the voice's own pace). */
  speed?: number;
  /** A call that must fit its beat (the countdown's 40 ticks): mastered no longer than this, sped up if it has to be. */
  maxSeconds?: number;
}

/** Read on the select screen as a fighter is chosen (FIGHTER_DEFS names). */
export const DUEL_FIGHTER_NAMES: Readonly<Record<FighterId, string>> = {
  'ilyra-voss': 'Ilyra Voss',
  'brann-rook': 'Brann Rook',
  'sable-fen': 'Sable Fen',
  'mara-quell': 'Mara Quell',
  'kest-rel': 'Kest Rel',
  'nox-calder': 'Nox Calder',
  'edda-morrow': 'Edda Morrow',
  'selene-wraith': 'Selene Wraith',
  'rusk-emberjaw': 'Rusk Emberjaw',
  'father-thorne': 'Father Thorne',
};

/** The winner's call uses the name the results card shows (ui/duelCopy duelShortName). */
export const DUEL_SHORT_NAMES: Readonly<Record<FighterId, string>> = {
  'ilyra-voss': 'Ilyra',
  'brann-rook': 'Brann',
  'sable-fen': 'Sable',
  'mara-quell': 'Mara',
  'kest-rel': 'Kest',
  'nox-calder': 'Nox',
  'edda-morrow': 'Edda',
  'selene-wraith': 'Selene',
  'rusk-emberjaw': 'Rusk',
  'father-thorne': 'Thorne',
};

/** STOCK_STAGES names. */
export const DUEL_STAGE_NAMES: Readonly<Record<StockStageId, string>> = {
  foundry: 'The Foundry',
  kiln: 'The Kiln',
  cistern: 'The Cistern',
  gallery: 'The Gallery',
};

/** Shouted as the ultimate fires (FIGHTER_DEFS ultimate names; the stockUltimate event's `name`). */
export const DUEL_ULTIMATE_NAMES: Readonly<Record<FighterId, string>> = {
  'ilyra-voss': 'Phoenix Draft',
  'brann-rook': 'Redline',
  'sable-fen': 'Bloodsense',
  'mara-quell': 'Dead Chime',
  'kest-rel': 'Updraft',
  'nox-calder': 'Long Night',
  'edda-morrow': 'Rose Window',
  'selene-wraith': 'Mirror Hunt',
  'rusk-emberjaw': 'Kiln Heart',
  'father-thorne': 'Overgrowth',
};

export const duelFighterLine = (id: FighterId): string => `fighter.${id}`;
export const duelWinsLine = (id: FighterId): string => `wins.${id}`;
export const duelStageLine = (id: StockStageId): string => `stage.${id}`;
export const duelCountLine = (n: number): string => `count.${n}`;
export const duelReadyLine = (slot: number): string => `ready.${slot + 1}`;
export const duelUltimateLine = (id: FighterId): string => `ultimate.${id}`;

/** The countdown's beats are 40 ticks (0.67 s): each number is said inside one. */
const BEAT_SECONDS = 0.6;

const SEAT_WORDS = ['one', 'two'] as const;

/**
 * Deliveries that differ from the words. Speech-to-text heard the plain 'Kest' as 'Cast' (and 'Kest Rel' as
 * 'Castrol') in every take: written in capitals the voice holds the E and it comes back as KEST.
 */
const SAY: Readonly<Record<string, string>> = { 'fighter.kest-rel': 'KEST REL!', 'wins.kest-rel': 'KEST wins!', ko: 'K. O.!' };
/** At the fast read (1.2) every delivery of 'Kest Rel' tried was spelled out (K-E-S-T) or heard as 'Castrol': it keeps the voice's own pace. */
const SPEED: Readonly<Record<string, number>> = { 'fighter.kest-rel': 1 };

export const DUEL_LINES: readonly DuelLine[] = [
  { id: 'choose', text: 'Choose your fighter!', group: 'select' },
  ...(Object.entries(DUEL_FIGHTER_NAMES) as Array<[FighterId, string]>).map(([id, name]): DuelLine => ({ id: duelFighterLine(id), text: `${name}!`, say: SAY[duelFighterLine(id)], speed: SPEED[duelFighterLine(id)], group: 'select' })),
  ...(Object.entries(DUEL_STAGE_NAMES) as Array<[StockStageId, string]>).map(([id, name]): DuelLine => ({ id: duelStageLine(id), text: `${name}!`, group: 'select' })),
  ...SEAT_WORDS.map((word, slot): DuelLine => ({ id: duelReadyLine(slot), text: `Player ${word}, ready!`, group: 'select' })),
  { id: 'challenger', text: 'Here comes a new challenger!', group: 'select' },
  // The VS card (the match loading): "<P1>! Versus! <P2>! <Stage>!"; preloaded with the select screen.
  { id: 'versus', text: 'Versus!', group: 'select' },
  { id: duelCountLine(3), text: 'Three!', group: 'match', maxSeconds: BEAT_SECONDS },
  { id: duelCountLine(2), text: 'Two!', group: 'match', maxSeconds: BEAT_SECONDS },
  { id: duelCountLine(1), text: 'One!', group: 'match', maxSeconds: BEAT_SECONDS },
  { id: 'fight', text: 'Fight!', group: 'match' },
  { id: 'ko', text: 'K.O.!', say: SAY.ko, group: 'match' },
  { id: 'ring-out', text: 'Ring out!', group: 'match' },
  { id: 'self-destruct', text: 'Self-destruct!', group: 'match' },
  { id: 'last-stock', text: 'Last stock!', group: 'match' },
  { id: 'shield-break', text: 'Shield break!', group: 'match' },
  ...(Object.entries(DUEL_ULTIMATE_NAMES) as Array<[FighterId, string]>).map(([id, name]): DuelLine => ({ id: duelUltimateLine(id), text: `${name}!`, group: 'match' })),
  { id: 'time', text: 'Time!', group: 'result' },
  { id: 'game', text: 'Game!', group: 'result' },
  ...(Object.entries(DUEL_SHORT_NAMES) as Array<[FighterId, string]>).map(([id, name]): DuelLine => ({ id: duelWinsLine(id), text: `${name} wins!`, say: SAY[duelWinsLine(id)], group: 'result' })),
  { id: 'draw', text: 'Draw game!', group: 'result' },
  // Said on a rematch's first countdown beat, in place of "Three!".
  { id: 'rematch', text: 'Rematch!', group: 'result', maxSeconds: BEAT_SECONDS },
];
