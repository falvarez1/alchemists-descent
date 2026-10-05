import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { BRASS, BRASS_D, BRASS_L, INK, IRON, IRON_D, Pen, cameraView } from '@/render/sprites/FineArt';
import type { RGB } from '@/render/sprites/FineArt';
import { TUNING, plateDir } from '@/fighters/kits/brann-rook-logic';
import { drawDuelEffect } from '@/render/duel/DuelFighterSprites';

/**
 * Brann's plate and the heat of her vessel, drawn (presentation only: the plate's geometry that blocks
 * is `segmentSectorEntry`, the same arc, in brann-rook-logic.ts). A black-iron curved plate with brass
 * edging, a brass boss and rivets, standing 14 cells out from the chest and facing the aim side.
 *
 *  - it swings up over `raiseTicks` (the arc opens and settles out to its reach);
 *  - a blow flares the arc where it landed and shoves the plate in a cell or two;
 *  - the brass edging heats toward orange with the vessel's Pressure, and blinks red-hot in its last moments.
 */

export interface PlateView {
  up: boolean;
  /** 0..1 swing-up progress. */
  raise: number;
  /** 0..1 clang flash, and where on the arc it landed (an absolute angle from the chest). */
  flash: number;
  flashAngle: number;
  /** Cells the plate was shoved in by the last blow; eases back out. */
  recoil: number;
  /** In its last moments: the edging blinks. */
  warn: boolean;
  /** 0..1 Pressure, for the brass's heat. */
  heat: number;
}

export function newPlateView(): PlateView {
  return { up: false, raise: 0, flash: 0, flashAngle: 0, recoil: 0, warn: false, heat: 0 };
}

const HOT: RGB = [1, 0.4, 0.12];
const FLASH: RGB = [1, 0.92, 0.7];
const IRON_L: RGB = [0.52, 0.52, 0.56];
const DIAL: RGB = [0.62, 0.58, 0.46];
const NEEDLE: RGB = [0.82, 0.1, 0.06];
const THICK = 5;

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** A cheap deterministic grain so the hammered iron is not a flat colour. */
const grain = (i: number, j: number): number => (((i * 73856093) ^ (j * 19349663)) & 7) / 7;

