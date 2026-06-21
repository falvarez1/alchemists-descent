import type {
  AudioApi,
  Ctx,
  Enemy,
  EnemyKind,
  ExplosionApi,
  LightningApi,
  Mechanism,
  PhysicsApi,
  Projectile,
  ProjectilesApi,
  RuneVault,
  RuntimeDecor,
  SpellId,
  SpellsApi,
} from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { EventBus } from '@/core/events';
import { escapeHtml } from '@/core/strings';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { bloodColor, COLOR_FN, EMPTY_COLOR, packRGB, stoneColor, unpackB, unpackG, unpackR } from '@/sim/colors';
import { CELL_PALETTE, paletteColor } from '@/sim/cellPalette';
import { SPELL_ORDER } from '@/config/params';
import { VIEW_H, VIEW_W } from '@/config/constants';
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
import {
  drawDigBeam,
  drawLightningArcs,
  drawParticles,
  drawProjectiles,
} from '@/render/sprites/FxSprites';
import { createPlayer, PlayerControl } from '@/entities/Player';
import { createDefaultStatus } from '@/entities/status';
// The combat micro-sim: the REAL casting/projectile/explosion/cell-sim stack
// run against the gallery's scratch world (same precedent as Mechanisms above).
import { Spells } from '@/combat/Spells';
import { Projectiles } from '@/combat/Projectiles';
import { Lightning } from '@/combat/Lightning';
import { Explosions } from '@/sim/explosion';
import { Particles } from '@/particles/Particles';
import { Physics } from '@/entities/physics';
import { Simulation } from '@/sim/Simulation';

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

// Every Gallery preview shares ONE fully-typed no-op audio. Previews run the REAL
// combat/particle/entity code, which fires a wide spread of ctx.audio.* sounds;
// the old per-preview stubs hand-listed only a handful, so any sound they missed
// crashed the preview ("ctx.audio.X is not a function" — e.g. Vitriol Spray's
// liquid splash hitting splash()). Typing this as AudioApi makes tsc enforce
// completeness, so a newly-added sound can never silently reopen that gap.
const GALLERY_NOOP_AUDIO: AudioApi = (() => {
  const s = (): void => undefined;
  return {
    enabled: false,
    ensure: s,
    toggle: () => false,
    tone: s, noiseBurst: s, boom: s, zap: s, lightning: s, hollowKnock: s,
    bubble: s, shatter: s, pickup: s, chest: s, keyJingle: s, portalWhoosh: s,
    learn: s, drinkPotion: s, lever: s, doorGrind: s, brazier: s,
    groan: s, chirp: s, skitter: s, drip: s, dryFire: s, wandSwap: s, sputter: s,
    heartbeat: s, cardPick: s, cardSlot: s, footstep: s, crawlShuffle: s,
    crampedBump: s, landThud: s, splash: s, alert: s, gong: s, coin: s, hurt: s,
    jump: s, squelch: s, flame: s, dig: s, waveHorn: s, levitate: s, implode: s,
  };
})();

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
  /** Live-fire demos (the Alchemist's tactical spells): chip labels... */
  spells?: string[];
  /** ...and the rig factory a spell chip switches the stage to. */
  buildSpell?: (spellIdx: number) => StageRig;
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
  weaver: 'Eight-legged lair guardian. Plants long IK feet, writes vine threads, and stumbles when stripped of growth.',
  colossus: 'The Kiln Colossus. Water is the strategy.',
  leviathan: 'The Sunken Leviathan. Water is its armor — take the water away.',
};

const ENEMY_KINDS: EnemyKind[] = [
  'slime', 'imp', 'golem', 'acidslime', 'wisp', 'mage', 'bat', 'spitter', 'bomber', 'eggs', 'colossus',
  'weaver', 'leviathan',
];

/**
 * Where each tactical-spell demo aims: 'foe' fires at the target dummy,
 * 'fort' at the practice structure — terrain wreckers (meteor, black hole,
 * bomb, dig...) read far better against something they can visibly destroy.
 */
const SPELL_TARGET: Record<SpellId, 'foe' | 'fort'> = {
  bolt: 'foe', scatter: 'foe', bomb: 'fort', lightning: 'foe', flame: 'foe',
  emberstorm: 'foe', vitriol: 'foe', frostshard: 'foe', icelance: 'foe',
  wisp: 'foe', dig: 'fort', conjure: 'fort', warp: 'fort', meteor: 'fort',
  blackhole: 'fort',
};

export class Gallery {
  private root: HTMLDivElement;
  private stage!: HTMLCanvasElement;
  private listEl!: HTMLDivElement;
  private infoEl!: HTMLDivElement;
  private searchEl!: HTMLInputElement;
  private captionEl!: HTMLDivElement;
  private hintEl!: HTMLSpanElement;
  private viewToggleEl!: HTMLButtonElement;

