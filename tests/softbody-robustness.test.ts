import { describe, expect, it } from 'vitest';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { makeSoftBody, softArea, stepSoftBody } from '@/creatures/rig/softbody';
import type { SoftBody, SoftOpts } from '@/creatures/rig/softbody';
import { integrate, movePoint, point, translate } from '@/creatures/rig/physics';
import { CreatureRaster, blankLight } from '@/render/creatures/raster';
import { material } from '@/render/creatures/palette';
import type { PixelSurface } from '@/render/pixels';

/**
 * QA 2026-09-27: an intermittent tab hang, "RangeError: Array buffer
 * allocation failed", allocation sizes squaring each frame. The chain: a gel
 * ring stretched by its body jumping while rim points were snagged behind
 * rock; the pressure term (linear in area, area quadratic in size) then
 * pushed the rim through the centroid and re-inflated it inside-out at
 * ~0.05·R² per tick; the creature raster sized its scratch from those points.
 */

/** The slime's real options (creatures/species/gel.ts). */
const GEL_OPTS: SoftOpts = {
  gravity: 0.14, damping: 0.9, wetDamping: 0.8, buoyancy: 0.4, friction: 0.55,
  shape: 0.2, pressure: 0.55, follow: 0.42,
};

/** The pre-fix step, verbatim, as the ordinary-motion reference. */
function legacyStep(world: World, sb: SoftBody, ax: number, ay: number, o: SoftOpts): void {
  const pts = sb.pts, n = pts.length;
  if (Math.abs(sb.cx - ax) + Math.abs(sb.cy - ay) > 40) {
    for (const p of pts) translate(p, ax - sb.cx, ay - sb.cy);
    sb.cx = ax; sb.cy = ay;
  }
  for (const p of pts) integrate(world, p, o);
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  const fx = (ax - cx) * o.follow, fy = (ay - cy) * o.follow;
  const sx = o.scaleX ?? 1, sy = o.scaleY ?? 1, ang = o.angle ?? 0, ca = Math.cos(ang), sa = Math.sin(ang);
  const area = softArea(sb);
  const target = sb.area0 * sx * sy;
  const press = o.pressure * (target - area) / Math.max(1, target) * 2.2;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const rx = sb.rest[i * 2] * sx, ry = sb.rest[i * 2 + 1] * sy;
    const tx = cx + fx + rx * ca - ry * sa, ty = cy + fy + rx * sa + ry * ca;
    const prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
    let nx = next.y - prev.y, ny = -(next.x - prev.x);
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    movePoint(world, p, p.x + (tx - p.x) * o.shape + nx * press, p.y + (ty - p.y) * o.shape + ny * press);
  }
  let ncx = 0, ncy = 0;
  for (const p of pts) { ncx += p.x; ncy += p.y; }
  sb.cx = ncx / n; sb.cy = ncy / n;
}

function floorWorld(): World {
  const w = new World(240, 160);
  for (let x = 0; x < w.width; x++) for (let y = 120; y < w.height; y++) w.types[w.idx(x, y)] = Cell.Stone;
  return w;
}

function fill(w: World, x0: number, y0: number, x1: number, y1: number, cell: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y)) w.types[w.idx(x, y)] = cell;
}

/** Largest distance of any rim point from the ring's centroid. */
function spread(sb: SoftBody): number {
  let m = 0;
  for (const p of sb.pts) m = Math.max(m, Math.hypot(p.x - sb.cx, p.y - sb.cy));
  return m;
}

function allFinite(sb: SoftBody): boolean {
  return Number.isFinite(sb.cx) && Number.isFinite(sb.cy) &&
    sb.pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.px) && Number.isFinite(p.py));
}