export function drawPlate(out: PixelSurface, field: LightField, ctx: Ctx, v: PlateView): void {
  if (!v.up) return;
  const player = ctx.player;
  if (player.dead) return;
  const g = TUNING.guard;
  const cx = player.x, cy = player.y - (player.crawling ? 4 : 9);
  const dir = plateDir(player.aimAngle);
  const a0 = Math.atan2(dir.y, dir.x);
  // The swing-up: the arc opens from a narrow plate to its full span while it settles out to its reach.
  const e = 1 - (1 - Math.min(1, v.raise)) ** 3;
  const span = g.halfArc * (0.3 + 0.7 * e);
  const r1 = Math.max(5, g.reach * (0.6 + 0.4 * e) - v.recoil);
  const r0 = r1 - THICK;
  if (drawDuelEffect(out, ctx, 'guard_plate', Math.min(15, v.raise * 15),
    cx + dir.x * r1, cy + dir.y * r1, dir.x < 0, v.warn ? .8 : 1, Math.atan2(dir.y, dir.x < 0 ? -dir.x : dir.x))) return;
  const sample = field.sample(cx + dir.x * g.reach, cy + dir.y * g.reach);
  // Held in her lantern's light, but never lost in the dark: the plate is the one thing she is behind
  // (and never brighter than the sprite itself: a bright lantern close by would push the brass and the dial into the bloom)
  const lit = (k: number): number => Math.min(1.08, Math.max(0.7, k));
  const pen = new Pen(out, cameraView(ctx.camera, 24), [lit(sample.r), lit(sample.g), lit(sample.b)]);
  const reach = g.reach + 4;
  if (!pen.inView(cx - reach, cy - reach, cx + reach, cy + reach)) return;
  const s = pen.step;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  // The brass heats with the vessel; in its last moments it blinks red-hot (steady when flashes are reduced).
  const blink = v.warn && !calm && ((frame >> 2) & 1) === 1;
  const heat = Math.max(v.heat, blink ? 1 : 0);
  // (Held a little under full brightness: the bloom turns a lit brass edge into a glowing outline.)
  const brass = mix(scale(BRASS, 0.8), HOT, heat);
  const brassLit = mix(scale(BRASS_L, 0.78), HOT, heat * 0.6);
  const brassDark = mix(scale(BRASS_D, 0.85), HOT, heat * 0.5);

  const n = Math.max(8, Math.ceil((2 * span * r1) / s));
  const nr = Math.max(2, Math.round(THICK / s));
  const band = (i: number): boolean => Math.abs(i - n * 0.22) <= 1.2 / s * 0.5 || Math.abs(i - n * 0.78) <= 1.2 / s * 0.5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const th = a0 - span + 2 * span * t;
    const ct = Math.cos(th), st = Math.sin(th);
    // The lamp is upper-left: the face brightens where its normal points that way.
    const shade = 0.8 + 0.3 * (-0.6 * ct - 0.8 * st);
    const cap = i <= 2 / s * 0.5 || i >= n - 2 / s * 0.5;
    const strap = band(i);
    for (let j = 0; j <= nr; j++) {
      const r = r0 + (THICK * j) / nr;
      const x = cx + ct * r, y = cy + st * r;
      const k = j / nr; // 0 inner .. 1 outer
      if (j === nr) pen.px(x, y, brass, 0.95 + 0.2 * shade);
      else if (j === 0) pen.px(x, y, brassDark, 0.95);
      else if (cap) pen.px(x, y, brass, 0.85 + 0.2 * shade);
      else if (strap) pen.px(x, y, brassDark, 0.9 + 0.2 * shade);
      // the outer face carries a pale bevel just under the brass; the face darkens toward the inside, like a rolled plate
      else if (j === nr - 1) pen.px(x, y, IRON_L, shade);
      else pen.px(x, y, k > 0.45 ? IRON : IRON_D, shade * (0.9 + 0.2 * grain(i, j)));
    }
    // A thin ink line outside the outer edge keeps the plate legible against bright steam and fire.
    pen.px(cx + ct * (r1 + s), cy + st * (r1 + s), INK);
    pen.px(cx + ct * (r0 - s), cy + st * (r0 - s), INK, 0.85);
  }
  // Rivets on the straps and the clasps at each end.
  const mid = r1 - THICK * 0.5;
  for (const t of [0.22, 0.78]) {
    const th = a0 - span + 2 * span * t;
    for (const dr of [-1.4, 1.4]) pen.rivet(cx + Math.cos(th) * (mid + dr), cy + Math.sin(th) * (mid + dr), brassLit);
  }
  for (const t of [0.045, 0.955]) {
    const th = a0 - span + 2 * span * t;
    pen.rivet(cx + Math.cos(th) * mid, cy + Math.sin(th) * mid, brassLit);
  }
  // The gauge at the middle of the arc: a brass-ringed dial whose needle climbs with the vessel's Pressure.
  // (Off the middle: the wand's own tip glows there, on the aim.)
  const gt = a0 - span + 2 * span * 0.36;
  const bx = cx + Math.cos(gt) * mid, by = cy + Math.sin(gt) * mid;
  pen.disc(bx, by, 3.2, brassDark, INK, s, true);
  pen.disc(bx, by, 2.5, DIAL, brass, s * 1.5, true);
  const hot = Math.max(v.heat, 0);
  const na = -Math.PI * (0.9 - 0.8 * Math.min(1, hot));
  for (const tick of [-0.9, -0.5, -0.1]) pen.px(bx + Math.cos(tick * Math.PI) * 1.9, by + Math.sin(tick * Math.PI) * 1.9, INK, 0.7);
  pen.line(bx, by, bx + Math.cos(na) * 2.2, by + Math.sin(na) * 2.2, NEEDLE, 0);
  pen.px(bx, by, INK);
  // A hot edge gives off light of its own.
  if (heat > 0.25) {
    const k = (heat - 0.15) * 0.5;
    for (let i = 0; i <= n; i += 2) {
      const th = a0 - span + (2 * span * i) / n;
      pen.glow(cx + Math.cos(th) * r1, cy + Math.sin(th) * r1, HOT, k);
    }
  }
  // The clang: a white-gold flare where the blow landed.
  if (v.flash > 0.02) {
    const fx = cx + Math.cos(v.flashAngle) * r1, fy = cy + Math.sin(v.flashAngle) * r1;
    const rad = 1 + 2.6 * v.flash;
    for (let dy = -rad; dy <= rad; dy += s) {
      for (let dx = -rad; dx <= rad; dx += s) {
        const d = Math.hypot(dx, dy) / rad;
        if (d > 1) continue;
        pen.glow(fx + dx, fy + dy, FLASH, (1 - d) * v.flash * 1.1);
      }
    }
    pen.raw(fx, fy, FLASH, 1.2);
  }
}

/** The glow of a Redline: a red heat rim hugging the body, pulsing. Additive, so it lights what is behind it. */
export function drawRedlineAura(out: PixelSurface, _field: LightField, ctx: Ctx, strength: number): void {
  const player = ctx.player;
  if (player.dead || strength <= 0) return;
  const px = out.addFinePx ?? out.addPx;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const cx = player.x, cy = player.y - (player.crawling ? 5 : 9);
  if (drawDuelEffect(out, ctx, 'redline_aura', calm ? 18 : 12 + frame % 12, cx, cy, false, strength * .65)) return;
  const rx = 7, ry = player.crawling ? 6 : 11.5;
  const pulse = calm ? 0.8 : 0.72 + 0.28 * Math.sin(frame * 0.22);
  // A soft red wash over everything within 22 cells, added on top of the finished frame: it tints the lit stone and the
  // sprite alike (a red LIGHT cannot, since lights combine by their brightest channel and her lantern is already bright).
  const R = 22;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy * 1.15) / R;
      if (d >= 1) continue;
      const k = strength * pulse * (1 - d) * (1 - d) * 0.32;
      out.addPx(cx + dx, cy + dy, k, k * 0.2, k * 0.045);
    }
  }
  const n = 60;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Heat licks upward: the ring is brighter over the shoulders than at the boots.
    const up = 0.55 + 0.45 * Math.max(0, -Math.sin(a));
    const lick = 0.8 + 0.2 * Math.sin(a * 5 + frame * 0.3);
    const k = strength * pulse * up * lick * 0.7;
    px.call(out, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 1.0 * k, 0.28 * k, 0.07 * k);
    px.call(out, cx + Math.cos(a) * (rx + 1), cy + Math.sin(a) * (ry + 1), 0.6 * k, 0.12 * k, 0.03 * k);
  }
}
