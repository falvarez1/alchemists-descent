import type { BiomeId, Ctx, EnemyKind, InputMode, SpellId } from '@/core/types';
import type { Cell } from '@/sim/CellType';
import { WIDTH } from '@/config/constants';
import { BIOMES } from '@/config/biomes';
import { GEN_TUNE, GEN_TUNE_DEFAULTS, WORLDGEN_DRESSING_CHANNELS, WORLDGEN_LOOK_FIELDS } from '@/config/gen';
import { EXTRAS, campaignDressingRecipeForBiome } from '@/world/biomeExtras';
import { bindSelect } from '@/ui/domBind';
import { escapeAttr, escapeHtml } from '@/core/strings';
import { MATERIAL_PALETTE, MATERIAL_SWATCHES } from '@/content/materialPalette';
import { ELEMENT_ICON, makeIconCanvas } from '@/ui/icons';
import { fillMaterialPopover } from '@/ui/materialInfo';
import { PopoverHost } from '@/ui/editor/PopoverHost';
import { ensureSandboxWorldDetached } from '@/core/runtimeState';
import { SANDBOX_FOCUS, stampSandboxArena } from '@/world/sandboxArena';

/** "Granular Solids" -> "Granular solids". The dock's headings are sentence case; a play build's Workshop upper-cases them in CSS either way. */
function sentenceCase(title: string): string {
  return title.charAt(0) + title.slice(1).toLowerCase();
}

export type SelectionChangedFn = (id: string | number, mode: 'element' | 'spell') => void;

// ===================== UI Wiring =====================
/**
 * Left-hand toolbar: element/spell tool buttons, world generation controls
 * and the build-mode enemy droppers. Selecting a tool also rebuilds the
 * context inspector via the `onSelectionChanged` callback (wired by Game).
 */
export class Toolbar {
  private readonly popovers = new PopoverHost();
  private readonly disposers: Array<() => void> = [];
  private readonly worldgenTuneDisposers: Array<() => void> = [];

  constructor(
    private ctx: Ctx,
    private onSelectionChanged: SelectionChangedFn,
  ) {
    // Render before wiring: `wireToolButtons` binds whatever `.tool-btn`
    // elements exist, so the generated material buttons must be in the DOM
    // first. Absent container (the standalone Builder route) is a no-op.
    this.renderMaterialPalette();
    this.wireToolButtons();
    this.wireWorldGen();
    this.wireEnemyDroppers();
    this.wireFilter();
    this.wireMaterialPopovers();
    this.paintArmed();
  }

  dispose(): void {
    this.clearWorldgenTuneDisposers();
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.popovers.dispose();
  }

  private listen(target: EventTarget | null, type: string, listener: EventListener, options?: AddEventListenerOptions): void {
    if (!target) return;
    target.addEventListener(type, listener, options);
    this.disposers.push(() => target.removeEventListener(type, listener, options));
  }

  private listenWorldgenTune(target: EventTarget | null, type: string, listener: EventListener): void {
    if (!target) return;
    target.addEventListener(type, listener);
    this.worldgenTuneDisposers.push(() => target.removeEventListener(type, listener));
  }

  private clearWorldgenTuneDisposers(): void {
    for (const dispose of this.worldgenTuneDisposers.splice(0).reverse()) dispose();
  }

