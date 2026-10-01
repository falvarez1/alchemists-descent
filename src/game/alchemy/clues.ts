import { CLUES, type Clue } from '@/content/alchemyClues';
import { loadClues, loadDiscoveredMaterials, loadDiscoveredRecipes, recordClue } from '@/core/grimoireStore';
import type { Ctx } from '@/core/types';

/**
 * THE MARGINALIA DIRECTOR: writes the Grimoire's margin notes (content/alchemyClues)
 * as play earns them. It listens to what the game already says (a material examined,
 * a floor entered, a kill, a recipe brewed) and inscribes the matching notes, once,
 * into the persistent Grimoire (so a note found on one run is there on the next).
 *
 * A note about a recipe the reader already knows is moot: it is written quietly,
 * with no toast. A note that arrives while playing says so, once per note.
 */
export class ClueDirector {
  private readonly offs: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    const on = ctx.events.on.bind(ctx.events);
    this.offs.push(
      on('grimoireEntryDiscovered', ({ kind, id }) => {
        if (kind === 'material') this.fire((c) => c.on.on === 'examine' && String(c.on.cell) === id);
      }),
      on('levelChanged', () => this.onFloor()),
      on('enemyKilled', ({ kind }) => this.fire((c) => c.on.on === 'kill' && (c.on.kind === '*' || c.on.kind === kind))),
      on('recipeBrewed', ({ id }) => this.fire((c) => c.on.on === 'brewed' && c.on.recipe === id)),
    );
    this.catchUp();
  }

  private onFloor(): void {
    const level = this.ctx.levels?.current?.def.id;
    if (level) this.fire((c) => c.on.on === 'floor' && c.on.level === level);
  }

  /** What the reader already knows from earlier runs is written in at once, without a word. */
  private catchUp(): void {
    const materials = loadDiscoveredMaterials();
    const recipes = loadDiscoveredRecipes();
    const level = this.ctx.levels?.current?.def.id;
    this.fire(
      (c) =>
        (c.on.on === 'examine' && materials[String(c.on.cell)] === true) ||
        (c.on.on === 'brewed' && recipes[c.on.recipe] === true) ||
        (c.on.on === 'floor' && c.on.level === level),
      true,
    );
  }

  private fire(match: (c: Clue) => boolean, quiet = false): void {
    const known = loadDiscoveredRecipes();
    const have = loadClues();
    let toasted = false;
    for (const c of CLUES) {
      if (have[c.id] || !match(c)) continue;
      if (!recordClue(c.id)) continue;
      if (known[c.recipe]) continue; // moot: written, never announced
      this.ctx.events.emit('clueUnlocked', { id: c.id, recipe: c.recipe, text: c.text });
      if (!quiet && !toasted) {
        toasted = true;
        this.ctx.events.emit('toast', { text: 'Grimoire — a new note in the margin' });
      }
    }
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }
}
