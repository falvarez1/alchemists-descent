import type { Ctx } from '@/core/types';
import { rleDecode, rleEncode } from '@/core/rle';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';

/**
 * The Level Library (build mode): save the painted world to localStorage,
 * reload it later, export/import as .json files, and playtest in place.
 *
 * Format v1: run-length-encoded cell types (base64) + sparse life/charge.
 * Colors are NOT stored — they regenerate per material on load (hand-painted
 * cells were COLOR_FN-colored to begin with, so the look survives).
 */

interface SavedLevel {
  v: 1;
  w: number;
  h: number;
  biome: string;
  /** RLE pairs [count, type, count, type, ...] packed into base64. */
  rle: string;
  /** Sparse [index, value] pairs for non-zero life cells. */
  life: Array<[number, number]>;
  charge: Array<[number, number]>;
}

const STORE_KEY = 'noita-level-library';

function loadLibrary(): Record<string, SavedLevel> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SavedLevel>) : {};
  } catch {
    return {};
  }
}

function saveLibrary(lib: Record<string, SavedLevel>): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false; // quota — caller falls back to telling the user to export
  }
}

export class LevelStore {
  constructor(private ctx: Ctx) {
    this.wire();
    this.refreshList();
  }

  private serialize(): SavedLevel {
    const ctx = this.ctx;
    const w = ctx.world;
    const life: Array<[number, number]> = [];
    const charge: Array<[number, number]> = [];
    for (let i = 0; i < w.types.length; i++) {
      if (w.life[i] !== 0) life.push([i, w.life[i]]);
      if (w.charge[i] !== 0) charge.push([i, w.charge[i]]);
    }
    return {
      v: 1,
      w: w.width,
      h: w.height,
      biome: ctx.state.currentBiome,
      rle: rleEncode(w.types),
      // Cap sparse channels so a world on fire doesn't balloon the save.
      life: life.slice(0, 60000),
      charge: charge.slice(0, 20000),
    };
  }

  private applySave(save: SavedLevel): void {
    const ctx = this.ctx;
    const w = ctx.world;
    if (save.w !== w.width || save.h !== w.height) return;
    w.clear();
    rleDecode(save.rle, w.types);
    // Regenerate per-material colors (the save stores no color channel).
    for (let i = 0; i < w.types.length; i++) {
      const t = w.types[i];
      if (t === Cell.Empty) continue;
      const fn = COLOR_FN[t];
      w.colors[i] = fn ? fn() : EMPTY_COLOR;
    }
    for (const [i, v] of save.life) w.life[i] = v;
    for (const [i, v] of save.charge) w.charge[i] = v;
    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
    ctx.particles.clear();
    ctx.events.emit('toast', { text: 'LEVEL LOADED' });
  }

  /* ---------------- DOM wiring ---------------- */

  private wire(): void {
    document.getElementById('btn-level-save')?.addEventListener('click', () => {
      const name = window.prompt('Level name:', 'my-level');
      if (!name) return;
      const lib = loadLibrary();
      lib[name] = this.serialize();
      if (saveLibrary(lib)) this.ctx.events.emit('toast', { text: `SAVED "${name.toUpperCase()}"` });
      else window.alert('Storage is full — use Export to keep this level as a file.');
      this.refreshList();
    });

    document.getElementById('btn-level-load')?.addEventListener('click', () => {
      const select = document.getElementById('level-select') as HTMLSelectElement | null;
      const name = select?.value;
      if (!name) return;
      const save = loadLibrary()[name];
      if (save) this.applySave(save);
    });

    document.getElementById('btn-level-delete')?.addEventListener('click', () => {
      const select = document.getElementById('level-select') as HTMLSelectElement | null;
      const name = select?.value;
      if (!name) return;
      const lib = loadLibrary();
      delete lib[name];
      saveLibrary(lib);
      this.refreshList();
    });

    document.getElementById('btn-level-export')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this.serialize())], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'noita-level.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.getElementById('level-import')?.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          const save = JSON.parse(text) as SavedLevel;
          if (save.v === 1 && typeof save.rle === 'string') this.applySave(save);
        } catch {
          window.alert('Not a valid level file.');
        }
        input.value = '';
      });
    });

    document.getElementById('btn-level-playtest')?.addEventListener('click', () => {
      this.ctx.levels.playCurrentWorld(this.ctx);
      (document.getElementById('mode-play-btn') as HTMLButtonElement | null)?.click();
    });

    document.getElementById('btn-expedition-abandon')?.addEventListener('click', () => {
      if (!this.ctx.levels.hasSavedExpedition()) {
        this.ctx.events.emit('toast', { text: 'NO SAVED EXPEDITION' });
        return;
      }
      if (!window.confirm('Abandon the saved expedition? The next descent starts fresh.')) return;
      this.ctx.levels.abandonExpedition();
      this.ctx.events.emit('toast', { text: 'EXPEDITION ABANDONED' });
    });
  }

  private refreshList(): void {
    const select = document.getElementById('level-select') as HTMLSelectElement | null;
    if (!select) return;
    const names = Object.keys(loadLibrary());
    select.innerHTML = '';
    for (const n of names) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      select.appendChild(opt);
    }
    select.disabled = names.length === 0;
  }
}