  /**
   * Instant material popover (same content as the Builder palette's): icon,
   * name, sim classification, gameplay description, live tunables. Fixed-
   * positioned at the toolbar's right edge so it floats over the viewport.
   */
  private wireMaterialPopovers(): void {
    const bar = document.getElementById('left-toolbar');
    if (!bar) return;
    // the buttons move under the cursor on scroll — drop the popover. The dock
    // scrolls per tab panel (and the bar itself in a flat Workshop list).
    for (const scroller of [bar, ...Array.from(bar.querySelectorAll('.sb-panel'))]) {
      this.listen(scroller, 'scroll', () => this.hideMatPopover(), { passive: true });
    }
    for (const btn of document.querySelectorAll<HTMLButtonElement>(
      '.tool-btn[data-mode="element"]',
    )) {
      const id = Number(btn.dataset.id);
      this.listen(btn, 'mouseenter', () => this.showMatPopover(btn, id));
      this.listen(btn, 'mouseleave', () => this.hideMatPopover());
      // A keyboard user arriving on a tile gets what a hover gets: its name and rules.
      this.listen(btn, 'focus', () => { if (btn.matches(':focus-visible')) this.showMatPopover(btn, id); });
      this.listen(btn, 'blur', () => this.hideMatPopover());
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

  /**
   * Live tool filter: hides non-matching tool buttons, and a group (a section
   * title with its buttons) left with none. Groups are found by class, not by
   * position, so it does not care how deep the dock's panels nest them. The
   * World tab's buttons are actions, not tools, and are never filtered.
   */
  private wireFilter(): void {
    const filter = document.getElementById('toolbar-filter') as HTMLInputElement | null;
    const bar = document.getElementById('left-toolbar');
    if (!filter || !bar) return;
    this.listen(filter, 'input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const group of Array.from(bar.querySelectorAll<HTMLElement>('.sb-group'))) {
        let hits = 0;
        for (const btn of Array.from(group.querySelectorAll<HTMLElement>('.tool-btn'))) {
          const hit = q === '' || (btn.textContent ?? '').toLowerCase().includes(q);
          btn.style.display = hit ? '' : 'none';
          if (hit) hits++;
        }
        group.style.display = hits > 0 ? '' : 'none';
      }
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
    this.paintArmed();
  }

  /**
   * Build the material buttons from the shared catalog.
   *
   * The markup used to be hand-written in `index.html`, which duplicated cell
   * ids (an append-only save ABI) into HTML and made the Builder clone them
   * back out of the DOM. `src/content/materialPalette.ts` is the source now.
   */
  private renderMaterialPalette(): void {
    const anchor = document.getElementById('material-palette');
    if (!anchor) return;
    const parts: string[] = [];
    for (const group of MATERIAL_PALETTE) {
      parts.push(
        `<div class="sb-group"><div class="section-title" data-count="${group.items.length}">${escapeHtml(sentenceCase(group.title))}</div><div class="sb-grid">`,
      );
      for (const item of group.items) {
        parts.push(
          `<button class="tool-btn" data-mode="element" data-id="${item.id}" aria-pressed="false">` +
            `<span class="color-indicator" style="background:${escapeAttr(item.color)}"></span>` +
            `<span class="tool-label">${escapeHtml(item.label)}</span></button>`,
        );
      }
      parts.push('</div></div>');
    }
    const holder = document.createElement('div');
    holder.innerHTML = parts.join('');
    // One `.sb-group` per palette group (its title and its tile grid), spliced in
    // where the placeholder was. The filter finds groups by that class, and a
    // play build's Workshop flattens the wrappers back to a plain list
    // (styles/sandbox.css), so the structure here is a contract with both.
    anchor.replaceWith(...Array.from(holder.childNodes));
    document
      .querySelector(`#left-toolbar .tool-btn[data-id="${this.ctx.state.currentElement}"]`)
      ?.classList.add('active');
    for (const btn of document.querySelectorAll('#left-toolbar .tool-btn')) {
      btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
    }
  }

  private wireToolButtons(): void {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      this.listen(btn, 'click', (e) => {
        document.querySelectorAll('.tool-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        // currentTarget, not target: the tile's icon and label are children that take the click.
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        target.setAttribute('aria-pressed', 'true');
        this.ctx.state.activeInputMode = target.getAttribute('data-mode') as InputMode;

        if (this.ctx.state.activeInputMode === 'element') {
          this.ctx.state.currentElement = parseInt(target.getAttribute('data-id')!) as Cell;
          this.onSelectionChanged(this.ctx.state.currentElement, 'element');
        } else {
          this.ctx.state.currentSpell = target.getAttribute('data-id') as SpellId;
          this.onSelectionChanged(this.ctx.state.currentSpell, 'spell');
        }
        this.paintArmed();
      });
    });
  }

  /**
   * The armed readout (the dock's footer): what a click on the canvas will do,
   * from the same state the click reads. No-op where the footer is absent (the
   * Workshop hides it, the standalone editor route has no dock).
   */
  private paintArmed(): void {
    const icon = document.getElementById('sb-armed-icon');
    const nameEl = document.getElementById('sb-armed-name');
    const kindEl = document.getElementById('sb-armed-kind');
    if (!icon || !nameEl || !kindEl) return;
    const { state, params } = this.ctx;
    let name: string;
    let kind: string;
    let glyph: string | undefined;
    let color = '#888';
    if (state.activeInputMode === 'spell') {
      name = params.spells[state.currentSpell]?.name ?? state.currentSpell;
      kind = 'Spell \u00b7 left-click casts';
      glyph = state.currentSpell;
      const btn = document.querySelector<HTMLElement>(`#left-toolbar .tool-btn.spell-mode[data-id="${state.currentSpell}"]`);
      color = btn?.querySelector<HTMLElement>('.color-indicator')?.style.background || color;
    } else {
      const id = state.currentElement;
      name = id === 0 ? 'Eraser' : (params.materials[id]?.name ?? `Material ${id}`);
      kind = id === 0 ? 'Material \u00b7 left-click erases' : 'Material \u00b7 left-click paints';
      glyph = ELEMENT_ICON[id];
      color = MATERIAL_SWATCHES.find((s) => s.id === id)?.color ?? color;
    }
    nameEl.textContent = name;
    kindEl.textContent = kind;
    icon.replaceChildren();
    const canvas = glyph ? makeIconCanvas(glyph, 2) : null;
    if (canvas) {
      icon.appendChild(canvas);
    } else {
      const dot = document.createElement('span');
      dot.className = 'color-indicator';
      dot.style.background = color;
      icon.appendChild(dot);
    }
  }

  private wireWorldGen(): void {
    this.listen(document.getElementById('btn-sandbox'), 'click', () => {
      ensureSandboxWorldDetached(this.ctx);
      stampSandboxArena(this.ctx);
      this.ctx.camera.snapTo(SANDBOX_FOCUS.x, SANDBOX_FOCUS.y);
    });
    this.listen(document.getElementById('btn-caves'), 'click', () => {
      ensureSandboxWorldDetached(this.ctx);
      this.ctx.worldgen.regenerate(this.ctx);
    });
    // Options sourced from BIOMES (not a hard-coded HTML subset) and the dropdown
    // seeded from the live currentBiome, so it lists every biome and reflects state.
    const biomeBinding = bindSelect({
      select: 'biome-select',
      options: (Object.keys(BIOMES) as BiomeId[]).map((id) => ({ value: id, label: BIOMES[id].name })),
      get: () => this.ctx.state.currentBiome,
      set: (v) => { this.ctx.state.currentBiome = v as BiomeId; },
      onChange: () => {
        ensureSandboxWorldDetached(this.ctx);
        this.rebuildWorldgenTune(); // the dressing sliders follow the selected biome
        this.ctx.worldgen.regenerate(this.ctx);
      },
    });
    this.disposers.push(() => biomeBinding.dispose?.());
    this.listen(document.getElementById('btn-fortress'), 'click', () => {
      ensureSandboxWorldDetached(this.ctx);
      this.ctx.worldgen.spawnFortress(this.ctx);
    });
    this.listen(document.getElementById('btn-worldgen-reset'), 'click', () => {
      Object.assign(GEN_TUNE, GEN_TUNE_DEFAULTS);
      this.rebuildWorldgenTune();
      this.ctx.events.emit('paramsChanged'); // clear the persisted worldgen diff
      ensureSandboxWorldDetached(this.ctx);
      this.ctx.worldgen.regenerate(this.ctx);
    });
    this.rebuildWorldgenTune();
  }

  /** A live slider row writing straight into a tuning object; the change shows on
   *  the next "Generate Caves" (worldgen is a one-shot bake, not per-frame). */
  private worldgenSlider(host: HTMLElement, label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, dec: number): void {
    const fmt = (v: number) => (dec === 0 ? String(Math.round(v)) : v.toFixed(dec));
    const row = document.createElement('div');
    row.className = 'wg-tune-row';
    const top = document.createElement('div');
    top.className = 'wg-tune-top';
    const lab = document.createElement('span');
    lab.textContent = label;
    const val = document.createElement('span');
    val.className = 'wg-tune-val';
    val.textContent = fmt(get());
    top.append(lab, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    this.listenWorldgenTune(input, 'input', () => {
      const v = parseFloat(input.value);
      set(v);
      val.textContent = fmt(v);
      // worldgen is a one-shot bake, but emit so the tuning store persists the
      // dial across reloads (it shows on the next Generate Caves).
      this.ctx.events.emit('paramsChanged');
    });
    row.append(top, input);
    host.appendChild(row);
  }

  /** (Re)build the worldgen look sliders: global structure (cave size + the
   *  walk-surface "sink" fill) + the CURRENT biome's dressing densities. */
  private rebuildWorldgenTune(): void {
    const host = document.getElementById('worldgen-tune');
    if (!host) return;
    this.clearWorldgenTuneDisposers();
    host.innerHTML = '';
    // Field list + ranges come from the shared WORLDGEN_LOOK_FIELDS descriptor so
    // this panel and the Builder's worldgen LOOK panel can't drift apart.
    for (const f of WORLDGEN_LOOK_FIELDS) {
      this.worldgenSlider(host, f.label, () => GEN_TUNE[f.key], (v) => { GEN_TUNE[f.key] = v; }, f.min, f.max, f.step, f.decimals);
    }
    // The CURRENT biome's dressing: gold richness (EXTRAS) + the campaign-recipe
    // material densities (the channel material differs per biome — for earthen
    // ore=gold, glow=glowshroom, liquid=water, rubble=moss, vine=vines). Editing
    // these writes into the live tables; the dressed sandbox preview shows it.
    const extras = EXTRAS[this.ctx.state.currentBiome] as unknown as Record<string, number | undefined>;
    this.worldgenSlider(host, 'Gold richness', () => extras.goldBonus ?? 1, (v) => { extras.goldBonus = v; }, 0, 3, 0.1, 1);
    const recipe = campaignDressingRecipeForBiome(this.ctx.state.currentBiome) as unknown as Record<string, number>;
    for (const [key, label] of WORLDGEN_DRESSING_CHANNELS) {
      if (typeof recipe[key] !== 'number') continue;
      this.worldgenSlider(host, label, () => recipe[key], (v) => { recipe[key] = v; }, 0, 2, 0.02, 2);
    }
  }

  // Build-mode enemy droppers
  private dropEnemyAtTop(kind: EnemyKind): void {
    ensureSandboxWorldDetached(this.ctx);
    const x = 20 + Math.floor(Math.random() * (WIDTH - 40));
    this.ctx.enemyCtl.spawn(kind, x, kind === 'imp' ? 14 + Math.random() * 12 : 6);
  }

  private wireEnemyDroppers(): void {
    this.listen(document.getElementById('btn-spawn-slime'), 'click', () => this.dropEnemyAtTop('slime'));
    this.listen(document.getElementById('btn-spawn-imp'), 'click', () => this.dropEnemyAtTop('imp'));
    this.listen(document.getElementById('btn-spawn-golem'), 'click', () => this.dropEnemyAtTop('golem'));
  }
}
