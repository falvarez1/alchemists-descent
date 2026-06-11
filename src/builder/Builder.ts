import type { BiomeId, Ctx, EnemyKind, PickupKind } from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';
import {
  applyWorldLayer,
  captureWorldLayer,
  createEmptyDocument,
  freshId,
  loadDocLibrary,
  saveDocLibrary,
} from '@/builder/document';
import type { EditorDocument, EditorObject, EditorObjectKind } from '@/builder/document';
import {
  addObjectCmd,
  CommandStack,
  deleteObjectCmd,
  editParamCmd,
  moveObjectCmd,
} from '@/builder/commands';
import { compileAndPlaytest, validateDocument } from '@/builder/compile';
import type { DocIssue } from '@/builder/compile';

/**
 * The Builder (docs/BUILDER.md Phases 2+3 + Phase 9 core): an authoring
 * overlay on top of the paused sandbox. It edits an EditorDocument — the
 * document is the source of truth; the live world is only a viewport and,
 * via CAPTURE TERRAIN, a paint surface (real terrain tools arrive in
 * Phase 4). PLAYTEST compiles a disposable runtime; scars never flow back.
 *
 * Session model: mode stays 'build', ctx.state.paused freezes the sim while
 * the overlay is up (rendering continues — WASD still pans the camera via
 * the build-mode Camera branch). All Builder DOM is injected here so the
 * tool owns its markup end to end.
 */

const PLACEABLE: Array<{ kind: EditorObjectKind; label: string; glyph: string }> = [
  { kind: 'spawn', label: 'Player Spawn', glyph: 'S' },
  { kind: 'enemy', label: 'Enemy', glyph: 'E' },
  { kind: 'pickup', label: 'Pickup', glyph: 'P' },
  { kind: 'exitPortal', label: 'Exit Portal', glyph: 'X' },
  { kind: 'waystone', label: 'Waystone', glyph: 'W' },
];

const GLYPH: Partial<Record<EditorObjectKind, string>> = Object.fromEntries(
  PLACEABLE.map((p) => [p.kind, p.glyph]),
);

const DEFAULT_PARAMS: Partial<Record<EditorObjectKind, () => Record<string, unknown>>> = {
  spawn: () => ({}),
  enemy: () => ({ kind: 'slime' }),
  pickup: () => ({ kind: 'goldpile', amount: 30 }),
  exitPortal: () => ({ alwaysOpen: false }),
  waystone: () => ({ lit: false }),
};

const ENEMY_KINDS: EnemyKind[] = [
  'slime', 'imp', 'golem', 'acidslime', 'wisp', 'mage', 'bat', 'spitter', 'bomber', 'eggs', 'colossus',
];
const PICKUP_KINDS: PickupKind[] = ['goldpile', 'heart', 'tome', 'chest', 'potion', 'key'];
const BIOMES: BiomeId[] = [
  'earthen', 'frozen', 'flooded', 'timber', 'scorched', 'fungal', 'crystal', 'volcanic',
];

/** How close (in cells) an overlay click must be to count as selecting an object. */
const PICK_RADIUS = 7;

export class Builder {
  private doc: EditorDocument;
  private readonly cmds = new CommandStack(() => this.doc);
  private isOpen = false;
  private ownsPause = false;
  private returningFromPlaytest = false;

  private selectedId: string | null = null;
  private placeKind: EditorObjectKind | null = null;
  private drag: { obj: EditorObject; origX: number; origY: number; grabX: number; grabY: number } | null = null;

  private root!: HTMLDivElement;
  private overlay!: HTMLDivElement;
  private markerLayer!: HTMLDivElement;
  private markers = new Map<string, HTMLDivElement>();
  private modeBtn!: HTMLButtonElement;
  private rafId = 0;
  private statusTimer = 0;

  constructor(private ctx: Ctx) {
    this.doc = createEmptyDocument('untitled', ctx.state.currentBiome);
    this.buildDom();
    this.wireBar();
    this.wirePointer();
    window.addEventListener('keydown', this.onKeyDown, true);
    // Entering play (PLAY button) while authoring closes the overlay; the
    // document survives for the next open.
    ctx.events.on('modeChanged', ({ mode }) => {
      if (mode === 'play' && this.isOpen) this.close();
    });
  }

  /* ===================== open / close ===================== */

