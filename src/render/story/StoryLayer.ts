import type { Ctx } from '@/core/types';
import type { StoryRenderView } from '@/core/story';
import { VIEW_H, VIEW_W } from '@/config/constants';
import type { LightField, PixelSurface } from '@/render/pixels';
import { blocksEntity } from '@/sim/CellType';
import { material, type CreatureMaterial } from '@/render/creatures/palette';
import { blankLight, sampleSceneLight, sharedRaster } from '@/render/creatures/raster';
import { drawStoryFigure } from './figureArt';

/**
 * THE STORY LAYER (wave 3 WS-S): what the story puts in the world, drawn in
 * the play layer between the set dressing and the creatures —
 *
 *  - the Docent's SPEAKING-PIPES on the back wall (hidden behind any rock in
 *    front of them): a brass run down from the dark to a flared horn at head
 *    height, bracketed to the wall; the horn warms and glows while he speaks,
 *    and breathes a faint pulse when it has something to say and you are near;
 *  - PELL'S CAMP: his lantern on its pole, a bedroll, a crate with the map on
 *    it, a spirit stove with the kettle on — or, on the Kiln, the cold camp and
 *    the page he left. The camp gathers the run: the pages of his map pinned to
 *    the wall from the second floor, the tin cup once you have drunk his tea,
 *    frost on the floor of the Cold Store, and on the Kiln his tea tin, empty
 *    or unopened;
 *  - the RESONANT VALVE: a brass wheel on its pipe with a green-glass gauge
 *    that hums while the echo plays;
 *  - PELL himself, and the ECHOES' ghosts (render/story/figureArt).
 */

const LIGHT = blankLight();

function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
const BRASS_D = rgb(0x5a3a16), BRASS = rgb(0xa8783a), BRASS_L = rgb(0xe8b868), MOUTH = rgb(0x120a04);

/** Is the world cell at (x, y) open (back wall visible)? */
function open(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world, X = Math.floor(x), Y = Math.floor(y);
  if (!w.inBounds(X, Y)) return false;
  return !blocksEntity(w.types[w.idx(X, Y)]);
}

function onScreen(ctx: Ctx, x: number, y: number, pad: number): boolean {
  const cx = ctx.camera.renderX, cy = ctx.camera.renderY;
  return x > cx - pad && x < cx + VIEW_W + pad && y > cy - pad && y < cy + VIEW_H + pad;
}

/* ---------------- speaking-pipes ---------------- */

