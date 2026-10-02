import { VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx, Enemy } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import {
  TUNING, moteFade, ringAlpha, ringRadius, spoorIndex, tetherReach, tetherTension,
} from '@/fighters/kits/sable-fen-logic';
import type { SpoorTrail } from '@/fighters/kits/sable-fen-logic';

/**
 * Sable Fen's drawables (docs/fighters/sable-fen.md), pure presentation: the kit owns the state they read and
 * its lifetime, and nothing here touches a cell or draws a random number (every wobble is a hash or a sine of
 * the frame).
 *
 *  - the spoor: fading green motes at a marked foe's recent positions, additive and on the 'under' layer, so a
 *    track glows in the dark and over rock;
 *  - the Bogline tether: a twisted rope, taut from her hand to a barbed hook, flying out, twanging when it
 *    bites and coiling back when it is spent;
 *  - the overlay: stun stars over a foe the line has dazed, the slow heartbeat rings of Bloodsense, the flare on
 *    each wounded foe a ring passes, and the warm glow of the body itself through rock.
 */

type Put = (this: PixelSurface, wx: number, wy: number, r: number, g: number, b: number) => void;
type Rgb = readonly [number, number, number];

/** A deterministic 0..1 hash of two integers (no Math.random: this runs in the render and must not move any stream). */
function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Is a point (with `pad` cells of margin) inside the view the renderer is drawing? */
function inView(ctx: Ctx, x: number, y: number, pad: number): boolean {
  const cx = ctx.camera.x, cy = ctx.camera.y;
  return x >= cx - pad && x <= cx + VIEW_W + pad && y >= cy - pad && y <= cy + VIEW_H + pad;
}

/** One world cell of additive light at the surface's own pixel step. */
function addCell(out: PixelSurface, add: Put, step: number, cx: number, cy: number, r: number, g: number, b: number): void {
  for (let fy = 0; fy < 1; fy += step) {
    for (let fx = 0; fx < 1; fx += step) add.call(out, cx + fx + step * 0.5, cy + fy + step * 0.5, r, g, b);
  }
}

// ======================================================================== the spoor

export interface SpoorView {
  /** Every trail still burning, by the foe that left it. */
  trails: ReadonlyMap<Enemy, SpoorTrail>;
}

/** The green of a track: a cold, wet green, a little blue in the shoulders. */
const MOTE: Rgb = [0.28, 1.0, 0.44];

/** Offsets of the glow around a mote's core: the cross, then the corners, then the outer ring. */
const CROSS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const CORNERS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const OUTER: ReadonlyArray<readonly [number, number]> = [[-2, 0], [2, 0], [0, -2], [0, 2]];

