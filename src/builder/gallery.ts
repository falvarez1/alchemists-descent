import type { Ctx, Enemy, EnemyKind, Mechanism, RuneVault, RuntimeDecor } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { EventBus } from '@/core/events';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, stoneColor, unpackB, unpackG, unpackR } from '@/sim/colors';
import { CELL_PALETTE, paletteColor } from '@/sim/cellPalette';
// Concrete game/render imports follow the compile.ts -> game/instantiate
// precedent: the gallery IS a consumer of the real runtime — previews must
// animate with the same code the game runs, or they drift into fiction.
import {
  Mechanisms,
  makeBrazier,
  makeBuoy,
  makeChargeLatch,
  makeCounterweight,
  makeDoor,
  makeLever,
  makePlate,
  makePlug,
  makeRelay,
  makeScale,
  makeSensor,
  makeValve,
  setDoorCells,
  setValveCells,
} from '@/game/Mechanisms';
import { instantiateObjects, makeInstantiationSink } from '@/game/instantiate';
import { stampBuoyBasin } from '@/builder/stamps';
import type { CellSetter } from '@/builder/stamps';
import { decodePrefabCells } from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';
import type { SpriteAsset } from '@/builder/assets/sprites';
import { resolveLoopTag } from '@/builder/assets/sprites';
import { resolveRuntimeSprite } from '@/builder/assets/spritelib';
import type { ResolvedSprite } from '@/builder/assets/spritelib';
import { drawMechanismSprite, drawRuneGlyphSprite } from '@/render/sprites/MechanismSprites';
import { drawPlayerSprite } from '@/render/sprites/PlayerSprite';
import { drawEnemySprite } from '@/render/sprites/EnemySprites';
import { drawDecor } from '@/render/sprites/DecorSprites';
import { createPlayer } from '@/entities/Player';
import { createDefaultStatus } from '@/entities/status';

/**
 * THE GALLERY (docs/BUILDER.md): a Storybook-style browser for everything
 * the game can show — prefabs, mechanisms, entities, animated sprites —
 * presented live. Mechanism rigs run the REAL Mechanisms runtime against a
 * scratch World (a lever pull really sweeps, a valve really retracts its
 * cells, a counterweight really tips); entities draw through the REAL
 * sprite functions; prefabs render their actual cells with their actual
 * lights, mechanisms, decor, and inhabitants. State chips switch each item
 * between its meaningful states. Nothing here is a mockup.
 */

interface StageRig {
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Render real cells from the scratch world inside bounds. */
  cells?: boolean;
  /** Logic tick (the real Mechanisms.update, state scripts, anim drivers). */
  step?: (frame: number) => void;
  /** Overlay sprites (mechanism states, entities, decor) — world coords. */
  draw?: (s: PixelSurface, frame: number) => void;
  /** Soft light halos drawn under the overlay (prefab authored lights). */
  halos?: Array<{ x: number; y: number; r: number; css: string }>;
  /** Vector annotations (anchors, footprints, links) for MARKERS states. */
  markers?: Array<
    | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; css: string }
    | { kind: 'tick'; x: number; y: number; dx: number; dy: number; css: string }
  >;
}

interface GalleryItem {
  id: string;
  section: 'MECHANISMS' | 'PREFABS' | 'ENTITIES' | 'SPRITES';
  name: string;
  meta: string;
  desc: string;
  glyph: string;
  glyphCss: string;
  states: string[];
  thumb?: () => HTMLCanvasElement | null;
  build: (state: number) => StageRig;
}

export interface GalleryHooks {
  ctx: Ctx;
  /** User prefab library (builtins are added by the gallery itself). */
  userPrefabs: () => PrefabDef[];
  builtinPrefabs: () => ReadonlyArray<PrefabDef>;
  sprites: () => SpriteAsset[];
  docSprites: () => SpriteAsset[] | undefined;
}

/** Stage rig origin on the scratch world (kept inside decor cull range). */
const RX = 120;
const FY = 120; // rig floor row

const ZOOMS = [1, 2, 3, 4, 6, 8, 10];

const FULLBRIGHT = {
  sample: () => ({ r: 1, g: 1, b: 1 }),
} as unknown as LightField;

const ENEMY_DESC: Partial<Record<EnemyKind, string>> = {
  slime: 'Squash-and-stretch hopper. Splits its gaze around the room until alerted.',
  acidslime: 'A slime in acid greens — its blood eats the floor.',
  imp: 'Self-lit hover-flapper. Dives in arcs.',
  golem: 'Heavy strider with a pulsing core. Leaves dents in the dark.',
  wisp: 'A guttering diamond of light. The room follows it.',
  mage: 'Hooded telekinetic — hands flare when it channels.',
  bat: 'Sleeps on ceilings; wakes as a flutter of leather.',
  spitter: 'Lobs corrosive gobs from range.',
  bomber: 'Walks its payload to you, fuse first.',
  eggs: 'A clutch. It is not dormant.',
  colossus: 'The Kiln Colossus. Water is the strategy.',
  leviathan: 'The Sunken Leviathan. Water is its armor — take the water away.',
};

const ENEMY_KINDS: EnemyKind[] = [
  'slime', 'imp', 'golem', 'acidslime', 'wisp', 'mage', 'bat', 'spitter', 'bomber', 'eggs', 'colossus',
  'leviathan',
];

export class Gallery {
  private root: HTMLDivElement;
  private stage!: HTMLCanvasElement;
  private listEl!: HTMLDivElement;
  private infoEl!: HTMLDivElement;
  private searchEl!: HTMLInputElement;
  private captionEl!: HTMLDivElement;

  private items: GalleryItem[] = [];
  private filtered: GalleryItem[] = [];
  private selected = 0;
  private state = 0;
  private rig: StageRig | null = null;
  private zoom = 0; // 0 = FIT
  private frame = 1;
  private raf = 0;
  private openFlag = false;
  private caption = '';
  private captionT = 0;
  private warned = new Set<string>();
  /** Cursor position in WORLD cells over the stage — alerted entities track
   *  it (a STABLE object: rigs capture the reference, the loop mutates). */
  private cursorWorld = { x: RX + 26, y: FY - 6 };
  private mousePx: { x: number; y: number } | null = null;

