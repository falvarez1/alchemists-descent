import { VIEW_H, VIEW_W } from '@/config/constants';
import { FIGHTER_DEFS } from '@/content/fighters';
import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';

/**
 * The ring-out blast (Duel): a fighter leaving the blast zone bursts at the edge of the screen it left by, a cone of its
 * colour fired back toward the stage with an ivory core and flung streaks, for about two thirds of a second. Read from the
 * arena's own `fighterDown` events. Sized in screen terms, so it hits as hard at any camera zoom.
 */
interface Burst { x: number; y: number; born: number; color: readonly [number, number, number]; seed: number }
const LIFE = 48;
const bursts: Burst[] = [];
const hooked = new WeakSet<object>();

function accent(ctx: Ctx, slot: number): [number, number, number] {
  const id = ctx.arena?.bundle(slot)?.fighters.id ?? null;
  const hex = Number.parseInt((id ? FIGHTER_DEFS[id]?.accent : null)?.slice(1) ?? 'efac58', 16);
  return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
}

export function drawDuelKoFx(out: PixelSurface, ctx: Ctx): void {
  const arena = ctx.arena;
  if (!arena) return;
  if (!hooked.has(ctx.events)) {
    hooked.add(ctx.events);
    ctx.events.on('fighterDown', ev => {
      if (ev.source !== 'ring-out' || !ctx.arena?.stockMatch) return;
      bursts.push({ x: ev.x, y: ev.y, born: ctx.state.frameCount, color: accent(ctx, ev.slot), seed: ev.slot * 977 + ctx.state.frameCount });
    });
  }
  if (!arena.stockMatch) { bursts.length = 0; return; }
  if (bursts.length === 0) return;
  const frame = ctx.state.frameCount, cam = ctx.camera, zoom = Math.max(.2, cam.zoom || 1);
  const cx = cam.x + VIEW_W / 2, cy = cam.y + VIEW_H / 2, hw = VIEW_W / 2 / zoom, hh = VIEW_H / 2 / zoom;
  const centre = arena.stockStage.center;
  const quiet = ctx.state.reduceFlashes === true;
  const fine = !!out.blendFinePx && (out.pixelStep ?? 1) < 1;
  const step = fine ? (out.pixelStep ?? .5) : 1;
  let kept = 0;
  for (const b of bursts) {
    const age = frame - b.born;
    if (age < 0 || age >= LIFE) continue;
    bursts[kept++] = b;
    // Where it left the screen: the exit point pinned to the visible frame's edge.
    const ex = Math.max(cx - hw, Math.min(cx + hw, b.x)), ey = Math.max(cy - hh, Math.min(cy + hh, b.y));
    let dx = centre.x - ex, dy = centre.y - 20 - ey;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const u = age / LIFE, grow = Math.min(1, age / 5), fade = Math.pow(1 - u, 1.3);
    const len = (300 / zoom) * grow * (.85 + .15 * u), base = (78 / zoom) * (1 - .35 * u);
    const peak = quiet ? .4 : .95;
    // The cone: widest at the screen edge, narrowing toward the stage; ivory at its spine, the fighter's colour outside.
    // Scanned in screen space over its bounding box, so every pixel is covered exactly once (no lattice, no double blend).
    const px = -dy, py = dx, tipHalf = base * .18;
    const xs = [ex + px * base, ex - px * base, ex + dx * len + px * tipHalf, ex + dx * len - px * tipHalf];
    const ys = [ey + py * base, ey - py * base, ey + dy * len + py * tipHalf, ey + dy * len - py * tipHalf];
    const bx0 = Math.max(cx - hw, Math.min(...xs)), bx1 = Math.min(cx + hw, Math.max(...xs));
    const by0 = Math.max(cy - hh, Math.min(...ys)), by1 = Math.min(cy + hh, Math.max(...ys));
    for (let y = Math.floor(by0 / step) * step; y <= by1; y += step) for (let x = Math.floor(bx0 / step) * step; x <= bx1; x += step) {
      const vx = x - ex, vy = y - ey, s = vx * dx + vy * dy;
      if (s < 0 || s > len) continue;
      const along = s / Math.max(1, len), half = base * (1 - along * .82), w = vx * px + vy * py;
      if (Math.abs(w) > half) continue;
      {
        const edge = Math.abs(w) / Math.max(.5, half);
        const a = fade * peak * (1 - along) * (1 - edge * edge);
        if (a < .02) continue;
        const hot = Math.max(0, 1 - edge * 3.4) * (1 - along * .7);
        const r = b.color[0] + (1 - b.color[0]) * hot, g = b.color[1] + (.95 - b.color[1]) * hot, bl = b.color[2] + (.8 - b.color[2]) * hot;
        if (fine) {
          out.blendFinePx!(x, y, r * a, g * a, bl * a, a);
          if (!quiet && hot > .3 && out.addFinePx) out.addFinePx(x, y, r * a * .25, g * a * .25, bl * a * .25);
        } else out.addPx(x, y, r * a * .8, g * a * .8, bl * a * .8);
      }
    }
    if (quiet) continue;
    // The blast's first frames: a white-hot flash at the exit point and a shockwave ring racing out from it.
    if (age < 8) {
      const fr = (18 + age * 4) / zoom, fa = (1 - age / 8) * .6;
      for (let y = -fr; y <= fr; y += step) for (let x = -fr; x <= fr; x += step) {
        const d = (x * x + y * y) / (fr * fr);
        if (d > 1) continue;
        const a = fa * (1 - d);
        if (fine) out.addFinePx!(ex + x, ey + y, a, a * .95, a * .85); else out.addPx(ex + x, ey + y, a * .6, a * .57, a * .5);
      }
    }
    if (age < 22) {
      const rr = (12 + age * 9) / zoom, ra = (1 - age / 22) * .85;
      for (let t = 0; t < Math.PI * 2; t += step / Math.max(4, rr)) {
        const x = ex + Math.cos(t) * rr, y = ey + Math.sin(t) * rr;
        if (fine) out.blendFinePx!(x, y, b.color[0] * ra, b.color[1] * ra, b.color[2] * ra, ra); else out.addPx(x, y, b.color[0] * ra * .7, b.color[1] * ra * .7, b.color[2] * ra * .7);
      }
    }
    // Streaks flung past the cone, fixed per burst so they do not flicker.
    for (let i = 0; i < 22; i++) {
      const h = Math.sin((b.seed + i * 12.9898) * 78.233) * 43758.5453, r1 = h - Math.floor(h);
      const h2 = Math.sin((b.seed + i * 4.1414) * 39.346) * 12543.237, r2 = h2 - Math.floor(h2);
      const ang = (r1 - .5) * 1.9, ca = Math.cos(ang), sa = Math.sin(ang);
      const sx = dx * ca - dy * sa, sy = dx * sa + dy * ca;
      const from = (30 + r2 * 120) / zoom * grow + age * 4 / zoom, to = from + (24 + r1 * 40) / zoom;
      for (let s = from; s <= to; s += step) {
        const a = fade * (1 - (s - from) / (to - from)) * .9;
        const x = ex + sx * s, y = ey + sy * s;
        if (fine) out.blendFinePx!(x, y, a, .95 * a, .8 * a, a);
        else out.addPx(x, y, a * .7, a * .66, a * .56);
      }
    }
  }
  bursts.length = kept;
}
