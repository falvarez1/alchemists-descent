import { describe, expect, it } from 'vitest';

import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { DEPTH_KITS, MAX_DEPTH_PLANES, depthKitFor, genericKit } from '@/config/depthKits';
import { FLOOR_LOOKS } from '@/config/floorLooks';
import type { BiomeId, LevelRuntime } from '@/core/types';
import { bakeForeground, bakePlane } from '@/render/depth/bake';
import {
  backdropOrigin, backdropTexel, cameraFor, foregroundCoord, foregroundExtent, framingAnchor, particleScreen, pulseOpacity, wrap,
} from '@/render/depth/parallax';
import { luma, valueStats } from '@/render/depth/raster';
import { REVEAL_CELL, RevealField, centreMask, pointMask, rectMask } from '@/render/depth/reveal';

const ALL_BIOMES = Object.keys(FLOOR_LOOKS) as BiomeId[];

describe('depth kit lookup', () => {
  it('the four spine floors have their own kits', () => {
    expect(depthKitFor('earthen').id).toBe('bellows');
    expect(depthKitFor('fungal').id).toBe('rot');
    expect(depthKitFor('flooded').id).toBe('cisterns');
    expect(depthKitFor('volcanic').id).toBe('kiln');
    // The second doors (wave 3).
    expect(depthKitFor('frozen').id).toBe('cold');
    expect(depthKitFor('crystal').id).toBe('glass');
  });

  it('every other biome (and unknown ids) falls back to a generic kit graded from its floor look', () => {
    for (const biome of ALL_BIOMES) {
      const kit = depthKitFor(biome);
      expect(kit.planes.length).toBeGreaterThanOrEqual(3);
      if (!DEPTH_KITS[biome]) expect(kit.id).toBe('generic');
    }
    // A biome nobody has written a kit for still renders with depth.
    expect(depthKitFor('timber').id).toBe('generic');
    expect(depthKitFor('scorched').id).toBe('generic');
    expect(depthKitFor('not-a-biome' as BiomeId).id).toBe('generic');
    expect(depthKitFor(null).id).toBe('bellows');
    // Cached: the same object every call (bitmaps are baked once per kit).
    expect(depthKitFor('timber')).toBe(depthKitFor('timber'));
  });

  it('generic kits take their colour from the floor look', () => {
    const cold = genericKit('frozen'), gilded = genericKit('gilded');
    // The frozen tint is blue-heavy; the gilded one warm.
    expect(cold.palette.haze[2]).toBeGreaterThan(cold.palette.haze[0]);
    expect(gilded.palette.haze[0]).toBeGreaterThan(gilded.palette.haze[2] * 0.8);
  });

  it('kits obey the slot budget and order planes far to near', () => {
    for (const kit of [...Object.values(DEPTH_KITS), genericKit('frozen')]) {
      if (!kit) continue;
      expect(kit.planes.length).toBeLessThanOrEqual(MAX_DEPTH_PLANES);
      for (let i = 1; i < kit.planes.length; i++) {
        expect(kit.planes[i].parallax).toBeGreaterThanOrEqual(kit.planes[i - 1].parallax);
      }
      for (const p of kit.planes) {
        expect(p.parallax).toBeGreaterThan(0);
        expect(p.parallax).toBeLessThan(1);
        expect(p.lit).toBeGreaterThanOrEqual(0);
        expect(p.lit).toBeLessThanOrEqual(1);
      }
      // The lantern reaches near planes more than far ones.
      const solid = kit.planes.filter((p) => !p.shafts);
      expect(solid[0].lit).toBeLessThan(solid[solid.length - 1].lit);
      expect(kit.foreground?.parallax ?? 2).toBeGreaterThan(1);
      for (const s of kit.particles) {
        if (s.behind) expect(s.parallax).toBeLessThan(1);
        else expect(s.parallax).toBeGreaterThan(1);
      }
    }
  });
});