function drawPipe(out: PixelSurface, field: LightField, ctx: Ctx, p: StoryRenderView['pipes'][number], nearAndFresh: boolean): void {
  const set = out.setFinePx ? out.setFinePx.bind(out) : out.setPx.bind(out);
  const add = out.addFinePx ? out.addFinePx.bind(out) : out.addPx.bind(out);
  const step = out.pixelStep ?? 1;
  const hornTop = p.floorY - 30, mouthY = p.floorY - 22;
  const top = Math.max(p.top, ctx.camera.renderY - 4);
  const lit = (x: number, y: number): number => {
    const s = typeof field?.sample === 'function' ? field.sample(x, y) : null;
    // Brass keeps a little of its own gleam in the gloom: never below half-lit.
    return s ? Math.min(1.3, Math.max(0.5, (s.r + s.g + s.b) / 3 + 0.12)) : 0.9;
  };
  const glowK = p.speaking;
  // A brass tube (a dark edge, the body, a bright line where it catches the light) down the back wall.
  const shade = (u: number): [number, number, number] => (u < 0.2 ? BRASS_D : u < 0.55 ? BRASS : u < 0.75 ? BRASS_L : BRASS);
  for (let y = top; y < hornTop; y += step) {
    const L = lit(p.x, y);
    for (let x = p.x - 1.5; x <= p.x + 1.5; x += step) {
      if (!open(ctx, x, y)) continue;
      const c = shade((x - (p.x - 1.5)) / 3);
      set(x, y, c[0] * L, c[1] * L, c[2] * L);
    }
    // A collar every 24 rows, bolted to the rock.
    const band = ((y - p.floorY) % 24 + 24) % 24;
    if (band < 1.5) for (let x = p.x - 2.5; x <= p.x + 2.5; x += step) if (open(ctx, x, y)) set(x, y, BRASS_L[0] * L, BRASS_L[1] * L, BRASS_L[2] * L);
  }
  // The horn: a flared bell, open toward the passer-by, its rim catching the light.
  for (let y = hornTop; y <= mouthY; y += step) {
    const u = (y - hornTop) / (mouthY - hornTop);
    const half = 1.5 + u * u * 4.2;
    const L = lit(p.x, y) * (1 + glowK * 0.7);
    for (let x = p.x - half; x <= p.x + half; x += step) {
      if (!open(ctx, x, y)) continue;
      const c = shade((x - (p.x - half)) / (half * 2));
      set(x, y, c[0] * L, c[1] * L, c[2] * L);
    }
  }
  // The mouth: dark, warming to an ember when he speaks; a bright lip.
  for (let x = p.x - 5.6; x <= p.x + 5.6; x += step) {
    const warm = glowK * 0.9;
    if (open(ctx, x, mouthY + step)) set(x, mouthY + step, MOUTH[0] + warm, MOUTH[1] + warm * 0.6, MOUTH[2] + warm * 0.22);
    if (open(ctx, x, mouthY + step * 2)) set(x, mouthY + step * 2, BRASS_L[0] * 0.9, BRASS_L[1] * 0.9, BRASS_L[2] * 0.9);
  }
  // Warm breath from the horn while he speaks; a slow pulse when it has something to say and you are near.
  const pulse = nearAndFresh ? 0.22 + 0.16 * Math.sin(ctx.state.frameCount * 0.07) : 0;
  const k = Math.max(glowK, pulse);
  if (k > 0.01) {
    const r0 = ctx.state.reduceFlashes ? 10 : 16;
    for (let dy = -6; dy <= r0; dy += step) for (let dx = -r0; dx <= r0; dx += step) {
      const d = Math.hypot(dx, dy * 1.15) / r0;
      if (d >= 1) continue;
      const a = (1 - d) * (1 - d) * 0.26 * k;
      add(p.x + dx, mouthY + 3 + dy, a * 1.0, a * 0.64, a * 0.3);
    }
  }
}

/* ---------------- props on the rasterizer ---------------- */

const WOOD = 1, BRASS_M = 2, GLASS = 3, FLAME = 4, CLOTH = 5, CLOTH_D = 6, PAPER = 7, IRON = 8, CRATE = 9, GAUGE = 10, FROST = 12;
const PROPS: CreatureMaterial[] = [
  material({ keys: [0x140c06, 0x34200e, 0x5c3a1c, 0x86592e], gloss: 0.3, rim: 0.6, outline: 0x060403 }),
  material({ keys: [0x3a1806, 0x8a4816, 0xd07a2a, 0xffb55a, 0xffe6a8], gloss: 0.8, shine: 22, rim: 0.7, outline: 0x140802 }),
  material({ keys: [0x5a3a18, 0xc88a3a, 0xffd88a, 0xfff4d0], translucent: 0.3, emissive: 0.85, glow: 0x6a3a0c, glowK: 1, rim: 1, outline: 0x241404 }),
  material({ keys: [0x6a1a00, 0xe05a08, 0xffb030, 0xfff2b0], emissive: 1, glow: 0x7a2a04, glowK: 1.1 }),
  material({ keys: [0x1a0808, 0x3a1612, 0x5e2a20, 0x844434], gloss: 0.1, rim: 0.6, outline: 0x080303 }),
  material({ keys: [0x100a08, 0x241612, 0x3a2620, 0x52382e], gloss: 0.1, rim: 0.5, outline: 0x060303 }),
  material({ keys: [0x5a5240, 0x9a8e6c, 0xcfc29c, 0xefe4c4, 0xfff8e4], gloss: 0.05, rim: 0.5, outline: 0x241e14 }),
  material({ keys: [0x100c0a, 0x2a221e, 0x463a32, 0x6a5a4c], gloss: 0.55, shine: 18, rim: 0.7, outline: 0x060403 }),
  material({ keys: [0x1c120a, 0x3e2a16, 0x644626, 0x8e6a3c], gloss: 0.2, rim: 0.6, outline: 0x0a0604 }),
  material({ keys: [0x0a3a34, 0x2aa88e, 0x9aecd8, 0xffffff], emissive: 1, glow: 0x0c3a30, glowK: 0.9, translucent: 0.35 }),
  material({ keys: [0x2a0a00, 0x6a2006, 0xa8400e, 0xe07a2a], emissive: 0.6, glow: 0x2a0a02, glowK: 0.4 }),
  // Frost: pale blue-white, a little of its own glint (index 12, appended).
  material({ keys: [0x5a7a8a, 0x9ac0d0, 0xd6eef6, 0xffffff], gloss: 0.6, shine: 24, emissive: 0.25, glow: 0x1a3a4a, glowK: 0.25, rim: 0.8 }),
];