export function drawSpoor(out: PixelSurface, _field: LightField, ctx: Ctx, v: SpoorView): void {
  if (v.trails.size === 0) return;
  const step = out.pixelStep ?? 1;
  const add = (out.addFinePx ?? out.addPx) as Put;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const life = TUNING.spoor.life;
  for (const tr of v.trails.values()) {
    let px = 0, py = 0, pk = 0, have = false;
    for (let i = 0; i < tr.n; i++) {
      const at = spoorIndex(tr, i);
      const age = frame - tr.ts[at];
      const f = moteFade(age, life);
      if (f <= 0.01) { have = false; continue; }
      // The mote rises a little as it burns and sways on its own phase.
      const seed = hash(at, tr.ts[at]);
      const rise = Math.min(age, life) * 0.04;
      const x = tr.xs[at] + Math.sin(frame * 0.06 + seed * 6.28) * 0.7;
      const y = tr.ys[at] - 2 - rise;
      if (!inView(ctx, x, y, 6)) { have = false; continue; }
      const twinkle = calm ? 0.9 : 0.74 + 0.26 * Math.sin(frame * 0.21 + seed * 9);
      const k = f * twinkle;
      const cx = Math.round(x), cy = Math.round(y);
      // A bright core, a cross and corners round it, and (while it is young) a faint outer halo.
      addCell(out, add, step, cx, cy, MOTE[0] * k * 1.25, MOTE[1] * k * 1.25, MOTE[2] * k * 1.25);
      const h = k * 0.5;
      for (const [ox, oy] of CROSS) addCell(out, add, step, cx + ox, cy + oy, MOTE[0] * h, MOTE[1] * h, MOTE[2] * h);
      const c = k * 0.2;
      for (const [ox, oy] of CORNERS) addCell(out, add, step, cx + ox, cy + oy, MOTE[0] * c, MOTE[1] * c, MOTE[2] * c);
      if (f > 0.4) {
        const o = k * 0.12;
        for (const [ox, oy] of OUTER) addCell(out, add, step, cx + ox, cy + oy, MOTE[0] * o, MOTE[1] * o, MOTE[2] * o);
      }
      // A dotted thread to the next-newer mote: the track, not just its footprints.
      if (have) {
        const dx = px - x, dy = py - y;
        const len = Math.hypot(dx, dy);
        const kk = Math.min(k, pk) * 0.5;
        for (let s = 1.5; s < len - 1; s += 1.5) {
          const t = s / len;
          add.call(out, x + dx * t + 0.5, y + dy * t + 0.5, MOTE[0] * kk, MOTE[1] * kk, MOTE[2] * kk);
        }
      }
      px = x; py = y; pk = k; have = true;
    }
  }
}

// ======================================================================== the tether

export interface TetherView {
  /** The frame the hook was thrown. */
  born: number;
  /** The age (ticks) at which the pull ended and the line began to coil, or null while it is out. */
  endAge: number | null;
  /** Where the hook sits now: fixed on rock, riding the foe it bit. */
  anchor: () => { x: number; y: number };
  /** The hook is in a foe (it glows a deeper green) and not in rock. */
  foe: boolean;
}

const ROPE_A: Rgb = [0.42, 0.45, 0.24];
const ROPE_B: Rgb = [0.22, 0.26, 0.13];
const STEEL: Rgb = [0.7, 0.76, 0.68];
const BOG_GLOW: Rgb = [0.3, 1.0, 0.5];