describe('depth plane art', () => {
  it('bakes deterministically', () => {
    const kit = depthKitFor('fungal');
    const a = bakePlane(kit, 1, null)!, b = bakePlane(kit, 1, null)!;
    expect(a.width).toBe(kit.planes[1].source.kind === 'art' ? kit.planes[1].source.width : 0);
    expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels))).toBe(true);
  });

  it('image planes wait for their image instead of painting garbage', () => {
    expect(bakePlane(depthKitFor('earthen'), 0, null)).toBeNull();
  });

  it('near planes remain sparse and darker; procedural far fills remain opaque', () => {
    for (const biome of ['fungal', 'flooded', 'volcanic', 'frozen'] as BiomeId[]) {
      const kit = depthKitFor(biome);
      const solid = kit.planes.map((p, i) => ({ p, i })).filter(({ p }) => !p.shafts && p.source.kind === 'art');
      const near = valueStats(bakePlane(kit, solid[solid.length - 1].i, null)!);
      expect(near.coverage).toBeLessThan(0.5);
      expect(near.mean).toBeLessThan(110);
      if (kit.planes[0].source.kind === 'art') {
        const far = valueStats(bakePlane(kit, 0, null)!);
        expect(far.coverage).toBeGreaterThan(0.99);
        expect(near.mean).toBeLessThan(far.mean);
      }
    }
  });

  it('authored planes preserve source pixels and transparency while baking their haze', () => {
    // Actual asset exposure and hot-core distributions are checked in
    // verify-visual-fidelity.mjs after the browser decodes the WebP images.
    const image = { width: 2, height: 1, pixels: new Uint8ClampedArray([255, 185, 90, 255, 0, 0, 0, 0]) };
    const original = image.pixels.slice();
    const baked = bakePlane(depthKitFor('volcanic'), 0, image)!;
    expect(image.pixels).toEqual(original);
    expect(baked.pixels).not.toBe(image.pixels);
    expect(baked.pixels[3]).toBe(255);
    expect(baked.pixels[7]).toBe(0);
    expect(baked.pixels.slice(0, 3)).not.toEqual(original.slice(0, 3));
  });

  it('lit silhouettes step down the ramp toward the viewer', () => {
    for (const biome of ['volcanic', 'flooded', 'fungal'] as BiomeId[]) {
      const kit = depthKitFor(biome);
      const solid = kit.planes.map((p, i) => ({ p, i })).filter(({ p }) => !p.shafts && p.source.kind === 'art').slice(1);
      const means = solid.map(({ i }) => valueStats(bakePlane(kit, i, null)!).mean);
      for (let k = 1; k < means.length; k++) expect(means[k]).toBeLessThan(means[k - 1]);
    }
  });

  it('the Kiln heat rises: its plume plane scrolls and breathes', () => {
    const plume = depthKitFor('volcanic').planes.find((p) => p.shafts)!;
    expect(plume.scroll?.y ?? 0).toBeGreaterThan(0);
    expect(plume.pulse?.amp ?? 0).toBeGreaterThan(0);
  });

  it('the Glass Galleries add no false beams: no light shafts, no bright texels', () => {
    const kit = depthKitFor('crystal');
    expect(kit.planes.some((p) => p.shafts)).toBe(false);
    for (let i = 0; i < kit.planes.length; i++) {
      const b = bakePlane(kit, i, null)!;
      let max = 0;
      for (let o = 0; o < b.pixels.length; o += 4) {
        if (b.pixels[o + 3] < 8) continue;
        max = Math.max(max, b.pixels[o] * 0.2126 + b.pixels[o + 1] * 0.7152 + b.pixels[o + 2] * 0.0722);
      }
      expect(max).toBeLessThan(140);
    }
  });

  it('the Cold Store light falls from above', () => {
    const b = bakePlane(depthKitFor('frozen'), 0, null)!;
    const rowMean = (y: number): number => {
      let s = 0;
      for (let x = 0; x < b.width; x++) { const o = (y * b.width + x) * 4; s += b.pixels[o] + b.pixels[o + 1] + b.pixels[o + 2]; }
      return s / b.width;
    };
    expect(rowMean(Math.round(b.height * 0.1))).toBeGreaterThan(rowMean(Math.round(b.height * 0.7)));
  });

  it('backgrounds stay darker than the brightest playable values', () => {
    for (const kit of [...Object.values(DEPTH_KITS), genericKit('crystal')]) {
      if (!kit) continue;
      for (let i = 0; i < kit.planes.length; i++) {
        if (kit.planes[i].source.kind !== 'art' || kit.planes[i].shafts) continue;
        expect(valueStats(bakePlane(kit, i, null)!).mean).toBeLessThan(150);
      }
      expect(luma(kit.palette.fg)).toBeLessThan(20);
    }
  });

  it('light-shaft planes are soft: mostly transparent, never opaque', () => {
    const kit = depthKitFor('flooded');
    const i = kit.planes.findIndex((p) => p.shafts);
    const bmp = bakePlane(kit, i, null)!;
    let maxA = 0, lit = 0;
    for (let o = 3; o < bmp.pixels.length; o += 4) { maxA = Math.max(maxA, bmp.pixels[o]); if (bmp.pixels[o] > 0) lit++; }
    expect(maxA).toBeGreaterThan(40);
    expect(maxA).toBeLessThan(160);
    expect(lit / (bmp.pixels.length / 4)).toBeLessThan(0.35);
  });

  it('the foreground covers every camera position and floor 1 is framed deliberately', () => {
    const kit = depthKitFor('earthen');
    const fg = kit.foreground!;
    const w = foregroundExtent(WIDTH, VIEW_W, fg.parallax), h = foregroundExtent(HEIGHT, VIEW_H, fg.parallax);
    const d1 = bakeForeground(kit, 'd1', w, h)!;
    expect(d1.width).toBe(Math.ceil(w / fg.scale));
    // The Intake's riser pipe lands at the left edge while the camera follows the player there.
    const tx = Math.floor(framingAnchor(280, 20, VIEW_W, WIDTH, fg.parallax) / fg.scale);
    const ty = Math.floor(framingAnchor(305, 80, VIEW_H, HEIGHT, fg.parallax) / fg.scale);
    expect(d1.pixels[(ty * d1.width + tx) * 4 + 3]).toBe(255);
    // Sparse: silhouettes frame the view, they never blanket it.
    expect(valueStats(d1).coverage).toBeLessThan(0.12);
    const generated = bakeForeground(depthKitFor('volcanic'), null, w, h)!;
    expect(valueStats(generated).coverage).toBeGreaterThan(0.005);
    expect(valueStats(generated).coverage).toBeLessThan(0.2);
  });
});

