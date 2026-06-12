import type { Ctx } from '@/core/types';
import { MINIMAP_W, MINIMAP_H } from '@/config/constants';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';

/** Fog color for unexplored map cells (#0a0a10). */
const UNEXPLORED = packRGB(10, 10, 16);
/** Explored open air — lifted above the fog so visited caverns read on the map. */
const EXPLORED_AIR = packRGB(22, 22, 30);

/** Redraw cadence while the overlay is open (frames). */
const REDRAW_INTERVAL = 8;

/** Non-null getElementById — the minimap elements exist statically in index.html. */
function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

// ===================== Minimap =====================
/**
 * The material-colored descent map (M, play mode): a 1:8 downsample of the
 * current level's live World, masked by the explored fog-of-war. Cartography
 * samples World.types directly, so your lava spill IS the map.
 *
 * The lead calls update(ctx) every frame; terrain is resampled every
 * REDRAW_INTERVAL frames while the overlay is open. Colors come from a
 * palette generated once at construction (one COLOR_FN sample per material)
 * so the map does not shimmer between redraws.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly c2d: CanvasRenderingContext2D;
  private readonly img: ImageData;
  /** Always-on corner panel (play mode), refreshed on a slower cadence. */
  private readonly corner: CanvasRenderingContext2D;
  private readonly cornerEl: HTMLCanvasElement;
  /** One representative packed 0xRRGGBB per cell type, frozen at construction. */
  private readonly palette: Uint32Array;
  private visible = false;

  constructor(private ctx: Ctx) {
    this.canvas = el('minimap-canvas') as HTMLCanvasElement;
    this.canvas.width = MINIMAP_W;
    this.canvas.height = MINIMAP_H;
    this.c2d = this.canvas.getContext('2d')!;
    this.img = this.c2d.createImageData(MINIMAP_W, MINIMAP_H);
    this.cornerEl = el('minimap-corner') as HTMLCanvasElement;
    this.corner = this.cornerEl.getContext('2d')!;

    this.palette = new Uint32Array(CELL_COUNT);
    for (let t = 0; t < CELL_COUNT; t++) {
      const fn = COLOR_FN[t];
      this.palette[t] = fn ? fn() : UNEXPLORED;
    }
    this.palette[Cell.Empty] = EXPLORED_AIR;

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || e.repeat || this.ctx.state.mode !== 'play') return;
      this.setVisible(!this.visible);
    });

    // The map is a play-mode verb; leaving play always closes it.
    ctx.events.on('modeChanged', ({ mode }) => {
      if (mode !== 'play') this.setVisible(false);
    });

    // Key in hand -> the portal dot pings on the corner map for a few
    // seconds: "now go THERE."
    ctx.events.on('objectiveChanged', ({ text }) => {
      if (text === 'REACH THE PORTAL') this.portalPing = 300;
    });
  }

  /** Frames left of the go-to-the-portal ping. */
  private portalPing = 0;

  private setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    el('minimap-overlay').classList.toggle('visible', on);
    if (on) this.redraw(this.ctx);
  }

  /** Per-frame hook (lead-wired). Cheap no-op unless something needs redrawing. */
  update(ctx: Ctx): void {
    if (this.portalPing > 0) this.portalPing--;
    // Always-on corner panel: a slower cadence keeps it nearly free —
    // except while the portal ping flashes, which earns a fast refresh.
    const cadence = this.portalPing > 0 ? 8 : 30;
    if (ctx.state.mode === 'play' && ctx.state.frameCount % cadence === 0) this.redrawCorner(ctx);
    if (!this.visible || ctx.state.frameCount % REDRAW_INTERVAL !== 0) return;
    this.redraw(ctx);
  }

  /** The compact top-right map: terrain + landmark dots, no caption. */
  private redrawCorner(ctx: Ctx): void {
    const level = ctx.levels.current;
    if (!level) return;
    this.paintTerrain(level);
    this.corner.putImageData(this.img, 0, 0);
    this.paintMarkers(this.corner, ctx, level);
  }

  private redraw(ctx: Ctx): void {
    const level = ctx.levels.current;
    if (!level) return;

    const exploredCount = this.paintTerrain(level);
    this.c2d.putImageData(this.img, 0, 0);
    this.paintMarkers(this.c2d, ctx, level);

    const pct = Math.round((exploredCount / level.explored.length) * 100);
    el('minimap-caption').textContent =
      'D' + level.def.depth + ' · ' + level.def.name + ' — ' + pct + '% explored';
  }

  /** Fill this.img from the explored mask + live world; returns explored count. */
  private paintTerrain(level: NonNullable<Ctx['levels']['current']>): number {
    const { world, explored } = level;
    const data = this.img.data;
    const palette = this.palette;
    let exploredCount = 0;

    for (let y = 0; y < MINIMAP_H; y++) {
      for (let x = 0; x < MINIMAP_W; x++) {
        const i = x + y * MINIMAP_W;
        let color = UNEXPLORED;
        if (explored[i] === 1) {
          exploredCount++;
          // Single sample at the 8x8 block center is plenty at this scale.
          const t = world.types[x * 8 + 4 + (y * 8 + 4) * world.width];
          color = palette[t];
        }
        const o = i * 4;
        data[o] = unpackR(color);
        data[o + 1] = unpackG(color);
        data[o + 2] = unpackB(color);
        data[o + 3] = 255;
      }
    }
    return exploredCount;
  }

  /** Landmark dots: portal, well, lit waystones, cauldron, key/hearts/tomes, player. */
  private paintMarkers(
    g: CanvasRenderingContext2D,
    ctx: Ctx,
    level: NonNullable<Ctx['levels']['current']>,
  ): void {
    if (level.portal) {
      // ping: the destination flashes big and bright right after the key
      if (this.portalPing > 0 && this.portalPing % 16 < 8) {
        g.fillStyle = '#ffffff';
        g.fillRect((level.portal.x >> 3) - 3, (level.portal.y >> 3) - 3, 7, 7);
      }
      g.fillStyle = level.keyTaken ? '#c084fc' : '#7c3aed';
      g.fillRect((level.portal.x >> 3) - 1, (level.portal.y >> 3) - 1, 3, 3);
    }
    if (level.exit) {
      g.fillStyle = '#a855f7';
      g.fillRect((level.exit.x >> 3) - 1, (level.exit.sealY >> 3) - 1, 2, 2);
    }
    g.fillStyle = '#ff9a3c';
    for (const w of level.waystones) {
      if (w.lit) g.fillRect((w.x >> 3) - 1, (w.y >> 3) - 1, 2, 2);
    }
    if (level.cauldron) {
      g.fillStyle = '#4ade80';
      g.fillRect((level.cauldron.x >> 3) - 1, (level.cauldron.y >> 3) - 1, 2, 2);
    }
    if (level.vaultArch) {
      // the gilded arch: always shown on the branch side (the way home is a
      // promise), but a host's hidden arch only once its alcove was SEEN —
      // a discovered secret stays on your map, an unfound one stays secret
      const ax = level.vaultArch.x >> 3,
        ay = level.vaultArch.y >> 3;
      if (level.def.branch || level.explored[ax + ay * MINIMAP_W] > 0) {
        g.fillStyle = '#fcd34d';
        g.fillRect(ax - 1, ay - 1, 3, 3);
      }
    }
    for (const p of level.pickups) {
      if (p.taken) continue;
      if (p.kind === 'key') g.fillStyle = '#fde047';
      else if (p.kind === 'heart') g.fillStyle = '#fb7185';
      else if (p.kind === 'tome') g.fillStyle = '#7dd3fc';
      else continue; // gold/chests/potions stay secrets until found on foot
      g.fillRect(p.x >> 3, p.y >> 3, 2, 2);
    }
    // Locks worth hunting: sealed mechanism gates (amber, dim once opened)
    // and rune glyphs (violet until struck, green after)
    for (const m of level.mechanisms) {
      if (m.kind !== 'door') continue;
      g.fillStyle = m.state === 1 ? '#3f6212' : '#fbbf24';
      g.fillRect(m.x >> 3, m.y >> 3, 2, 2);
    }
    for (const v of level.runeVaults) {
      g.fillStyle = v.active ? '#4ade80' : '#a78bfa';
      g.fillRect(v.rx >> 3, v.ry >> 3, 2, 2);
    }
    g.fillStyle = '#ffffff';
    g.fillRect((ctx.player.x >> 3) - 1, (ctx.player.y >> 3) - 1, 2, 2);
  }
}