const QUAD = new Float64Array(8);
function quad(x0: number, y0: number, x1: number, y1: number): Float64Array {
  QUAD[0] = x0; QUAD[1] = y0; QUAD[2] = x1; QUAD[3] = y0; QUAD[4] = x1; QUAD[5] = y1; QUAD[6] = x0; QUAD[7] = y1;
  return QUAD;
}

const TQ = new Float64Array(8);
/** A quad centred on (cx, cy), half-sizes hw x hh, turned by `a` radians (a page pinned a little crooked). */
function tiltQuad(cx: number, cy: number, hw: number, hh: number, a: number): Float64Array {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < 4; i++) {
    const px = i === 0 || i === 3 ? -hw : hw, py = i < 2 ? -hh : hh;
    TQ[i * 2] = cx + px * c - py * s;
    TQ[i * 2 + 1] = cy + px * s + py * c;
  }
  return TQ;
}

/** The pages of his map pinned to the wall over the crate: one for each floor he has mapped, crooked, inked, pinned in red. */
function drawPinnedPages(r: typeof sharedRaster, n: number, cx: number, y: number): void {
  const at = n === 1 ? [0] : n === 2 ? [-3.2, 3.2] : [-6.4, 0, 6.4];
  for (let i = 0; i < n; i++) {
    const px = cx + at[i]!, py = y - 17.5 - (i % 2) * 2.6, a = [-0.09, 0.06, -0.04][i]!;
    r.poly(tiltQuad(px, py, 2.4, 3.1, a), 4, -5, PAPER, 0.05, { group: 10 + i });
    r.stroke(px - 1.5, py - 1.4, px + 1.4, py - 1.2 + a * 3, CLOTH_D, 0, true);
    r.stroke(px - 1.6, py + 0.1, px + 0.8, py + 0.3, CLOTH_D, 0, true);
    r.stroke(px - 1.2, py + 1.6, px + 1.5, py + 1.4, CLOTH_D, 0, true);
    r.dot(px, py - 2.6, CLOTH, 2, 5);
  }
}

/** His tea tin on the cold camp: closed and full when he still has it, open and empty beside its lid when you drank it. */
function drawTin(r: typeof sharedRaster, empty: boolean, tx: number, y: number): void {
  r.poly(quad(tx - 1.5, y - 3.4, tx + 1.5, y - 0.2), 4, -0.6, BRASS_M, 0.6, { group: 14 });
  r.stroke(tx - 1.5, y - 1.7, tx + 1.5, y - 1.7, CLOTH, 0, true);
  if (empty) {
    r.ellipse(tx, y - 3.4, 1.5, 0.45, 0, -0.5, IRON, { group: 14 });
    r.ellipse(tx + 4.2, y - 0.7, 1.6, 0.6, 0, -0.5, IRON, { group: 15 });
  } else {
    r.ellipse(tx, y - 3.5, 1.6, 0.55, 0, -0.5, BRASS_M, { group: 14 });
  }
}