describe('parallax math', () => {
  it('backdropTexel samples the plane from its origin (scaled, offset, wrapped)', () => {
    expect(backdropTexel(backdropOrigin(0, 0, 0.1), 5, 1, 0, 100)).toBe(5);
    expect(backdropTexel(backdropOrigin(100, 100, 0.1), 5, 1, 0, 100)).toBe(15);
    // Half-cell texels at scale 0.5 (the refinery plates).
    expect(backdropTexel(0, 5, 0.5, 0, 100)).toBe(10);
    expect(backdropTexel(0, 5, 1, 3, 100)).toBe(8);
    expect(backdropTexel(0, -1, 1, 0, 100)).toBe(99);
    expect(wrap(-1, 7)).toBe(6);
  });

  it('a backdrop plane sits at cam·speed on screen through every sub-cell camera position', () => {
    // The frame is composed at floor(cam) and the quad slides by the residual,
    // so view position v shows at screen v − residual.
    for (const speed of [0.05, 0.14, 0.32]) {
      for (let i = 0; i <= 500; i++) {
        const cam = 100 + i * 0.037, renderCam = Math.floor(cam), residual = cam - renderCam;
        for (const screen of [0, 17.25, 300.5]) {
          expect(backdropOrigin(renderCam, cam, speed) + screen + residual).toBeCloseTo(cam * speed + screen, 9);
        }
      }
    }
  });

  it('a slow camera drift slides a backdrop edge steadily, never riding the world and snapping back', () => {
    // Model the GPU compose: fragment k (2 per cell) samples the plane at its
    // own view position; find the first fragment showing texel `edge` or later.
    const fragmentAt = (origin: number, residual: number, edge: number): number => {
      let k = 0;
      while (Math.floor(origin + (k + 0.5) / 2 + residual) < edge) k++;
      return k;
    };
    const drift = (originFor: (renderCam: number, cam: number, speed: number) => number, speed: number) => {
      const edge = Math.floor(100 * speed) + 200;
      let last = Infinity, backward = 0, worst = 0;
      for (let i = 0; i <= 120; i++) {
        const cam = 100 + i * 0.1, renderCam = Math.floor(cam);
        const k = fragmentAt(originFor(renderCam, cam, speed), cam - renderCam, edge);
        if (k > last) backward++;
        last = k;
        worst = Math.max(worst, Math.abs(k - (2 * (edge - cam * speed) - 0.5)));
      }
      return { backward, worst };
    };
    for (const speed of [0.08, 0.14, 0.32]) {
      const glide = drift(backdropOrigin, speed);
      expect(glide.backward).toBe(0);
      expect(glide.worst).toBeLessThan(1); // within one canvas pixel of the ideal
      // The old mapping (floor(renderCam · speed)) rode the world for a cell and
      // jumped back — the model above must catch that.
      const legacy = drift((renderCam, _cam, s) => Math.floor(renderCam * s), speed);
      expect(legacy.backward).toBeGreaterThan(5);
      expect(legacy.worst).toBeGreaterThan(1);
    }
  });

  it('a plane with parallax P moves P× the camera', () => {
    const P = 0.3;
    const at = (cam: number): number => backdropOrigin(cam, cam, P);
    expect(at(1000) - at(0)).toBeCloseTo(300);
    // Foreground: the plane point under a fixed world point drifts (P − 1) × the camera.
    const P2 = 1.4;
    expect(foregroundCoord(500, 100, P2) - foregroundCoord(500, 0, P2)).toBeCloseTo(40);
    expect(foregroundCoord(500, 0, P2)).toBe(500);
  });

  it('foreground extent covers the last camera position', () => {
    const P = 1.4, ext = foregroundExtent(WIDTH, VIEW_W, P);
    const lastCam = WIDTH - VIEW_W;
    expect(foregroundCoord(lastCam + VIEW_W, lastCam, P)).toBeLessThanOrEqual(ext);
  });

  it('framing anchors land at the requested screen spot (camera clamped to the world)', () => {
    const P = 1.4;
    for (const focus of [100, 800, 1500]) {
      const cam = cameraFor(focus, VIEW_W, WIDTH);
      const anchor = framingAnchor(focus, 40, VIEW_W, WIDTH, P);
      // plane = world + cam(P−1) and world = cam + screen → screen = plane − cam·P.
      expect(anchor - cam * P).toBeCloseTo(40);
      expect(cam).toBeGreaterThanOrEqual(0);
      expect(cam).toBeLessThanOrEqual(WIDTH - VIEW_W);
    }
  });

  it('particles wrap inside a screen-sized span and track their plane', () => {
    const span = VIEW_W + 48;
    for (const cam of [0, 333, 1000]) {
      const s = particleScreen(100, cam, 0.3, span, 24);
      expect(s).toBeGreaterThanOrEqual(-24);
      expect(s).toBeLessThan(span - 24);
    }
    // One camera cell moves a P = 0.3 particle 0.3 cells (until it wraps).
    expect(particleScreen(400, 10, 0.3, span, 24) - particleScreen(400, 11, 0.3, span, 24)).toBeCloseTo(0.3);
  });

  it('shaft pulse breathes below its base opacity', () => {
    let lo = 1, hi = 0;
    for (let f = 0; f < 420; f += 7) {
      const v = pulseOpacity(1, 0.35, 420, f);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThanOrEqual(0.65 - 1e-9);
    expect(hi - lo).toBeGreaterThan(0.3);
  });
});

describe('foreground occluder fade (the readability rule)', () => {
  it('the screen centre is always clear; the edges keep their occluders', () => {
    expect(centreMask(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, false)).toBe(0);
    expect(centreMask(VIEW_W / 2 + 100, VIEW_H / 2, VIEW_W, VIEW_H, false)).toBe(0);
    expect(centreMask(4, 4, VIEW_W, VIEW_H, false)).toBe(1);
    // High-readability lighting clears a wider centre.
    const edge = centreMask(VIEW_W * 0.12, VIEW_H / 2, VIEW_W, VIEW_H, false);
    expect(centreMask(VIEW_W * 0.12, VIEW_H / 2, VIEW_W, VIEW_H, true)).toBeLessThan(edge);
  });

  it('a point punches a soft hole', () => {
    const p = { x: 50, y: 50, r: 40 };
    expect(pointMask(50, 50, p)).toBe(0);
    expect(pointMask(50 + 20, 50, p)).toBe(0);
    expect(pointMask(50 + 60, 50, p)).toBe(1);
    const mid = pointMask(50 + 40, 50, p);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('occluders thin smoothly when the player walks behind them, and return smoothly', () => {
    const f = new RevealField(VIEW_W, VIEW_H);
    const corner = { x: 30, y: 30 };
    f.update([], { readable: false }, null);
    const open = f.sample(corner.x, corner.y);
    expect(open).toBeGreaterThan(0.9);
    // The player arrives in the corner: the allowance eases down, never snapping.
    const player = [{ x: corner.x, y: corner.y, r: 46 }];
    f.update(player, { readable: false }, null);
    const step1 = f.sample(corner.x, corner.y);
    expect(step1).toBeLessThan(open);
    expect(step1).toBeGreaterThan(0.5);
    for (let k = 0; k < 40; k++) f.update(player, { readable: false }, null);
    expect(f.sample(corner.x, corner.y)).toBeLessThan(0.02);
    // The player leaves: it eases back.
    f.update([], { readable: false }, null);
    const back = f.sample(corner.x, corner.y);
    expect(back).toBeGreaterThan(0.02);
    expect(back).toBeLessThan(0.5);
  });

  it('authored set pieces (the Bell & Tea Engine) stay clear of occluders', () => {
    const rect = { x0: 100, y0: 40, x1: 500, y1: 200, pad: 36 };
    expect(rectMask(300, 100, rect)).toBe(0);
    expect(rectMask(500 + 10, 100, rect)).toBeLessThan(0.5);
    expect(rectMask(500 + 40, 100, rect)).toBe(1);
    const f = new RevealField(VIEW_W, VIEW_H);
    f.update([], { readable: false }, null, [{ x0: -50, y0: -50, x1: 120, y1: 80, pad: 36 }]);
    expect(f.sample(8, 8)).toBe(0);
    expect(f.sample(VIEW_W - 8, VIEW_H - 8)).toBeGreaterThan(0.9);
  });

  it('optics zones silence the depth particles (the Glass Galleries\' puzzles)', () => {
    const f = new RevealField(VIEW_W, VIEW_H);
    f.update([], { readable: false }, null, [{ x0: 40, y0: 40, x1: 160, y1: 120, pad: 30, calm: true }]);
    expect(f.sampleCalm(100, 80)).toBe(0);
    expect(f.sampleCalm(VIEW_W - 20, VIEW_H - 20)).toBe(1);
    // A plain no-occluder zone (the engine hall) leaves the particles alone.
    const g = new RevealField(VIEW_W, VIEW_H);
    g.update([], { readable: false }, null, [{ x0: 40, y0: 40, x1: 160, y1: 120, pad: 30 }]);
    expect(g.sampleCalm(100, 80)).toBe(1);
    expect(g.sample(100, 80)).toBe(0);
  });

  it('high-readability lighting softens every occluder', () => {
    const a = new RevealField(VIEW_W, VIEW_H), b = new RevealField(VIEW_W, VIEW_H);
    a.update([], { readable: false }, null);
    b.update([], { readable: true }, null);
    expect(b.sample(8, 8)).toBeLessThan(a.sample(8, 8));
    expect(b.sample(8, 8)).toBeGreaterThan(0);
  });

  it('packs allowance and light into the upload bytes', () => {
    const f = new RevealField(VIEW_W, VIEW_H);
    f.update([], { readable: false }, (vx, _vy, out) => { out[0] = vx < VIEW_W / 2 ? 0 : 1; out[1] = 0.5; });
    const corner = 0, right = (f.w - 1) * 4;
    expect(f.bytes[corner]).toBeGreaterThan(200);
    expect(f.bytes[corner + 1]).toBe(0);
    expect(f.bytes[right + 1]).toBe(255);
    // B: the designed-darkness factor the far particles dim by.
    expect(f.bytes[corner + 2]).toBe(128);
    expect(f.w).toBe(Math.ceil(VIEW_W / REVEAL_CELL) + 1);
  });
});

describe('authored no-occluder zones', () => {
  it('keeps the second doors\' puzzle rooms and guardian halls clear; the Galleries\' are calm', async () => {
    const { authoredZones } = await import('@/render/depth/DepthScene');
    const runtime = {
      placedPrefabs: [
        { id: 'glass-periscope', x0: 100, y0: 100, x1: 250, y1: 186 },
        { id: 'cold-ice-vault', x0: 400, y0: 300, x1: 530, y1: 380 },
        { id: 'flora-bramble', x0: 600, y0: 600, x1: 700, y1: 700 },
      ],
      boss: { x: 800, y: 500, kind: 'lenswright' },
    } as unknown as LevelRuntime;
    const zones = authoredZones(runtime);
    expect(zones.map((z) => z.calm)).toEqual([true, false, true]);
    expect(zones.some((z) => z.x0 === 600)).toBe(false);
    // The Lens Room covers the hovering Lenswright and the floor under it.
    const hall = zones[2];
    expect(hall.x0).toBeLessThan(800);
    expect(hall.x1).toBeGreaterThan(800);
    expect(hall.y0).toBeLessThan(500);
    expect(hall.y1).toBeGreaterThan(540);
    // Cached per runtime.
    expect(authoredZones(runtime)).toBe(zones);
  });
});
