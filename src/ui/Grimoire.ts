import type { Ctx } from '@/core/types';
import { RECIPES, loadDiscoveredRecipes, type Recipe } from '@/game/Brewing';
import { MATERIAL_PARAMS } from '@/config/params';

// Bundled like the backdrop layers (new URL → Vite asset). The authored book art.
const GRIMOIRE_SRC = new URL('../../assets/grimoire-open-straight.png', import.meta.url).href;

/**
 * The wizard's Grimoire — an in-world book (toggle with `J`) drawn onto the
 * authored book art. Phase 1: the persistent brewing recipes (discovered =
 * inscribed, undiscovered = "? ? ?"). The right-page "Material Lore" section is
 * the home for the Examine discoveries (#5) as that system lands.
 */
export class Grimoire {
  private readonly overlay: HTMLDivElement;
  private readonly left: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private open = false;
  /** Sim pause state captured on open, restored on close (nests under the pause menu). */
  private wasPaused = false;

  constructor(private readonly ctx: Ctx) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'grimoire-overlay';
    this.overlay.innerHTML = `
      <div class="grimoire-book">
        <img class="grimoire-img" src="${GRIMOIRE_SRC}" alt="Grimoire" draggable="false">
        <div class="grimoire-page grimoire-left"></div>
        <div class="grimoire-page grimoire-right"></div>
      </div>`;
    (document.getElementById('canvas-holder') ?? document.body).appendChild(this.overlay);
    this.left = this.overlay.querySelector('.grimoire-left') as HTMLDivElement;
    this.right = this.overlay.querySelector('.grimoire-right') as HTMLDivElement;
    // Click the dimmed backdrop (not the book) to close.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.toggle();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.code === 'KeyJ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.toggle();
    } else if (e.code === 'Escape' && this.open) {
      this.toggle();
    }
  };

  toggle(): void {
    this.open = !this.open;
    this.overlay.classList.toggle('open', this.open);
    if (this.open) {
      this.wasPaused = this.ctx.state.paused;
      this.ctx.state.paused = true; // reading the book pauses the world
      this.render();
    } else {
      this.ctx.state.paused = this.wasPaused;
    }
  }

  private render(): void {
    const known = loadDiscoveredRecipes();
    const matName = (c: number): string => MATERIAL_PARAMS[c]?.name ?? `#${c}`;
    const entry = (r: Recipe): string => {
      if (!known[r.id]) {
        return `<div class="gr-entry gr-locked"><div class="gr-title">&#10022; Unknown Elixir</div><div class="gr-sub">brew its recipe to inscribe it</div></div>`;
      }
      const needs = r.needs.map((n) => `${n.min}&times; ${matName(n.cell)}`).join(', ');
      return `<div class="gr-entry"><div class="gr-title">${r.name}</div><div class="gr-sub">Needs ${needs}</div></div>`;
    };
    const discovered = RECIPES.filter((r) => known[r.id]).length;
    this.left.innerHTML =
      `<div class="gr-head">Grimoire</div>` +
      `<div class="gr-section">Elixirs &mdash; ${discovered} / ${RECIPES.length} known</div>` +
      RECIPES.map(entry).join('');
    this.right.innerHTML =
      `<div class="gr-head">Material Lore</div>` +
      `<div class="gr-empty">Examine the world (press <b>I</b>) to record what its materials do, and brew in a cauldron to inscribe new elixirs.</div>`;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.overlay.remove();
  }
}
