import type { Critter, Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { GLOW_THREADS, glowThreadX } from '@/game/organisms/glowworm';
import { pufferSac } from '@/game/organisms/puffer';
import { snapjawHead } from '@/game/organisms/snapjaw';
import { CRAWL, GLOW, LEECH, PUFF, SNAP } from '@/game/organisms/types';
import { playerGap } from '@/game/organisms/common';

/**
 * Organism art (WS-N). Tiny bodies drawn at the overlay's fine resolution and
 * lit by the real light field — so in a dark cave a snapjaw is a silhouette
 * with a coal-red throat, a glow-worm is only its beaded thread, and an ember
 * beetle is a moving spark — while their own light (beads, throats, bellies)
 * is additive and always shows.
 */

type RGB = readonly [number, number, number];

const STEP = 0.5;
let L = { r: 1, g: 1, b: 1 };

function lightAt(light: LightField, x: number, y: number): void {
  if (typeof light?.sample !== 'function') { L = { r: 1, g: 1, b: 1 }; return; }
  const s = light.sample(x, y);
  L = { r: Math.max(0.1, Math.min(1.5, s.r)), g: Math.max(0.1, Math.min(1.5, s.g)), b: Math.max(0.12, Math.min(1.5, s.b)) };
}

function px(s: PixelSurface, x: number, y: number, c: RGB, k = 1): void {
  const r = c[0] * L.r * k, g = c[1] * L.g * k, b = c[2] * L.b * k;
  if (s.setFinePx) s.setFinePx(x, y, r, g, b); else s.setPx(x, y, r, g, b);
}

function glow(s: PixelSurface, x: number, y: number, c: RGB, k = 1): void {
  if (k <= 0) return;
  if (s.addFinePx) s.addFinePx(x, y, c[0] * k, c[1] * k, c[2] * k); else s.addPx(x, y, c[0] * k, c[1] * k, c[2] * k);
}

function veil(s: PixelSurface, x: number, y: number, c: RGB, a: number): void {
  const r = c[0] * L.r * a, g = c[1] * L.g * a, b = c[2] * L.b * a;
  if (s.blendFinePx) s.blendFinePx(x, y, r, g, b, a); else if (a > 0.5) px(s, x, y, c);
}

function line(s: PixelSurface, ax: number, ay: number, bx: number, by: number, c: RGB, k = 1): void {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
  for (let i = 0; i <= n; i++) px(s, ax + (bx - ax) * i / n, ay + (by - ay) * i / n, c, k);
}

/**
 * Filled, top-lit ellipse (axes a along angle th, b across). `shade(u, v)` may
 * return a colour per point (u, v in -1..1) for markings; default is a soft
 * volume ramp from `lo` to `hi`.
 */
function blob(
  s: PixelSurface, cx: number, cy: number, a: number, b: number, th: number, lo: RGB, hi: RGB,
  mark?: (u: number, v: number) => RGB | null,
): void {
  const ca = Math.cos(th), sa = Math.sin(th), R = Math.max(a, b) + STEP;
  for (let y = -R; y <= R; y += STEP) {
    for (let x = -R; x <= R; x += STEP) {
      const u = (x * ca + y * sa) / a, v = (-x * sa + y * ca) / b;
      const d = u * u + v * v;
      if (d > 1) continue;
      const m = mark?.(u, v);
      if (m) { px(s, cx + x, cy + y, m); continue; }
      // Light from above-left: brighter toward the top, a dark rim at the edge.
      const t = Math.max(0, Math.min(1, 0.55 - y / (R * 1.6) - x / (R * 4) - d * 0.35));
      px(s, cx + x, cy + y, [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t]);
    }
  }
}

const hash = (x: number, y: number): number => {
  let h = Math.imul(Math.round(x * 2) * 73856093 ^ Math.round(y * 2) * 19349663, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

/* ---------------------------------------------------------------- glow-worm */

function drawGlowworm(s: PixelSurface, light: LightField, ctx: Ctx, c: Critter): void {
  const ax = (c.anchorX ?? c.x) + 0.5, ay = (c.anchorY ?? c.y);
  const ext = c.extent ?? 0, t = ctx.state.frameCount;
  const fed = Math.min(1, (c.meal ?? 0) / 300);
  const hiding = c.state === GLOW.RETRACT;
  lightAt(light, ax, ay + 1);
  // The curtain: pale, barely-there threads beaded with droplets of light.
  const beadK = hiding ? 0.25 : 1;
  for (let k = 0; k < GLOW_THREADS.length; k++) {
    const len = ext * GLOW_THREADS[k][1];
    for (let d = 0.5; d <= len; d += STEP) {
      const y = ay + 0.5 + d, x = glowThreadX(c, y, k);
      veil(s, x, y, [0.72, 0.82, 0.8], 0.24);
      const bead = (d * 2 + (c.anchorX ?? 0) + k * 3) % 5 < 1;
      if (bead) {
        const tw = 0.65 + Math.sin(t * 0.05 + d * 1.7 + c.phase + k) * 0.35;
        px(s, x, y, [0.7, 1, 0.95], 0.6);
        glow(s, x, y, [0.22, 0.85, 0.78], tw * beadK);
        glow(s, x, y + STEP, [0.06, 0.3, 0.28], tw * beadK);
      }
    }
    if (len > 1) {
      const y = ay + 0.5 + len, x = glowThreadX(c, y, k);
      px(s, x, y, [0.8, 1, 0.96], 0.8);
      glow(s, x, y, [0.35, 1.1, 1], 0.9 * beadK);
      glow(s, x, y + STEP, [0.12, 0.4, 0.38], 0.9 * beadK);
      glow(s, x - STEP, y, [0.05, 0.2, 0.19], 0.8 * beadK);
      glow(s, x + STEP, y, [0.05, 0.2, 0.19], 0.8 * beadK);
    }
  }
  // The worm: a pale grub pressed to the rock, its tail lamp glowing.
  blob(s, ax, ay + 0.8, 1.7, 0.7, Math.sin(c.phase * 0.5) * 0.15, [0.36, 0.4, 0.34], [0.78, 0.84, 0.74]);
  const tail = 0.55 + fed * 0.9 + Math.sin(t * 0.04 + c.phase) * 0.15;
  glow(s, ax + 1.2, ay + 0.9, [0.2, 0.75, 0.68], tail * (hiding ? 0.5 : 1));
  glow(s, ax + 1.7, ay + 0.9, [0.08, 0.35, 0.3], tail);
}

/* ---------------------------------------------------------------- puffer */

function drawPuffer(s: PixelSurface, light: LightField, ctx: Ctx, c: Critter): void {
  const ax = (c.anchorX ?? c.x) + 0.5, ay = (c.anchorY ?? c.y) + 0.5, nx = c.nx ?? 0, ny = c.ny ?? -1;
  const inf = c.extent ?? 0, t = ctx.state.frameCount;
  const sac = pufferSac(c);
  lightAt(light, sac.x, sac.y);
  // A body close by: the ripe sac trembles on its stalk (the tell before it pops).
  const near = inf > 0.4 && playerGap(ctx, sac.x, sac.y) < sac.r + 7;
  const jx = near ? Math.sin(t * 1.9) * 0.25 : 0;
  // Stalk.
  line(s, ax - nx * 0.4, ay - ny * 0.4, sac.x - nx * sac.r * 0.7 + jx, sac.y - ny * sac.r * 0.7, [0.26, 0.24, 0.14]);
  if (c.state === PUFF.SPENT && inf < 0.12) {
    // Spent: a wrinkled, sagging flap.
    blob(s, sac.x + jx, sac.y + 0.4, 1.4, 0.55, 0.2, [0.2, 0.18, 0.1], [0.36, 0.33, 0.2]);
    return;
  }
  const breathe = 1 + Math.sin(c.phase * 1.3) * 0.035 * (0.3 + inf);
  // The sac hangs along its normal: u runs root→crown, v across it.
  const along = Math.atan2(ny, nx);
  const a = sac.r * breathe * 1.08, b = sac.r * breathe * 0.92;
  const cx = sac.x + jx, cy = sac.y;
  const ca = Math.cos(along), sa = Math.sin(along), R = a + STEP;
  const seed = (c.anchorX ?? 0) * 0.37 + (c.anchorY ?? 0) * 0.11;
  for (let y = -R; y <= R; y += STEP) {
    for (let x = -R; x <= R; x += STEP) {
      const u = (x * ca + y * sa) / a, v = (-x * sa + y * ca) / b;
      const d = u * u + v * v;
      if (d > 1) continue;
      // Meridian veins converge on the crown pore; pale warts dot the skin.
      const ang = Math.atan2(v, u + 1.05);
      const vein = Math.abs(Math.sin(ang * 5 + seed)) < 0.12 && u > -0.6;
      const wart = hash(u * 3 + seed, v * 3) > 0.93;
      const lit = Math.max(0, Math.min(1, 0.6 - y / (R * 1.5) - x / (R * 5) - d * 0.3));
      let col: RGB = [0.28 + lit * 0.42, 0.27 + lit * 0.4, 0.1 + lit * 0.2];
      if (vein) col = [col[0] * 0.62, col[1] * 0.6, col[2] * 0.55];
      if (wart) col = [0.84, 0.8, 0.58];
      if (u > 0.82 && Math.abs(v) < 0.35) col = u > 0.9 ? [0.86, 0.84, 0.62] : [0.2, 0.18, 0.08]; // the crown pore
      // The thin membrane at the rim lets the dark show through.
      if (d > 0.78) veil(s, cx + x, cy + y, col, 0.7); else px(s, cx + x, cy + y, col);
    }
  }
  if (inf > 0.4) {
    // Ripe: bioluminescent freckles pulse, faster when something is near.
    const pulse = 0.55 + Math.sin(t * (near ? 0.3 : 0.05) + c.phase) * 0.45;
    for (let k = 0; k < 7; k++) {
      const ang = k * 2.39996 + seed, rr = sac.r * (0.3 + (k % 3) * 0.2);
      glow(s, cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr * 0.85, [0.16, 0.42, 0.12], (inf - 0.25) * pulse);
    }
  }
}

/* ---------------------------------------------------------------- snapjaw */

function drawSnapjaw(s: PixelSurface, light: LightField, ctx: Ctx, c: Critter): void {
  const ax = (c.anchorX ?? c.x) + 0.5, ay = (c.anchorY ?? c.y) + 0.5, nx = c.nx ?? 0, ny = c.ny ?? -1;
  const head = snapjawHead(c), t = ctx.state.frameCount;
  const state = c.state ?? SNAP.OPEN;
  const tell = state === SNAP.TELL;
  const jit = tell ? Math.sin(t * 2.3) * 0.3 : 0;
  const hx = head.x + jit * -ny, hy = head.y + jit * nx;
  lightAt(light, hx, hy);
  const burnt = Math.min(1, (c.gasp ?? 0) / 44);
  const skin = (r: number, g: number, b: number): RGB => [r * (1 - burnt * 0.6) + burnt * 0.2, g * (1 - burnt * 0.7), b * (1 - burnt * 0.8)];
  // Stalk: a muscular S from the root to the hinge, lit across its width.
  const len = Math.hypot(hx - ax, hy - ay), n = Math.max(6, Math.ceil(len / (STEP * 0.7)));
  const sway = Math.sin(c.phase * 0.7) * 0.9;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const bend = Math.sin(k * Math.PI) * sway;
    const x = ax + (hx - ax) * k + -ny * bend, y = ay + (hy - ay) * k + nx * bend;
    const w = 1.15 - k * 0.5;
    for (let o = -w; o <= w + 0.01; o += STEP * 0.8) {
      const lit = 0.5 - o / (w * 2.2);
      const ring = Math.abs(Math.sin(k * len * 1.3)) < 0.18 ? 0.75 : 1;
      px(s, x + -ny * o, y + nx * o, skin((0.12 + lit * 0.26) * ring, (0.18 + lit * 0.3) * ring, (0.07 + lit * 0.12) * ring));
    }
  }
  // Jaws: two fleshy, toothed lobes hinged at the stalk tip. Each lobe is a
  // full ellipse: its outer half green skin lit from above, its inner half the
  // red lining you see down the open mouth, a comb of pale teeth on the lip.
  const axis = Math.atan2(hy - ay, hx - ax);
  const gape = Math.max(0, c.extent ?? 1) * 0.55;
  const Lj = 5.2, T = 1.7;
  // The throat wedge between the lobes: dark flesh the lure glows out of.
  if (gape > 0.08) {
    for (let u = 0.3; u <= Lj * 0.75; u += STEP * 0.7) {
      const spread = Math.tan(gape) * u * 0.9;
      for (let v = -spread; v <= spread; v += STEP * 0.8) {
        const x = hx + Math.cos(axis) * u - Math.sin(axis) * v, y = hy + Math.sin(axis) * u + Math.cos(axis) * v;
        px(s, x, y, skin(0.24, 0.05, 0.05));
      }
    }
  }
  for (const side of [-1, 1]) {
    const th = axis + side * gape;
    const ca = Math.cos(th), sa = Math.sin(th);
    for (let u = 0; u <= Lj; u += STEP * 0.7) {
      const halfW = T * Math.sqrt(Math.max(0, 1 - ((u - Lj * 0.5) / (Lj * 0.52)) ** 2));
      for (let v = -halfW * 0.55; v <= halfW; v += STEP * 0.8) {
        // v > 0 is the outside of the lobe; v < 0 faces the mouth.
        const x = hx + ca * u - sa * v * side, y = hy + sa * u + ca * v * side;
        let col: RGB;
        if (v < 0) col = skin(0.62 - (-v / halfW) * 0.2, 0.13, 0.11);
        else {
          const up = -(ca * 0 - sa * side) * 0 + (y < hy ? 0.1 : 0);
          const lit = Math.max(0, 1 - v / (halfW + 0.01)) * 0.5 + up;
          const spot = hash(u + side * 11 + (c.anchorX ?? 0), v) > 0.86;
          col = spot ? skin(0.62, 0.52, 0.2) : skin(0.2 + lit * 0.22, 0.32 + lit * 0.3, 0.1 + lit * 0.08);
        }
        px(s, x, y, col);
      }
      // Teeth: a comb along the inner lip, raking across the mouth.
      if (u > 0.9 && u < Lj - 0.4 && Math.abs(((u * 1.5) % 1) - 0.5) < 0.2) {
        const lip = -halfW * 0.55;
        for (let k = 0; k < 2; k++) {
          const v = lip - k * STEP;
          px(s, hx + ca * (u + k * 0.25) - sa * v * side, hy + sa * (u + k * 0.25) + ca * v * side, [0.9, 0.86, 0.72], 1.15);
        }
      }
    }
  }
  // The coal-red throat: its lure, dark when it is digesting or dead-still.
  if (state === SNAP.OPEN || state === SNAP.TELL || state === SNAP.REOPEN) {
    const lure = (0.55 + Math.sin(t * 0.07 + c.phase) * 0.2) * (tell ? 1.7 : 1) * (1 - burnt);
    for (let u = 0.6; u < 3.2; u += STEP) {
      const k = 1 - Math.abs(u - 1.6) / 1.8;
      glow(s, hx + Math.cos(axis) * u, hy + Math.sin(axis) * u, [0.55, 0.12, 0.04], lure * k);
    }
  } else if (state === SNAP.CHEW) {
    // A swallowed meal bulges the closed pod.
    blob(s, hx + Math.cos(axis) * 2, hy + Math.sin(axis) * 2, 2.4, 1.9, axis, skin(0.2, 0.24, 0.1), skin(0.44, 0.4, 0.2));
  }
  if (burnt > 0.1) glow(s, hx, hy, [0.5, 0.18, 0.02], burnt * (0.5 + Math.sin(t * 0.5) * 0.3));
}

/* ---------------------------------------------------------------- crawlers */

/** Shell ramps (dark, light) per crawler kind. */
const CRAWLER_SHELL: Record<string, [RGB, RGB]> = {
  isopod: [[0.3, 0.29, 0.34], [0.8, 0.78, 0.84]],
  emberbeetle: [[0.1, 0.06, 0.04], [0.36, 0.24, 0.14]],
  // Frost mite: a pale, rimed, half-clear body.
  frostmite: [[0.42, 0.52, 0.6], [0.9, 0.96, 1.0]],
  // Glass beetle: a clear blue-violet shell over a darker body.
  glassbeetle: [[0.16, 0.18, 0.3], [0.62, 0.7, 0.92]],
  // Lens mite: a small amber-grey grinder with a bulging lens of a head.
  lensmite: [[0.24, 0.2, 0.16], [0.64, 0.56, 0.44]],
};

function drawCrawler(s: PixelSurface, light: LightField, ctx: Ctx, c: Critter): void {
  const ember = c.kind === 'emberbeetle', t = ctx.state.frameCount;
  lightAt(light, c.x, c.y);
  const shell: [RGB, RGB] = CRAWLER_SHELL[c.kind] ?? CRAWLER_SHELL.isopod;
  const small = c.kind === 'frostmite' || c.kind === 'lensmite';
  const glassy = c.kind === 'glassbeetle';
  const heat = ember ? 0.45 + Math.min(1, (c.meal ?? 0) / 500) * 0.8 + Math.sin(t * 0.09 + c.phase) * 0.12 : 0;
  if (c.state === CRAWL.BALL || c.state === CRAWL.UNCURL) {
    const r = 1.1 + (1 - (c.extent ?? 1)) * 0.5;
    const roll = c.x * 1.2;
    blob(s, c.x, c.y, r, r, 0, shell[0], shell[1], (u, v) => {
      const a = Math.atan2(v, u) + roll;
      return Math.abs(Math.sin(a * 2.5)) < 0.18 && u * u + v * v > 0.2 ? [shell[0][0] * 0.7, shell[0][1] * 0.7, shell[0][2] * 0.7] : null;
    });
    if (ember) glow(s, c.x, c.y, [0.5, 0.2, 0.03], heat * 0.6);
    return;
  }
  const nx = c.nx ?? 0, ny = c.ny ?? -1, hand = c.facing >= 0 ? 1 : -1;
  // Move direction from the wall and the hand it keeps on it.
  const dx = hand > 0 ? -ny : ny, dy = hand > 0 ? nx : -nx;
  const th = Math.atan2(dy, dx);
  const len = ember ? 1.7 : small ? 1.4 : glassy ? 1.9 : 2.2, wid = ember ? 0.95 : small ? 0.8 : 1.0;
  const cx = c.x + nx * 0.2, cy = c.y + ny * 0.2;
  // Legs: little strokes to the wall, stepping.
  for (let k = -1; k <= 1; k++) {
    const kick = Math.sin(c.phase * 2.2 + k * 2) * 0.35;
    const lx = cx + dx * (k * 0.7 + kick), ly = cy + dy * (k * 0.7 + kick);
    line(s, lx, ly, lx - nx * 0.9 + dx * kick * 0.5, ly - ny * 0.9 + dy * kick * 0.5, [0.1, 0.09, 0.1]);
  }
  blob(s, cx, cy, len, wid, th, shell[0], shell[1], (u, v) => {
    // Plate seams across the back (isopods and frost mites).
    if ((c.kind === 'isopod' || c.kind === 'frostmite') && Math.abs(u * 2.5 - Math.round(u * 2.5)) < 0.12 && Math.abs(u) < 0.9) {
      return [shell[0][0] * 1.3, shell[0][1] * 1.3, shell[0][2] * 1.3];
    }
    // A glass beetle's elytra: a bright specular streak down the shell.
    if (glassy && Math.abs(v + 0.35) < 0.16 && Math.abs(u) < 0.7) return [0.95, 0.98, 1];
    return null;
  });
  if (glassy) {
    // The clear shell splits light: a spectral fleck that walks with it.
    const hue = (t * 0.05 + c.phase) % 3;
    const col: RGB = hue < 1 ? [0.9, 0.35, 0.5] : hue < 2 ? [0.4, 0.9, 0.5] : [0.4, 0.55, 1];
    glow(s, cx + dx * 0.4 - nx * 0.4, cy + dy * 0.4 - ny * 0.4, col, 0.25 * Math.max(L.r, L.g, L.b));
  }
  if (c.kind === 'lensmite') {
    // The lens it grinds with: a bright bead at the head.
    px(s, cx + dx * len * 0.9, cy + dy * len * 0.9, [0.95, 0.92, 0.8]);
  }
  // Antennae: they test the air, quicker when it has stopped to sniff.
  const sniff = Math.sin(t * 0.21 + c.phase) * 0.5;
  const hx = cx + dx * len, hy = cy + dy * len;
  for (const sd of [-1, 1]) {
    const ex = hx + dx * 1.3 + nx * (0.7 + sd * 0.3 + sniff * 0.3), ey = hy + dy * 1.3 + ny * (0.7 + sd * 0.3 + sniff * 0.3);
    line(s, hx, hy, ex, ey, ember ? [0.3, 0.16, 0.06] : [0.32, 0.3, 0.34]);
  }
  if (ember) {
    // The glowing seam: coal it has eaten, burning slow inside the shell.
    for (let u = -len * 0.8; u <= len * 0.8; u += STEP) {
      const k = heat * (1 - Math.abs(u) / (len * 1.1));
      px(s, cx + dx * u + nx * 0.2, cy + dy * u + ny * 0.2, [1, 0.62, 0.2], 0.6 + k * 0.4);
      glow(s, cx + dx * u + nx * 0.2, cy + dy * u + ny * 0.2, [1.1, 0.42, 0.06], k);
    }
    glow(s, cx - dx * len * 0.5, cy - dy * len * 0.5, [0.8, 0.3, 0.04], heat);
    glow(s, cx - dx * len * 0.5 + nx * STEP, cy - dy * len * 0.5 + ny * STEP, [0.3, 0.1, 0.01], heat);
  }
}

/* ---------------------------------------------------------------- leech */

function drawLeech(s: PixelSurface, light: LightField, _ctx: Ctx, c: Critter): void {
  lightAt(light, c.x, c.y);
  const dead = (c.dead ?? 0) > 0, full = c.extent ?? 0;
  const latched = c.state === LEECH.LATCHED;
  const lo: RGB = dead ? [0.16, 0.13, 0.1] : [0.16 + full * 0.2, 0.04, 0.05];
  const hi: RGB = dead ? [0.3, 0.26, 0.2] : [0.42 + full * 0.25, 0.14, 0.12];
  const segs = 6, dir = c.facing >= 0 ? 1 : -1;
  for (let i = 0; i < segs; i++) {
    const k = i / (segs - 1);
    const wave = dead ? 0 : Math.sin(c.phase - k * 3) * 0.45;
    const x = latched ? c.x + wave * 0.6 : c.x - dir * k * 2.6;
    const y = latched ? c.y + k * 2.4 : c.y + wave;
    const r = (0.5 + full * 0.35) * (1 - Math.abs(k - 0.55) * 0.6);
    blob(s, x, y, r + 0.1, r, 0, lo, hi);
  }
  if (!dead) px(s, c.x + (latched ? 0 : dir * 0.4), c.y, [0.55, 0.25, 0.2]);
}

/* ---------------------------------------------------------------- ash moth */

function drawAshmoth(s: PixelSurface, light: LightField, ctx: Ctx, c: Critter): void {
  lightAt(light, c.x, c.y);
  const beat = (ctx.state.frameCount + (c.phase * 10 | 0)) % 6 < 3 ? 1 : 0;
  px(s, c.x, c.y, [0.5, 0.48, 0.44]);
  px(s, c.x - 1, c.y - beat, [0.62, 0.6, 0.56]);
  px(s, c.x + 1, c.y - (1 - beat), [0.62, 0.6, 0.56]);
  px(s, c.x - 0.5, c.y - beat * 0.5, [0.44, 0.42, 0.4]);
  px(s, c.x + 0.5, c.y - (1 - beat) * 0.5, [0.44, 0.42, 0.4]);
}

/* ---------------------------------------------------------------- light moths */

function drawLightMoth(s: PixelSurface, light: LightField, ctx: Ctx, c: Critter): void {
  lightAt(light, c.x, c.y);
  const t = ctx.state.frameCount;
  const beat = (t + (c.phase * 10 | 0)) % 6 < 3 ? 1 : 0;
  if (c.kind === 'snowmoth') {
    const wing: RGB = [0.94, 0.96, 1], body: RGB = [0.7, 0.72, 0.78];
    px(s, c.x, c.y, body);
    px(s, c.x - 1, c.y - beat, wing); px(s, c.x + 1, c.y - (1 - beat), wing);
    px(s, c.x - 0.5, c.y - beat * 0.5, wing); px(s, c.x + 0.5, c.y - (1 - beat) * 0.5, wing);
    // Powder drifting off the wings now and then.
    if ((t + (c.phase * 7 | 0)) % 23 === 0) px(s, c.x, c.y + 1, [0.8, 0.85, 0.9], 0.6);
    return;
  }
  // Prism moth: its scaled wings throw back the light that falls on them as
  // a spectrum — the brighter the light on it, the brighter the flash.
  const lum = Math.max(L.r, L.g, L.b);
  const hue = (t * 0.08 + c.phase * 3) % 3;
  const a: RGB = hue < 1 ? [0.95, 0.4, 0.55] : hue < 2 ? [0.45, 0.95, 0.55] : [0.45, 0.6, 1];
  const b: RGB = hue < 1 ? [0.45, 0.6, 1] : hue < 2 ? [0.95, 0.4, 0.55] : [0.45, 0.95, 0.55];
  px(s, c.x, c.y, [0.5, 0.48, 0.6]);
  px(s, c.x - 1, c.y - beat, a); px(s, c.x + 1, c.y - (1 - beat), b);
  px(s, c.x - 0.5, c.y - beat * 0.5, [0.75, 0.75, 0.9]); px(s, c.x + 0.5, c.y - (1 - beat) * 0.5, [0.75, 0.75, 0.9]);
  if (lum > 0.45) {
    glow(s, c.x - 1, c.y - beat, a, (lum - 0.45) * 0.5);
    glow(s, c.x + 1, c.y - (1 - beat), b, (lum - 0.45) * 0.5);
  }
}

/* ---------------------------------------------------------------- brine skater */

function drawSkater(s: PixelSurface, light: LightField, ctx: Ctx, c: Critter): void {
  lightAt(light, c.x, c.y);
  const t = ctx.state.frameCount;
  const dir = c.facing >= 0 ? 1 : -1;
  const stroke = Math.sin(c.phase * 1.3) * 0.4;
  // Four long legs splayed on the film, a thin body between.
  const leg: RGB = [0.18, 0.2, 0.22];
  line(s, c.x, c.y, c.x + dir * (2.4 + stroke), c.y + 0.3, leg);
  line(s, c.x, c.y, c.x + dir * (1.2 - stroke), c.y + 0.5, leg);
  line(s, c.x, c.y, c.x - dir * (2.2 - stroke), c.y + 0.4, leg);
  line(s, c.x, c.y, c.x - dir * (1.0 + stroke), c.y + 0.5, leg);
  blob(s, c.x, c.y - 0.3, 1.1, 0.45, 0, [0.12, 0.13, 0.16], [0.36, 0.4, 0.46]);
  // Dimples where its feet press the surface.
  if ((t + (c.phase * 5 | 0)) % 20 < 12) {
    veil(s, c.x + dir * (2.4 + stroke), c.y + 0.6, [0.8, 0.92, 0.95], 0.3);
    veil(s, c.x - dir * (2.2 - stroke), c.y + 0.6, [0.8, 0.92, 0.95], 0.3);
  }
}

/** Draw one organism (the critter layer calls this for organism kinds). */
export function drawOrganism(s: PixelSurface, light: LightField, ctx: Ctx, c: Critter): void {
  switch (c.kind) {
    case 'glowworm': drawGlowworm(s, light, ctx, c); break;
    case 'puffer': drawPuffer(s, light, ctx, c); break;
    case 'snapjaw': drawSnapjaw(s, light, ctx, c); break;
    case 'isopod': case 'emberbeetle': case 'frostmite': case 'glassbeetle': case 'lensmite': drawCrawler(s, light, ctx, c); break;
    case 'snowmoth': case 'prismmoth': drawLightMoth(s, light, ctx, c); break;
    case 'brineskater': drawSkater(s, light, ctx, c); break;
    case 'leech': drawLeech(s, light, ctx, c); break;
    case 'ashmoth': drawAshmoth(s, light, ctx, c); break;
    default: break;
  }
}

/** Light seeds for organisms that make their own (beads, throats, bellies). */
export function organismLights(ctx: Ctx, seed: (x: number, y: number, r: number, g: number, b: number) => void): void {
  if (ctx.state.mode !== 'play') return;
  const t = ctx.state.frameCount;
  const cx = ctx.camera.x, cy = ctx.camera.y;
  for (const c of ctx.critters.list) {
    if (c.x < cx - 40 || c.x > cx + 680 || c.y < cy - 40 || c.y > cy + 400) continue;
    if (c.kind === 'glowworm') {
      const ax = (c.anchorX ?? c.x) + 0.5, ay = c.anchorY ?? c.y, ext = c.extent ?? 0;
      const k = c.state === GLOW.RETRACT ? 0.35 : 1;
      const fed = Math.min(1, (c.meal ?? 0) / 300);
      seed(ax + 1, ay + 1, 0.03 * k, (0.14 + fed * 0.12) * k, (0.13 + fed * 0.1) * k);
      if (ext > 3) seed(glowThreadX(c, ay + ext), ay + ext, 0.03 * k, 0.16 * k, 0.15 * k);
    } else if (c.kind === 'snapjaw') {
      if (c.state === SNAP.CHEW) continue;
      const h = snapjawHead(c), l = 0.12 + Math.sin(t * 0.07 + c.phase) * 0.04;
      seed(h.x, h.y, l * 1.3, l * 0.3, l * 0.08);
    } else if (c.kind === 'puffer') {
      if ((c.extent ?? 0) > 0.4) { const sac = pufferSac(c); seed(sac.x, sac.y, 0.03, 0.08 * (c.extent ?? 0), 0.02); }
    } else if (c.kind === 'emberbeetle') {
      const heat = 0.5 + Math.min(1, (c.meal ?? 0) / 500) * 0.7;
      seed(c.x, c.y, 0.3 * heat, 0.11 * heat, 0.02 * heat);
    }
  }
}