function drawCamp(out: PixelSurface, field: LightField, ctx: Ctx, camp: NonNullable<StoryRenderView['camp']>): void {
  if (!out.setFinePx) return;
  const r = sharedRaster, f = camp.facing, y = camp.floorY + 0.5, x = camp.x, t = ctx.state.frameCount;
  const dress = camp.dress;
  r.begin(out.pixelStep ?? 1, x - 40, y - 36, x + 40, y + 2, PROPS, x, y);
  r.outline = 1; r.bands = 0.7; r.dither = false; r.blend = 1.2;
  // What the run has left here: his map pages on the wall behind the crate.
  if (dress && dress.pages > 0) drawPinnedPages(r, dress.pages, x - f * 9, y);
  // Frost on the floor of the Cold Store: pale rime along the ground, more of it by the bedroll.
  if (dress?.frost) {
    for (let i = -6; i <= 6; i++) {
      const fx = x + i * 5.6 + Math.sin(i * 2.3) * 1.4;
      r.ellipse(fx, y - 0.25, 2.2 + Math.abs(Math.sin(i * 1.7)) * 1.4, 0.55, 0, -0.4, FROST, { group: 20 + (i + 6) });
    }
  }
  // Bedroll behind him.
  const bx = x - f * 20;
  r.capsule(bx - 6, y - 1.5, 1.6, bx + 6, y - 1.6, 1.7, -4, -4, camp.abandoned ? CLOTH_D : CLOTH, { group: 1 });
  r.ellipse(bx + f * 6.5, y - 1.8, 1.9, 1.9, 0, -3.5, CLOTH_D, { group: 1 });
  if (camp.abandoned) {
    // The crate tipped over; the stove cold; his last page on the bedroll (until read).
    r.poly(quad(x + f * 16 - 3, y - 4.6, x + f * 16 + 3, y - 0.2), 4, -2, CRATE, 0.3, { group: 2 });
    r.ellipse(x + f * 8, y - 1.6, 1.8, 1.4, 0, -1, IRON, { group: 3 });
    if (!camp.pageRead) {
      r.poly(quad(bx - 2.2, y - 5.2, bx + 2.2, y - 3.4), 4, -2.5, PAPER, 0.05, { group: 4 });
      r.glowStamp(bx, y - 4.3, 2.4, 1.2, 0, PAPER, 0.6 + Math.sin(t * 0.06) * 0.25, 0.2, 4);
    }
    if (dress && dress.tin !== 'none') drawTin(r, dress.tin === 'empty', x + f * 1.5, y);
  } else {
    // A crate with the map spread on it.
    const cx = x - f * 9;
    r.poly(quad(cx - 3.2, y - 6, cx + 3.2, y - 0.2), 4, -2, CRATE, 0.3, { group: 2 });
    r.stroke(cx - 3.2, y - 3, cx + 3.2, y - 3, WOOD, 0, true);
    r.poly(quad(cx - 3.6, y - 6.8, cx + 2.8, y - 5.8), 4, -1.5, PAPER, 0.05, { group: 5 });
    if (dress?.cup) {
      // The tin cup from his last tea, left on the crate by the map.
      r.ellipse(cx + 1.9, y - 8.2, 1.05, 1.15, 0, -1.4, BRASS_M, { group: 16 });
      r.ellipse(cx + 1.9, y - 9.2, 1.05, 0.38, 0, -1.3, IRON, { group: 16 });
    }
    if (dress?.frost) r.ellipse(cx, y - 6.3, 3.4, 0.45, 0, -1.4, FROST, { group: 17 });
    // The spirit stove and the kettle, steaming.
    const sx = x + f * 16;
    r.poly(quad(sx - 1.6, y - 2.4, sx + 1.6, y - 0.2), 4, -1, IRON, 0.2, { group: 3 });
    r.ellipse(sx, y - 2.6, 1.0, 0.45, 0, -0.8, FLAME, { group: 3, noOutline: true });
    r.ellipse(sx, y - 4.4, 1.7, 1.5, 0, -0.9, BRASS_M, { group: 6 });
    r.capsule(sx + f * 1.4, y - 4.6, 0.3, sx + f * 2.8, y - 5.8, 0.25, -0.8, -0.8, BRASS_M, { group: 6 });
    // The lantern pole planted beside him, the lantern swinging a little.
    const px = x + f * 9;
    r.capsule(px, y, 0.4, px, y - 27, 0.35, -3, -3, WOOD, { group: 7 });
    r.capsule(px, y - 27, 0.3, px + f * 3.2, y - 26.2, 0.3, -3, -3, WOOD, { group: 7 });
    const sway = Math.sin(t * 0.045) * 0.6;
    const lx = px + f * 3.2 + sway, ly = y - 23.6;
    r.ellipse(lx, ly, 1.3, 1.7, 0, -2.6, GLASS, { group: 8, noOutline: true });
    r.ellipse(lx, ly - 1.9, 1.2, 0.5, 0, -2.5, BRASS_M, { group: 8 });
    r.ellipse(lx, ly + 1.8, 1.0, 0.35, 0, -2.5, BRASS_M, { group: 8 });
    r.glowStamp(lx, ly, 1.1, 1.4, 0, FLAME, 1.4 + Math.sin(t * 0.21) * 0.15, 0.6, 8);
  }
  sampleSceneLight(field, x, y - 10, 12, 0, LIGHT, 1);
  LIGHT.r = Math.max(0.5, LIGHT.r); LIGHT.g = Math.max(0.48, LIGHT.g); LIGHT.b = Math.max(0.46, LIGHT.b);
  r.resolve(out, LIGHT);
  // The kettle's steam: a few pale wisps (presentation only).
  if (!camp.abandoned && out.addFinePx && !ctx.state.reduceFlashes) {
    for (let i = 0; i < 4; i++) {
      const life = ((t * 0.012 + i / 4) % 1);
      const wx = x + f * (19 + life * 2) + Math.sin(life * 6 + i) * 0.8, wy = y - 6 - life * 9;
      const a = (1 - life) * 0.12;
      out.addFinePx(wx, wy, a, a, a * 0.95);
      out.addFinePx(wx + 0.5, wy, a * 0.6, a * 0.6, a * 0.6);
    }
  }
}

