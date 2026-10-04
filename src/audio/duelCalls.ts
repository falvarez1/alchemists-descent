import type { FighterId } from '@/content/fighters';
import type { StockStageId } from '@/config/stockStage';
import type { VersusDevice, VersusPhase } from '@/core/versus';
import type { EventMap } from '@/core/events';
import type { SfxId } from '@/content/audio/sfxCues';
import { duelCountLine, duelFighterLine, duelReadyLine, duelStageLine, duelUltimateLine, duelWinsLine } from '@/content/audio/duelLines';

/**
 * WHAT THE CABINET CALLS, AND WHEN: the pure half of audio/DuelAnnouncer.
 * Every call answers a real moment: the select screen's model changing
 * (versusChanged), the stock match's beats (stockMatchBeat), a ring-out
 * (fighterDown), a shield giving out (stockShieldBreak), an ultimate (stockUltimate),
 * the VS card while the match loads.
 */

/**
 * One step of a call: a line of the announcer's (content/audio/duelLines id) and/or a sound, in order.
 * `atMs`: the step lands this long after the call began (on the audio clock: a beat the HUD shows at a
 * fixed time) rather than just after the line before it.
 */
export interface DuelStep { line?: string; sfx?: SfxId; atMs?: number }

export interface DuelCall {
  steps: DuelStep[];
  /**
   * A call cuts the one in progress when its priority is at least as high (a new
   * name cuts the last name: the player cycles fast); a lower one is not made.
   */
  priority: number;
  /** A select-screen call: not made once the lobby has closed (a name still loading as the match starts). */
  lobbyOnly?: boolean;
}

/**
 * The winner's name lands this long after GAME!, with the HUD's "<Name> wins" banner (ui/StockMatchHud:
 * GAME! the moment the match finishes, the name 950 ms later, the results card at 2.2 s).
 */
export const RESULT_NAME_MS = 950;

/** The select screen's calls cut each other; a ring-out outranks them; the countdown and the result outrank everything. */
export const DUEL_PRIORITY = { select: 1, minor: 1, down: 2, beat: 3 } as const;

/** Countdown numbers the announcer has a recording for (a longer countdown ticks silently above them). */
const COUNT_CALLS = 3;

export interface LobbySeatView { readonly fighter: FighterId; readonly device: VersusDevice; readonly ready: boolean }
export interface LobbyView { readonly phase: VersusPhase; readonly stage: StockStageId; readonly seats: readonly LobbySeatView[] }

/** A copy of what the select screen shows (the session mutates its seats in place). */
export function lobbyView(v: LobbyView): LobbyView {
  return { phase: v.phase, stage: v.stage, seats: v.seats.map((s) => ({ fighter: s.fighter, device: s.device, ready: s.ready })) };
}

/**
 * The select screen's calls for one change of the session: "Choose your fighter!" as the lobby
 * opens; a fighter's name as a seat chooses it; the stage's name; "Player one, ready!" when a
 * player (never the CPU, which is always ready) locks in; "Here comes a new challenger!" with the
 * coin when a second player takes the CPU's seat.
 */
export function lobbyCalls(prev: LobbyView | null, next: LobbyView): DuelCall[] {
  if (next.phase !== 'lobby') return [];
  if (!prev || prev.phase !== 'lobby') return [{ steps: [{ line: 'choose' }], priority: DUEL_PRIORITY.select, lobbyOnly: true }];
  const calls: DuelCall[] = [];
  next.seats.forEach((seat, slot) => {
    const was = prev.seats[slot];
    if (!was) return;
    const human = seat.device !== 'cpu';
    if (human && was.device === 'cpu' && next.seats.every((s) => s.device !== 'cpu')) {
      calls.push({ steps: [{ sfx: 'duel.join', line: 'challenger' }], priority: DUEL_PRIORITY.select, lobbyOnly: true });
      return;
    }
    if (seat.fighter !== was.fighter) calls.push({ steps: [{ line: duelFighterLine(seat.fighter) }], priority: DUEL_PRIORITY.select, lobbyOnly: true });
    if (human && seat.device === was.device && seat.ready && !was.ready) calls.push({ steps: [{ sfx: 'duel.ready', line: duelReadyLine(slot) }], priority: DUEL_PRIORITY.select, lobbyOnly: true });
  });
  if (next.stage !== prev.stage) calls.push({ steps: [{ sfx: 'duel.stage', line: duelStageLine(next.stage) }], priority: DUEL_PRIORITY.select, lobbyOnly: true });
  return calls;
}

