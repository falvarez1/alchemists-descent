import type { Ctx } from '@/core/types';
import { rleDecodeExact, rleEncode } from '@/core/rle';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import { appDialog } from '@/ui/AppDialog';
import { resetCombatTransients } from '@/game/transients';
import { ensureSandboxWorldDetached } from '@/game/sandboxWorld';

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

function isSparsePairs(
  value: unknown,
  maxIndex: number,
  minValue: number,
  maxValue: number,
): value is Array<[number, number]> {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [i, v] = entry;
    return Number.isInteger(i) && i >= 0 && i < maxIndex && Number.isInteger(v) && v >= minValue && v <= maxValue;
  });
}

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
  private readonly disposers: Array<() => void> = [];

  constructor(private ctx: Ctx) {
    this.wire();
    this.refreshList();
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private serialize(): SavedLevel {
    const ctx = this.ctx;
    ensureSandboxWorldDetached(ctx);
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

  private applySave(save: SavedLevel): boolean {
    const ctx = this.ctx;
    // Structural validation: tampered localStorage (or a hand-edited file) can
    // be missing the sparse arrays or carry a non-string RLE blob. Bail out as
    // a clean "false" (caller shows "Load Failed") instead of throwing an
    // uncaught error deep inside rleDecode/atob or the life/charge loops.
    const w = ctx.world;
    if (save.w !== w.width || save.h !== w.height) return false;
    if (
      typeof save.rle !== 'string' ||
      !isSparsePairs(save.life, w.types.length, -32768, 32767) ||
      !isSparsePairs(save.charge, w.types.length, 0, 65535)
    ) {
      return false;
    }
    const decoded = new Uint8Array(w.types.length);
    if (!rleDecodeExact(save.rle, decoded)) return false;
    for (const t of decoded) {
      if (t >= CELL_COUNT) return false;
    }

    ensureSandboxWorldDetached(ctx);
    const target = ctx.world;
    if (target.width !== w.width || target.height !== w.height) return false;
    target.clear();
    target.types.set(decoded);
    // Regenerate per-material colors (the save stores no color channel).
    for (let i = 0; i < target.types.length; i++) {
      const t = target.types[i];
      if (t === Cell.Empty) continue;
      const fn = COLOR_FN[t];
      target.colors[i] = fn ? fn() : EMPTY_COLOR;
    }
    for (const [i, v] of save.life) target.life[i] = v;
    for (const [i, v] of save.charge) target.setChargeAt(i, v);
    ctx.enemies.length = 0;
    resetCombatTransients(ctx);
    ctx.events.emit('toast', { text: 'LEVEL LOADED' });
    return true;
  }

  /* ---------------- DOM wiring ---------------- */

  private wire(): void {
    this.listen('btn-level-save', 'click', async () => {
      const name = await appDialog.prompt('Level name:', 'my-level', {
        title: 'Save Level',
      });
      if (!name) return;
      const lib = loadLibrary();
      if (
        lib[name] &&
        !(await appDialog.confirm(`Overwrite saved level "${name}"?`, {
          title: 'Overwrite Level',
          confirmText: 'Overwrite',
          tone: 'danger',
        }))
      ) {
        return;
      }
      lib[name] = this.serialize();
      if (saveLibrary(lib))
        this.ctx.events.emit('toast', {
          text: `SAVED "${name.toUpperCase()}"`,
        });
      else await appDialog.alert('Storage is full — use Export to keep this level as a file.', 'Storage Full');
      this.refreshList();
    });

    this.listen('btn-level-load', 'click', async () => {
      const select = document.getElementById('level-select') as HTMLSelectElement | null;
      const name = select?.value;
      if (!name) return;
      const save = loadLibrary()[name];
      if (!save) return;
      if (
        !(await appDialog.confirm(`Load saved level "${name}" and replace the current Sandbox world?`, {
          title: 'Load Level',
          confirmText: 'Load',
          tone: 'danger',
        }))
      ) {
        return;
      }
      if (!this.applySave(save))
        await appDialog.alert('That level was saved for a different world size.', 'Load Failed');
    });

    this.listen('btn-level-delete', 'click', async () => {
      const select = document.getElementById('level-select') as HTMLSelectElement | null;
      const name = select?.value;
      if (!name) return;
      if (
        !(await appDialog.confirm(`Delete saved level "${name}"?`, {
          title: 'Delete Level',
          confirmText: 'Delete',
          tone: 'danger',
        }))
      ) {
        return;
      }
      const lib = loadLibrary();
      delete lib[name];
      if (!saveLibrary(lib)) await appDialog.alert('Could not update local storage.', 'Delete Failed');
      this.refreshList();
    });

    this.listen('btn-level-export', 'click', () => {
      const blob = new Blob([JSON.stringify(this.serialize())], {
        type: 'application/json',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'noita-level.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    this.listen('level-import', 'change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const text = await file.text();
          const save = JSON.parse(text) as SavedLevel;
          if (save.v === 1 && typeof save.rle === 'string') {
            const ok = await appDialog.confirm('Import this level file and replace the current Sandbox world?', {
              title: 'Import Level',
              confirmText: 'Import',
              tone: 'danger',
            });
            if (ok && !this.applySave(save)) {
              await appDialog.alert('That level file was saved for a different world size.', 'Import Failed');
            }
          } else {
            await appDialog.alert('Not a valid level file.', 'Import Failed');
          }
        } catch {
          await appDialog.alert('Not a valid level file.', 'Import Failed');
        }
        input.value = '';
      })();
    });

    this.listen('btn-level-playtest', 'click', () => {
      this.ctx.state.playtestSource = 'sandbox';
      this.ctx.levels.playCurrentWorld(this.ctx);
      (document.getElementById('mode-play-btn') as HTMLButtonElement | null)?.click();
    });

    this.listen('btn-expedition-abandon', 'click', async () => {
      if (!this.ctx.levels.hasSavedExpedition()) {
        this.ctx.events.emit('toast', { text: 'NO SAVED EXPEDITION' });
        return;
      }
      const ok = await appDialog.confirm('Abandon the saved expedition? The next descent starts fresh.', {
        title: 'Abandon Expedition',
        confirmText: 'Abandon',
        tone: 'danger',
      });
      if (!ok) return;
      this.ctx.levels.abandonExpedition();
      this.ctx.events.emit('toast', { text: 'EXPEDITION ABANDONED' });
    });
  }

  private listen<K extends keyof HTMLElementEventMap>(
    id: string,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    const target = document.getElementById(id);
    if (!target) return;
    target.addEventListener(type, handler as EventListener);
    this.disposers.push(() => target.removeEventListener(type, handler as EventListener));
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
