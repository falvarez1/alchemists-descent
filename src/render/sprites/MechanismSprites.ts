import type { Mechanism, RuneVault } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';
import { hash2 } from '@/core/math';
import { BRASS, BRASS_L, INK, IRON, IRON_D, Pen, STEEL, type RGB } from './FineArt';

/**
 * Procedural mechanism overlays (extracted from FrameComposer so the Builder
 * gallery previews animate with the SAME code the game renders with): lever
 * arms sweep, plates dip, braziers gutter, scales sag, buoys bob, coils
 * spark — and the machine primitives read their states (valve pips, plug
 * cracks, sensor ramps, counterweight sag, relay fuses).
 *
 * Everything here is presentation over real cells: stateless per frame,
 * driven only by the mechanism's own fields and the frame counter, and
 * rasterised at the surface's presentation step (half a cell on the fine
 * surface, whole cells in the gallery). Callers cull off-camera mechanisms
 * before calling.
 */

export interface MechanismSpriteOptions {
  /** Scene light at the fixture; brass and iron take the room's lamps. */
  light?: RGB;
  /** Handwheel rotation (radians) — the sluice's spring-damped valve turn. */
  turn?: number;
}

const OAK: RGB = [0.55, 0.42, 0.2];
const OAK_D: RGB = [0.33, 0.24, 0.1];
const LAMP_ON: RGB = [0.2, 1.6, 0.4];
const LAMP_OFF: RGB = [1.6, 0.3, 0.15];
const LAMP_PULL: RGB = [1.1, 1.0, 0.7];

/** 0 at rest on the current side, sweeping to 1 as the 26-frame pull lands. */
export function pullProgress(m: Pick<Mechanism, 'pullT'>): number {
  if (m.pullT === undefined || m.pullT <= 0) return 0;
  const p = 1 - m.pullT / 26;
  return p * p * (3 - 2 * p); // smoothstep: heavy start, firm finish
}

/** Where the crank handle rests: a pull swings it half a turn, so the
 * lever's state is literally which side the handle came to rest on. */
export function crankAngle(m: Pick<Mechanism, 'pullT' | 'state'>): number {
  const dir = m.state === 1 ? 1 : -1;
  return (m.state === 1 ? Math.PI : 0) - Math.PI * pullProgress(m) * dir + Math.PI * 0.5;
}

/** The Bell & Tea Engine's starter: a brass crank wheel on an iron stand,
 * its handle swinging half a turn per pull, a connecting rod running to the
 * striker rod's foot. */
function drawCrank(p: Pen, m: Mechanism, frame: number): void {
  const ax = m.x, ay = m.y - 5, r = 7.5, floor = m.y + 7;
  const angle = crankAngle(m);
  // Stand: a riveted foot plate and two iron legs meeting at the bearing.
  p.box(ax, floor - 0.5, 6.5, 0.75, 0, IRON);
  p.rivet(ax - 4.5, floor - 1); p.rivet(ax + 4.5, floor - 1);
  p.rod(ax - 4.5, floor - 1, ax - 1, ay + 1.5, IRON_D, 1.4);
  p.rod(ax + 4.5, floor - 1, ax + 1, ay + 1.5, IRON, 1.4);
  p.rod(ax, ay + 4, ax, floor - 1, IRON, 1.5);
  // Backing disc so the spokes read against any wall.
  p.disc(ax, ay, r + 0.5, IRON_D, INK, p.step, true);
  p.wheel(ax, ay, r, angle, { spokes: 6, handle: true, rimWidth: 1.6 });
  // Connecting rod from the crank pin to the real striker rod's foot.
  const pinX = ax + Math.cos(angle) * (r - 1.6), pinY = ay + Math.sin(angle) * (r - 1.6);
  p.rod(pinX, pinY, ax + 12, ay - 10, STEEL, 1);
  p.disc(pinX, pinY, 1.1, BRASS_L, INK);
  p.disc(ax + 12, ay - 10, 1.2, BRASS, INK);
  // Indicator lamp on the bearing: ready (red) / engine started (green).
  const pulse = 0.7 + Math.sin(frame * 0.1) * 0.2;
  const lamp = pullProgress(m) > 0 ? LAMP_PULL : m.state === 1 ? LAMP_ON : LAMP_OFF;
  p.raw(ax - 3, ay + 5.5, lamp, pulse);
  p.glow(ax - 3, ay + 5.5, lamp, 0.35 * pulse);
}