/** A countdown number's call: the number (or "Rematch!" opening a rematch) over the tick. */
export function countCall(count: number, rematch: boolean): DuelCall | null {
  if (count <= 0) return null;
  const line = rematch ? 'rematch' : count <= COUNT_CALLS ? duelCountLine(count) : undefined;
  return { steps: [{ sfx: 'duel.count', line }], priority: DUEL_PRIORITY.beat };
}

/**
 * A match beat's call. The fight: "Fight!" on the sting. The end: "Game!" (or "Time!" when the clock
 * ran out) on the GAME sting, then the winner's name on the results card's slam, or "Draw game!".
 */
export function beatCall(beat: EventMap['stockMatchBeat'], opts: { winner: FighterId | null; timeUp: boolean; rematch: boolean }): DuelCall | null {
  if (beat.state === 'countdown') return countCall(beat.count, opts.rematch);
  if (beat.state === 'fighting') return { steps: [{ sfx: 'duel.fight', line: 'fight' }], priority: DUEL_PRIORITY.beat };
  const close: DuelStep = beat.winner === null || !opts.winner ? { sfx: 'duel.results', line: 'draw', atMs: RESULT_NAME_MS } : { sfx: 'duel.results', line: duelWinsLine(opts.winner), atMs: RESULT_NAME_MS };
  return { steps: [{ sfx: 'duel.game', line: opts.timeUp ? 'time' : 'game' }, close], priority: DUEL_PRIORITY.beat };
}

/**
 * A ring-out. The blast always; the announcer only while the match goes on (the final stock's
 * call is "Game!"): "Self-destruct!" when nobody's blow sent them out, else "Ring out!" and "K.O.!"
 * in turn, and "Last stock!" when the fighter comes back on their last.
 */
export function downCall(ev: EventMap['fighterDown'], opts: { stocksLeft: number; finished: boolean; downsSoFar: number }): DuelCall {
  if (opts.finished) return { steps: [{ sfx: 'duel.ko' }], priority: DUEL_PRIORITY.down };
  const steps: DuelStep[] = [{ sfx: 'duel.ko', line: ev.by === ev.slot ? 'self-destruct' : opts.downsSoFar % 2 === 0 ? 'ring-out' : 'ko' }];
  if (opts.stocksLeft === 1) steps.push({ line: 'last-stock' });
  return { steps, priority: DUEL_PRIORITY.down };
}

/**
 * The VS card (the match loading): "<P1>! Versus! <P2>!" and the stage, one call so the names never cut
 * each other; the first countdown beat cuts whatever is left of it.
 */
export function versusCall(p1: FighterId, p2: FighterId, stage?: StockStageId): DuelCall {
  const steps: DuelStep[] = [{ line: duelFighterLine(p1) }, { sfx: 'duel.stage', line: 'versus' }, { line: duelFighterLine(p2) }];
  if (stage) steps.push({ line: duelStageLine(stage) });
  return { steps, priority: DUEL_PRIORITY.select };
}

/** An ultimate fires (the super freeze): the super sting and the ultimate's own name, shouted. */
export const ultimateCall = (fighter: FighterId): DuelCall => ({ steps: [{ sfx: 'duel.super', line: duelUltimateLine(fighter) }], priority: DUEL_PRIORITY.down });

/** A shield gave out: a passing call that never talks over a bigger one. */
export const shieldBreakCall = (): DuelCall => ({ steps: [{ line: 'shield-break' }], priority: DUEL_PRIORITY.minor });
