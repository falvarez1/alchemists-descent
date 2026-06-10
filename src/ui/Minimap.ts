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
  /** One representative packed 0xRRGGBB per cell type, frozen at construction. */
  private readonly palette: Uint32Array;
  private visible = false;

  constructor(private ctx: Ctx) {
    this.canvas = el('minimap-canvas') as HTMLCanvasElement;
    this.canvas.width = MINIMAP_W;
    this.canvas.height = MINIMAP_H;
    this.c2d = this.canvas.getContext('2d')!;
    this.img = this.c2d.createImageData(MINIMAP_W, MINIMAP_H);

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
  }

  private setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    el('minimap-overlay').classList.toggle('visible', on);
    if (on) this.redraw(this.ctx);
  }

  /** Per-frame hook (lead-wired). Cheap no-op unless the overlay is open. */
  update(ctx: Ctx): void {
    if (!this.visible || ctx.state.frameCount % REDRAW_INTERVAL !== 0) return;
    this.redraw(ctx);
  }

  private redraw(ctx: Ctx): void {
    const level = ctx.levels.current;
    if (!level) return;

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
    this.c2d.putImageData(this.img, 0, 0);

    // Markers go over the terrain: well exit, lit waystones, then the player.
    if (level.exit) {
      this.c2d.fillStyle = '#a855f7';
      this.c2d.fillRect((level.exit.x >> 3) - 1, (level.exit.sealY >> 3) - 1, 2, 2);
    }
    this.c2d.fillStyle = '#ff9a3c';
    for (const w of level.waystones) {
      if (w.lit) this.c2d.fillRect((w.x >> 3) - 1, (w.y >> 3) - 1, 2, 2);
    }
    this.c2d.fillStyle = '#ffffff';
    this.c2d.fillRect((ctx.player.x >> 3) - 1, (ctx.player.y >> 3) - 1, 2, 2);

    const pct = Math.round((exploredCount / explored.length) * 100);
    el('minimap-caption').textContent =
      'D' + level.def.depth + ' · ' + level.def.name + ' — ' + pct + '% explored';
  }
}
