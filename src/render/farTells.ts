import type { Ctx } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';

/**
 * FAR-FIELD TELLS (levels review #3, #14). Two small objects that matter a great
 * deal and read as almost nothing from afar: the exit portal (a 12-px violet mote)
 * and the golden key (four pixels of gold). These draw what lets the eye find them
 * across a cavern, all as additive light that stops at rock (a column rises through
 * open air only; a flare is a flare of the key's own light). Pure pixel work on the
 * composer's additive layer: no state, no DOM, nothing the grid does not explain.
 */

/** The composer's additive pixel layer (FrameComposer.addPx). */
export interface PixelSink {
  addPx(x: number, y: number, r: number, g: number, b: number): void;
}

/** Height of the woken portal's light column, in cells. */
export const PORTAL_COLUMN_H = 64;
/** Ticks the wake-up flourish (the expanding ring, the rising column) lasts after the key is taken. */
export const PORTAL_WAKE_TICKS = 70;
/** The sealed gate keeps a short, dim shaft so it reads as a structure. */
const SEALED_COLUMN_H = 18;

function openAt(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  return x >= 0 && y >= 0 && x < w.width && y < w.height && !blocksEntity(w.types[x + y * w.width]);
}

/**
 * Ticks since the key was taken, for the portal's wake-up: Infinity when the gate
 * is still sealed or the moment was not recorded (a resumed floor shows the gate
 * already awake, without the flourish).
 */
export function portalWakeAge(keyTaken: boolean, keyTakenFrame: number | undefined, frame: number): number {
  return keyTaken && keyTakenFrame !== undefined ? Math.max(0, frame - keyTakenFrame) : Number.POSITIVE_INFINITY;
}

/**
 * The exit gate's column of light and, once the key is taken, its outer ring and
 * the ring that goes out over the cave when it wakes. `woke` is the level's
 * keyTaken; `since` the ticks since (Infinity: long ago).
 */
export function drawPortalTell(
  sink: PixelSink,
  ctx: Ctx,
  portal: { x: number; y: number },
  frame: number,
  woke: boolean,
  since: number,
): void {
  const cy = portal.y - 4;
  // The column: a slow shaft that rises from the gate through open air and stops at rock.
  const full = woke ? PORTAL_COLUMN_H : SEALED_COLUMN_H;
  const grown = woke ? Math.min(full, 6 + since * 1.6) : full;
  const strength = woke ? 0.95 : 0.22;
  for (let k = 4; k < grown; k++) {
    const yy = Math.round(portal.y - 6 - k);
    const cx = Math.round(portal.x + Math.sin(k * 0.17 - frame * 0.055) * (0.5 + k * 0.03));
    if (yy < 1 || !openAt(ctx, cx, yy)) break;
    const f = Math.pow(1 - k / full, 1.4) * strength * (0.75 + 0.25 * Math.sin(frame * 0.09 - k * 0.3));
    sink.addPx(cx, yy, 0.55 * f, 0.18 * f, 0.95 * f);
    if (woke && openAt(ctx, cx - 1, yy)) sink.addPx(cx - 1, yy, 0.2 * f, 0.06 * f, 0.36 * f);
    if (woke && openAt(ctx, cx + 1, yy)) sink.addPx(cx + 1, yy, 0.2 * f, 0.06 * f, 0.36 * f);
  }
  if (!woke) return;

  // A core of light at the gate's heart, so the woken gate reads as a lamp and not a ring of dots.
  const heart = 0.75 + Math.sin(frame * 0.1) * 0.25;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > 2.3 || !openAt(ctx, portal.x + dx, cy + dy)) continue;
      const f = heart * (1 - d / 2.8);
      sink.addPx(portal.x + dx, cy + dy, 0.7 * f, 0.25 * f, 1.2 * f);
    }
  }

  // A second ring, turning the other way, beyond the gate's own.
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 - frame * 0.03;
    const px = Math.round(portal.x + Math.cos(a) * 13.5);
    const py = Math.round(cy + Math.sin(a) * 12);
    if (!openAt(ctx, px, py)) continue;
    const tw = 0.55 + Math.sin(frame * 0.17 + k * 1.3) * 0.35;
    sink.addPx(px, py, 0.45 * tw, 0.15 * tw, 0.85 * tw);
  }

  // The wake-up: one ring goes out over the cave (through open air, never rock).
  if (since < PORTAL_WAKE_TICKS) {
    const r = 4 + since * 0.85;
    const f = Math.pow(1 - since / PORTAL_WAKE_TICKS, 2);
    const n = Math.round(14 + r * 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = Math.round(portal.x + Math.cos(a) * r);
      const py = Math.round(cy + Math.sin(a) * r * 0.85);
      if (!openAt(ctx, px, py)) continue;
      sink.addPx(px, py, 1.1 * f, 0.4 * f, 2.0 * f);
    }
  }
}