  open(): void {
    if (this.isOpen) return;
    // The Builder rides on build mode; leave the descent first if needed.
    if (this.ctx.state.mode === 'play') {
      (document.getElementById('mode-build-btn') as HTMLButtonElement | null)?.click();
    }
    this.isOpen = true;
    if (!this.ctx.state.paused) {
      this.ctx.state.paused = true;
      this.ownsPause = true;
    }
    if (this.returningFromPlaytest && this.doc.world) {
      // The compiled playtest scarred a COPY; re-decode the authored layer.
      applyWorldLayer(this.ctx, this.doc.world);
      this.ctx.enemies.length = 0;
      this.ctx.projectiles.length = 0;
      this.ctx.particles.clear();
      this.status('PLAYTEST DISCARDED — DOCUMENT TERRAIN RESTORED');
    }
    this.returningFromPlaytest = false;
    this.root.style.display = '';
    this.modeBtn.classList.add('active');
    document.body.classList.add('builder-open');
    this.refreshDocSelect();
    this.syncAll();
    this.rafId = requestAnimationFrame(this.loop);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.rafId);
    if (this.ownsPause) {
      this.ctx.state.paused = false;
      this.ownsPause = false;
    }
    this.placeKind = null;
    this.drag = null;
    this.root.style.display = 'none';
    this.modeBtn.classList.remove('active');
    document.body.classList.remove('builder-open');
  }

  /* ===================== DOM scaffold ===================== */

  private buildDom(): void {
    // Header toggle, third seat in the existing mode switch.
    this.modeBtn = document.createElement('button');
    this.modeBtn.id = 'mode-builder-btn';
    this.modeBtn.textContent = 'BUILDER';
    this.modeBtn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    document.querySelector('.mode-switch')?.appendChild(this.modeBtn);

    const holder = document.getElementById('canvas-holder');
    this.root = document.createElement('div');
    this.root.id = 'builder-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="builder-bar">
        <span class="b-title">BUILDER</span>
        <input id="b-doc-name" value="untitled" spellcheck="false" title="Document name">
        <select id="b-biome" title="Document biome"></select>
        <button id="b-new" title="New document">NEW</button>
        <select id="b-doc-select" title="Saved documents"></select>
        <button id="b-load">LOAD</button>
        <button id="b-save">SAVE</button>
        <button id="b-export">EXPORT</button>
        <label for="b-import" class="b-filebtn">IMPORT</label>
        <input type="file" id="b-import" accept=".json" hidden>
        <span class="b-sep"></span>
        <button id="b-undo" title="Ctrl+Z">&#8617;</button>
        <button id="b-redo" title="Ctrl+Y">&#8618;</button>
        <span class="b-sep"></span>
        <button id="b-capture" title="Snapshot the live sandbox cells into the document">CAPTURE TERRAIN</button>
        <button id="b-validate">VALIDATE</button>
        <button id="b-playtest" class="b-accent">PLAYTEST</button>
        <button id="b-exit">EXIT</button>
      </div>
      <div id="builder-overlay"><div id="builder-markers"></div></div>
      <div id="builder-palette">
        <div class="bp-head">PLACE</div>
        ${PLACEABLE.map(
          (p) => `<button class="bp-tool" data-kind="${p.kind}"><span class="bp-glyph k-${p.kind}">${p.glyph}</span>${p.label}</button>`,
        ).join('')}
        <div class="bp-hint">Click canvas to place.<br>ESC cancels &middot; DEL removes.<br>Terrain: paint in Sandbox,<br>then CAPTURE TERRAIN.</div>
      </div>
      <div id="builder-inspector"></div>
      <div id="builder-issues" style="display:none"></div>
      <div id="builder-status"></div>`;
    holder?.appendChild(this.root);

    this.overlay = this.root.querySelector('#builder-overlay') as HTMLDivElement;
    this.markerLayer = this.root.querySelector('#builder-markers') as HTMLDivElement;

    const biome = this.el<HTMLSelectElement>('b-biome');
    for (const b of BIOMES) {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = b;
      biome.appendChild(opt);
    }

    // Keystrokes inside Builder fields are the Builder's: stop them before
    // they bubble to InputManager (else typing a name pans the camera).
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.addEventListener('keyup', (e) => e.stopPropagation());

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.bp-tool')) {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.kind as EditorObjectKind;
        this.placeKind = this.placeKind === kind ? null : kind;
        this.syncPalette();
      });
    }
  }

  private el<T extends HTMLElement>(id: string): T {
    return this.root.querySelector('#' + id) as T;
  }

  /* ===================== top bar actions ===================== */

  private wireBar(): void {
    this.el<HTMLInputElement>('b-doc-name').addEventListener('change', (e) => {
      this.doc.name = (e.target as HTMLInputElement).value.trim() || 'untitled';
    });
    this.el<HTMLSelectElement>('b-biome').addEventListener('change', (e) => {
      this.doc.biome = (e.target as HTMLSelectElement).value as BiomeId;
    });

    this.el('b-new').addEventListener('click', () => {
      if (this.doc.objects.length > 0 && !window.confirm('Discard the current document?')) return;
      this.doc = createEmptyDocument('untitled', this.ctx.state.currentBiome);
      this.cmds.clear();
      this.selectedId = null;
      this.syncAll();
      this.status('NEW DOCUMENT');
    });

    this.el('b-save').addEventListener('click', () => {
      const lib = loadDocLibrary();
      lib[this.doc.id] = this.doc;
      if (saveDocLibrary(lib)) this.status(`SAVED "${this.doc.name.toUpperCase()}"`);
      else this.status('STORAGE FULL — USE EXPORT', true);
      this.refreshDocSelect();
    });

    this.el('b-load').addEventListener('click', () => {
      const id = this.el<HTMLSelectElement>('b-doc-select').value;
      const saved = loadDocLibrary()[id];
      if (!saved) return;
      // Clone so edits never mutate the library copy until the next SAVE.
      this.doc = JSON.parse(JSON.stringify(saved)) as EditorDocument;
      this.cmds.clear();
      this.selectedId = null;
      this.applyDocTerrain();
      this.syncAll();
      this.status(`LOADED "${this.doc.name.toUpperCase()}"`);
    });

    this.el('b-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this.doc)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.doc.name || 'level'}.builder.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    this.el<HTMLInputElement>('b-import').addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as EditorDocument;
          if (parsed.v !== 2 || !Array.isArray(parsed.objects)) throw new Error('bad');
          this.doc = parsed;
          this.cmds.clear();
          this.selectedId = null;
          this.applyDocTerrain();
          this.syncAll();
          this.status(`IMPORTED "${this.doc.name.toUpperCase()}"`);
        } catch {
          this.status('NOT A BUILDER DOCUMENT', true);
        }
        input.value = '';
      });
    });

    this.el('b-undo').addEventListener('click', () => this.undo());
    this.el('b-redo').addEventListener('click', () => this.redo());

    this.el('b-capture').addEventListener('click', () => {
      this.doc.world = captureWorldLayer(this.ctx);
      this.status('TERRAIN CAPTURED INTO DOCUMENT');
    });

    this.el('b-validate').addEventListener('click', () => {
      const issues = validateDocument(this.doc);
      this.doc.validation = {
        at: new Date().toISOString(),
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
      };
      this.renderIssues(issues);
      this.status(issues.length === 0 ? 'VALID — NO ISSUES' : `${issues.length} ISSUE(S)`);
    });

    this.el('b-playtest').addEventListener('click', () => this.playtest());
    this.el('b-exit').addEventListener('click', () => this.close());
  }

  private playtest(): void {
    const issues = validateDocument(this.doc);
    this.renderIssues(issues);
    if (issues.some((i) => i.severity === 'error')) {
      this.status('FIX ERRORS BEFORE PLAYTEST', true);
      return;
    }
    this.returningFromPlaytest = true;
    this.close();
    compileAndPlaytest(this.ctx, this.doc);
    (document.getElementById('mode-play-btn') as HTMLButtonElement | null)?.click();
  }

  /** Re-decode the authored terrain into the live world (fresh combat state). */
  private applyDocTerrain(): void {
    if (!this.doc.world) return;
    applyWorldLayer(this.ctx, this.doc.world);
    this.ctx.enemies.length = 0;
    this.ctx.projectiles.length = 0;
    this.ctx.particles.clear();
  }

  private undo(): void {
    const label = this.cmds.undo();
    this.status(label ? 'UNDID ' + label.toUpperCase() : 'NOTHING TO UNDO');
    this.syncAll();
  }

  private redo(): void {
    const label = this.cmds.redo();
    this.status(label ? 'REDID ' + label.toUpperCase() : 'NOTHING TO REDO');
    this.syncAll();
  }

  /* ===================== pointer: place / select / drag ===================== */

  /** Screen -> world cells; the inverse of InputManager.getMouseGridCoords. */
  private mouseToWorld(e: MouseEvent): { x: number; y: number } {
    const rect = this.overlay.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    const zx = 0.5 + (u - 0.5) / this.ctx.camera.zoom;
    const zy = 0.5 + (v - 0.5) / this.ctx.camera.zoom;
    return {
      x: Math.floor(zx * VIEW_W) + this.ctx.camera.renderX,
      y: Math.floor(zy * VIEW_H) + this.ctx.camera.renderY,
    };
  }

  private wirePointer(): void {
    this.overlay.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const pos = this.mouseToWorld(e);
      if (this.placeKind) {
        this.place(this.placeKind, pos.x, pos.y);
        this.placeKind = null;
        this.syncPalette();
        return;
      }
      const hit = this.hitTest(pos.x, pos.y);
      this.select(hit?.id ?? null);
      if (hit && !hit.locked) {
        this.drag = { obj: hit, origX: hit.x, origY: hit.y, grabX: pos.x - hit.x, grabY: pos.y - hit.y };
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      const pos = this.mouseToWorld(e);
      this.drag.obj.x = pos.x - this.drag.grabX;
      this.drag.obj.y = pos.y - this.drag.grabY;
    });
    window.addEventListener('mouseup', () => {
      if (!this.drag) return;
      const { obj, origX, origY } = this.drag;
      const toX = obj.x;
      const toY = obj.y;
      this.drag = null;
      if (toX === origX && toY === origY) return;
      // Rewind the live preview, then land the move as one undoable command.
      obj.x = origX;
      obj.y = origY;
      this.cmds.run(moveObjectCmd(obj, toX, toY));
      this.renderInspector();
    });
  }

  private place(kind: EditorObjectKind, x: number, y: number): void {
    // A document has exactly one spawn: placing again moves the existing one.
    if (kind === 'spawn') {
      const existing = this.doc.objects.find((o) => o.kind === 'spawn');
      if (existing) {
        this.cmds.run(moveObjectCmd(existing, x, y));
        this.select(existing.id);
        this.status('SPAWN MOVED');
        return;
      }
    }
    const obj: EditorObject = {
      id: freshId(kind),
      kind,
      x,
      y,
      rotation: 0,
      locked: false,
      hidden: false,
      params: DEFAULT_PARAMS[kind]?.() ?? {},
    };
    this.cmds.run(addObjectCmd(obj));
    this.select(obj.id);
    this.status('PLACED ' + kind.toUpperCase());
  }

  private hitTest(x: number, y: number): EditorObject | null {
    let best: EditorObject | null = null;
    let bestD = PICK_RADIUS * PICK_RADIUS;
    for (const o of this.doc.objects) {
      const d = (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y);
      if (d <= bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private select(id: string | null): void {
    this.selectedId = id;
    this.syncMarkers();
    this.renderInspector();
  }

  private deleteSelection(): void {
    const obj = this.selected();
    if (!obj) return;
    this.cmds.run(deleteObjectCmd(obj));
    this.select(null);
    this.status('DELETED ' + obj.kind.toUpperCase());
  }

  private selected(): EditorObject | null {
    return this.doc.objects.find((o) => o.id === this.selectedId) ?? null;
  }

  /* ===================== keyboard (capture phase) ===================== */

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (e.code === 'Escape') (t as HTMLInputElement).blur();
      return; // let the field receive the key; root handlers shield InputManager
    }
    if (e.code === 'Tab') {
      // The Builder owns Tab — no silent mode flip mid-edit.
      e.preventDefault();
      e.stopPropagation();
    } else if (e.code === 'Escape') {
      e.stopPropagation();
      if (this.placeKind) {
        this.placeKind = null;
        this.syncPalette();
      } else this.select(null);
    } else if (e.code === 'Delete') {
      e.stopPropagation();
      this.deleteSelection();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      e.stopPropagation();
      this.redo();
    } else if (e.code === 'KeyB' || e.code === 'KeyM' || e.code === 'KeyH') {
      // Keep play-mode overlays (bench/map/handbook) out of authoring.
      e.stopPropagation();
    }
  };

  /* ===================== markers ===================== */

  /** Per-frame: glue the DOM markers to their world positions. */
  private loop = (): void => {
    if (!this.isOpen) return;
    this.rafId = requestAnimationFrame(this.loop);
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width === 0) return;
    const cam = this.ctx.camera;
    for (const [id, el] of this.markers) {
      const obj = this.doc.objects.find((o) => o.id === id);
      if (!obj) continue;
      // Forward transform of InputManager.getMouseGridCoords (zoom-aware).
      const ux = ((obj.x - cam.renderX) / VIEW_W - 0.5) * cam.zoom + 0.5;
      const uy = ((obj.y - cam.renderY) / VIEW_H - 0.5) * cam.zoom + 0.5;
      el.style.left = (ux * rect.width).toFixed(1) + 'px';
      el.style.top = (uy * rect.height).toFixed(1) + 'px';
      el.style.display = ux < -0.02 || ux > 1.02 || uy < -0.02 || uy > 1.02 ? 'none' : '';
    }
  };

  /** Rebuild the marker DOM from the document (object set changed). */
  private syncMarkers(): void {
    this.markerLayer.innerHTML = '';
    this.markers.clear();
    for (const o of this.doc.objects) {
      const m = document.createElement('div');
      m.className = `b-marker k-${o.kind}`
        + (o.id === this.selectedId ? ' sel' : '')
        + (o.hidden ? ' ghost' : '');
      m.textContent = GLYPH[o.kind] ?? '?';
      m.title = o.kind;
      this.markers.set(o.id, m);
      this.markerLayer.appendChild(m);
    }
  }

  /* ===================== inspector ===================== */

  private renderInspector(): void {
    const panel = this.el<HTMLDivElement>('builder-inspector');
    const obj = this.selected();
    if (!obj) {
      panel.innerHTML = `<div class="bi-head">INSPECTOR</div>
        <div class="bi-empty">Nothing selected.<br>Click a marker, or pick a<br>tool and click the canvas.</div>
        <div class="bi-row"><span>objects</span><b>${this.doc.objects.length}</b></div>
        <div class="bi-row"><span>terrain</span><b>${this.doc.world ? 'captured' : '—'}</b></div>
        <div class="bi-row"><span>undo depth</span><b>${this.cmds.depth}</b></div>`;
      return;
    }

    let rows = `<div class="bi-head">${obj.kind.toUpperCase()}</div>
      <div class="bi-id">${obj.id}</div>
      <div class="bi-row"><span>x</span><input type="number" data-f="x" value="${Math.round(obj.x)}"></div>
      <div class="bi-row"><span>y</span><input type="number" data-f="y" value="${Math.round(obj.y)}"></div>`;

    if (obj.kind === 'enemy') {
      rows += `<div class="bi-row"><span>kind</span><select data-p="kind">${ENEMY_KINDS.map(
        (k) => `<option value="${k}"${obj.params.kind === k ? ' selected' : ''}>${k}</option>`,
      ).join('')}</select></div>`;
      if (obj.params.kind === 'bat') {
        rows += this.checkRow(obj, 'sleeping', 'roosting');
      }
    } else if (obj.kind === 'pickup') {
      rows += `<div class="bi-row"><span>kind</span><select data-p="kind">${PICKUP_KINDS.map(
        (k) => `<option value="${k}"${obj.params.kind === k ? ' selected' : ''}>${k}</option>`,
      ).join('')}</select></div>`;
      const pk = obj.params.kind;
      if (pk === 'goldpile' || pk === 'chest') {
        rows += `<div class="bi-row"><span>amount</span><input type="number" data-p="amount" data-num="1" value="${
          typeof obj.params.amount === 'number' ? obj.params.amount : 30
        }"></div>`;
      }
      if (pk === 'tome') {
        rows += `<div class="bi-row"><span>card</span><input type="text" data-p="card" placeholder="random" value="${
          typeof obj.params.card === 'string' ? obj.params.card : ''
        }"></div>`;
      }
      if (pk === 'potion') {
        rows += `<div class="bi-row"><span>potion</span><input type="text" data-p="potion" placeholder="random" value="${
          typeof obj.params.potion === 'string' ? obj.params.potion : ''
        }"></div>`;
      }
    } else if (obj.kind === 'exitPortal') {
      rows += this.checkRow(obj, 'alwaysOpen', 'always open');
    } else if (obj.kind === 'waystone') {
      rows += this.checkRow(obj, 'lit', 'pre-lit');
    }

    rows += `<div class="bi-flags">
        <label><input type="checkbox" data-f="locked"${obj.locked ? ' checked' : ''}>locked</label>
        <label><input type="checkbox" data-f="hidden"${obj.hidden ? ' checked' : ''}>hidden</label>
      </div>
      <button id="bi-delete">DELETE (DEL)</button>`;
    panel.innerHTML = rows;

    // x/y commit as move commands; params as edit-param commands.
    for (const input of panel.querySelectorAll<HTMLInputElement>('input[data-f="x"],input[data-f="y"]')) {
      input.addEventListener('change', () => {
        const nx = input.dataset.f === 'x' ? Number(input.value) : obj.x;
        const ny = input.dataset.f === 'y' ? Number(input.value) : obj.y;
        if (Number.isFinite(nx) && Number.isFinite(ny)) this.cmds.run(moveObjectCmd(obj, nx, ny));
        this.syncMarkers();
      });
    }
    for (const field of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-p]')) {
      field.addEventListener('change', () => {
        const key = field.dataset.p as string;
        let value: unknown =
          field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : field.value;
        if (field.dataset.num) value = Number(field.value);
        if (value === '') value = undefined;
        this.cmds.run(editParamCmd(obj, key, value));
        this.renderInspector(); // kind switches change which param rows exist
      });
    }
    for (const flag of panel.querySelectorAll<HTMLInputElement>('input[data-f="locked"],input[data-f="hidden"]')) {
      flag.addEventListener('change', () => {
        if (flag.dataset.f === 'locked') obj.locked = flag.checked;
        else obj.hidden = flag.checked;
        this.syncMarkers();
      });
    }
    panel.querySelector('#bi-delete')?.addEventListener('click', () => this.deleteSelection());
  }

  private checkRow(obj: EditorObject, key: string, label: string): string {
    return `<div class="bi-row"><span>${label}</span><input type="checkbox" data-p="${key}"${
      obj.params[key] === true ? ' checked' : ''
    }></div>`;
  }

  /* ===================== issues / status / sync ===================== */

  private renderIssues(issues: DocIssue[]): void {
    const panel = this.el<HTMLDivElement>('builder-issues');
    if (issues.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    panel.innerHTML =
      `<div class="bi-head">ISSUES <button id="b-issues-close">&times;</button></div>` +
      issues
        .map(
          (i, n) =>
            `<div class="b-issue ${i.severity}" data-n="${n}">[${i.severity.slice(0, 4).toUpperCase()}] ${i.what}</div>`,
        )
        .join('');
    panel.querySelector('#b-issues-close')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });
    for (const row of panel.querySelectorAll<HTMLDivElement>('.b-issue')) {
      row.addEventListener('click', () => {
        const issue = issues[Number(row.dataset.n)];
        if (issue?.objId) this.select(issue.objId);
      });
    }
  }

  private status(text: string, warn = false): void {
    const line = this.el<HTMLDivElement>('builder-status');
    line.textContent = text;
    line.classList.toggle('warn', warn);
    line.classList.add('show');
    clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => line.classList.remove('show'), 4000);
  }

  private syncPalette(): void {
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.bp-tool')) {
      btn.classList.toggle('active', btn.dataset.kind === this.placeKind);
    }
  }

  private refreshDocSelect(): void {
    const select = this.el<HTMLSelectElement>('b-doc-select');
    const lib = loadDocLibrary();
    select.innerHTML = '';
    for (const [id, d] of Object.entries(lib)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = d.name;
      select.appendChild(opt);
    }
    select.disabled = select.options.length === 0;
  }

  private syncAll(): void {
    this.el<HTMLInputElement>('b-doc-name').value = this.doc.name;
    this.el<HTMLSelectElement>('b-biome').value = this.doc.biome;
    this.syncMarkers();
    this.syncPalette();
    this.renderInspector();
  }
}