  private items: GalleryItem[] = [];
  private filtered: GalleryItem[] = [];
  private selected = 0;
  private state = 0;
  /** Selected spell-demo chip (-1 = showing a STATE, not a spell). */
  private spellSel = -1;
  private rig: StageRig | null = null;
  private zoom = 0; // 0 = FIT
  private frame = 1;
  private raf = 0;
  private openFlag = false;
  private maximized = false;
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
  // (score backs the gold-coin homing the firing range can trigger)
  private stubState = { mode: 'play', paused: false, frameCount: 1, currentBiome: 'earthen', score: 0 };
  private stub: Ctx;
  private mech: Mechanisms;
  private spriteCache = new Map<string, ResolvedSprite | null>();
  // Reusable offscreen canvas + ImageData for the cells path — created once and
  // resized only when the rig's bounds (bw/bh) change, instead of allocating a
  // fresh canvas/getContext/createImageData every animation frame.
  private cellCanvas: HTMLCanvasElement | null = null;
  private cellCtx: CanvasRenderingContext2D | null = null;
  private cellImage: ImageData | null = null;

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
      audio: GALLERY_NOOP_AUDIO,
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
    // headless-probe handle (the window.__game convention)
    (window as unknown as { __gallery?: Gallery }).__gallery = this;

    this.root = document.createElement('div');
    this.root.id = 'builder-gallery';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="bg-head">
        <span class="bg-title">GALLERY</span>
        <input id="bg-search" type="search" placeholder="search gallery" spellcheck="false">
        <span id="bg-hint" class="bg-hint">/ focus &middot; &uarr;&darr; browse &middot; &larr;&rarr; states &middot; +/&minus; zoom &middot; ESC close</span>
        <div class="bg-actions">
          <button id="bg-view-toggle" type="button" aria-label="Maximize gallery" title="Maximize gallery"></button>
          <button id="bg-close" type="button" aria-label="Close gallery">&times;</button>
        </div>
      </div>
      <div class="bg-body">
        <div id="bg-list" role="listbox" aria-label="Gallery items"></div>
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
    this.hintEl = this.root.querySelector('#bg-hint')!;
    this.viewToggleEl = this.root.querySelector('#bg-view-toggle')!;
    this.viewToggleEl.addEventListener('click', () => this.setMaximized(!this.maximized));
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
    this.setMaximized(false);
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

  /**
   * Tear down the document-level listener the constructor installs (capture
   * phase, so it must be removed with the same flag) and drop the loop + DOM.
   * The gallery is normally a long-lived singleton, but without this the
   * capture-phase keydown handler would leak if the host is ever rebuilt.
   */
  dispose(): void {
    this.close();
    document.removeEventListener('keydown', this.onKey, true);
    delete (window as unknown as { __gallery?: Gallery }).__gallery;
    this.root.remove();
  }

  private setMaximized(maximized: boolean): void {
    this.maximized = maximized;
    this.root.classList.toggle('maximized', maximized);
    this.viewToggleEl.classList.toggle('restore-icon', maximized);
    this.viewToggleEl.title = maximized ? 'Restore gallery' : 'Maximize gallery';
    this.viewToggleEl.setAttribute('aria-label', this.viewToggleEl.title);
    this.viewToggleEl.setAttribute('aria-pressed', String(maximized));
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
      const d = e.key === 'ArrowRight' ? 1 : -1;
      if (it && this.spellSel >= 0 && it.spells) {
        // browsing the spell demos: arrows walk the spell list instead
        this.setSpell((this.spellSel + d + it.spells.length) % it.spells.length);
      } else if (it && it.states.length > 1) {
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
    this.spellSel = -1;
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
    this.spellSel = -1;
    this.rebuild();
    this.renderInfo();
  }

  private setSpell(n: number): void {
    this.spellSel = n;
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
    // full-world sim window by default; the spell rig narrows it to its stage
    this.world.simBounds.x0 = 0;
    this.world.simBounds.y0 = 0;
    this.world.simBounds.x1 = this.world.width;
    this.world.simBounds.y1 = this.world.height;
    this.rig =
      this.spellSel >= 0 && it.buildSpell ? it.buildSpell(this.spellSel) : it.build(this.state);
  }

  /* ===================== rendering ===================== */

  private loop = (): void => {
    if (!this.openFlag) return;
    // Tab hidden: the live micro-sim is purely cosmetic, so skip the
    // step+redraw work entirely (no advancing the world for invisible frames),
    // but keep rescheduling so the gallery resumes cleanly when shown again.
    if (document.hidden) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
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
        // Reuse the offscreen canvas/context/ImageData across frames; only
        // (re)allocate when the rig's pixel bounds change. The buffer must be
        // re-zeroed each frame so cells that turned Empty (or out-of-bounds
        // padding) read transparent exactly as a fresh createImageData would.
        if (!this.cellCanvas || !this.cellCtx) {
          this.cellCanvas = document.createElement('canvas');
          this.cellCtx = this.cellCanvas.getContext('2d')!;
        }
        if (this.cellCanvas.width !== bw || this.cellCanvas.height !== bh || !this.cellImage) {
          this.cellCanvas.width = bw;
          this.cellCanvas.height = bh;
          this.cellImage = this.cellCtx.createImageData(bw, bh);
        }
        const img = this.cellImage;
        img.data.fill(0);
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
        this.cellCtx.putImageData(img, 0, 0);
        g.drawImage(this.cellCanvas, ox, oy, bw * z, bh * z);
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

    // caption strip: state/spell name, overridden by live toasts from the rig
    if (this.captionT > 0) this.captionT--;
    const it = this.filtered[this.selected];
    const sub =
      it && this.spellSel >= 0 && it.spells
        ? ' — ' + it.spells[this.spellSel]
        : it && it.states.length > 1
          ? ' — ' + it.states[this.state]
          : '';
    const base = it ? `${it.name}${sub}` : '';
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
      const isSel = n === this.selected;
      row.className = 'bg-item' + (isSel ? ' sel' : '');
      row.dataset.n = String(n);
      row.setAttribute('role', 'option');
      row.tabIndex = -1;
      row.setAttribute('aria-selected', String(isSel));
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
      this.listEl.innerHTML = '<div class="bg-empty">No matching items</div>';
    }
  }