/**
 * The golden key's glint: a cross of gold light on the key's own clock (game/keyLure),
 * longer when the key is far (the eye needs more to find it) and shorter close up.
 * `flare` is lureGlint(): 0..1.
 */
export function drawKeyFlare(sink: PixelSink, x: number, y: number, flare: number, distance: number): void {
  if (flare <= 0) return;
  const arm = 3 + Math.round(flare * (distance > 70 ? 11 : 6));
  // A small hot core with a halo round it, so it reads as a point of light and not a stray pixel.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const core = dx === 0 && dy === 0 ? 1.6 : dx === 0 || dy === 0 ? 0.9 : 0.45;
      sink.addPx(x + dx, y + dy, 1.2 * core * flare, 1.0 * core * flare, 0.5 * core * flare);
    }
  }
  for (let k = 2; k <= arm; k++) {
    const f = flare * Math.pow(1 - (k - 1) / arm, 0.75);
    const r = 1.5 * f;
    const g = 1.25 * f;
    const b = 0.55 * f;
    sink.addPx(x + k, y, r, g, b);
    sink.addPx(x - k, y, r, g, b);
    sink.addPx(x, y + k, r * 0.85, g * 0.85, b * 0.85);
    sink.addPx(x, y - k, r * 0.85, g * 0.85, b * 0.85);
    if (k <= Math.ceil(arm / 2)) {
      const d = 0.8 * f;
      sink.addPx(x + k, y + k, d, d * 0.85, d * 0.4);
      sink.addPx(x - k, y - k, d, d * 0.85, d * 0.4);
      sink.addPx(x + k, y - k, d, d * 0.85, d * 0.4);
      sink.addPx(x - k, y + k, d, d * 0.85, d * 0.4);
    }
  }
}

/**
 * A set piece's lamp as the eye sees it from afar: a small point of the lamp's own
 * colour with a four-point halo, breathing slowly. The light it casts is in the
 * light field (render/setPieceTells via Lighting); this is the lamp itself, so the
 * piece shows even where its light is swallowed by the rock round it.
 */
export function drawLampGlint(
  sink: PixelSink,
  x: number,
  y: number,
  color: { r: number; g: number; b: number },
  phase: number,
  frame: number,
): void {
  const { r, g, b } = color;
  const breathe = 0.7 + 0.3 * Math.sin(frame * 0.045 + phase);
  sink.addPx(x, y, 1.3 * r * breathe, 1.3 * g * breathe, 1.3 * b * breathe);
  const h = 0.55 * breathe;
  sink.addPx(x - 1, y, h * r, h * g, h * b);
  sink.addPx(x + 1, y, h * r, h * g, h * b);
  sink.addPx(x, y - 1, h * r, h * g, h * b);
  sink.addPx(x, y + 1, h * r, h * g, h * b);
  const far = 0.25 * breathe;
  sink.addPx(x - 2, y, far * r, far * g, far * b);
  sink.addPx(x + 2, y, far * r, far * g, far * b);
  sink.addPx(x, y - 2, far * r, far * g, far * b);
  sink.addPx(x, y + 2, far * r, far * g, far * b);
}