/** The sluice's handwheel on an iron column. It turns with the valve's own
 * spring-damped travel (clockwise to open, back to close). */
function drawHandwheel(p: Pen, m: Mechanism, frame: number, turn: number): void {
  const cx = m.x, cy = m.y - 14, r = 10.5, foot = m.y + 13;
  // Column with a flared foot, rivets and a gear box under the axle.
  p.box(cx, foot - 0.75, 7, 0.75, 0, IRON);
  p.box(cx, foot - 2.5, 5, 1, 0, IRON_D);
  p.rod(cx, cy + 3, cx, foot - 3, IRON, 4);
  for (let y = cy + 6; y < foot - 4; y += 3) { p.rivet(cx - 1.5, y); p.rivet(cx + 1.5, y + 1.5); }
  p.box(cx, cy + 2.5, 4.5, 2.5, 0, IRON_D);
  p.rivet(cx - 3, cy + 1); p.rivet(cx + 3, cy + 1); p.rivet(cx - 3, cy + 4); p.rivet(cx + 3, cy + 4);
  p.disc(cx, cy, r + 0.5, IRON_D, INK, p.step, true);
  p.wheel(cx, cy, r, turn, { spokes: 6, rimWidth: 1.8, groove: true });
  // Three grip pegs ride the rim.
  for (let i = 0; i < 3; i++) {
    const a = turn + i * Math.PI * 2 / 3 + Math.PI / 6;
    p.disc(cx + Math.cos(a) * (r - 0.9), cy + Math.sin(a) * (r - 0.9), 1, BRASS_L, INK);
  }
  const pulse = 0.7 + Math.sin(frame * 0.1) * 0.2;
  const lamp = pullProgress(m) > 0 ? LAMP_PULL : m.state === 1 ? LAMP_ON : LAMP_OFF;
  p.raw(cx + 3, cy + r + 2.5, lamp, pulse);
  p.glow(cx + 3, cy + r + 2.5, lamp, 0.3 * pulse);
}

function drawLever(p: Pen, m: Mechanism, frame: number): void {
  // base bracket: an iron plate with a pivot boss
  p.box(m.x, m.y, 1.75, 0.5, 0, IRON);
  p.disc(m.x, m.y - 1, 0.9, IRON_D, INK);
  // the arm: snapped to its side at rest, SWEEPING during a hand-pull
  // (state flips only when the pull completes, so animate from the
  // current side toward its opposite)
  const dir = m.state === 1 ? 1 : -1;
  const pulling = pullProgress(m) > 0;
  const lean = dir + (-dir - dir) * pullProgress(m);
  const tipX = m.x + 3 * lean, tipY = m.y - 5 + (pulling && Math.abs(lean) < 0.4 ? -1 : 0);
  p.rod(m.x, m.y - 1, tipX, tipY, OAK, 1);
  p.line(m.x, m.y - 1, m.x + (tipX - m.x) * 0.3, m.y - 1 + (tipY - m.y + 1) * 0.3, OAK_D, 0);
  // glowing knob rides the arm tip; strains white mid-pull
  const g = 0.7 + Math.sin(frame * 0.1) * 0.2;
  const lamp = pulling ? LAMP_PULL : m.state === 1 ? LAMP_ON : LAMP_OFF;
  p.raw(tipX, tipY, lamp, pulling ? 1 : g);
  p.raw(tipX - p.step, tipY, lamp, (pulling ? 1 : g) * 0.6);
  p.raw(tipX, tipY - p.step, lamp, (pulling ? 1 : g) * 0.6);
}

function drawGauge(p: Pen, x: number, y: number, frac: number, lit: RGB, dim: RGB): void {
  for (let n = 0; n < 5; n++) {
    const gy = y - 9 - n;
    const on = frac * 5 > n;
    p.raw(x - 2, gy, on ? lit : dim);
    p.raw(x - 2 + p.step, gy, on ? lit : dim, 0.8);
  }
}