  /**
   * The keyboard-hint bar only advertises &larr;&rarr; when arrows actually do
   * something for the selected item — it walks multiple STATES, or steps the
   * TACTICAL SPELLS demos. Single-state items (no spells) drop the segment.
   */
  private renderHint(it: GalleryItem | undefined): void {
    const hasArrows = !!it && (it.states.length > 1 || !!it.spells);
    const arrows = hasArrows ? '&larr;&rarr; ' + (it && it.spells ? 'states/spells' : 'states') + ' &middot; ' : '';
    this.hintEl.innerHTML =
      '/ focus &middot; &uarr;&darr; browse &middot; ' + arrows + '+/&minus; zoom &middot; ESC close';
  }

  private renderInfo(): void {
    const it = this.filtered[this.selected];
    this.renderHint(it);
    if (!it) {
      this.infoEl.innerHTML = '';
      return;
    }
    const chips = it.states
      .map(
        (s, n) =>
          `<button class="bg-chip${n === this.state && this.spellSel < 0 ? ' on' : ''}" data-s="${n}" aria-pressed="${n === this.state && this.spellSel < 0}">${escapeHtml(s)}</button>`,
      )
      .join('');
    const spellChips = (it.spells ?? [])
      .map(
        (s, n) =>
          `<button class="bg-chip${n === this.spellSel ? ' on' : ''}" data-sp="${n}" aria-pressed="${n === this.spellSel}">${escapeHtml(s)}</button>`,
      )
      .join('');
    this.infoEl.innerHTML =
      `<div class="bg-iname">${escapeHtml(it.name)}</div>` +
      `<div class="bg-imeta">${escapeHtml(it.meta)}</div>` +
      `<div class="bg-idesc">${escapeHtml(it.desc)}</div>` +
      (it.states.length > 1 ? `<div class="bg-ihead">STATES</div><div class="bg-chips">${chips}</div>` : '') +
      (it.spells
        ? `<div class="bg-ihead">TACTICAL SPELLS</div><div class="bg-chips bg-spellchips">${spellChips}</div>`
        : '');
    for (const b of this.infoEl.querySelectorAll<HTMLButtonElement>('.bg-chip[data-s]')) {
      b.addEventListener('click', () => this.setState(Number(b.dataset.s)));
    }
    for (const b of this.infoEl.querySelectorAll<HTMLButtonElement>('.bg-chip[data-sp]')) {
      b.addEventListener('click', () => this.setSpell(Number(b.dataset.sp)));
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
            this.world, list, RX - 8, FY,
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
      spriteLookup: (id) => this.hooks.sprites().find((sprite) => sprite.id === id) ?? null,
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
    const PLAYER_STATES = [
      'IDLE', 'RUN', 'CAST', 'JUMP', 'HURT', 'PULL', 'CROUCH', 'CRAWL (loop)',
      'CRAWL · CRAMPED', 'WALL GRAB', 'CLIMB CATCH', 'CLIMB UP', 'CLIMB DOWN',
      'CLIMB HOLD', 'WALL JUMP', 'DIVE', 'SKID (loop)', 'STATUS TELLS (loop)',
    ];
    const SPELL_LABELS = SPELL_ORDER.map((id) =>
      this.hooks.ctx.params.spells[id].name.toUpperCase(),
    );
    // ...plus the kick, which isn't a spell but is the player's other "cast":
    // a force-push blast of air. Appended after the spells; see buildKickRig.
    const PLAYER_RIGS = [...SPELL_LABELS, 'FORCE PUSH (F)'];
    items.push({
      id: 'ent-player',
      section: 'ENTITIES',
      name: 'The Alchemist',
      meta: `player · 9×17 · ${PLAYER_STATES.length} states`,
      desc:
        'The procedural wizard: stride-wheel boots, swaying robe, 4-segment spring hat, wand glow toward the aim. ' +
        'He faces your cursor; CAST aims the wand straight at it. ' +
        'TACTICAL SPELLS put him on a firing range — live casts against a target dummy or the practice fort, real cells and all. ' +
        'FORCE PUSH (F) fires the real kick: a blast of air that bursts a patch of ash into flying motes (in play it blows enemies back, smashes small foes into walls, scatters critters, and bends vines).',
      glyph: '@',
      glyphCss: '#c084fc',
      states: PLAYER_STATES,
      spells: PLAYER_RIGS,
      buildSpell: (n) => (n < SPELL_ORDER.length ? this.buildSpellRig(SPELL_ORDER[n]) : this.buildKickRig()),
      build: (st) => {
        this.stageFloor(RX - 30, RX + 30);
        // the poses that live against rock bring their rock along
        if (st === 8) this.paint(RX - 22, FY - 13, RX + 22, FY - 11, Cell.Stone); // crawl-gauge ceiling
        if (st >= 9 && st <= 14) this.paint(RX + 5, FY - 30, RX + 14, FY + 3, Cell.Stone); // the climbing face
        const fake = createPlayer();
        fake.x = RX;
        fake.y = FY;
        fake.facing = 1;
        const cursor = this.cursorWorld;
        const ctx = this.entityCtx(fake);
        // the sprite asks the spells service for the wand muzzle, the input
        // manager for the bomb charge, and physics for crawl headroom — the
        // muzzle comes from the REAL Spells service (it reads only player
        // fields), the rest are honest stubs
        const x = ctx as unknown as {
          spells: Spells;
          input: { bombCharge: number };
          physics: { entityFree: () => boolean; cellBlocks: () => boolean };
        };
        x.spells = new Spells(ctx);
        x.input = { bombCharge: 0 };
        const cramped = st === 8;
        x.physics = { entityFree: () => !cramped, cellBlocks: () => false };
        const TELLS = ['WET', 'OILED', 'FROZEN', 'STONESKIN', 'SWIFT', 'TORCHBEARER'] as const;
        return {
          bounds: { x0: RX - 24, y0: FY - 28, x1: RX + 24, y1: FY + 4 },
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
            if (st === 0) {
              // idle fidget: every few seconds he reaches up to straighten the hat
              fake.fidgetT = f % 170;
            } else if (st === 1) {
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
            } else if (st === 6) {
              // crouch & peek: planted boots, folded robe, eyes down the ledge
              fake.crouchT = Math.min(10, fake.crouchT + 1);
            } else if (st === 7 || st === 8) {
              // prone low crawl (CRAWL.md) — CRAMPED presses even the head flat
              fake.crawling = true;
              fake.crawlT = Math.min(10, fake.crawlT + 1);
              fake.crawlSlope = 0;
              fake.stridePhase += 0.16;
              fake.aimAngle = fake.facing === 1 ? 0 : Math.PI;
            } else if (st === 9) {
              // bouldering lock-off on the painted face (pose gate: grounded,
              // still, hands free)
              fake.facing = 1;
              fake.wallGrabDir = 1;
              fake.wallGrabT = 10;
            } else if (st === 10) {
              // first-class climb catch: one hand slaps the wall, feet swing in
              fake.grounded = false;
              fake.facing = -1;
              fake.climbing = true;
              fake.climbDir = 1;
              fake.climbT = Math.min(10, fake.climbT + 2);
              fake.climbIntentY = 0;
              fake.climbPhase = f % 12;
              fake.wallGrabDir = 1;
              fake.wallGrabT = 10;
            } else if (st === 11 || st === 12 || st === 13) {
              // slow bouldering cycle: up/down/hold share the same key poses
              fake.grounded = false;
              fake.facing = -1;
              fake.climbing = true;
              fake.climbDir = 1;
              fake.climbT = 10;
              fake.climbIntentY = st === 11 ? -1 : st === 12 ? 1 : 0;
              fake.climbMoveT = f % (fake.climbIntentY < 0 ? 5 : 4);
              fake.climbPhase = Math.floor(f / (fake.climbIntentY === 0 ? 12 : 5)) % 24;
              fake.wallGrabDir = 1;
              fake.wallGrabT = 10;
            } else if (st === 14) {
              // wall jump: brace, kick away, then show the airborne escape arc
              const t = f % 80;
              fake.facing = -1;
              if (t < 26) {
                fake.grounded = false;
                fake.climbing = true;
                fake.climbDir = 1;
                fake.climbT = 10;
                fake.climbIntentY = 0;
                fake.climbPhase = t;
                fake.wallGrabDir = 1;
                fake.wallGrabT = 10;
              } else {
                fake.climbing = false;
                fake.wallGrabT = 0;
                fake.grounded = false;
                fake.facing = -1;
                fake._svx = -1.8;
                const p = (t - 26) / 54;
                fake.y = FY - Math.round(20 * Math.sin(Math.PI * Math.min(1, p)));
                fake._svy = p < 0.5 ? -1.8 : 1.6;
              }
            } else if (st === 15) {
              // dive slam: a falling spear, then the landing squash
              const t = f % 90;
              if (t < 64) {
                fake.grounded = false;
                fake.diveT = 10;
                fake._svy = 2.4;
                fake.y = FY - 26 + Math.round((t / 64) * 24);
              } else {
                fake.diveT = 0;
                if (t === 64) fake.landTimer = 9;
                if (fake.landTimer > 0) fake.landTimer--;
              }
            } else if (st === 16) {
              // sprint, then heels down: the skid throws the torso back
              const t = f % 84;
              if (t < 26) {
                fake._svx = 2.0 * fake.facing;
                fake.stridePhase += 0.26;
                fake.skidT = 0;
              } else if (t < 44) {
                fake.skidT = 44 - t;
                fake.skidDir = fake.facing;
                fake._svx = ((44 - t) / 18) * fake.facing;
              } else {
                fake.skidT = 0;
              }
            } else if (st === 17) {
              // status skins, one at a time: the readable tells layered on the pose
              const seg = Math.floor(f / 70) % TELLS.length;
              const stt = fake.status;
              stt.wet = stt.oiled = stt.frozen = stt.stoneskin = stt.swift = stt.torch = 0;
              if (seg === 0) stt.wet = 70;
              else if (seg === 1) stt.oiled = 70;
              else if (seg === 2) stt.frozen = 70;
              else if (seg === 3) stt.stoneskin = 70;
              else if (seg === 4) {
                stt.swift = 70; // the speed trail needs real velocity
                fake._svx = 1.6 * fake.facing;
                fake.stridePhase += 0.22;
              } else stt.torch = 70;
              this.caption = 'TELL — ' + TELLS[seg];
              this.captionT = 2;
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
      weaver: [
        walk(16, 0.034),
        {
          label: 'SLEEPING',
          setup: (e) => {
            e.sleeping = true;
            e.alerted = false;
            e.weaverSupport = 1;
            this.paint(RX - 22, FY - 34, RX + 22, FY - 32, Cell.Stone);
            for (let x = RX - 18; x <= RX + 18; x += 9) this.paint(x, FY - 31, x, FY - 6, Cell.Vines);
          },
        },
        {
          label: 'NEEDLE STEP',
          alerted: true,
          setup: (e) => {
            e.weaverSupport = 1;
          },
          step: (e, f) => {
            e.windup = Math.max(1, 18 - (f % 54));
            e.needleX = RX + 19;
            e.needleY = FY - 11;
          },
        },
        {
          label: 'THREAD SPIT',
          alerted: true,
          setup: (e) => {
            e.weaverSupport = 1;
          },
          step: (e, f) => {
            e.blink = Math.max(1, 18 - (f % 60));
            e.webPulse = Math.max(0, 18 - (f % 60));
          },
        },
        {
          label: 'FOOTING LOST',
          alerted: true,
          setup: (e) => {
            e.weaverSupport = 0;
            e.cranky = 160;
            e.webPulse = 18;
            this.paint(RX - 24, FY - 1, RX + 24, FY - 1, Cell.Empty);
            this.paint(RX - 28, FY - 3, RX - 20, FY - 1, Cell.Vines);
            this.paint(RX + 20, FY - 3, RX + 28, FY - 1, Cell.Vines);
          },
          step: (e, f) => {
            e.recoil = f % 34 < 12 ? 12 - (f % 12) : 0;
            e.webPulse = Math.max(0, 18 - (f % 34));
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

  /* ===================== the firing range (tactical spells) ===================== */

  /**
   * A live-fire diorama: the Alchemist on the left, a target dummy mid-field
   * (foe spells) or a stone-and-timber practice fort (terrain wreckers), a
   * thick backstop, and the REAL combat stack — Spells casts from the wand
   * tip, Projectiles flies and detonates, Explosions carves the scratch
   * world, Particles ride the wind, and the cell sim makes the wreckage
   * burn, flow, and settle. Terrain repaints at the top of every cast cycle
   * so each shot lands on a fresh stage.
   */
  private buildSpellRig(spell: SpellId): StageRig {
    const cinematic = spell === 'meteor' || spell === 'blackhole';
    const PXC = RX - (cinematic ? 76 : 52); // the caster's mark
    const FCX = RX + (cinematic ? 82 : 58), FCY = FY - 12; // practice-fort center
    const bounds = {
      x0: PXC - (cinematic ? 20 : 18),
      y0: FY - (cinematic ? 62 : 50),
      x1: FCX + (cinematic ? 32 : 28),
      y1: FY + 6,
    };
    const fortTarget = SPELL_TARGET[spell] === 'fort';

    const paintStage = (): void => {
      this.paint(bounds.x0, bounds.y0, bounds.x1, bounds.y1, Cell.Empty);
      this.paint(bounds.x0, FY + 1, bounds.x1, FY + 5, Cell.Stone); // floor
      this.paint(FCX + 24, FY - 44, FCX + 29, FY, Cell.Stone); // backstop
      // containment wall behind the caster: a bounced bomb stays on the range
      this.paint(bounds.x0, FY - 44, bounds.x0 + 3, FY, Cell.Stone);
      // the practice fort: stone shell, timber interior, a gold seam to loot loose
      this.paint(FCX - 7, FY - 26, FCX + 7, FY, Cell.Stone);
      this.paint(FCX - 5, FY - 24, FCX + 5, FY - 2, Cell.Wood);
      this.paint(FCX - 1, FY - 16, FCX + 1, FY - 12, Cell.Gold);
    };
    paintStage();

    // sim window = this stage (the cell sim only breathes inside it)
    const sb = this.world.simBounds;
    sb.x0 = Math.max(0, bounds.x0 - 2);
    sb.y0 = Math.max(0, bounds.y0 - 2);
    sb.x1 = Math.min(this.world.width, bounds.x1 + 3);
    sb.y1 = Math.min(this.world.height, FY + 8);

    const fake = createPlayer();
    fake.x = PXC;
    fake.y = FY;
    fake.facing = 1;
    fake.spell = spell;
    fake.mana = fake.maxMana = 9999;

    const enemies: Enemy[] = [];
    const dummyHome = { x: RX + 24, y: FY };
    const dummy = fortTarget ? null : this.fakeEnemy('golem', dummyHome.x, dummyHome.y, true);
    if (dummy) enemies.push(dummy);
    let downT = 0; // frames until the felled dummy respawns

    // where this spell aims (conjure wants open air; dig chews the fort's base)
    const aim =
      spell === 'conjure'
        ? { x: RX + 12, y: FY - 14 }
        : spell === 'dig'
          ? { x: FCX, y: FY - 6 }
          : fortTarget
            ? { x: FCX, y: FCY }
            : { x: dummyHome.x, y: FY - 6 };

    const noop = (): void => undefined;
    const particles = new Particles();
    const projectiles: Projectile[] = [];
    const demoParams = {
      ...this.hooks.ctx.params,
      global: { ...this.hooks.ctx.params.global, simSpeed: 1.0 },
    };
    const input = {
      keys: {}, mouse: aim, isDrawing: false, lastX: null, lastY: null,
      buildSpellHeld: false, bombCharge: -1,
      activeChargingBlackHole: null as Projectile | null,
      siphonHeld: false, pourHeld: false, drinkHeld: false,
    };
    const ctx = {
      world: this.world,
      events: this.events,
      enemies,
      player: fake,
      playerCtl: { damage: noop, kill: noop, respawn: noop },
      enemyCtl: {
        defs: this.hooks.ctx.enemyCtl.defs,
        spawn: noop,
        damage: (e: Enemy, dmg: number) => {
          e.hp -= dmg;
          e.flash = 8;
          if (e.hp <= 0 && downT === 0) {
            // the dummy goes down the Noita way, then walks back on
            particles.burst(e.x, e.y - 6, 26, Cell.Blood, bloodColor, 3.2);
            particles.burst(e.x, e.y - 6, 10, null, () => packRGB(255, 120, 150), 2.4, {
              glow: 2.0, grav: -0.01,
            });
            downT = 110;
            e.x = -900;
            e.y = -900;
            this.caption = 'TARGET DOWN';
            this.captionT = 80;
          }
        },
      },
      // explosion feel scales with distance from the camera heart — center it here
      camera: {
        x: RX - Math.floor(VIEW_W / 2), y: FY - Math.floor(VIEW_H / 2),
        renderX: 0, renderY: 0,
      },
      state: this.stubState,
      params: demoParams,
      audio: GALLERY_NOOP_AUDIO,
      particles,
      projectiles,
      shockwaves: [],
      input,
      fx: { screenShake: 0, bloomKick: 0, digBeam: null, hitstop: 0 },
      rigidBodies: {
        bodies: [],
        spawn: () => {
          throw new Error('Gallery previews do not spawn rigid bodies');
        },
        remove: noop,
        clear: noop,
        update: noop,
        applyImpulse: noop,
        applyImpulseAt: noop,
        applyMomentumAt: noop,
        applyRadialImpulse: noop,
        hitTest: () => null,
        dragTo: noop,
        grab: noop,
        release: noop,
        igniteArea: () => 0,
      },
      levels: { current: this.runtime },
    } as unknown as Ctx;
    // the real combat stack, wired to the scratch ctx (constructor-injected)
    (ctx as { spells: SpellsApi }).spells = new Spells(ctx);
    (ctx as { lightning: LightningApi }).lightning = new Lightning(ctx);
    (ctx as { explosions: ExplosionApi }).explosions = new Explosions(ctx);
    (ctx as { physics: PhysicsApi }).physics = new Physics(ctx);
    (ctx as { projectileCtl: ProjectilesApi }).projectileCtl = new Projectiles();
    const sim = new Simulation();

    // cast cadence: one-shots on a cycle; streams hold the trigger; bomb
    // charges then releases; the black hole charges, detaches, and collapses
    const mode =
      spell === 'flame' || spell === 'vitriol' || spell === 'dig'
        ? 'held'
        : spell === 'bomb' || spell === 'blackhole'
          ? spell
          : 'single';
    const cycle =
      spell === 'blackhole' ? 460 : spell === 'meteor' ? 300 : mode === 'bomb' ? 250 : mode === 'held' ? 170 : 120;
    let startF = -1;
    let bombReleased = false;
    let bombDetonated = false;

    return {
      bounds,
      cells: true,
      step: (f) => {
        if (startF < 0) startF = f;
        const t = (f - startF) % cycle;
        if (t === 0) {
          // fresh stage for every cast: repaint terrain, walk the caster home
          paintStage();
          fake.x = PXC;
          fake.y = FY;
          fake.vx = fake.vy = 0;
          fake.cooldown = 0;
          fake.firing = false;
          input.bombCharge = -1;
          bombReleased = false;
          bombDetonated = false;
          projectiles.length = 0;
          particles.clear();
          ctx.shockwaves.length = 0;
          ctx.fx.digBeam = null;
          if (input.activeChargingBlackHole) {
            input.activeChargingBlackHole.charging = false;
            input.activeChargingBlackHole = null;
          }
        }
        fake.mana = 9999;
        if (fake.cooldown > 0) fake.cooldown--;
        if (fake.blinkTimer > 0) fake.blinkTimer--;
        else if (Math.random() < 0.006) fake.blinkTimer = 8;
        if (fake.invuln > 0) fake.invuln--; // warp grants mercy frames; let them tick
        if (fake.recoilT > 0) fake.recoilT--;
        if (fake.swapT > 0) fake.swapT--;
        fake.grounded = true;
        fake._svx = 0;
        fake._svy = 0;
        fake.aimAngle = Math.atan2(aim.y - (fake.y - 9), aim.x - fake.x);
        fake.facing = aim.x >= fake.x ? 1 : -1;

        const inBurst =
          mode === 'held' ? t >= 12 && t < 96
          : mode === 'bomb' ? t >= 12 && t < 64
          : mode === 'blackhole' ? t >= 12 && t < 42
          : t >= 10 && t < 34;
        fake.firing = inBurst;
        if (mode === 'single') {
          if (t === 12) {
            fake.cooldown = 0;
            ctx.spells.firePlayerSpell();
            fake.recoilT = 6;
          }
        } else if (mode === 'held') {
          if (inBurst) {
            fake.cooldown = 0;
            ctx.spells.firePlayerSpell();
          }
        } else if (mode === 'bomb') {
          if (inBurst) {
            // Gallery-specific choreography: show the same charge meter the
            // sprite uses, then throw on a deterministic beat.
            input.bombCharge = Math.min(1, Math.max(0, (t - 12) / 52));
          }
          if (!bombReleased && t >= 64) {
            const sp = ctx.params.spells.bomb;
            const tip = ctx.spells.wandTip();
            const a = fake.aimAngle;
            const charge = Math.max(0.65, input.bombCharge);
            const power = sp.velocityForce! * (0.35 + charge * 1.25);
            projectiles.push({
              x: tip.x, y: tip.y,
              vx: Math.cos(a) * power, vy: Math.sin(a) * power - 0.6,
              type: 'bomb', life: 70, age: 0,
              charging: false, hostile: false,
            });
            input.bombCharge = -1;
            fake.recoilT = 6;
            bombReleased = true;
          }
          if (!bombDetonated && t >= 118) {
            // The preview needs the payoff inside one gallery cycle; the
            // damage itself is still the real explosion implementation.
            ctx.explosions.trigger(FCX, FCY, Math.floor(ctx.params.spells.bomb.explosionRadius!));
            projectiles.length = 0;
            bombDetonated = true;
            this.caption = 'BOOM — CAST BOMB';
            this.captionT = 50;
          }
        } else {
          // blackhole: open the well, hold the channel, then let go
          if (t === 12) {
            fake.cooldown = 0;
            ctx.spells.firePlayerSpell();
          }
          if (t === 42 && input.activeChargingBlackHole) {
            input.activeChargingBlackHole.charging = false;
            input.activeChargingBlackHole = null;
          }
        }

        // the real frame order in miniature: cells+projectiles+shockwaves,
        // then ballistic particles, then arc decay, then the beam's tail
        sim.update(ctx);
        particles.update(ctx);
        ctx.lightning.update();
        if (ctx.fx.digBeam && --ctx.fx.digBeam.life <= 0) ctx.fx.digBeam = null;

        if (dummy) {
          if (dummy.flash > 0) dummy.flash--;
          if (downT > 0 && --downT === 0) {
            dummy.hp = dummy.maxHp;
            dummy.x = dummyHome.x;
            dummy.y = dummyHome.y;
            dummy.flash = 10;
            particles.burst(dummy.x, dummy.y - 6, 12, null, () => packRGB(160, 220, 255), 2.0, {
              glow: 1.8, grav: -0.01,
            });
          }
        }
      },
      draw: (s, f) => {
        void f;
        drawParticles(s, FULLBRIGHT, ctx);
        drawLightningArcs(s, ctx);
        drawProjectiles(s, ctx);
        if (dummy && downT === 0) {
          this.safeDraw('enemy-golem', () => drawEnemySprite(s, FULLBRIGHT, ctx, dummy));
        }
        drawDigBeam(s, ctx);
        this.safeDraw('player', () => drawPlayerSprite(s, FULLBRIGHT, ctx));
      },
    };
  }

  /**
   * FORCE PUSH (F): the kick is a blast of air. This rig fires the REAL
   * `PlayerControl.kick` on a cycle against a patch of ash, so you watch the gust
   * burst it into flying motes and the dust arc whoosh out — the same code the
   * game runs. In play the same gust blows enemies back (small foes smash into
   * walls), scatters critters, and bends vines; here the stage shows the gust.
   */
  private buildKickRig(): StageRig {
    const PXC = RX - 14;
    const bounds = { x0: PXC - 18, y0: FY - 46, x1: RX + 42, y1: FY + 6 };
    const ashX0 = RX, ashX1 = RX + 16, ashY0 = FY - 7, ashY1 = FY - 1;

    const paintStage = (): void => {
      this.paint(bounds.x0, bounds.y0, bounds.x1, bounds.y1, Cell.Empty);
      this.paint(bounds.x0, FY + 1, bounds.x1, FY + 8, Cell.Stone); // floor
      this.paint(bounds.x1 - 4, FY - 40, bounds.x1, FY, Cell.Stone); // backstop the motes slam into
      this.paint(bounds.x0, FY - 40, bounds.x0 + 3, FY, Cell.Stone); // containment behind the wizard
      this.paint(ashX0, ashY0, ashX1, ashY1, Cell.Ash); // the patch the gust blows into motes
    };

    const sb = this.world.simBounds;
    sb.x0 = Math.max(0, bounds.x0 - 2);
    sb.y0 = Math.max(0, bounds.y0 - 2);
    sb.x1 = Math.min(this.world.width, bounds.x1 + 3);
    sb.y1 = Math.min(this.world.height, FY + 8);

    const fake = createPlayer();
    fake.x = PXC;
    fake.y = FY;
    fake.facing = 1;
    fake.aimAngle = 0;

    const noop = (): void => undefined;
    const particles = new Particles();
    const projectiles: Projectile[] = [];
    const input = {
      keys: {}, mouse: { x: RX + 20, y: FY - 6 }, isDrawing: false, lastX: null, lastY: null,
      buildSpellHeld: false, bombCharge: -1, activeChargingBlackHole: null as Projectile | null,
      siphonHeld: false, pourHeld: false, drinkHeld: false,
    };
    const ctx = {
      world: this.world,
      events: this.events,
      enemies: [] as Enemy[],
      player: fake,
      playerCtl: { damage: noop, kill: noop, respawn: noop },
      enemyCtl: { defs: this.hooks.ctx.enemyCtl.defs, spawn: noop, damage: noop, kill: noop, gustShove: noop, update: noop },
      camera: { x: RX - Math.floor(VIEW_W / 2), y: FY - Math.floor(VIEW_H / 2), renderX: 0, renderY: 0 },
      state: this.stubState,
      params: this.hooks.ctx.params,
      audio: GALLERY_NOOP_AUDIO,
      particles,
      projectiles,
      shockwaves: [],
      input,
      fx: { screenShake: 0, bloomKick: 0, digBeam: null, hitstop: 0 },
      rigidBodies: {
        bodies: [], spawn: () => { throw new Error('Gallery previews do not spawn rigid bodies'); },
        remove: noop, clear: noop, update: noop, applyImpulse: noop, applyImpulseAt: noop,
        applyMomentumAt: noop, applyRadialImpulse: noop, hitTest: () => null, dragTo: noop, grab: noop, release: noop, igniteArea: () => 0,
      },
      levels: { current: this.runtime },
    } as unknown as Ctx;
    // the real combat stack the sim leans on (so cells settle correctly), plus the
    // REAL player controller — kick() is the actual game implementation.
    (ctx as { spells: SpellsApi }).spells = new Spells(ctx);
    (ctx as { lightning: LightningApi }).lightning = new Lightning(ctx);
    (ctx as { explosions: ExplosionApi }).explosions = new Explosions(ctx);
    (ctx as { physics: PhysicsApi }).physics = new Physics(ctx);
    (ctx as { projectileCtl: ProjectilesApi }).projectileCtl = new Projectiles();
    const playerCtl = new PlayerControl(ctx);
    const sim = new Simulation();

    paintStage();
    const cycle = 150;
    let startF = -1;
    return {
      bounds,
      cells: true,
      step: (f) => {
        if (startF < 0) startF = f;
        const t = (f - startF) % cycle;
        if (t === 0) {
          paintStage();
          particles.clear();
          fake.x = PXC; fake.y = FY; fake.vx = fake.vy = 0; fake.facing = 1; fake.aimAngle = 0;
        }
        if (fake.blinkTimer > 0) fake.blinkTimer--;
        else if (Math.random() < 0.006) fake.blinkTimer = 8;
        fake.grounded = true; fake.firing = false; fake._svx = 0; fake._svy = 0;
        fake.aimAngle = 0; fake.facing = 1;
        if (t === 40) {
          (playerCtl as unknown as { kickCooldownT: number }).kickCooldownT = 0;
          playerCtl.kick(ctx);
          this.caption = 'FORCE PUSH (F) — a blast of air';
          this.captionT = 70;
        }
        sim.update(ctx);
        particles.update(ctx);
      },
      draw: (s) => {
        drawParticles(s, FULLBRIGHT, ctx);
        this.safeDraw('player', () => drawPlayerSprite(s, FULLBRIGHT, ctx));
      },
    };
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

