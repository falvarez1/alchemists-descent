import type { BiomeId, Ctx, EnemyKind, InputMode, SpellId } from '@/core/types';
import type { Cell } from '@/sim/CellType';
import { WIDTH } from '@/config/constants';
import { ELEMENT_ICON, makeIconCanvas } from '@/ui/icons';
import { fillMaterialPopover } from '@/ui/materialInfo';
import { PopoverHost } from '@/ui/editor/PopoverHost';
import { ensureSandboxWorldDetached } from '@/game/sandboxWorld';

export type SelectionChangedFn = (id: string | number, mode: 'element' | 'spell') => void;

// ===================== UI Wiring =====================
/**
 * Left-hand toolbar: element/spell tool buttons, world generation controls
 * and the build-mode enemy droppers. Selecting a tool also rebuilds the
 * context inspector via the `onSelectionChanged` callback (wired by Game).
 */
export class Toolbar {
  private readonly popovers = new PopoverHost();

  constructor(
    private ctx: Ctx,
    private onSelectionChanged: SelectionChangedFn,
  ) {
    this.wireToolButtons();
    this.wireWorldGen();
    this.wireEnemyDroppers();
    this.wireFilter();
    this.wireMaterialPopovers();
  }

  /**
   * Instant material popover (same content as the Builder palette's): icon,
   * name, sim classification, gameplay description, live tunables. Fixed-
   * positioned at the toolbar's right edge so it floats over the viewport.
   */
  private wireMaterialPopovers(): void {
    const bar = document.getElementById('left-toolbar');
    if (!bar) return;
    // the buttons move under the cursor on scroll — drop the popover
    bar.addEventListener('scroll', () => this.hideMatPopover(), { passive: true });
    for (const btn of document.querySelectorAll<HTMLButtonElement>(
      '.tool-btn[data-mode="element"]',
    )) {
      const id = Number(btn.dataset.id);
      btn.addEventListener('mouseenter', () => this.showMatPopover(btn, id));
      btn.addEventListener('mouseleave', () => this.hideMatPopover());
    }
  }

  private showMatPopover(btn: HTMLButtonElement, id: number): void {
    const name = this.ctx.params.materials[id]?.name ?? (btn.textContent ?? '').trim();
    const color = btn.querySelector<HTMLElement>('.color-indicator')?.style.background ?? '#888';
    this.popovers.show({
      id: 'lt-matpop',
      anchor: btn,
      preferredSide: 'right',
      offsetY: -6,
      render: (pop) => fillMaterialPopover(pop, id, name, color, this.ctx.params.materials[id]),
    });
  }

  private hideMatPopover(): void {
    this.popovers.hide('lt-matpop');
  }

  /** Live tool filter: hides non-matching buttons and emptied section titles. */
  private wireFilter(): void {
    const filter = document.getElementById('toolbar-filter') as HTMLInputElement | null;
    const bar = document.getElementById('left-toolbar');
    if (!filter || !bar) return;
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      let title: HTMLElement | null = null;
      let titleHasHit = false;
      const flushTitle = (): void => {
        if (title) title.style.display = titleHasHit ? '' : 'none';
      };
      for (const el of Array.from(bar.children) as HTMLElement[]) {
        if (el.id === 'toolbar-filter' || el.id === 'level-import') continue; // the input stays; the file input stays hidden
        if (el.classList.contains('section-title')) {
          flushTitle();
          title = el;
          titleHasHit = false;
          continue;
        }
        const hit = q === '' || (el.textContent ?? '').toLowerCase().includes(q);
        el.style.display = hit ? '' : 'none';
        if (hit) titleHasHit = true;
      }
      flushTitle();
    });
  }

  injectToolbarIcons(): void {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      const mode = btn.getAttribute('data-mode');
      const name = mode === 'spell' ? btn.getAttribute('data-id')! : ELEMENT_ICON[parseInt(btn.getAttribute('data-id')!)];
      const icon = makeIconCanvas(name, 2);
      if (!icon) return;
      const dot = btn.querySelector('.color-indicator');
      if (dot) btn.replaceChild(icon, dot); else btn.prepend(icon);
    });
  }

  private wireToolButtons(): void {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const t = e.target as HTMLElement;
        const target = t.classList.contains('tool-btn') ? t : t.parentElement!;
        target.classList.add('active');
        this.ctx.state.activeInputMode = target.getAttribute('data-mode') as InputMode;

        if (this.ctx.state.activeInputMode === 'element') {
          this.ctx.state.currentElement = parseInt(target.getAttribute('data-id')!) as Cell;
          this.onSelectionChanged(this.ctx.state.currentElement, 'element');
        } else {
          this.ctx.state.currentSpell = target.getAttribute('data-id') as SpellId;
          this.onSelectionChanged(this.ctx.state.currentSpell, 'spell');
        }
      });
    });
  }

  private wireWorldGen(): void {
    document.getElementById('btn-caves')!.addEventListener('click', () => {
      ensureSandboxWorldDetached(this.ctx);
      this.ctx.worldgen.regenerate(this.ctx);
    });
    document.getElementById('biome-select')!.addEventListener('change', (e) => {
      this.ctx.state.currentBiome = (e.target as HTMLSelectElement).value as BiomeId;
      ensureSandboxWorldDetached(this.ctx);
      this.ctx.worldgen.regenerate(this.ctx);
    });
    document.getElementById('btn-fortress')!.addEventListener('click', () => {
      ensureSandboxWorldDetached(this.ctx);
      this.ctx.worldgen.spawnFortress(this.ctx);
    });
  }

  // Build-mode enemy droppers
  private dropEnemyAtTop(kind: EnemyKind): void {
    ensureSandboxWorldDetached(this.ctx);
    const x = 20 + Math.floor(Math.random() * (WIDTH - 40));
    this.ctx.enemyCtl.spawn(kind, x, kind === 'imp' ? 14 + Math.random() * 12 : 6);
  }

  private wireEnemyDroppers(): void {
    document.getElementById('btn-spawn-slime')!.addEventListener('click', () => this.dropEnemyAtTop('slime'));
    document.getElementById('btn-spawn-imp')!.addEventListener('click', () => this.dropEnemyAtTop('imp'));
    document.getElementById('btn-spawn-golem')!.addEventListener('click', () => this.dropEnemyAtTop('golem'));
  }
}