export function drawTether(out: PixelSurface, field: LightField, ctx: Ctx, v: TetherView): void {
  const p = ctx.player;
  if (p.dead) return;
  const T = TUNING.bogline;
  const step = out.pixelStep ?? 1;
  const put = (out.setFinePx ?? out.setPx) as Put;
  const add = (out.addFinePx ?? out.addPx) as Put;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const age = frame - v.born;
  const a = v.anchor();
  const sx = p.x, sy = p.y - (p.crawling ? 4 : 9);
  let dx = a.x - sx, dy = a.y - sy;
  const total = Math.hypot(dx, dy);
  if (total < 1) return;
  dx /= total; dy /= total;
  // She holds the line out from her hand, not from the middle of her chest.
  const hand = Math.min(5, total * 0.5);
  const hx = sx + dx * hand, hy = sy + dy * hand;
  const len = Math.max(0, total - hand);
  const reach = tetherReach(age, T.flightTicks, v.endAge, T.retractTicks);
  const tension = tetherTension(age, T.flightTicks, v.endAge, T.retractTicks);
  const L = len * reach;
  // Perpendicular, for the sag and the twang.
  const nx = -dy, ny = dx;
  const sinceBite = v.endAge === null ? age - T.flightTicks : -1;
  const twang = sinceBite >= 0 && !calm ? Math.max(0, 1 - sinceBite / 10) * 0.65 : 0;
  const sag = (1 - tension) * Math.min(7, len * 0.08);

  // ---- the crack of the line leaving her hand: a few rays and a flash, for the first ticks ----
  if (age < 5 && !calm) {
    const k = 1 - age / 5;
    for (let r = 0; r < 7; r++) {
      const ang = Math.atan2(dy, dx) + (r - 3) * 0.42;
      for (let s = 1; s <= 4; s += step) {
        add.call(out, hx + Math.cos(ang) * s, hy + Math.sin(ang) * s, BOG_GLOW[0] * k * 0.9 / s * 2, BOG_GLOW[1] * k * 0.9 / s * 2, BOG_GLOW[2] * k * 0.9 / s * 2);
      }
    }
  }

  // ---- the rope: three fine pixels wide, twisted in pairs of lighter and darker strand ----
  let tipX = hx, tipY = hy;
  const stepLen = Math.max(step, 0.5);
  for (let s = 0; s <= L; s += stepLen) {
    const t = len > 0 ? s / len : 0;
    const arch = Math.sin(Math.PI * t);
    const off = arch * sag + (twang > 0 ? Math.sin(s * 0.5 - frame * 1.1) * twang * arch : 0);
    const x = hx + dx * s + nx * off, y = hy + dy * s + ny * off;
    tipX = x; tipY = y;
    if (!inView(ctx, x, y, 4)) continue;
    const strand = ((s * 0.5) | 0) & 1;
    const c = strand ? ROPE_A : ROPE_B;
    const lt = field.sample(x, y);
    const lr = 0.5 + 0.5 * Math.min(1, lt.r), lg = 0.5 + 0.5 * Math.min(1, lt.g), lb = 0.5 + 0.5 * Math.min(1, lt.b);
    put.call(out, x + 0.5, y + 0.5, c[0] * lr + 0.04, c[1] * lg + 0.06, c[2] * lb + 0.03);
    // the lit edge above, the shaded edge below
    put.call(out, x + 0.5 + nx * step, y + 0.5 + ny * step, c[0] * lr * 1.18 + 0.05, c[1] * lg * 1.18 + 0.07, c[2] * lb * 1.18 + 0.03);
    put.call(out, x + 0.5 - nx * step, y + 0.5 - ny * step, c[0] * lr * 0.55, c[1] * lg * 0.55, c[2] * lb * 0.55);
    // A bog-green sheen so the line still reads in the dark.
    if (((s * 0.5) | 0) % 3 === 0) add.call(out, x + 0.5, y + 0.5, BOG_GLOW[0] * 0.12, BOG_GLOW[1] * 0.12, BOG_GLOW[2] * 0.12);
  }

  // ---- the hook: a shaft, a forward spike and two swept barbs, steel in the light, a green spark at the point ----
  if (reach > 0.02 && inView(ctx, tipX, tipY, 10)) {
    const fx = dx, fy = dy;
    const lt = field.sample(tipX, tipY);
    const lum = 0.55 + 0.45 * Math.min(1, (lt.r + lt.g + lt.b) / 3);
    const steel = (k: number): [number, number, number] => [STEEL[0] * lum * k, STEEL[1] * lum * k, STEEL[2] * lum * k];
    // shaft, back from the point
    for (let s = -1.5; s <= 4.5; s += stepLen) {
      const c = steel(s < 0 ? 1.2 : 1);
      put.call(out, tipX - fx * s + 0.5, tipY - fy * s + 0.5, c[0], c[1], c[2]);
      put.call(out, tipX - fx * s + 0.5 + nx * step, tipY - fy * s + 0.5 + ny * step, c[0] * 0.75, c[1] * 0.75, c[2] * 0.75);
    }
    // the barbs: swept out and back from the neck of the shaft
    for (const sign of [-1, 1]) {
      for (let s = 0; s <= 4; s += stepLen) {
        const bow = Math.sin((s / 4) * Math.PI * 0.85) * 3.2 * sign;
        const bx = tipX - fx * (1.5 + s) + nx * bow, by = tipY - fy * (1.5 + s) + ny * bow;
        const c = steel(0.85);
        put.call(out, bx + 0.5, by + 0.5, c[0], c[1], c[2]);
        put.call(out, bx + 0.5 + fx * step, by + 0.5 + fy * step, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
      }
    }
    const bite = v.endAge === null ? Math.max(0, 1 - (age - T.flightTicks) / 12) : 0;
    const glow = (calm ? 0.8 : 0.8 + 0.2 * Math.sin(frame * 0.4)) * (0.55 + 0.45 * reach) + bite * 1.0;
    const tint: Rgb = v.foe ? [0.5, 1.0, 0.35] : BOG_GLOW;
    addCell(out, add, step, Math.round(tipX), Math.round(tipY), tint[0] * 0.9 * glow, tint[1] * 0.9 * glow, tint[2] * 0.9 * glow);
    for (const [ox, oy] of CROSS) addCell(out, add, step, Math.round(tipX) + ox, Math.round(tipY) + oy, tint[0] * 0.3 * glow, tint[1] * 0.3 * glow, tint[2] * 0.3 * glow);
    for (const [ox, oy] of CORNERS) addCell(out, add, step, Math.round(tipX) + ox, Math.round(tipY) + oy, tint[0] * 0.12 * glow, tint[1] * 0.12 * glow, tint[2] * 0.12 * glow);
    // The moment it bites: a ring that leaps out of the point.
    if (bite > 0) {
      const r = 1.5 + (1 - bite) * 8;
      const n = Math.max(12, Math.round(r * 5));
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        add.call(out, tipX + Math.cos(ang) * r, tipY + Math.sin(ang) * r, tint[0] * bite * 0.9, tint[1] * bite * 0.9, tint[2] * bite * 0.9);
      }
    }
  }
}