  // ---- the live micro-sim: ONE scratch world + real Mechanisms runtime ----
  private world = new World();
  private events = new EventBus();
  private runtime: { mechanisms: Mechanism[]; runeVaults: RuneVault[]; emitters: never[] } = {
    mechanisms: [],
    runeVaults: [],
    emitters: [],
  };
  private stubState = { mode: 'play', paused: false, frameCount: 1, currentBiome: 'earthen' };
  private stub: Ctx;
  private mech: Mechanisms;
  private spriteCache = new Map<string, ResolvedSprite | null>();

  constructor(
    host: HTMLElement,
    private hooks: GalleryHooks,
  ) {
    const noop = (): void => undefined;
    this.stub = {
      world: this.world,
      events: this.events,
      enemies: [],
      player: { x: -500, y: -500, dead: false, pullT: 0, pullDir: 1, facing: 1 },
      camera: { renderX: 0, renderY: 0, x: 0, y: 0 },
      state: this.stubState,
      audio: {
        tone: noop, groan: noop, zap: noop, bubble: noop, brazier: noop,
        lever: noop, doorGrind: noop, boom: noop,
      },
      particles: { spawn: noop, burst: noop, clear: noop },
      enemyCtl: hooks.ctx.enemyCtl,
      params: hooks.ctx.params,
      levels: { current: this.runtime },
      fx: { screenShake: 0 },
    } as unknown as Ctx;
    this.mech = new Mechanisms(this.stub);
    this.events.on('toast', ({ text }) => {
      this.caption = text;
      this.captionT = 160;
    });

    this.root = document.createElement('div');
    this.root.id = 'builder-gallery';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="bg-head">
        <span class="bg-title">GALLERY</span>
        <input id="bg-search" placeholder="search… ( / )" spellcheck="false">
        <span class="bg-hint">&uarr;&darr; browse &middot; &larr;&rarr; states &middot; +/&minus; zoom &middot; ESC close</span>
        <button id="bg-close" aria-label="Close gallery">&times;</button>
      </div>
      <div class="bg-body">
        <div id="bg-list"></div>
        <div class="bg-stagewrap">
          <canvas id="bg-stage"></canvas>
          <div class="bg-zoom">
            <button data-z="-" aria-label="Zoom out">&minus;</button>
            <button data-z="0" aria-label="Fit to stage">FIT</button>
            <button data-z="+" aria-label="Zoom in">+</button>
          </div>
          <div id="bg-caption"></div>
        </div>
        <div id="bg-info"></div>
      </div>`;
    host.appendChild(this.root);
    this.stage = this.root.querySelector('#bg-stage')!;
    this.listEl = this.root.querySelector('#bg-list')!;
    this.infoEl = this.root.querySelector('#bg-info')!;
    this.searchEl = this.root.querySelector('#bg-search')!;
    this.captionEl = this.root.querySelector('#bg-caption')!;
    this.root.querySelector('#bg-close')!.addEventListener('click', () => this.close());
    this.stage.addEventListener('mousemove', (e) => {
      const r = this.stage.getBoundingClientRect();
      this.mousePx = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    this.stage.addEventListener('mouseleave', () => {
      this.mousePx = null;
    });
    this.searchEl.addEventListener('input', () => this.applyFilter());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.bg-zoom button')) {
      b.addEventListener('click', () => {
        const z = b.dataset.z!;
        if (z === '0') this.zoom = 0;
        else {
          const cur = this.zoom === 0 ? this.fitZoom() : this.zoom;
          const i = ZOOMS.indexOf(cur);
          this.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (z === '+' ? 1 : -1)))];
        }
      });
    }
    document.addEventListener('keydown', this.onKey, true);
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  open(): void {
    this.items = this.buildCatalog();
    this.openFlag = true;
    this.root.style.display = '';
    this.searchEl.value = '';
    this.applyFilter();
    this.loop();
  }

  close(): void {
    this.openFlag = false;
    this.root.style.display = 'none';
    cancelAnimationFrame(this.raf);
    this.rig = null;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.openFlag) return;
    // typing in search: arrows still browse the filtered results (the
    // Storybook way); Enter/Escape leave the field; the rest types
    if (document.activeElement === this.searchEl) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        this.searchEl.blur();
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') {
        e.stopPropagation();
        return;
      }
    }
    if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const d = e.key === 'ArrowDown' ? 1 : -1;
      this.select((this.selected + d + this.filtered.length) % Math.max(1, this.filtered.length));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const it = this.filtered[this.selected];
      if (it && it.states.length > 1) {
        const d = e.key === 'ArrowRight' ? 1 : -1;
        this.setState((this.state + d + it.states.length) % it.states.length);
      }
    } else if (e.key === '+' || e.key === '=') {
      const cur = this.zoom === 0 ? this.fitZoom() : this.zoom;
      this.zoom = ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(cur) + 1)];
    } else if (e.key === '-') {
      const cur = this.zoom === 0 ? this.fitZoom() : this.zoom;
      this.zoom = ZOOMS[Math.max(0, ZOOMS.indexOf(cur) - 1)];
    } else if (e.key === '/') {
      this.searchEl.focus();
    } else {
      // unhandled: still swallow it so Builder hotkeys can't fire underneath
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
  };

  /* ===================== catalog ===================== */

  private buildCatalog(): GalleryItem[] {
    const items: GalleryItem[] = [];
    items.push(...this.mechanismItems());
    items.push(...this.prefabItems());
    items.push(...this.entityItems());
    items.push(...this.spriteItems());
    return items;
  }

  private applyFilter(): void {
    const q = this.searchEl.value.trim().toLowerCase();
    this.filtered = q
      ? this.items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.meta.toLowerCase().includes(q) ||
            i.section.toLowerCase().includes(q),
        )
      : this.items;
    this.renderList();
    this.select(0);
  }

  private select(n: number): void {
    this.selected = Math.max(0, Math.min(this.filtered.length - 1, n));
    this.state = 0;
    this.rebuild();
    this.renderList();
    this.renderInfo();
    // manual nearest-scroll INSIDE the list only — scrollIntoView would drag
    // the whole modal along with it
    const row = this.listEl.querySelector<HTMLElement>(`[data-n="${this.selected}"]`);
    if (row) {
      const top = row.offsetTop;
      if (top < this.listEl.scrollTop + 24) this.listEl.scrollTop = Math.max(0, top - 24);
      else if (top + row.offsetHeight > this.listEl.scrollTop + this.listEl.clientHeight) {
        this.listEl.scrollTop = top + row.offsetHeight - this.listEl.clientHeight;
      }
    }
  }

  private setState(s: number): void {
    this.state = s;
    this.rebuild();
    this.renderInfo();
  }

  private rebuild(): void {
    const it = this.filtered[this.selected];
    if (!it) {
      this.rig = null;
      return;
    }
    // a fresh rig gets a fresh micro-world and an empty mechanism roster
    this.world.clear();
    this.runtime.mechanisms.length = 0;
    this.runtime.runeVaults.length = 0;
    this.caption = '';
    this.captionT = 0;
    this.rig = it.build(this.state);
  }

  /* ===================== rendering ===================== */

  private loop = (): void => {
    if (!this.openFlag) return;
    this.frame++;
    this.stubState.frameCount = this.frame;
    const rig = this.rig;
    const g = this.stage.getContext('2d')!;
    const wrap = this.stage.parentElement!;
    if (this.stage.width !== wrap.clientWidth || this.stage.height !== wrap.clientHeight - 28) {
      this.stage.width = Math.max(80, wrap.clientWidth);
      this.stage.height = Math.max(60, wrap.clientHeight - 28);
    }
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#07090d';
    g.fillRect(0, 0, this.stage.width, this.stage.height);

    if (rig) {
      const b = rig.bounds;
      const bw = b.x1 - b.x0 + 1,
        bh = b.y1 - b.y0 + 1;
      const z = this.zoom === 0 ? this.fitZoom() : this.zoom;
      const ox = Math.floor((this.stage.width - bw * z) / 2);
      const oy = Math.floor((this.stage.height - bh * z) / 2);
      // the cursor in world cells BEFORE the rig thinks (alerted gaze)
      if (this.mousePx) {
        this.cursorWorld.x = b.x0 + (this.mousePx.x - ox) / z;
        this.cursorWorld.y = b.y0 + (this.mousePx.y - oy) / z;
        this.stage.dataset.cursor = `${Math.round(this.cursorWorld.x)},${Math.round(this.cursorWorld.y)}`;
      }
      rig.step?.(this.frame);

      // backdrop checker so transparency reads as transparency
      g.fillStyle = '#0a0d13';
      g.fillRect(ox, oy, bw * z, bh * z);
      g.fillStyle = '#0d1118';
      const ck = Math.max(4, z * 2);
      for (let y = 0; y * ck < bh * z; y++) {
        for (let x = (y % 2); x * ck < bw * z; x += 2) {
          g.fillRect(ox + x * ck, oy + y * ck, Math.min(ck, bw * z - x * ck), Math.min(ck, bh * z - y * ck));
        }
      }

      // 1) real cells from the scratch world
      if (rig.cells) {
        const img = g.createImageData(bw, bh);
        for (let y = 0; y < bh; y++) {
          for (let x = 0; x < bw; x++) {
            const wi = this.world.idx(b.x0 + x, b.y0 + y);
            const t = this.world.types[wi];
            if (t === Cell.Empty) continue;
            const c = this.world.colors[wi];
            const o = (x + y * bw) * 4;
            img.data[o] = unpackR(c);
            img.data[o + 1] = unpackG(c);
            img.data[o + 2] = unpackB(c);
            img.data[o + 3] = 255;
          }
        }
        const off = document.createElement('canvas');
        off.width = bw;
        off.height = bh;
        off.getContext('2d')!.putImageData(img, 0, 0);
        g.drawImage(off, ox, oy, bw * z, bh * z);
      }

      // 2) authored-light halos
      if (rig.halos) {
        g.globalCompositeOperation = 'lighter';
        for (const h of rig.halos) {
          const cx = ox + (h.x - b.x0 + 0.5) * z,
            cy = oy + (h.y - b.y0 + 0.5) * z;
          const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(4, h.r * z));
          grad.addColorStop(0, h.css);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad;
          g.beginPath();
          g.arc(cx, cy, Math.max(4, h.r * z), 0, Math.PI * 2);
          g.fill();
        }
        g.globalCompositeOperation = 'source-over';
      }

      // 3) live sprite overlay through a PixelSurface onto the canvas
      if (rig.draw) {
        const surf: PixelSurface = {
          setPx: (wx, wy, r, gg, bb) => {
            g.globalCompositeOperation = 'source-over';
            g.fillStyle = `rgb(${Math.min(255, Math.round(r * 255))},${Math.min(255, Math.round(gg * 255))},${Math.min(255, Math.round(bb * 255))})`;
            g.fillRect(ox + (Math.round(wx) - b.x0) * z, oy + (Math.round(wy) - b.y0) * z, z, z);
          },
          addPx: (wx, wy, r, gg, bb) => {
            g.globalCompositeOperation = 'lighter';
            g.fillStyle = `rgb(${Math.min(255, Math.round(r * 255))},${Math.min(255, Math.round(gg * 255))},${Math.min(255, Math.round(bb * 255))})`;
            g.fillRect(ox + (Math.round(wx) - b.x0) * z, oy + (Math.round(wy) - b.y0) * z, z, z);
          },
        };
        rig.draw(surf, this.frame);
        g.globalCompositeOperation = 'source-over';
      }

      // 4) annotations
      if (rig.markers) {
        g.lineWidth = 1;
        for (const mk of rig.markers) {
          if (mk.kind === 'box') {
            g.strokeStyle = mk.css;
            g.setLineDash([4, 3]);
            g.strokeRect(ox + (mk.x0 - b.x0) * z, oy + (mk.y0 - b.y0) * z, (mk.x1 - mk.x0 + 1) * z, (mk.y1 - mk.y0 + 1) * z);
            g.setLineDash([]);
          } else {
            g.strokeStyle = mk.css;
            g.beginPath();
            const sx = ox + (mk.x - b.x0 + 0.5) * z,
              sy = oy + (mk.y - b.y0 + 0.5) * z;
            g.moveTo(sx, sy);
            g.lineTo(sx + mk.dx * z * 4, sy + mk.dy * z * 4);
            g.stroke();
          }
        }
      }
    }

    // caption strip: state name, overridden by live toasts from the rig
    if (this.captionT > 0) this.captionT--;
    const it = this.filtered[this.selected];
    const base = it ? `${it.name}${it.states.length > 1 ? ' — ' + it.states[this.state] : ''}` : '';
    this.captionEl.textContent = this.captionT > 0 ? this.caption : base;
    this.captionEl.classList.toggle('bg-toast', this.captionT > 0);

    this.raf = requestAnimationFrame(this.loop);
  };

  private fitZoom(): number {
    const rig = this.rig;
    if (!rig) return 2;
    const bw = rig.bounds.x1 - rig.bounds.x0 + 1,
      bh = rig.bounds.y1 - rig.bounds.y0 + 1;
    return Math.max(1, Math.min(12, Math.floor(Math.min((this.stage.width - 16) / bw, (this.stage.height - 16) / bh))));
  }

  /* ===================== sidebar + info ===================== */

  private renderList(): void {
    this.listEl.innerHTML = '';
    let section = '';
    this.filtered.forEach((it, n) => {
      if (it.section !== section) {
        section = it.section;
        const head = document.createElement('div');
        head.className = 'bg-section';
        head.textContent = section;
        this.listEl.appendChild(head);
      }
      const row = document.createElement('div');
      row.className = 'bg-item' + (n === this.selected ? ' sel' : '');
      row.dataset.n = String(n);
      const thumb = it.thumb?.();
      if (thumb) {
        thumb.className = 'bg-thumb';
        row.appendChild(thumb);
      } else {
        const badge = document.createElement('span');
        badge.className = 'bg-badge';
        badge.style.color = it.glyphCss;
        badge.textContent = it.glyph;
        row.appendChild(badge);
      }
      const body = document.createElement('div');
      body.className = 'bg-itembody';
      body.innerHTML = `<span class="bg-name">${escapeHtml(it.name)}</span><span class="bg-meta">${escapeHtml(it.meta)}</span>`;
      row.appendChild(body);
      row.addEventListener('click', () => this.select(n));
      this.listEl.appendChild(row);
    });
    if (this.filtered.length === 0) {
      this.listEl.innerHTML = '<div class="bg-empty">nothing matches</div>';
    }
  }

  private renderInfo(): void {
    const it = this.filtered[this.selected];
    if (!it) {
      this.infoEl.innerHTML = '';
      return;
    }
    const chips = it.states
      .map(
        (s, n) =>
          `<button class="bg-chip${n === this.state ? ' on' : ''}" data-s="${n}">${escapeHtml(s)}</button>`,
      )
      .join('');
    this.infoEl.innerHTML =
      `<div class="bg-iname">${escapeHtml(it.name)}</div>` +
      `<div class="bg-imeta">${escapeHtml(it.meta)}</div>` +
      `<div class="bg-idesc">${escapeHtml(it.desc)}</div>` +
      (it.states.length > 1 ? `<div class="bg-ihead">STATES</div><div class="bg-chips">${chips}</div>` : '');
    for (const b of this.infoEl.querySelectorAll<HTMLButtonElement>('.bg-chip')) {
      b.addEventListener('click', () => this.setState(Number(b.dataset.s)));
    }
  }

  /* ===================== mechanism rigs ===================== */

  /** Stone floor + flanking pillars: every mechanism stands somewhere real. */
  private stageFloor(x0: number, x1: number): void {
    const w = this.world;
    for (let y = FY + 1; y <= FY + 3; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = Cell.Stone;
        w.colors[i] = stoneColor();
      }
    }
  }

  private paint(x0: number, y0: number, x1: number, y1: number, t: number, life = 0): void {
    const w = this.world;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = t;
        w.life[i] = life;
        const fn = COLOR_FN[t];
        w.colors[i] = t === Cell.Empty ? EMPTY_COLOR : fn ? fn() : EMPTY_COLOR;
      }
    }
  }

  private stepMech = (): void => {
    this.mech.update(this.stub);
  };

  private mechItem(
    name: string,
    glyph: string,
    glyphCss: string,
    desc: string,
    states: string[],
    build: (state: number) => StageRig,
  ): GalleryItem {
    return { id: 'mech-' + name, section: 'MECHANISMS', name, meta: 'mechanism', desc, glyph, glyphCss, states, build };
  }

  private mechanismItems(): GalleryItem[] {
    const list = this.runtime.mechanisms;
    const bounds = { x0: RX - 34, y0: FY - 26, x1: RX + 34, y1: FY + 4 };
    const targetDoor = (): Mechanism => {
      // a small payoff gate at the rig's edge so latches visibly OPEN something
      return makeDoor(this.stub, list, RX + 24, FY - 11, 3, 12);
    };
    return [
      this.mechItem(
        'Door', 'D', '#93c5fd',
        'A real metal gate: opens by retracting cell rows bottom-first, slams shut at once (never crushing a body).',
        ['CLOSED', 'OPEN'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          const door = makeDoor(this.stub, list, RX - 1, FY - 11, 3, 12);
          if (st === 1) setDoorCells(this.stub, door, true);
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Plate', '=', '#fbbf24',
        'A brass pressure sill — weighs real cells AND bodies on the rows above it.',
        ['IDLE', 'WEIGHTED'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          makePlate(this.world, list, RX - 9, FY, 7, targetDoor());
          if (st === 1) this.paint(RX - 7, FY - 2, RX - 5, FY - 1, Cell.Stone);
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Lever', '/', '#fbbf24',
        'Hand-pulled or flipped by concussion. The arm SWEEPS through the pull; the knob glows its state.',
        ['OFF', 'PULLING (loop)'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          const lever = makeLever(list, RX - 8, FY, targetDoor());
          return {
            bounds, cells: true,
            step: (f) => {
              if (st === 1 && f % 150 === 0 && (lever.pullT ?? 0) <= 0) lever.pullT = 26;
              this.stepMech();
            },
            draw: (s, f) => this.drawMechs(s, f),
          };
        },
      ),
      this.mechItem(
        'Brazier', '^', '#fb923c',
        'Latches forever when REAL fire reaches the bowl — then keeps its own flame burning.',
        ['DARK', 'LIT'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          makeBrazier(this.world, list, RX - 8, FY, targetDoor());
          if (st === 1) this.paint(RX - 9, FY - 2, RX - 7, FY - 1, Cell.Fire, 200);
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Scale', '#', '#fbbf24',
        'A sand scale: wants poured material WEIGHT in its pan. Bodies do not count. The gauge climbs, the pan sags.',
        ['EMPTY', 'POURED'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          makeScale(this.world, list, RX - 12, FY, 7, 24, targetDoor());
          if (st === 1) this.paint(RX - 12, FY - 4, RX - 6, FY - 1, Cell.Sand);
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Buoy', '~', '#38bdf8',
        'A sluice float: rises when enough liquid pools in its basin, bobbing on the fill line.',
        ['DRY', 'FLOODED'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          const set: CellSetter = (x, y, t) => {
            const i = this.world.idx(x, y);
            this.world.types[i] = t;
            const fn = COLOR_FN[t];
            this.world.colors[i] = fn ? fn() : EMPTY_COLOR;
          };
          const { body, zone } = stampBuoyBasin(set, RX - 8, FY, 13, 4);
          makeBuoy(list, RX - 8, FY - 1, zone, 26, targetDoor(), body);
          if (st === 1) this.paint(zone.x0, zone.y0, zone.x1, zone.y1, Cell.Water);
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Charge Latch', 'Z', '#7dd3fc',
        'A coil that latches FOREVER on the first electrified cell in its zone — lightning, charged water, conducting blood.',
        ['IDLE', 'SPARKED'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          makeChargeLatch(this.world, list, RX - 8, FY, targetDoor());
          if (st === 1) {
            this.paint(RX - 9, FY - 3, RX - 7, FY - 1, Cell.Water);
            for (let y = FY - 3; y <= FY - 1; y++) {
              for (let x = RX - 9; x <= RX - 7; x++) this.world.charge[this.world.idx(x, y)] = 3;
            }
          }
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Valve', 'V', '#5eead4',
        'A small material gate in a channel (a sluice is a wide valve). Retracts like a door; timed valves SLAM back shut.',
        ['CLOSED', 'OPEN', 'TIMED (loop)'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          // a channel through a stone block so the gate reads as a gate
          this.paint(RX - 12, FY - 12, RX + 12, FY - 1, Cell.Stone);
          this.paint(RX - 2, FY - 12, RX + 2, FY - 1, Cell.Empty);
          const valve = makeValve(this.stub, list, RX - 2, FY - 7, 5, 2, {
            material: Cell.Metal,
            autoCloseFrames: st === 2 ? 140 : 0,
          });
          if (st === 1) setValveCells(this.stub, valve, true);
          return {
            bounds, cells: true,
            step: (f) => {
              if (st === 2 && valve.state === 0 && f % 360 === 0) setValveCells(this.stub, valve, true);
              this.stepMech();
            },
            draw: (s, f) => this.drawMechs(s, f),
          };
        },
      ),
      this.mechItem(
        'Plug', '%', '#fb923c',
        'Real cells that FIRE a signal once destroyed — by anything. Cracks spread as the body is eaten toward the break point.',
        ['INTACT', 'DAMAGED', 'BROKEN'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          this.paint(RX - 12, FY - 10, RX + 12, FY - 1, Cell.Stone);
          this.paint(RX - 3, FY - 10, RX + 3, FY - 1, Cell.Empty);
          const plug = makePlug(this.world, list, RX - 3, FY - 7, 7, 4, Cell.Wood, targetDoor());
          if (st > 0 && plug.body) {
            // eat a deterministic share of the body: DAMAGED stays under the
            // default breakFrac (cracks + motes), BROKEN crosses it (fires)
            const goal = st === 1 ? Math.floor(plug.body.length * 0.35) : Math.floor(plug.body.length * 0.6);
            let eaten = 0;
            for (let k = 0; k < plug.body.length && eaten < goal; k += 2, eaten++) {
              const [bx, by] = plug.body[k];
              this.world.types[this.world.idx(bx, by)] = Cell.Empty;
            }
            for (let k = 1; k < plug.body.length && eaten < goal; k += 2, eaten++) {
              const [bx, by] = plug.body[k];
              this.world.types[this.world.idx(bx, by)] = Cell.Empty;
            }
          }
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Sensor', '?', '#5eead4',
        'A bounded zone read — heat, liquid, weight, charge, or an exact material. The node ramps amber as the reading climbs.',
        ['IDLE', 'WARMING', 'SATISFIED'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          makeSensor(
            list, RX - 8, FY,
            { sensorType: 'heat', threshold: 6, zone: { x0: RX - 12, y0: FY - 7, x1: RX - 4, y1: FY - 1 } },
            targetDoor(),
          );
          if (st === 1) this.paint(RX - 10, FY - 2, RX - 8, FY - 1, Cell.Fire, 200);
          if (st === 2) this.paint(RX - 11, FY - 3, RX - 6, FY - 1, Cell.Fire, 200);
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Counterweight', 'C', '#caa64a',
        'An iron pan that latches PERMANENTLY once enough mass stays poured. The pan sags; the gauge tips over.',
        ['EMPTY', 'HALF', 'TIPPED'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          makeCounterweight(this.world, list, RX - 12, FY, 7, 24, targetDoor());
          if (st === 1) this.paint(RX - 12, FY - 2, RX - 6, FY - 1, Cell.Sand);
          if (st === 2) this.paint(RX - 12, FY - 4, RX - 6, FY - 1, Cell.Sand);
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Relay', '&', '#a78bfa',
        'One-shot handoff: inputs satisfied, the fuse burns (sparks converge), then it FIRES once and latches forever.',
        ['IDLE', 'FUSE', 'FIRED'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          const door = targetDoor();
          const relay = makeRelay(list, RX - 4, FY, { delayFrames: st === 1 ? 240 : 0 }, door);
          if (st > 0) {
            const lever = makeLever(list, RX - 16, FY, relay);
            lever.state = 1;
          }
          return { bounds, cells: true, step: this.stepMech, draw: (s, f) => this.drawMechs(s, f) };
        },
      ),
      this.mechItem(
        'Rune Vault', 'R', '#86efac',
        'A stone slab keyed to a distant floating glyph: strike the rune with anything and the door dissolves bottom-up.',
        ['SEALED', 'STRUCK'],
        (st) => {
          this.stageFloor(RX - 34, RX + 34);
          const set: CellSetter = (x, y, t) => {
            const i = this.world.idx(x, y);
            this.world.types[i] = t;
            const fn = COLOR_FN[t];
            this.world.colors[i] = fn ? fn() : EMPTY_COLOR;
          };
          // pedestal + slab, the real stamps
          for (let dx = -2; dx <= 2; dx++) set(RX - 18 + dx, FY, Cell.Metal);
          const cells: Array<[number, number]> = [];
          for (let dy = 0; dy < 11; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              set(RX + 8 + dx, FY - 10 + dy, Cell.Stone);
              cells.push([RX + 8 + dx, FY - 10 + dy]);
            }
          }
          this.runtime.runeVaults.push({ rx: RX - 18, ry: FY - 2, door: cells, active: st === 1 });
          return {
            bounds, cells: true, step: this.stepMech,
            draw: (s, f) => {
              this.drawMechs(s, f);
              for (const v of this.runtime.runeVaults) {
                drawRuneGlyphSprite(s, v, f, this.hooks.ctx.params.global.maxBrightness);
              }
            },
          };
        },
      ),
    ];
  }

  private drawMechs(s: PixelSurface, frame: number): void {
    for (const m of this.runtime.mechanisms) drawMechanismSprite(s, m, frame);
  }

  /* ===================== prefab items ===================== */

  private prefabItems(): GalleryItem[] {
    const all: Array<{ p: PrefabDef; src: string }> = [
      ...this.hooks.builtinPrefabs().map((p) => ({ p, src: 'builtin' })),
      ...this.hooks.userPrefabs().map((p) => ({ p, src: 'library' })),
    ];
    return all.map(({ p, src }) => ({
      id: 'prefab-' + p.id,
      section: 'PREFABS' as const,
      name: p.name,
      meta: `${src} · ${p.w}×${p.h} · ${p.objects.length} obj · ${p.links.length} links` +
        (p.tags.length > 0 ? ' · ' + p.tags.map((t) => '#' + t).join(' ') : ''),
      desc:
        'Authored room: real cells, mechanisms idling in place, lights glowing, inhabitants where they will stand. ' +
        'MARKERS overlays anchors (worldgen connection points), object footprints, and link wires.',
      glyph: 'P',
      glyphCss: '#93c5fd',
      states: ['CLEAN', 'MARKERS'],
      thumb: () => prefabThumb(p),
      build: (st) => this.buildPrefabRig(p, st === 1),
    }));
  }

  private buildPrefabRig(p: PrefabDef, markers: boolean): StageRig {
    const PX = 24,
      PY = 20;
    const w = this.world;
    // terrain with factory colors (what the GAME shows, not palette markers)
    const cells = decodePrefabCells(p);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const t = cells[x + y * p.w];
        const i = w.idx(PX + x, PY + y);
        w.types[i] = t;
        const fn = COLOR_FN[t];
        w.colors[i] = t === Cell.Empty ? EMPTY_COLOR : fn ? fn() : EMPTY_COLOR;
      }
    }
    const set: CellSetter = (x, y, t) => {
      if (!w.inBounds(x, y)) return;
      const i = w.idx(x, y);
      w.types[i] = t;
      const fn = COLOR_FN[t];
      w.colors[i] = fn ? fn() : EMPTY_COLOR;
    };
    const sink = makeInstantiationSink();
    instantiateObjects(this.stub, sink, p.objects, p.links, p.lights, PX, PY, set, {
      docSprites: this.hooks.docSprites(),
      spriteCache: this.spriteCache,
    });
    this.runtime.mechanisms.push(...sink.mechanisms);
    this.runtime.runeVaults.push(...sink.runeVaults);
    // the room's inhabitants, calm, where generation would stand them
    const fakes = sink.enemies.map((rec) => this.fakeEnemy(rec.kind, rec.x, rec.y, false));
    const entCtx = this.entityCtx({ x: -500, y: -500 });

    const halos = sink.authoredLights.map((l) => ({
      x: l.x,
      y: l.y,
      r: Math.min(40, l.radius * 0.55),
      css: `rgba(${Math.round(l.r * 255)},${Math.round(l.g * 255)},${Math.round(l.b * 255)},${0.16 * l.intensity})`,
    }));

    const mk: NonNullable<StageRig['markers']> = [];
    if (markers) {
      for (const a of p.anchors ?? []) {
        const dx = a.dir === 'e' ? 1 : a.dir === 'w' ? -1 : 0;
        const dy = a.dir === 's' ? 1 : a.dir === 'n' ? -1 : 0;
        mk.push({ kind: 'tick', x: PX + a.x, y: PY + a.y, dx, dy, css: a.kind === 'sealed' ? '#fb923c' : '#7dd3fc' });
      }
      for (const m of sink.mechanisms) {
        mk.push({ kind: 'box', x0: m.x, y0: m.y, x1: m.x + Math.max(1, m.w) - 1, y1: m.y + Math.max(1, m.h) - 1, css: 'rgba(251,191,36,0.6)' });
      }
      for (const pk of sink.pickups) {
        mk.push({ kind: 'box', x0: Math.floor(pk.x) - 1, y0: Math.floor(pk.y) - 1, x1: Math.floor(pk.x) + 1, y1: Math.floor(pk.y) + 1, css: 'rgba(251,191,36,0.45)' });
      }
    }

    return {
      bounds: { x0: PX - 2, y0: PY - 2, x1: PX + p.w + 1, y1: PY + p.h + 1 },
      cells: true,
      halos,
      markers: mk,
      step: this.stepMech,
      draw: (s, f) => {
        this.drawMechs(s, f);
        for (const v of this.runtime.runeVaults) {
          drawRuneGlyphSprite(s, v, f, this.hooks.ctx.params.global.maxBrightness);
        }
        for (const d of sink.decors) this.safeDraw('decor', () => drawDecor(s, FULLBRIGHT, entCtx, d));
        for (const e of fakes) this.safeDraw('enemy-' + e.kind, () => drawEnemySprite(s, FULLBRIGHT, entCtx, e));
      },
    };
  }

  /* ===================== entity items ===================== */

  private entityCtx(player: unknown): Ctx {
    return {
      player,
      state: this.stubState,
      camera: { renderX: 0, renderY: 0, x: 0, y: 0 },
      enemyCtl: this.hooks.ctx.enemyCtl,
      params: this.hooks.ctx.params,
      world: this.world,
      enemies: [],
    } as unknown as Ctx;
  }

  private fakeEnemy(kind: EnemyKind, x: number, y: number, alerted: boolean): Enemy {
    const def = this.hooks.ctx.enemyCtl.defs[kind] as { hp?: number } | undefined;
    return {
      kind, x, y, vx: 0, vy: 0,
      hp: def?.hp ?? 10, maxHp: def?.hp ?? 10,
      facing: 1, grounded: true, prevG: true, splat: 0, blink: 0,
      bobPhase: (x * 0.37) % (Math.PI * 2), alerted, flash: 0, windup: 0,
      stride: 0, _px: x, _svx: 0, _svy: 0, sleeping: false, dying: 0,
      status: createDefaultStatus(),
    } as unknown as Enemy;
  }

  private safeDraw(tag: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      if (!this.warned.has(tag)) {
        this.warned.add(tag);
        console.warn(`[gallery] preview draw failed for ${tag}:`, err);
      }
    }
  }

  private entityItems(): GalleryItem[] {
    const items: GalleryItem[] = [];
    items.push({
      id: 'ent-player',
      section: 'ENTITIES',
      name: 'The Alchemist',
      meta: 'player · 9×17 · 6 states',
      desc:
        'The procedural wizard: stride-wheel boots, swaying robe, 4-segment spring hat, wand glow toward the aim. ' +
        'He faces your cursor; CAST aims the wand straight at it.',
      glyph: '@',
      glyphCss: '#c084fc',
      states: ['IDLE', 'RUN', 'CAST', 'JUMP', 'HURT', 'PULL'],
      build: (st) => {
        this.stageFloor(RX - 30, RX + 30);
        const fake = createPlayer();
        fake.x = RX;
        fake.y = FY;
        fake.facing = 1;
        const cursor = this.cursorWorld;
        const ctx = this.entityCtx(fake);
        // the sprite asks the spells service for the wand muzzle and the
        // input manager for the bomb charge — give the preview honest stubs
        const x = ctx as unknown as {
          spells: { wandTip: () => { x: number; y: number } };
          input: { bombCharge: number };
        };
        x.spells = {
          wandTip: () => ({
            x: fake.x + Math.cos(fake.aimAngle) * 7,
            y: fake.y - 9 + Math.sin(fake.aimAngle) * 7,
          }),
        };
        x.input = { bombCharge: 0 };
        return {
          bounds: { x0: RX - 24, y0: FY - 24, x1: RX + 24, y1: FY + 4 },
          cells: true,
          step: (f) => {
            // the sprite reads fields the Player controller normally drives;
            // the rig drives just enough of them for each pose
            if (fake.blinkTimer > 0) fake.blinkTimer--;
            else if (Math.random() < 0.006) fake.blinkTimer = 8;
            fake.facing = cursor.x >= fake.x ? 1 : -1;
            fake._svx = 0;
            fake.firing = false;
            fake.grounded = true;
            fake.y = FY;
            if (st === 1) {
              fake._svx = 1.5 * fake.facing;
              fake.stridePhase += 0.24;
            } else if (st === 2) {
              fake.firing = true;
              fake.aimAngle = Math.atan2(cursor.y - (fake.y - 9), cursor.x - fake.x);
            } else if (st === 3) {
              const t = f % 80;
              if (t < 40) {
                fake.grounded = false;
                fake.y = FY - Math.round(14 * Math.sin((Math.PI * t) / 40));
                fake._svy = t < 20 ? -1.6 : 1.6;
              } else fake._svy = 0;
            } else if (st === 4) {
              fake.staggerT = Math.max(0, 16 - (f % 80));
              fake.staggerDir = -fake.facing;
            } else if (st === 5) {
              if (f % 90 === 0) fake.pullT = 26;
              if (fake.pullT > 0) fake.pullT--;
              fake.pullDir = fake.facing;
            }
          },
          draw: (s) => this.safeDraw('player', () => drawPlayerSprite(s, FULLBRIGHT, ctx)),
        };
      },
    });

    // Per-kind ANIMATION STATES beyond CALM/ALERTED: each drives the same
    // entity fields the game AI drives, so the gallery shows the sprite's
    // real procedural poses (hops, pounds, fuses, channels...). `alerted`
    // states gaze at the live cursor.
    type StateDef = {
      label: string;
      alerted?: boolean;
      setup?: (e: Enemy & Record<string, number | boolean>) => void;
      step?: (e: Enemy & Record<string, number | boolean>, f: number) => void;
    };
    const hop: StateDef = {
      label: 'HOP (loop)',
      alerted: true,
      step: (e, f) => {
        const t = f % 110;
        if (t < 20) {
          e.windup = 20 - t;
          e.grounded = true;
          e.vy = 0;
          e.y = FY;
        } else if (t < 50) {
          const p = (t - 20) / 30;
          e.windup = 0;
          e.grounded = false;
          e.vy = -3 + 6 * p;
          e.y = FY - Math.round(16 * Math.sin(Math.PI * p));
        } else {
          e.grounded = true;
          e.vy = 0;
          e.y = FY; // the sprite itself lands the splat (prevG edge)
        }
      },
    };
    const walk = (amp: number, speed: number): StateDef => ({
      label: 'WALK (loop)',
      step: (e, f) => {
        // the sprite computes stride from REAL displacement — so displace it
        e.x = RX + Math.sin(f * speed) * amp;
      },
    });
    const EXTRA: Partial<Record<EnemyKind, StateDef[]>> = {
      slime: [hop],
      acidslime: [hop],
      imp: [
        {
          label: 'SWOOP (loop)',
          alerted: true,
          step: (e, f) => {
            e.x = RX + Math.sin(f * 0.05) * 12;
            e.vx = Math.cos(f * 0.05) * 1.4; // the lean reads from vx
            e.y = FY - 6 + Math.round(Math.sin(f * 0.1) * 3);
            (e as { bobPhase: number }).bobPhase += 0.07;
          },
        },
      ],
      mage: [
        {
          label: 'CHANNEL (loop)',
          alerted: true,
          step: (e, f) => {
            e.blink = Math.max(0, 45 - (f % 100)); // the telekinesis telegraph
          },
        },
      ],
      bat: [
        {
          label: 'SLEEPING',
          setup: (e) => {
            e.sleeping = true;
            e.y = FY - 22;
            this.paint(RX - 8, FY - 27, RX + 8, FY - 25, Cell.Stone); // its ceiling
          },
        },
        {
          label: 'FLARE (loop)',
          alerted: true,
          setup: (e) => {
            e.y = FY - 12;
            e.grounded = false;
          },
          step: (e, f) => {
            e.windup = Math.max(0, 14 - (f % 70));
          },
        },
      ],
      spitter: [
        {
          label: 'SPIT (loop)',
          alerted: true,
          step: (e, f) => {
            const t = f % 90;
            e.attackCd = 90 - t; // the maw glows brighter as the shot charges
            e.recoil = t < 14 ? 14 - t : 0; // ...and recoils right after it
          },
        },
      ],
      bomber: [
        hop,
        {
          label: 'FUSING (loop)',
          alerted: true,
          step: (e, f) => {
            e.fusing = Math.max(1, 100 - (f % 130)); // strobe speeds toward boom
          },
        },
      ],
      golem: [
        walk(12, 0.045),
        {
          label: 'POUND (loop)',
          alerted: true,
          step: (e, f) => {
            e.punching = Math.max(0, 24 - (f % 80)); // wind-up, then the slam
          },
        },
      ],
      colossus: [
        walk(14, 0.03),
        {
          label: 'DOUSED',
          step: (e) => {
            (e as unknown as { status: { wet: number } }).status.wet = 120; // dark basalt + steam
          },
        },
      ],
    };

    for (const kind of ENEMY_KINDS) {
      const extra = EXTRA[kind] ?? [];
      items.push({
        id: 'ent-' + kind,
        section: 'ENTITIES',
        name: kind.charAt(0).toUpperCase() + kind.slice(1),
        meta: `enemy · ${2 + extra.length} states`,
        desc: (ENEMY_DESC[kind] ?? 'A cave dweller.') +
          ' CALM creatures scan the room on a slow wander; ALERTED ones lock their gaze onto YOUR CURSOR over the stage.',
        glyph: 'E',
        glyphCss: '#f87171',
        states: ['CALM', 'ALERTED', ...extra.map((s) => s.label)],
        build: (st) => {
          this.stageFloor(RX - 30, RX + 30);
          const def = this.hooks.ctx.enemyCtl.defs[kind] as { halfW?: number; h?: number } | undefined;
          const sdef = st >= 2 ? extra[st - 2] : null;
          const alerted = st === 1 || sdef?.alerted === true;
          const e = this.fakeEnemy(kind, RX, FY, alerted) as Enemy & Record<string, number | boolean>;
          sdef?.setup?.(e);
          // alerted gaze follows the live cursor (a stable mutated object)
          const ctx = this.entityCtx(alerted ? this.cursorWorld : { x: -500, y: -500 });
          const hw = (def?.halfW ?? 6) + 10,
            hh = (def?.h ?? 12) + 9;
          return {
            bounds: { x0: RX - Math.max(20, hw), y0: FY - Math.max(28, hh), x1: RX + Math.max(20, hw), y1: FY + 4 },
            cells: true,
            step: (f) => sdef?.step?.(e, f),
            draw: (s) => this.safeDraw('enemy-' + kind, () => drawEnemySprite(s, FULLBRIGHT, ctx, e)),
          };
        },
      });
    }
    return items;
  }

  /* ===================== sprite items ===================== */

  private spriteItems(): GalleryItem[] {
    const seen = new Set<string>();
    const assets: SpriteAsset[] = [];
    for (const s of [...(this.hooks.docSprites() ?? []), ...this.hooks.sprites()]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      assets.push(s);
    }
    return assets.map((asset) => {
      const tags = asset.tags.map((t) => t.name);
      return {
        id: 'sprite-' + asset.id,
        section: 'SPRITES' as const,
        name: asset.name,
        meta: `sprite · ${asset.w}×${asset.h} · ${asset.frames.length} frames`,
        desc:
          'Animated decor — visual only, the grid doesn\'t know it\'s there. ' +
          (tags.length > 0 ? 'Loop tags: ' + tags.join(', ') + '.' : 'No tags: plays all frames forward.'),
        glyph: 'S',
        glyphCss: '#5eead4',
        states: tags.length > 0 ? ['ALL', ...tags.map((t) => t.toUpperCase())] : ['ALL'],
        build: (st) => {
          const resolved = resolveRuntimeSprite(asset.id, this.hooks.docSprites(), this.spriteCache);
          if (!resolved) return { bounds: { x0: RX - 20, y0: FY - 20, x1: RX + 20, y1: FY + 4 } };
          const tag = st > 0 ? tags[st - 1] : '';
          const { from, to, dir } = resolveLoopTag(resolved.asset, tag);
          const d: RuntimeDecor = {
            x: RX, y: FY - (asset.h >> 1),
            sprite: resolved.sprite,
            from, to, dir, flipX: false, phase: 0, tickScale: 0,
          };
          const ctx = this.entityCtx({ x: -500, y: -500 });
          return {
            bounds: {
              x0: RX - Math.max(16, asset.w), y0: FY - Math.max(16, asset.h) - 4,
              x1: RX + Math.max(16, asset.w), y1: FY + 4,
            },
            draw: (s) => this.safeDraw('sprite-' + asset.id, () => drawDecor(s, FULLBRIGHT, ctx, d)),
          };
        },
      };
    });
  }
}

/* ===================== helpers ===================== */

function prefabThumb(p: PrefabDef): HTMLCanvasElement {
  const cells = decodePrefabCells(p);
  const src = document.createElement('canvas');
  src.width = p.w;
  src.height = p.h;
  const sg = src.getContext('2d')!;
  const img = sg.createImageData(p.w, p.h);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] === 0 ? paletteColor(0) : CELL_PALETTE[cells[i]];
    const o = i * 4;
    img.data[o] = unpackR(c);
    img.data[o + 1] = unpackG(c);
    img.data[o + 2] = unpackB(c);
    img.data[o + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  const thumb = document.createElement('canvas');
  thumb.width = 44;
  thumb.height = 32;
  const tg = thumb.getContext('2d')!;
  tg.imageSmoothingEnabled = false;
  tg.fillStyle = '#0a0c11';
  tg.fillRect(0, 0, 44, 32);
  const scale = Math.min(44 / p.w, 32 / p.h);
  const dw = Math.max(1, Math.round(p.w * scale));
  const dh = Math.max(1, Math.round(p.h * scale));
  tg.drawImage(src, (44 - dw) / 2, (32 - dh) / 2, dw, dh);
  return thumb;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

