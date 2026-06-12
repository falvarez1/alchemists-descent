import type { Mechanism, RuneVault } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';
import { hash2 } from '@/core/math';

/**
 * Procedural mechanism overlays (extracted from FrameComposer so the Builder
 * gallery previews animate with the SAME code the game renders with): lever
 * arms sweep, plates dip, braziers gutter, scales sag, buoys bob, coils
 * spark — and the machine primitives read their states (valve pips, plug
 * cracks, sensor ramps, counterweight sag, relay fuses).
 *
 * Everything here is presentation over real cells: stateless per frame,
 * driven only by the mechanism's own fields and the frame counter. Callers
 * cull off-camera mechanisms before calling.
 */

export function drawMechanismSprite(s: PixelSurface, m: Mechanism, frame: number): void {
  if (m.kind === 'lever') {
    // base bracket
    s.setPx(m.x - 1, m.y, 0.42, 0.44, 0.5);
    s.setPx(m.x, m.y, 0.5, 0.52, 0.58);
    s.setPx(m.x + 1, m.y, 0.42, 0.44, 0.5);
    s.setPx(m.x, m.y - 1, 0.32, 0.34, 0.4);
    // the arm: snapped to its side at rest, SWEEPING during a hand-pull
    // (state flips only when the pull completes, so animate from the
    // current side toward its opposite)
    const dir = m.state === 1 ? 1 : -1;
    let lean = dir;
    const pulling = m.pullT !== undefined && m.pullT > 0;
    if (pulling) {
      const p = 1 - m.pullT! / 26;
      const eased = p * p * (3 - 2 * p); // smoothstep: heavy start, firm finish
      lean = dir + (-dir - dir) * eased;
    }
    for (let st = 1; st <= 4; st++) {
      s.setPx(m.x + Math.round(st * 0.55 * lean), m.y - 1 - st, 0.55, 0.42, 0.2);
    }
    // glowing knob rides the arm tip; strains white mid-pull
    const kx = m.x + Math.round(3 * lean),
      ky = m.y - 5 + (pulling ? Math.round(Math.abs(lean) < 0.4 ? -1 : 0) : 0);
    const g = 0.7 + Math.sin(frame * 0.1) * 0.2;
    if (pulling) s.setPx(kx, ky, 1.1, 1.0, 0.7);
    else if (m.state === 1) s.setPx(kx, ky, 0.2 * g, 1.6 * g, 0.4 * g);
    else s.setPx(kx, ky, 1.6 * g, 0.3 * g, 0.15 * g);
  } else if (m.kind === 'plate') {
    // pressure plates physically dip before the amber latch glow takes over
    const sink = m.pressed ? 1 : 0;
    for (let dx = 0; dx < m.w; dx++) s.setPx(m.x + dx, m.y + sink, 0.52, 0.45, 0.22);
    if (m.pressed || m.state > 0) {
      const g = 0.5 + Math.sin(frame * 0.18) * 0.25;
      for (let dx = 0; dx < m.w; dx += 2) s.addPx(m.x + dx, m.y - 1 + sink, 0.9 * g, 0.75 * g, 0.2 * g);
    }
  } else if (m.kind === 'brazier') {
    if (m.state === 0) {
      // dark bowls hint at what they want
      if (frame % 40 < 20) s.addPx(m.x, m.y - 2, 0.25, 0.12, 0.04);
    } else {
      const flame = 0.7 + Math.sin(frame * 0.21 + m.x) * 0.25 + Math.random() * 0.18;
      s.addPx(m.x, m.y - 3, 1.0 * flame, 0.48 * flame, 0.08);
      s.addPx(m.x - 1, m.y - 2, 0.65 * flame, 0.28 * flame, 0.05);
      s.addPx(m.x + 1, m.y - 2, 0.65 * flame, 0.28 * flame, 0.05);
    }
  } else if (m.kind === 'scale') {
    // weight gauge: notches above the pan fill amber toward the threshold
    const frac = Math.min(1, (m.reading ?? 0) / (m.threshold ?? 24));
    const sag = Math.round(frac * 2);
    for (let dx = 0; dx < m.w; dx++) s.setPx(m.x + dx, m.y + sag, 0.55, 0.43, 0.18);
    s.setPx(m.x - 1, m.y - 1 + sag, 0.32, 0.25, 0.12);
    s.setPx(m.x + m.w, m.y - 1 + sag, 0.32, 0.25, 0.12);
    for (let n = 0; n < 5; n++) {
      const gy = m.y - 9 - n;
      if (frac * 5 > n) s.setPx(m.x - 2, gy, 0.95, 0.7, 0.15);
      else s.setPx(m.x - 2, gy, 0.16, 0.13, 0.08);
    }
    if (m.state > 0) {
      const g = 0.6 + Math.sin(frame * 0.2) * 0.3;
      s.addPx(m.x + (m.w >> 1), m.y - 1, 0.9 * g, 0.75 * g, 0.2 * g);
    }
  } else if (m.kind === 'buoy' && m.zone) {
    // the float: a bobbing diamond riding the fill line, green when up
    const frac = Math.min(1, (m.reading ?? 0) / (m.threshold ?? 28));
    const fy = m.zone.y1 - Math.round((m.zone.y1 - m.zone.y0) * frac);
    const y2 = Math.round(fy - 1 + Math.sin(frame * 0.1 + m.x) * 0.8);
    const up = m.state > 0;
    const r2 = up ? 0.25 : 0.8,
      g2 = up ? 1.3 : 0.6,
      b2 = up ? 0.45 : 0.25;
    s.setPx(m.x, y2, r2, g2, b2);
    s.setPx(m.x - 1, y2 + 1, r2 * 0.6, g2 * 0.6, b2 * 0.6);
    s.setPx(m.x + 1, y2 + 1, r2 * 0.6, g2 * 0.6, b2 * 0.6);
  } else if (m.kind === 'chargelatch') {
    // the coil: cold cyan spiral, blazing white-blue once latched
    const latched = m.state === 1;
    const p2 = latched ? 1 : 0.45 + Math.sin(frame * 0.13 + m.y) * 0.25;
    s.setPx(m.x, m.y - 2, 0.3 * p2, 0.7 * p2, 1.1 * p2);
    s.setPx(m.x - 1, m.y - 3, 0.22 * p2, 0.5 * p2, 0.8 * p2);
    s.setPx(m.x + 1, m.y - 3, 0.22 * p2, 0.5 * p2, 0.8 * p2);
    s.setPx(m.x, m.y - 4, 0.35 * p2, 0.75 * p2, 1.2 * p2);
    if (latched && frame % 9 < 2) s.addPx(m.x, m.y - 5, 0.5, 0.9, 1.4);
  } else if (m.kind === 'valve') {
    if (m.state === 0) {
      // closed: faint amber pips at the slab corners hint "this moves"
      if (frame % 50 < 25) {
        s.addPx(m.x, m.y, 0.5, 0.38, 0.1);
        s.addPx(m.x + m.w - 1, m.y, 0.5, 0.38, 0.1);
        s.addPx(m.x, m.y + m.h - 1, 0.5, 0.38, 0.1);
        s.addPx(m.x + m.w - 1, m.y + m.h - 1, 0.5, 0.38, 0.1);
      }
    } else if (m.dissolve && m.dissolve.length > 0) {
      // retracting: grind shimmer dances along the slab's top edge
      const gx = m.x + ((frame * 2) % Math.max(1, m.w));
      s.addPx(gx, m.y - 1, 0.7, 0.65, 0.5);
      s.addPx(m.x + m.w - 1 - ((frame * 2) % Math.max(1, m.w)), m.y, 0.5, 0.45, 0.35);
    } else if (m.closeT !== undefined && m.closeT < 90) {
      // timed valve about to SLAM: urgent red-amber blink across the gap
      if (frame % 8 < 4) {
        for (let dx = 0; dx < m.w; dx += 2) s.addPx(m.x + dx, m.y + (m.h >> 1), 1.1, 0.3, 0.08);
      }
    }
  } else if (m.kind === 'plug') {
    if (m.state === 0 && m.body && m.body.length > 0) {
      // cracks spread across the seal as its body is eaten away — the
      // positions are hashed from the plug's own coords so they hold still
      const frac = 1 - Math.min(1, (m.reading ?? m.body.length) / m.body.length);
      const cracks = Math.floor(frac * 6);
      for (let k = 0; k < cracks; k++) {
        const cx = m.x + Math.floor(hash2(m.x + k * 7, m.y, 401) * m.w);
        const cy = m.y + Math.floor(hash2(m.x, m.y + k * 5, 631) * m.h);
        s.setPx(cx, cy, 0.06, 0.05, 0.04);
      }
      // a damaged seal sheds dust motes, faster as it weakens
      if (frac > 0 && frame % Math.max(6, 30 - cracks * 4) < 4) {
        s.addPx(m.x + (m.w >> 1), m.y - 1, 0.4, 0.3, 0.2);
      }
    }
  } else if (m.kind === 'sensor') {
    // a tuned crystal node: teal idle, ramping AMBER as the reading climbs
    // toward the threshold, steady green once satisfied
    const on = m.state > 0;
    if (on) {
      const p2 = 0.9 + Math.sin(frame * 0.2) * 0.15;
      s.setPx(m.x, m.y - 1, 0.2 * p2, 1.1 * p2, 0.5 * p2);
      s.setPx(m.x, m.y - 2, 0.3 * p2, 1.3 * p2, 0.6 * p2);
    } else {
      const ramp = Math.min(1, (m.reading ?? 0) / (m.threshold ?? 8));
      const p2 = 0.35 + Math.sin(frame * 0.09 + m.id) * 0.2 + ramp * 0.35;
      // lerp teal -> amber with the ramp: the node visibly "hears" it coming
      const r = 0.15 + ramp * 0.75,
        g = 0.7 + ramp * 0.1,
        b = 0.65 * (1 - ramp * 0.8);
      s.setPx(m.x, m.y - 1, r * p2, g * p2, b * p2);
      s.setPx(m.x, m.y - 2, r * 1.2 * p2, g * 1.2 * p2, b * 1.2 * p2);
    }
  } else if (m.kind === 'counterweight' && m.zone) {
    // the pan sags under the pour (overlay illusion, like the scale) while
    // the 5-notch gauge climbs amber; latched holds a green ingot glow
    const frac = m.state === 1 ? 1 : Math.min(1, (m.reading ?? 0) / (m.threshold ?? 30));
    const sag = Math.round(frac * 2);
    for (let dx = 0; dx < m.w; dx++) s.setPx(m.x + dx, m.y + sag, 0.38, 0.35, 0.3);
    s.setPx(m.x - 1, m.y - 1 + sag, 0.26, 0.24, 0.2);
    s.setPx(m.x + m.w, m.y - 1 + sag, 0.26, 0.24, 0.2);
    for (let n = 0; n < 5; n++) {
      const gy = m.y - 9 - n;
      if (frac * 5 > n) s.setPx(m.x - 2, gy, 0.85, 0.62, 0.12);
      else s.setPx(m.x - 2, gy, 0.14, 0.12, 0.08);
    }
    if (m.state === 1) {
      const g = 0.6 + Math.sin(frame * 0.16) * 0.25;
      s.addPx(m.x + (m.w >> 1), m.y - 1, 0.25 * g, 1.1 * g, 0.45 * g);
    }
  } else if (m.kind === 'relay') {
    // the rune-gear node: dim violet idle; while the fuse burns, sparks
    // CONVERGE on the core (radius shrinks with the remaining delay) over a
    // fast amber blink; steady green once fired
    const burning = m.fuseT !== undefined && m.state === 0;
    if (m.state === 1) {
      s.setPx(m.x, m.y - 2, 0.25, 1.0, 0.45);
      s.setPx(m.x, m.y - 3, 0.18, 0.75, 0.34);
    } else if (burning) {
      if (frame % 6 < 3) {
        s.setPx(m.x, m.y - 2, 1.2, 0.8, 0.25);
        s.addPx(m.x, m.y - 3, 0.9, 0.55, 0.15);
      }
      const total = Math.max(1, m.delayFrames ?? 1);
      const radius = 1.5 + 4 * Math.min(1, (m.fuseT ?? 0) / total);
      for (let k = 0; k < 3; k++) {
        const a = frame * 0.25 + (k * Math.PI * 2) / 3;
        s.addPx(
          m.x + Math.round(Math.cos(a) * radius),
          m.y - 2 + Math.round(Math.sin(a) * radius),
          1.0, 0.7, 0.2,
        );
      }
    } else {
      const p2 = 0.4 + Math.sin(frame * 0.11 + m.x) * 0.18;
      s.setPx(m.x, m.y - 2, 0.55 * p2, 0.45 * p2, 1.0 * p2);
      s.setPx(m.x, m.y - 3, 0.4 * p2, 0.32 * p2, 0.75 * p2);
    }
  }
  // a broken mechanism strobes a dying red cross while it groans
  if (m.broken !== undefined && m.broken > 0 && frame % 20 < 10) {
    const sh = frame % 4 < 2 ? -1 : 1;
    s.addPx(m.x + sh, m.y - 4, 0.9, 0.12, 0.08);
    s.addPx(m.x - 1 + sh, m.y - 3, 0.5, 0.07, 0.04);
    s.addPx(m.x + 1 + sh, m.y - 5, 0.5, 0.07, 0.04);
    s.addPx(m.x + 1 + sh, m.y - 3, 0.5, 0.07, 0.04);
    s.addPx(m.x - 1 + sh, m.y - 5, 0.5, 0.07, 0.04);
  }
}

/** The floating rune glyph above its pedestal (rune vault strike target). */
export function drawRuneGlyphSprite(s: PixelSurface, v: RuneVault, frame: number, bst: number): void {
  const p = v.active ? 0.9 : 0.55 + Math.sin(frame * 0.07 + v.rx) * 0.35;
  const cr = v.active ? 0.2 * bst * p : 0.7 * bst * p;
  const cg = v.active ? 0.9 * bst * p : 0.25 * bst * p;
  const cb = v.active ? 0.4 * bst * p : 0.95 * bst * p;
  s.setPx(v.rx, v.ry, cr, cg, cb);
  s.setPx(v.rx - 1, v.ry + 1, cr * 0.7, cg * 0.7, cb * 0.7);
  s.setPx(v.rx + 1, v.ry + 1, cr * 0.7, cg * 0.7, cb * 0.7);
  s.setPx(v.rx, v.ry - 1, cr * 0.8, cg * 0.8, cb * 0.8);
  s.setPx(v.rx, v.ry + 2, cr * 0.5, cg * 0.5, cb * 0.5);
}