function drawValve(out: PixelSurface, field: LightField, ctx: Ctx, v: NonNullable<StoryRenderView['valve']>): void {
  if (!out.setFinePx) return;
  const r = sharedRaster, y = v.floorY + 0.5, x = v.x;
  r.begin(out.pixelStep ?? 1, x - 12, y - 30, x + 12, y + 2, PROPS, x, y);
  r.outline = 1; r.bands = 0.7; r.dither = false; r.blend = 1.2;
  // The pipe up from the floor, the wheel at chest height, a gauge beside it.
  r.capsule(x, y, 1.1, x, y - 16, 1.1, -3, -3, IRON, { group: 1 });
  r.ellipse(x, y - 1, 2.2, 1.1, 0, -2.8, IRON, { group: 1 });
  const cy = y - 14;
  const a0 = v.turn * Math.PI * 3;
  // The wheel: a brass rim of short segments, four spokes, a hub.
  const R = 5.2, N = 16;
  for (let i = 0; i < N; i++) {
    const a1 = a0 + (i / N) * Math.PI * 2, a2 = a0 + ((i + 1) / N) * Math.PI * 2;
    r.capsule(x + Math.cos(a1) * R, cy + Math.sin(a1) * R, 0.72, x + Math.cos(a2) * R, cy + Math.sin(a2) * R, 0.72, 1.2, 1.2, BRASS_M, { group: 2 });
  }
  for (let i = 0; i < 4; i++) {
    const a = a0 + (i * Math.PI) / 2 + Math.PI / 4;
    r.capsule(x, cy, 0.42, x + Math.cos(a) * (R - 0.4), cy + Math.sin(a) * (R - 0.4), 0.38, 0.9, 1.1, BRASS_M, { group: 2 });
  }
  r.ellipse(x, cy, 1.25, 1.25, 0, 1.6, BRASS_M, { group: 2 });
  r.dot(x, cy, IRON, 1, 3);
  // A little glass gauge on the pipe below the wheel: it hums green while the echo plays.
  const gx = x, gy = y - 5.4;
  r.ellipse(gx, gy, 1.7, 1.7, 0, -1.2, BRASS_M, { group: 3 });
  r.ellipse(gx, gy, 1.15, 1.15, 0, -1.0, GAUGE, { group: 3, noOutline: true });
  const hum = v.hum;
  r.glowStamp(gx, gy, 1.3 + hum, 1.3 + hum, 0, GAUGE, 0.5 + hum * 1.8 + (v.used ? 0 : Math.sin(ctx.state.frameCount * 0.07) * 0.3), 0.3, 3);
  sampleSceneLight(field, x, cy, 10, 0, LIGHT, 1);
  LIGHT.r = Math.max(0.5, LIGHT.r); LIGHT.g = Math.max(0.5, LIGHT.g); LIGHT.b = Math.max(0.5, LIGHT.b);
  r.resolve(out, LIGHT);
}