// ======================================================================== the overlay: stun, heartbeat

export interface Ring {
  born: number;
  ticks: number;
  r0: number;
  r1: number;
  /** 1 = a full lub or the first sweep, less for the dub. */
  strength: number;
}

export interface Ping {
  e: Enemy;
  born: number;
}

export interface Stun {
  e: Enemy;
  until: number;
}

export interface OverlayView {
  rings: readonly Ring[];
  pings: readonly Ping[];
  /** Foes Bloodsense is showing right now: each is warmed from within, through whatever stands between. */
  sensed: readonly Enemy[];
  /** Foes the line has dazed. */
  stuns: readonly Stun[];
}

const RING: Rgb = [0.22, 0.95, 0.46];

export function drawOverlay(out: PixelSurface, _field: LightField, ctx: Ctx, v: OverlayView): void {
  const p = ctx.player;
  const step = out.pixelStep ?? 1;
  const add = (out.addFinePx ?? out.addPx) as Put;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const defs = ctx.enemyCtl.defs;
  const camX = ctx.camera.x, camY = ctx.camera.y;

  // ---- the body, warmed from within: a soft green silhouette that beats with the ring ----
  const pingTicks = TUNING.bloodsense.pingTicks;
  for (const e of v.sensed) {
    const def = defs[e.kind];
    if (!def) continue;
    const ex = e.x, ey = e.y - def.h * 0.5;
    if (!inView(ctx, ex, ey, 30)) continue;
    let beat = calm ? 0.8 : 0.78 + 0.22 * Math.sin(frame * 0.1 + e.bobPhase * 6);
    for (const pg of v.pings) {
      if (pg.e !== e) continue;
      const t = (frame - pg.born) / pingTicks;
      if (t >= 0 && t < 1) beat += (1 - t) * 0.9;
    }
    const rx = def.halfW + 1.5, ry = def.h * 0.5 + 1.5;
    for (let fy = -ry; fy <= ry; fy += step) {
      for (let fx = -rx; fx <= rx; fx += step) {
        const q = (fx * fx) / (rx * rx) + (fy * fy) / (ry * ry);
        if (q > 1) continue;
        // brighter at the heart of the body, a clear rim at its edge
        const k = (0.12 + 0.3 * (1 - q) + (q > 0.7 ? 0.14 : 0)) * beat;
        add.call(out, ex + fx, ey + fy, RING[0] * k, RING[1] * k, RING[2] * k);
      }
    }
  }

  // ---- the rings out from her chest ----
  if (!p.dead) {
    const cx = p.x, cy = p.y - 9;
    for (const ring of v.rings) {
      const age = frame - ring.born;
      if (age < 0 || age > ring.ticks) continue;
      const r = ringRadius(age, ring.ticks, ring.r0, ring.r1);
      const a = ringAlpha(age, ring.ticks) * ring.strength;
      if (a <= 0.01) continue;
      // Spacing of the points along the circle: about one fine pixel.
      const n = Math.max(24, Math.ceil((Math.PI * 2 * r) / (step * 0.9)));
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
        if (x < camX - 2 || x > camX + VIEW_W + 2 || y < camY - 2 || y > camY + VIEW_H + 2) continue;
        // The ring breaks into a slow ripple of arcs: attention, not a hoop.
        const gate = 0.6 + 0.4 * Math.cos(ang * 6 + age * 0.12);
        const k = a * gate * 0.85;
        add.call(out, x, y, RING[0] * k, RING[1] * k, RING[2] * k);
        // The ring is three fine pixels deep: a bright edge with a softer body inside.
        const ix = cx + Math.cos(ang) * (r - step), iy = cy + Math.sin(ang) * (r - step);
        add.call(out, ix, iy, RING[0] * k * 0.55, RING[1] * k * 0.55, RING[2] * k * 0.55);
        const ox = cx + Math.cos(ang) * (r + step), oy = cy + Math.sin(ang) * (r + step);
        add.call(out, ox, oy, RING[0] * k * 0.35, RING[1] * k * 0.35, RING[2] * k * 0.35);
      }
    }
  }

  // ---- the flare on a wounded foe the ring has just swept past ----
  for (const pg of v.pings) {
    const age = frame - pg.born;
    if (age < 0 || age > pingTicks) continue;
    const def = defs[pg.e.kind];
    if (!def) continue;
    const t = age / pingTicks;
    const k = Math.pow(1 - t, 1.4) * (calm ? 0.6 : 1);
    const ex = pg.e.x, ey = pg.e.y - def.h * 0.5;
    if (!inView(ctx, ex, ey, 40)) continue;
    const rx = def.halfW + 3 + t * 10, ry = def.h * 0.5 + 3 + t * 10;
    const n = Math.max(28, Math.round((rx + ry) * 3));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      add.call(out, ex + Math.cos(ang) * rx, ey + Math.sin(ang) * ry, RING[0] * k * 0.95, RING[1] * k * 0.95, RING[2] * k * 0.95);
    }
  }

  // ---- a dazed foe: three motes circling over its head ----
  for (const s of v.stuns) {
    const e = s.e;
    const def = defs[e.kind];
    if (!def || frame >= s.until) continue;
    const hx = e.x, hy = e.y - def.h - 3;
    if (!inView(ctx, hx, hy, 12)) continue;
    const left = s.until - frame;
    const fade = Math.min(1, left / 8);
    for (let i = 0; i < 3; i++) {
      const ang = frame * 0.18 + (i / 3) * Math.PI * 2;
      const x = hx + Math.cos(ang) * (def.halfW * 0.7 + 2), y = hy + Math.sin(ang) * 1.8;
      const k = fade * (0.7 + 0.3 * Math.sin(ang));
      addCell(out, add, step, Math.round(x), Math.round(y), RING[0] * k * 1.1, RING[1] * k * 1.1, RING[2] * k * 1.1);
      const h = k * 0.3;
      for (const [ox, oy] of CROSS) addCell(out, add, step, Math.round(x) + ox, Math.round(y) + oy, RING[0] * h, RING[1] * h, RING[2] * h);
    }
  }
}
