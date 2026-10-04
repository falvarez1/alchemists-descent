import { VIEW_H, VIEW_W } from '@/config/constants';
import type { StockStageId } from '@/config/stockStage';
import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';

/**
 * Stage atmosphere (Duel): what hangs in each stage's air, as in its concept. The Foundry's and the Kiln's embers rising
 * off the furnaces (the Kiln's thick, with falling ash), the Cistern's drips and lifting mist, the Gallery's dust glinting
 * in the light. Presentation only and stateless: every mote's whole life is a function of its index and the tick, so it
 * costs no memory and never desyncs. Drawn behind the fighters, in world space (they do not slide with the camera).
 */
type Kind = 'ember' | 'ash' | 'drip' | 'mist' | 'mote';
interface Layer { kind: Kind; count: number; color: readonly [number, number, number]; speed: number; life: number }

const LAYERS: Record<StockStageId, readonly Layer[]> = {
  foundry: [{ kind: 'ember', count: 42, color: [1, .56, .2], speed: .32, life: 420 }],
  kiln: [
    { kind: 'ember', count: 90, color: [1, .5, .14], speed: .45, life: 360 },
    { kind: 'ash', count: 26, color: [.55, .5, .47], speed: .16, life: 600 },
  ],
  cistern: [
    { kind: 'drip', count: 26, color: [.62, .86, .9], speed: 3.2, life: 150 },
    { kind: 'mist', count: 34, color: [.5, .82, .84], speed: .12, life: 520 },
  ],
  gallery: [{ kind: 'mote', count: 56, color: [1, .86, .58], speed: .1, life: 640 }],
};

const hash = (n: number): number => { const h = Math.sin(n * 127.1 + 311.7) * 43758.5453; return h - Math.floor(h); };

export function drawStageAtmosphere(out: PixelSurface, ctx: Ctx): void {
  const arena = ctx.arena;
  if (!arena?.stockMatch || ctx.state.mode !== 'play') return;
  const stage = arena.stockStage, layers = LAYERS[stage.id];
  if (!layers) return;
  const frame = ctx.state.frameCount, cam = ctx.camera, zoom = Math.max(.2, cam.zoom || 1);
  const cx = cam.x + VIEW_W / 2, cy = cam.y + VIEW_H / 2, hw = VIEW_W / 2 / zoom + 4, hh = VIEW_H / 2 / zoom + 4;
  const { left, right, top, bottom } = stage.zone;
  const width = right - left, height = bottom - top;
  const fine = !!out.blendFinePx && (out.pixelStep ?? 1) < 1;
  const quiet = ctx.state.reduceFlashes === true;
  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l], [cr, cg, cb] = layer.color;
    for (let i = 0; i < layer.count; i++) {
      const seed = l * 1000 + i, life = layer.life * (.7 + .6 * hash(seed + .1));
      const age = (frame + hash(seed + .2) * life) % life, u = age / life;
      const born = Math.floor((frame + hash(seed + .2) * life) / life); // a new life starts somewhere new
      const x0 = left + hash(seed + born * 7.31) * width;
      let x = x0, y: number;
      const speed = layer.speed * (.6 + .8 * hash(seed + .3));
      let a = Math.min(1, u * 6, (1 - u) * 4);
      switch (layer.kind) {
        case 'ember':
          y = bottom - 120 * hash(seed + born * 3.7) - age * speed;
          x += Math.sin(age * .045 + i) * 5 + age * .05 * (hash(seed + .4) - .5);
          a *= .55 + .45 * Math.sin(frame * .3 + i * 1.7); // flicker
          break;
        case 'ash':
          y = top + age * speed; x += Math.sin(age * .02 + i) * 9; a *= .5;
          break;
        case 'drip':
          y = top + 60 + hash(seed + born * 5.1) * 200 + age * speed; a = u < .9 ? .6 : 0;
          break;
        case 'mist':
          y = bottom - 80 - age * speed; x += Math.sin(age * .01 + i) * 12; a *= .32;
          break;
        default: // mote
          y = top + hash(seed + born * 2.9) * height + Math.sin(age * .012 + i) * 8; x += age * speed * (hash(seed + .5) > .5 ? 1 : -1);
          a *= .25 + .75 * Math.max(0, Math.sin(frame * .05 + i * 2.3)); // glint
          break;
      }
      if (a <= .03 || Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) continue;
      if (!fine) { out.addPx(x, y, cr * a * .5, cg * a * .5, cb * a * .5); continue; }
      const px = Math.round(x * 2) / 2, py = Math.round(y * 2) / 2;
      if (layer.kind === 'drip') {
        for (let k = 0; k < 3; k++) out.blendFinePx!(px, py - k * .5, cr * a * (1 - k * .3), cg * a * (1 - k * .3), cb * a * (1 - k * .3), a * (1 - k * .3));
        continue;
      }
      if (layer.kind === 'mist') {
        for (let dy = -1; dy <= 1; dy += .5) for (let dx = -1.5; dx <= 1.5; dx += .5) out.blendFinePx!(px + dx, py + dy, cr * a * .6, cg * a * .6, cb * a * .6, a * .6);
        continue;
      }
      out.blendFinePx!(px, py, cr * a, cg * a, cb * a, a);
      if (layer.kind === 'ember' && !quiet && out.addFinePx) {
        const g = a * .35;
        out.addFinePx(px, py, cr * g * 2, cg * g * 2, cb * g * 2);
        for (const [ox, oy] of [[.5, 0], [-.5, 0], [0, .5], [0, -.5]] as const) out.addFinePx(px + ox, py + oy, cr * g, cg * g, cb * g);
      }
    }
  }
}
