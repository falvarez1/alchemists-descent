import type { Ctx, GameMode } from '@/core/types';

/** What the decision needs to know; gathered by {@link FocusPause} from the live game. */
export interface FocusFacts {
  /** The player's "Pause when the window loses focus" option. */
  enabled: boolean;
  mode: GameMode;
  paused: boolean;
  dead: boolean;
  builderOpen: boolean;
  /** Another modal owns the keyboard: the title, a dialog, a menu, the death card, a cinematic. */
  uiOwnerActive: boolean;
  /** A character is mid-conversation (Pell): the dialogue box has the screen. */
  dialogueOpen: boolean;
  /** A second window is linked to this world (AuthorLink): losing focus is how you work with two. */
  linkedPeers: boolean;
}

/**
 * Losing focus pauses a descent that is actually being played, and nothing else.
 * Not the Sandbox (the sim is the toy there), not the title or any menu (already
 * still), not a cinematic or a conversation (they own their own pacing), not the
 * death card, not the Builder, and not while a linked editor window is open (you
 * watch the game from the other window on purpose).
 */
export function shouldPauseOnFocusLoss(f: FocusFacts): boolean {
  return f.enabled && f.mode === 'play' && !f.paused && !f.dead && !f.builderOpen
    && !f.uiOwnerActive && !f.dialogueOpen && !f.linkedPeers;
}

/**
 * Pause-on-blur. Asks the pause menu for a pause through the same
 * `game-pause-request` the Start button and the Pause button use, so the Esc
 * menu owns the pause claim and Resume works as always. The request is a
 * TOGGLE there, so it is only ever sent while the game is not already paused.
 */
export class FocusPause {
  private dialogueOpen = false;
  private readonly offs: Array<() => void> = [];
  private readonly onBlur = (): void => { this.focusLost(); };
  private readonly onVisibility = (): void => { if (document.hidden) this.focusLost(); };

  constructor(private readonly ctx: Ctx, private readonly uiOwnerActive: () => boolean) {
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.offs.push(
      ctx.events.on('storyDialogue', (view) => { this.dialogueOpen = view?.open === true; }),
      ctx.events.on('levelChanged', () => { this.dialogueOpen = false; }),
    );
  }

  facts(): FocusFacts {
    const { state, player } = this.ctx;
    return {
      enabled: state.pauseOnBlur !== false,
      mode: state.mode,
      paused: state.paused,
      dead: player.dead,
      builderOpen: document.body.classList.contains('builder-open'),
      uiOwnerActive: this.uiOwnerActive(),
      dialogueOpen: this.dialogueOpen,
      linkedPeers: (this.ctx.peers?.count ?? 0) > 0 || this.ctx.duel?.active === true,
    };
  }

  /** True when this focus loss asked for a pause. */
  focusLost(): boolean {
    if (!shouldPauseOnFocusLoss(this.facts())) return false;
    window.dispatchEvent(new Event('game-pause-request'));
    return true;
  }

  dispose(): void {
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const off of this.offs.splice(0)) off();
  }
}