/** The flue's hatch: once the heave has begun, daylight rims it from above. */
function drawHatch(out: PixelSurface, ctx: Ctx, f: NonNullable<StoryRenderView['flue']>): void {
  if (!f.open || !out.addFinePx || ctx.state.reduceFlashes) return;
  const x = f.exit.x, y = f.shaft.y0 + 1;
  const pulse = 0.85 + Math.sin(ctx.state.frameCount * 0.05) * 0.15;
  for (let dy = 0; dy < 26; dy += out.pixelStep ?? 1) for (let dx = -16; dx <= 16; dx += out.pixelStep ?? 1) {
    const d = Math.hypot(dx / 16, dy / 26);
    if (d >= 1 || !open(ctx, x + dx, y + dy)) continue;
    const a = (1 - d) * (1 - d) * 0.3 * pulse;
    out.addFinePx(x + dx, y + dy, a, a * 0.94, a * 0.78);
  }
}

/** Everything the story draws, once a frame, between the set dressing and the creatures. */
export function drawStoryLayer(out: PixelSurface, field: LightField, ctx: Ctx): void {
  const v = ctx.story?.view;
  if (!v || ctx.state.mode !== 'play') return;
  const p = ctx.player;
  for (const pipe of v.pipes) {
    if (!onScreen(ctx, pipe.x, pipe.floorY - 40, 60)) continue;
    const near = !pipe.spoken && Math.abs(p.x - pipe.x) < 140 && Math.abs(p.y - pipe.floorY) < 90;
    drawPipe(out, field, ctx, pipe, near);
  }
  if (v.flue && onScreen(ctx, v.flue.exit.x, v.flue.shaft.y0, 40)) drawHatch(out, ctx, v.flue);
  if (v.valve && onScreen(ctx, v.valve.x, v.valve.floorY - 14, 40)) drawValve(out, field, ctx, v.valve);
  if (v.camp && onScreen(ctx, v.camp.x, v.camp.floorY - 14, 50)) drawCamp(out, field, ctx, v.camp);
  if (v.pell && onScreen(ctx, v.pell.x, v.pell.y - 10, 40)) drawStoryFigure(out, field, ctx, v.pell, false);
  if (v.echo) for (const a of v.echo.actors) if (onScreen(ctx, a.x, a.y - 10, 40)) drawStoryFigure(out, field, ctx, a, a.costume === 'surveyor');
}