export function drawMechanismSprite(s: PixelSurface, m: Mechanism, frame: number, opts: MechanismSpriteOptions = {}): void {
  const p = new Pen(s, null, opts.light ?? [1, 1, 1]);
  if (m.kind === 'lever') {
    if (m.look === 'crank') drawCrank(p, m, frame);
    else if (m.look === 'handwheel') drawHandwheel(p, m, frame, opts.turn ?? 0);
    else drawLever(p, m, frame);
  } else if (m.kind === 'plate') {
    // pressure plates physically dip before the amber latch glow takes over
    const sink = m.pressed ? 1 : 0;
    p.box(m.x + (m.w - 1) / 2, m.y + sink, m.w / 2, 0.5, 0, [0.52, 0.45, 0.22]);
    if (m.pressed || m.state > 0) {
      const g = 0.5 + Math.sin(frame * 0.18) * 0.25;
      for (let dx = 0; dx < m.w; dx += 2) p.glow(m.x + dx, m.y - 1 + sink, [0.9, 0.75, 0.2], g);
    }
  } else if (m.kind === 'brazier') {
    p.arc(m.x, m.y - 2.5, 2.2, Math.PI * 0.15, Math.PI * 0.85, IRON, 0.5);
    if (m.state === 0) {
      // dark bowls hint at what they want
      if (frame % 40 < 20) p.glow(m.x, m.y - 2, [0.25, 0.12, 0.04]);
    } else {
      const flame = 0.7 + Math.sin(frame * 0.21 + m.x) * 0.25 + Math.random() * 0.18;
      for (let t = 0; t < 3; t += p.step) {
        const sway = Math.sin(frame * 0.3 + t * 2) * 0.4 * t;
        p.glow(m.x + sway, m.y - 2 - t, [1.0, 0.48, 0.08], flame * (1 - t / 4));
        p.glow(m.x - 1 + sway * 0.5, m.y - 1.5 - t * 0.6, [0.65, 0.28, 0.05], flame * (1 - t / 3));
        p.glow(m.x + 1 + sway * 0.5, m.y - 1.5 - t * 0.6, [0.65, 0.28, 0.05], flame * (1 - t / 3));
      }
    }
  } else if (m.kind === 'scale') {
    // weight gauge: notches above the pan fill amber toward the threshold
    const frac = Math.min(1, (m.reading ?? 0) / (m.threshold ?? 24));
    const sag = Math.round(frac * 2);
    p.box(m.x + (m.w - 1) / 2, m.y + sag, m.w / 2, 0.5, 0, [0.55, 0.43, 0.18]);
    p.rod(m.x - 1, m.y - 1 + sag, m.x - 1, m.y + sag + 1, [0.32, 0.25, 0.12], 0.5);
    p.rod(m.x + m.w, m.y - 1 + sag, m.x + m.w, m.y + sag + 1, [0.32, 0.25, 0.12], 0.5);
    drawGauge(p, m.x, m.y, frac, [0.95, 0.7, 0.15], [0.16, 0.13, 0.08]);
    if (m.state > 0) {
      const g = 0.6 + Math.sin(frame * 0.2) * 0.3;
      p.glow(m.x + (m.w >> 1), m.y - 1, [0.9, 0.75, 0.2], g);
    }
  } else if (m.kind === 'buoy' && m.zone) {
    // the float: a bobbing diamond riding the fill line, green when up
    const frac = Math.min(1, (m.reading ?? 0) / (m.threshold ?? 28));
    const fy = m.zone.y1 - Math.round((m.zone.y1 - m.zone.y0) * frac);
    const y2 = fy - 1 + Math.sin(frame * 0.1 + m.x) * 0.8;
    const up = m.state > 0;
    const c: RGB = up ? [0.25, 1.3, 0.45] : [0.8, 0.6, 0.25];
    p.polygon([[m.x, y2 - 1.2], [m.x + 1.6, y2 + 0.6], [m.x, y2 + 1.6], [m.x - 1.6, y2 + 0.6]], c, 1, 0.4);
    p.raw(m.x, y2, c, 1.1);
  } else if (m.kind === 'chargelatch') {
    // the coil: cold cyan spiral, blazing white-blue once latched
    const latched = m.state === 1;
    const p2 = latched ? 1 : 0.45 + Math.sin(frame * 0.13 + m.y) * 0.25;
    for (let a = 0; a < Math.PI * 4; a += 0.25) {
      const r = 0.6 + a * 0.22;
      p.raw(m.x + Math.cos(a) * r, m.y - 3 + Math.sin(a) * r * 0.7, [0.3, 0.7, 1.1], p2 * (0.7 + (a / (Math.PI * 4)) * 0.4));
    }
    if (latched && frame % 9 < 2) p.glow(m.x, m.y - 5, [0.5, 0.9, 1.4]);
  } else if (m.kind === 'valve') {
    if (m.state === 0) {
      // closed: faint amber pips at the slab corners hint "this moves"
      if (frame % 50 < 25) {
        p.glow(m.x, m.y, [0.5, 0.38, 0.1]);
        p.glow(m.x + m.w - 1, m.y, [0.5, 0.38, 0.1]);
        p.glow(m.x, m.y + m.h - 1, [0.5, 0.38, 0.1]);
        p.glow(m.x + m.w - 1, m.y + m.h - 1, [0.5, 0.38, 0.1]);
      }
    } else if (m.dissolve && m.dissolve.length > 0) {
      // retracting: grind shimmer dances along the slab's top edge
      const gx = m.x + ((frame * 2) % Math.max(1, m.w));
      p.glow(gx, m.y - 1, [0.7, 0.65, 0.5]);
      p.glow(m.x + m.w - 1 - ((frame * 2) % Math.max(1, m.w)), m.y, [0.5, 0.45, 0.35]);
    } else if (m.closeT !== undefined && m.closeT < 90) {
      // timed valve about to SLAM: urgent red-amber blink across the gap
      if (frame % 8 < 4) {
        for (let dx = 0; dx < m.w; dx += 2) p.glow(m.x + dx, m.y + (m.h >> 1), [1.1, 0.3, 0.08]);
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
        const ex = cx + (hash2(cx, cy, 77) - 0.5) * 2, ey = cy + (hash2(cy, cx, 91) - 0.5) * 2;
        p.line(cx, cy, ex, ey, [0.06, 0.05, 0.04]);
      }
      // a damaged seal sheds dust motes, faster as it weakens
      if (frac > 0 && frame % Math.max(6, 30 - cracks * 4) < 4) {
        p.glow(m.x + (m.w >> 1), m.y - 1, [0.4, 0.3, 0.2]);
      }
    }
  } else if (m.kind === 'sensor') {
    // a tuned crystal node: teal idle, ramping AMBER as the reading climbs
    // toward the threshold, steady green once satisfied
    const on = m.state > 0;
    let c: RGB, p2: number;
    if (on) {
      p2 = 0.9 + Math.sin(frame * 0.2) * 0.15;
      c = [0.25, 1.2, 0.55];
    } else {
      const ramp = Math.min(1, (m.reading ?? 0) / (m.threshold ?? 8));
      p2 = 0.35 + Math.sin(frame * 0.09 + m.id) * 0.2 + ramp * 0.35;
      // lerp teal -> amber with the ramp: the node visibly "hears" it coming
      c = [0.15 + ramp * 0.75, 0.7 + ramp * 0.1, 0.65 * (1 - ramp * 0.8)];
    }
    p.polygon([[m.x, m.y - 3.4], [m.x + 1.1, m.y - 1.6], [m.x, m.y - 0.4], [m.x - 1.1, m.y - 1.6]], c, p2, 0.35);
    p.raw(m.x, m.y - 2, c, p2 * 1.25);
  } else if (m.kind === 'counterweight' && m.zone) {
    // the pan sags under the pour (overlay illusion, like the scale) while
    // the 5-notch gauge climbs amber; latched holds a green ingot glow
    const frac = m.state === 1 ? 1 : Math.min(1, (m.reading ?? 0) / (m.threshold ?? 30));
    const sag = Math.round(frac * 2);
    p.box(m.x + (m.w - 1) / 2, m.y + sag, m.w / 2, 0.5, 0, [0.38, 0.35, 0.3]);
    p.rod(m.x - 1, m.y - 1 + sag, m.x - 1, m.y + sag + 1, [0.26, 0.24, 0.2], 0.5);
    p.rod(m.x + m.w, m.y - 1 + sag, m.x + m.w, m.y + sag + 1, [0.26, 0.24, 0.2], 0.5);
    drawGauge(p, m.x, m.y, frac, [0.85, 0.62, 0.12], [0.14, 0.12, 0.08]);
    if (m.state === 1) {
      const g = 0.6 + Math.sin(frame * 0.16) * 0.25;
      p.glow(m.x + (m.w >> 1), m.y - 1, [0.25, 1.1, 0.45], g);
    }
  } else if (m.kind === 'relay') {
    // the rune-gear node: dim violet idle; while the fuse burns, sparks
    // CONVERGE on the core (radius shrinks with the remaining delay) over a
    // fast amber blink; steady green once fired
    const burning = m.fuseT !== undefined && m.state === 0;
    if (m.state === 1) {
      p.wheel(m.x, m.y - 2.5, 2, 0, { spokes: 4, rim: [0.25, 1.0, 0.45], face: [0.1, 0.4, 0.2], hub: [0.25, 1.0, 0.45] });
    } else if (burning) {
      if (frame % 6 < 3) p.wheel(m.x, m.y - 2.5, 2, frame * 0.2, { spokes: 4, rim: [1.2, 0.8, 0.25], face: [0.4, 0.25, 0.08], hub: [1.2, 0.8, 0.25] });
      const total = Math.max(1, m.delayFrames ?? 1);
      const radius = 1.5 + 4 * Math.min(1, (m.fuseT ?? 0) / total);
      for (let k = 0; k < 3; k++) {
        const a = frame * 0.25 + (k * Math.PI * 2) / 3;
        p.glow(m.x + Math.cos(a) * radius, m.y - 2 + Math.sin(a) * radius, [1.0, 0.7, 0.2]);
      }
    } else {
      const p2 = 0.4 + Math.sin(frame * 0.11 + m.x) * 0.18;
      p.wheel(m.x, m.y - 2.5, 2, 0, { spokes: 4, rim: [0.55 * p2, 0.45 * p2, 1.0 * p2], face: [0.2 * p2, 0.15 * p2, 0.4 * p2], hub: [0.4 * p2, 0.32 * p2, 0.75 * p2] });
    }
  }
  // a broken mechanism strobes a dying red cross while it groans
  if (m.broken !== undefined && m.broken > 0 && frame % 20 < 10) {
    const sh = frame % 4 < 2 ? -1 : 1;
    p.glow(m.x + sh, m.y - 4, [0.9, 0.12, 0.08]);
    p.line(m.x - 1 + sh, m.y - 3, m.x + 1 + sh, m.y - 5, [0.5, 0.07, 0.04]);
    p.line(m.x + 1 + sh, m.y - 3, m.x - 1 + sh, m.y - 5, [0.5, 0.07, 0.04]);
  }
}

/** The floating rune glyph above its pedestal (rune vault strike target). */
export function drawRuneGlyphSprite(s: PixelSurface, v: RuneVault, frame: number, bst: number): void {
  const p = new Pen(s);
  const pulse = v.active ? 0.9 : 0.55 + Math.sin(frame * 0.07 + v.rx) * 0.35;
  const c: RGB = v.active ? [0.2 * bst * pulse, 0.9 * bst * pulse, 0.4 * bst * pulse] : [0.7 * bst * pulse, 0.25 * bst * pulse, 0.95 * bst * pulse];
  p.line(v.rx, v.ry - 1.2, v.rx + 1.2, v.ry + 1, c, 0, 0.8);
  p.line(v.rx + 1.2, v.ry + 1, v.rx, v.ry + 2.2, c, 0, 0.6);
  p.line(v.rx, v.ry + 2.2, v.rx - 1.2, v.ry + 1, c, 0, 0.6);
  p.line(v.rx - 1.2, v.ry + 1, v.rx, v.ry - 1.2, c, 0, 0.8);
  p.raw(v.rx, v.ry, c);
  p.raw(v.rx, v.ry + 1, c, 0.7);
}