/** Deterministic little PRNG so the fuzz is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('soft body runaway guards', () => {
  it('ordinary motion is unchanged (the guards never bite)', () => {
    const wa = floorWorld(), wb = floorWorld();
    const a = makeSoftBody(100, 115, 6.2, 4.4, 14, 0.4), b = makeSoftBody(100, 115, 6.2, 4.4, 14, 0.4);
    let x = 100;
    for (let t = 0; t < 600; t++) {
      // Walk, hop, breathe, lean — the gel species' ordinary life on a floor.
      x += Math.sin(t * 0.03) * 0.6;
      const hop = Math.max(0, Math.sin(t * 0.09)) * 10;
      const breath = Math.sin(t * 0.06) * 0.035;
      const o = { ...GEL_OPTS, scaleX: 1 + breath, scaleY: 1 - breath, angle: Math.sin(t * 0.05) * 0.3 };
      legacyStep(wa, a, x, 115 - hop, o);
      stepSoftBody(wb, b, x, 115 - hop, o);
    }
    for (let i = 0; i < a.pts.length; i++) {
      expect(b.pts[i].x).toBeCloseTo(a.pts[i].x, 6);
      expect(b.pts[i].y).toBeCloseTo(a.pts[i].y, 6);
    }
  });

  it('a ring the pre-fix step inflated to infinity stays bounded (the QA runaway)', () => {
    // An inflated, stretched ring (a body that jumped while its rim was
    // snagged). The old pressure push overshoots and squares the size.
    const inflate = (sb: SoftBody): void => {
      for (const p of sb.pts) {
        const nx = sb.cx + (p.x - sb.cx) * 20, ny = sb.cy + (p.y - sb.cy) * 20;
        p.x = p.px = nx; p.y = p.py = ny;
      }
    };
    const wOld = new World(240, 240), wNew = new World(240, 240);
    const old = makeSoftBody(120, 120, 6.2, 4.4, 14, 0.4), fixed = makeSoftBody(120, 120, 6.2, 4.4, 14, 0.4);
    inflate(old); inflate(fixed);
    for (let t = 0; t < 8; t++) legacyStep(wOld, old, 120, 120, GEL_OPTS);
    expect(spread(old) > 1e6 || !allFinite(old)).toBe(true); // the bug, reproduced
    for (let t = 0; t < 1000; t++) {
      stepSoftBody(wNew, fixed, 120, 120, GEL_OPTS);
      expect(spread(fixed)).toBeLessThan(60);
    }
    expect(allFinite(fixed)).toBe(true);
    expect(softArea(fixed)).toBeLessThan(fixed.area0 * 3);
  });

  it('a slime wedged in rock for 1,000 ticks stays finite and bounded', () => {
    for (const scenario of ['bury', 'half', 'slot', 'lid'] as const) {
      const w = floorWorld();
      const sb = makeSoftBody(100, 115, 6.2, 4.4, 14, 0.4);
      for (let t = 0; t < 30; t++) stepSoftBody(w, sb, 100, 115, GEL_OPTS);
      if (scenario === 'bury') fill(w, 91, 101, 109, 119, Cell.Stone);
      if (scenario === 'half') fill(w, 91, 101, 101, 112, Cell.Stone);
      if (scenario === 'slot') { fill(w, 88, 99, 98, 119, Cell.Stone); fill(w, 102, 99, 112, 119, Cell.Stone); }
      if (scenario === 'lid') fill(w, 88, 109, 112, 111, Cell.Stone);
      for (let t = 0; t < 1000; t++) {
        // The gameplay body is shoved about inside the rock (explosions, gusts).
        const ax = 100 + Math.sin(t * 0.21) * 9 + (t % 97 === 0 ? 30 : 0);
        const ay = 115 - Math.abs(Math.cos(t * 0.17)) * 6;
        stepSoftBody(w, sb, ax, ay, { ...GEL_OPTS, scaleX: 1 + Math.sin(t) * 0.25, scaleY: 1 - Math.sin(t) * 0.25 });
        expect(allFinite(sb), `${scenario} finite @${t}`).toBe(true);
        expect(spread(sb), `${scenario} spread @${t}`).toBeLessThan(60);
      }
    }
  });

  it('survives snagged-rim jumps across many seeds (fuzz that diverged 28/80 pre-fix)', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rnd = prng(seed);
      const w = floorWorld();
      let ax = 120, ay = 115;
      const sb = makeSoftBody(ax, ay, 6.2, 4.4, 14, 0.4);
      for (let t = 0; t < 800; t++) {
        const r = rnd();
        if (r < 0.03) {
          const cx = Math.round(sb.cx + (rnd() - 0.5) * 16), cy = Math.round(sb.cy + (rnd() - 0.5) * 12), rr = 2 + Math.floor(rnd() * 8);
          fill(w, cx - rr, cy - rr, cx + rr, cy + rr, Cell.Stone);
        } else if (r < 0.045) {
          ax = Math.max(10, Math.min(230, ax + (rnd() - 0.5) * 60));
          ay = Math.max(10, Math.min(150, ay + (rnd() - 0.5) * 40));
        } else if (r < 0.055) {
          fill(w, Math.round(sb.cx) - 12, Math.round(sb.cy) - 10, Math.round(sb.cx) + 12, Math.round(sb.cy) + 10, Cell.Empty);
        } else {
          ax += (rnd() - 0.5) * 3; ay += (rnd() - 0.5) * 3;
        }
        const s = (rnd() - 0.5) * 0.5;
        stepSoftBody(w, sb, ax, ay, { ...GEL_OPTS, scaleX: 1 + s, scaleY: 1 - s, angle: (rnd() - 0.5) * 0.7 });
      }
      expect(allFinite(sb), `seed ${seed}`).toBe(true);
      expect(spread(sb), `seed ${seed}`).toBeLessThan(60);
    }
  });

  it('NaN points and a NaN anchor are survived', () => {
    const w = floorWorld();
    const sb = makeSoftBody(100, 115, 6.2, 4.4, 14, 0.4);
    sb.pts[3].x = NaN; sb.pts[7].py = Infinity;
    stepSoftBody(w, sb, 100, 115, GEL_OPTS);
    expect(allFinite(sb)).toBe(true);
    expect(Math.hypot(sb.cx - 100, sb.cy - 115)).toBeLessThan(10);
    // A poisoned anchor leaves the ring where it was instead of poisoning it.
    const before = sb.pts.map(p => [p.x, p.y]);
    stepSoftBody(w, sb, NaN, 115, GEL_OPTS);
    stepSoftBody(w, sb, 100, Infinity, GEL_OPTS);
    expect(sb.pts.map(p => [p.x, p.y])).toEqual(before);
    for (let t = 0; t < 100; t++) stepSoftBody(w, sb, 100, 115, GEL_OPTS);
    expect(allFinite(sb)).toBe(true);
  });

  it('rig points refuse non-finite targets and velocities', () => {
    const w = floorWorld();
    const p = point(50, 100, 0.55);
    movePoint(w, p, NaN, 100);
    movePoint(w, p, 50, Infinity);
    expect([p.x, p.y]).toEqual([50, 100]);
    p.px = Infinity;
    integrate(w, p, GEL_OPTS);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('creature raster sizing guards', () => {
  const MATS = [material({ keys: [0x102030, 0x406080, 0xa0c0e0] })];
  const surface = (): PixelSurface & { n: number } => {
    const s = { n: 0, pixelStep: 0.5,
      setFinePx() { s.n++; }, blendFinePx() { s.n++; }, addFinePx() {}, setPx() { s.n++; }, addPx() {} };
    return s;
  };

  it('pathological bounds never throw or allocate absurdly, and the next creature draws', () => {
    const r = new CreatureRaster();
    const bad: Array<[number, number, number, number, number]> = [
      [0.5, NaN, 0, 10, 10],
      [0.5, 0, 0, Infinity, 10],
      [0.5, -Infinity, -Infinity, Infinity, Infinity],
      [0.5, -8.3e52, -8.3e52, 8.3e52, 8.3e52],
      [0.5, 0, 0, 3.7e105, 3.7e105],
      [0, 0, 0, 10, 10],
      [NaN, 0, 0, 10, 10],
      [1e-9, 0, 0, 40, 40],
    ];
    for (const [step, x0, y0, x1, y1] of bad) {
      expect(() => r.begin(step, x0, y0, x1, y1, MATS, 100, 100)).not.toThrow();
      expect(r.w * r.h).toBeLessThanOrEqual(1 << 20);
      expect(() => { r.ellipse(100, 100, 6, 4, 0, 0, 1); r.resolve(surface(), blankLight()); }).not.toThrow();
    }
    // A normal creature right after still draws.
    r.begin(0.5, 90, 90, 110, 106, MATS, 100, 100);
    r.ellipse(100, 100, 6, 4, 0, 0, 1);
    const out = surface();
    r.resolve(out, blankLight());
    expect(out.n).toBeGreaterThan(100);
  });

  it('a flung limb is clipped to a window around the anchor', () => {
    const r = new CreatureRaster();
    r.begin(0.5, 100 - 1e6, 90, 110, 106, MATS, 100, 100);
    expect(r.w).toBeLessThan(900);
    expect(Number.isFinite(r.ox)).toBe(true);
    r.ellipse(100, 100, 6, 4, 0, 0, 1);
    const out = surface();
    r.resolve(out, blankLight());
    expect(out.n).toBeGreaterThan(100);
  });
});
