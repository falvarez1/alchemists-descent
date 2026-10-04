import type { PixelSurface } from '@/render/pixels';

/**
 * The concept sheets' combat marks (core-attacks.png, fighters-actions.png): a crescent with a hot ivory edge melting
 * into the fighter's colour and tapering at both tips, a four-point contact star, and a few spark pixels. Drawn at
 * presentation resolution where the surface has it; always local to the blow, never a screen flash.
 */
export type RGB = readonly [number, number, number];
const IVORY: RGB = [1, .95, .78];

function plot(out: PixelSurface, x: number, y: number, c: RGB, a: number, glow: number): void {
  if (a <= 0.01) return;
  if (out.blendFinePx) out.blendFinePx(x, y, c[0] * a, c[1] * a, c[2] * a, a);
  else out.addPx(x, y, c[0] * a, c[1] * a, c[2] * a);
  if (glow > 0 && out.addFinePx) out.addFinePx(x, y, c[0] * glow, c[1] * glow, c[2] * glow);
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * A crescent swept around (cx, cy): `from`..`to` are angles (radians, screen space, y down) of the outer edge, which
 * sits at radii rx/ry; the inner edge is the outer ellipse pulled back by `thick` along the sweep's facing so the band is
 * thickest at the middle of the sweep and vanishes at both tips. `fade` scales the whole mark.
 */
export function crescent(out: PixelSurface, cx: number, cy: number, rx: number, ry: number, from: number, to: number,
  thick: number, color: RGB, fade: number, quiet: boolean): void {
  if (fade <= 0) return;
  const step = out.setFinePx ? (out.pixelStep ?? 1) : 1, mid = (from + to) / 2;
  const nx = Math.cos(mid), ny = Math.sin(mid);
  const x0 = cx - rx - 1, x1 = cx + rx + 1, y0 = cy - ry - 1, y1 = cy + ry + 1;
  const peak = quiet ? .45 : .95;
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    const dx = x - cx, dy = y - cy;
    const outer = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (outer > 1) continue;
    // The angle of this pixel along the sweep, as 0..1.
    let ang = Math.atan2(dy / ry, dx / rx);
    let t = (ang - from) / (to - from);
    if (t < 0 || t > 1) { ang += Math.PI * 2 * (t < 0 ? 1 : -1); t = (ang - from) / (to - from); }
    if (t < 0 || t > 1) continue;
    const taper = Math.sin(t * Math.PI);
    // Inner edge: the same ellipse shifted back along the sweep's facing, by the band width at this point.
    const back = thick * taper;
    const ix = dx + nx * back, iy = dy + ny * back;
    if ((ix * ix) / (rx * rx) + (iy * iy) / (ry * ry) < 1) continue;
    // 0 at the outer rim, 1 at the inner edge: hot ivory rim, fighter colour inside.
    const depth = Math.min(1, (1 - Math.sqrt(outer)) * Math.max(rx, ry) / Math.max(.5, back));
    const c = mix(IVORY, color, Math.min(1, depth * 1.4));
    plot(out, x, y, c, fade * peak * (.35 + .65 * taper) * (1 - depth * .45), quiet ? 0 : fade * taper * .18);
  }
}

/** A contact star: four long rays and four short diagonals around an ivory core. */
export function star(out: PixelSurface, x: number, y: number, size: number, color: RGB, fade: number, quiet: boolean): void {
  if (fade <= 0) return;
  const step = out.setFinePx ? (out.pixelStep ?? 1) : 1, peak = quiet ? .5 : 1;
  for (const [dx, dy, len] of [[1, 0, 1], [-1, 0, 1], [0, 1, .8], [0, -1, .8], [.7, .7, .45], [-.7, .7, .45], [.7, -.7, .45], [-.7, -.7, .45]] as const) {
    const reach = size * len;
    for (let r = 0; r <= reach; r += step) {
      const k = r / reach, c = mix(IVORY, color, k);
      plot(out, x + dx * r, y + dy * r, c, fade * peak * (1 - k * .8), quiet ? 0 : fade * (1 - k) * .35);
    }
  }
}

/** A few spark pixels flung along a direction (deterministic per seed, so a blow's sparks do not flicker). */
export function sparks(out: PixelSurface, x: number, y: number, dirX: number, dirY: number, count: number, spread: number,
  color: RGB, fade: number, seed: number): void {
  for (let i = 0; i < count; i++) {
    const h = Math.sin((seed + i * 12.9898) * 78.233) * 43758.5453, r = h - Math.floor(h);
    const h2 = Math.sin((seed + i * 4.1414) * 39.346) * 12543.237, r2 = h2 - Math.floor(h2);
    const d = 4 + r * spread, side = (r2 - .5) * spread * .6;
    plot(out, x + dirX * d - dirY * side, y + dirY * d + dirX * side, r2 > .5 ? IVORY : color, fade * (1 - r * .6), fade * .3);
  }
}
