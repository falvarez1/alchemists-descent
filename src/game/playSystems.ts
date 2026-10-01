import type { Ctx, SanctumApi } from '@/core/types';
import type { StreamHost } from '@/audio/streamHost';
import { MusicDirector } from '@/audio/MusicDirector';
import { Narrator } from '@/audio/Narrator';
import { StoryDirector } from '@/game/story/StoryDirector';
import { NarrationCaption } from '@/ui/NarrationCaption';
import { AshVoice } from '@/ui/story/AshVoice';
import { Sanctum } from '@/ui/Sanctum';
import { Callouts } from '@/ui/Callouts';
import { CardOfferOverlay } from '@/ui/CardOfferOverlay';
import { HintTeachOverlay } from '@/ui/HintTeachOverlay';
import { HelpOverlay } from '@/ui/HelpOverlay';
import { Grimoire } from '@/ui/Grimoire';
import { TeaMachineOverlay } from '@/ui/TeaMachineOverlay';
import { BowlPanel } from '@/ui/BowlPanel';
import { ClueDirector } from '@/game/alchemy/clues';

/**
 * THE PLAY SYSTEMS — what a run needs and the title screen does not, loaded as
 * their own chunk (game/Game `loadPlaySystems`). The Game starts the download
 * the moment the title shows, and every way into a run (the entry's buttons,
 * the dev console, a dev reload restoring play) waits for it, so a run never
 * starts without them; in practice the chunk has landed long before anyone
 * clicks.
 *
 * Only systems whose place in the event and key order does not matter live
 * here: their keyboard listeners are bubble-phase listeners that already ran
 * after the eager ones (the Handbook, the Grimoire), or none at all. Overlays
 * whose CAPTURE listeners must run before the InputManager's (the dialogue
 * box, the story plates, the ledger, the map, the wand bench) stay in the
 * boot chunk. Construction order below is the order the Game used to build
 * them in.
 */
export interface PlaySystems {
  /** The Sanctum behind ctx.sanctum's stand-in (game/Game). */
  readonly sanctum: SanctumApi;
  /** Page-lifetime systems the Game disposes with itself. */
  readonly disposables: readonly { dispose(): void }[];
}

/**
 * `gestured`: a real pointer/key/touch gesture already happened on the page
 * (the Game watches from boot, the way the score used to), so the score
 * unlocks now instead of waiting for the next one.
 */
export function installPlaySystems(ctx: Ctx, audio: StreamHost, gestured: boolean): PlaySystems {
  const disposables: { dispose(): void }[] = [];
  const sanctum = new Sanctum(ctx);
  disposables.push(sanctum);
  // The score and the narrator: streamed recordings on the engine's music and
  // voice buses. Both stay silent (and fetch nothing) until the first gesture.
  const music = new MusicDirector(ctx, audio);
  // Built after the title showed: a click that came first still unlocks the score.
  if (gestured) music.adoptEarlierGesture();
  ctx.music = music;
  const narrator = new Narrator(ctx, audio);
  // The story (wave 3): the Docent's pipes, Pell, the echoes, the prologues, the Kiln escape.
  const story = new StoryDirector(ctx);
  ctx.story = story;
  disposables.push(story);
  ctx.narrator = narrator;
  disposables.push(music, narrator, new NarrationCaption(ctx));
  // Matron Ash's voice in the Sanctum.
  disposables.push(new AshVoice(ctx));
  // World-anchored alchemical-kill words (listens to `alchemyKill`/`combatCallout`).
  disposables.push(new Callouts(ctx));
  disposables.push(new CardOfferOverlay(ctx));
  disposables.push(new HintTeachOverlay(ctx));
  // The Handbook (H). Its ESC yields to the pause overlay registered before it.
  disposables.push(new HelpOverlay(ctx));
  // The wizard's Grimoire book (toggle with `J`), with the Journal tab.
  disposables.push(new Grimoire(ctx));
  disposables.push(new TeaMachineOverlay(ctx));
  // THE EXPERIMENT: the panel over the cauldron's bowl, and the margin notes play writes into the Grimoire.
  disposables.push(new BowlPanel(ctx));
  disposables.push(new ClueDirector(ctx));
  return { sanctum, disposables };
}
