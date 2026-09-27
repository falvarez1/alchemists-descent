import type { Ctx, Enemy, EnemyKind } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';
import { EYESHINE } from '@/config/darkness';
import { weaverLegGeometry } from '@/creatures/weaverAnatomy';
import { EYE_MARKS } from './anatomy';
import type { SceneLight } from './raster';

/**
 * EYESHINE AND GLOW MARKINGS (light wave). In designed darkness a creature is
 * black until light finds it — but its eyes are not: they hold a faint glow of
 * their own, and when the wand's light lands on a face turned toward the
 * lantern they flash back like a cat's in a headlamp. Species with living
 * markings (the Weaver's leg tips, the Rillback's lateral line, a slime's
 * core, the Stone Maw's jaw seams) show them too. Everything here is additive
 * overlay light drawn at the rig's real anchors after the body resolves, so
 * it composes identically on the CPU, WebGL2 and WebGPU paths.
 *
 * The reveal: a body in the dark resolves out of the black through an
 * ordered dither as the light finds it (fast), and sinks back slowly after.
 */

type RGB = readonly [number, number, number];

const EYE_COLOR: Partial<Record<EnemyKind, RGB>> = {
  weaver: [0.36, 1, 0.56],
  bat: [1, 0.26, 0.12],
  slime: [0.78, 1, 0.62],
  acidslime: [0.62, 1, 0.2],
  bomber: [1, 0.62, 0.22],
  spitter: [0.92, 1, 0.32],
  imp: [1, 0.56, 0.14],
  wisp: [0.56, 0.86, 1],
  golem: [1, 0.52, 0.16],
  colossus: [1, 0.46, 0.12],
  mage: [0.76, 0.42, 1],
  rillback: [0.42, 0.92, 1],
  leviathan: [0.52, 1, 0.9],
  rootloper: [1, 0.72, 0.22],
};
const DEFAULT_EYE: RGB = [0.9, 0.92, 0.72];

interface RevealState { reveal: number; tick: number }
const REVEAL = new WeakMap<Enemy, RevealState>();

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of this body the light has found (0..1), eased per tick. Outside
 * designed darkness it is always 1 (no dither in the readable world).
 */
export function revealFor(ctx: Ctx, e: Enemy, light: SceneLight, x: number, y: number): number {
  const q = ctx.lightQuery;
  const dark = q ? q.darkness(x, y) : 0;
  let st = REVEAL.get(e);
  if (!st) { st = { reveal: 1, tick: ctx.state.frameCount }; REVEAL.set(e, st); }
  const dt = Math.max(0, Math.min(6, ctx.state.frameCount - st.tick));
  st.tick = ctx.state.frameCount;
  if (dark < 0.4) { st.reveal = 1; return 1; }
  const lum = light.r * 0.3 + light.g * 0.5 + light.b * 0.2;
  const target = smooth(EYESHINE.revealLit * 0.6, EYESHINE.revealLit * 3.2, lum);
  if (target > st.reveal) st.reveal = Math.min(target, st.reveal + EYESHINE.revealRise * dt);
  else st.reveal = Math.max(target, st.reveal - EYESHINE.revealFall * dt);
  return st.reveal;
}

/** One soft additive glow blob at fine resolution. */
function glowAt(out: PixelSurface, x: number, y: number, radius: number, c: RGB, k: number): void {
  if (k <= 0.004) return;
  const add = out.addFinePx ?? out.addPx;
  const step = out.addFinePx ? (out.pixelStep ?? 1) : 1;
  const R = Math.max(step, radius);
  const inv = 1 / (R * R);
  for (let dy = -R; dy <= R + 1e-6; dy += step) {
    for (let dx = -R; dx <= R + 1e-6; dx += step) {
      const d2 = (dx * dx + dy * dy) * inv;
      if (d2 > 1) continue;
      const f = (1 - d2) * (1 - d2) * k;
      add.call(out, x + dx, y + dy, c[0] * f, c[1] * f, c[2] * f);
    }
  }
}

/**
 * Eyes (recorded by the species draw via markEye) and glow markings, scaled
 * by how dark the place is. `life` is the creature's own glow (a corpse's
 * eyes are dead: nothing is drawn).
 */
export function drawEyeshine(out: PixelSurface, ctx: Ctx, e: Enemy, life: number): void {
  const q = ctx.lightQuery;
  if (!q || life < 0.999) return;
  const p = ctx.player;
  const lid = e.sleeping ? 1 : (e.expression?.lid ?? 0);
  const open = Math.max(0, 1 - lid * 1.15);
  const col = EYE_COLOR[e.kind] ?? DEFAULT_EYE;
  // Facing the lantern: the gaze (or the body's facing) points at the wizard.
  const gx = e.expression?.gazeX ?? e.mind?.facing ?? 0;
  const toP = Math.sign(p.x - e.x) || 1;
  const facing = gx * toP > 0.05 || Math.abs(p.x - e.x) < 14 ? 1 : 0.18;
  const m = EYE_MARKS;
  if (open > 0.05) {
    for (let k = 0; k < m.n; k++) {
      const x = m.x[k], y = m.y[k], size = m.r[k];
      const dark = q.darkness(x, y);
      if (dark < EYESHINE.minDark) continue;
      const darkK = smooth(EYESHINE.minDark, 0.85, dark);
      const wand = q.wandLight(x, y);
      const retro = Math.min(1, wand / EYESHINE.retroFull) * facing;
      const I = darkK * open * (EYESHINE.base + retro * EYESHINE.retro);
      // A pin-point core and a soft halo; the retro flash widens the halo.
      glowAt(out, x, y, 0.5 + size * 0.5, col, I * 0.9);
      glowAt(out, x, y, 2.2 + size * 1.4 + retro * 1.8, col, I * 0.2);
    }
  }
  drawMarkings(out, ctx, e);
}

/** Living markings: only where it is dark enough for them to matter. */
function drawMarkings(out: PixelSurface, ctx: Ctx, e: Enemy): void {
  const q = ctx.lightQuery!;
  const dark = q.darkness(e.x, e.y - 6);
  if (dark < EYESHINE.minDark) return;
  const k = smooth(EYESHINE.minDark, 0.85, dark) * EYESHINE.marking;
  const t = ctx.state.frameCount;
  switch (e.kind) {
    case 'weaver': {
      // The glowing phalanges: each foot tip carries a pale green spark that
      // pulses along the legs in the order they step.
      const missing = e.weaverMissingLegs ?? 0;
      for (let i = 0; i < 8; i++) {
        if (missing & (1 << i)) continue;
        const foot = weaverLegGeometry(e, i)[4];
        const pulse = 0.7 + Math.sin(t * 0.09 + i * 0.8 + e.bobPhase) * 0.3;
        glowAt(out, foot.x, foot.y, 1.0, [0.6, 1, 0.76], k * 1.1 * pulse);
        glowAt(out, foot.x, foot.y, 2.6, [0.3, 0.9, 0.5], k * 0.2 * pulse);
      }
      break;
    }
    case 'rillback': {
      const nodes = e.body?.nodes;
      if (!nodes) break;
      for (let i = 1; i < nodes.length - 1; i++) {
        const on = ((t >> 3) + i) % 5 !== 0 ? 1 : 0.35;
        glowAt(out, nodes[i].x, nodes[i].y, 1.5, [0.35, 0.85, 1], k * 0.28 * on);
      }
      break;
    }
    case 'slime':
    case 'acidslime':
    case 'bomber': {
      const c = e.rig?.soft;
      const cx = c?.cx ?? e.x, cy = c?.cy ?? e.y - 4;
      const beat = 0.75 + Math.sin(t * 0.07 + e.bobPhase * 3) * 0.25;
      const col: RGB = e.kind === 'acidslime' ? [0.5, 1, 0.16] : e.kind === 'bomber' ? [1, 0.55, 0.16] : [0.62, 1, 0.66];
      glowAt(out, cx, cy + 0.6, 2.4, col, k * 0.42 * beat);
      break;
    }
    case 'stonemaw': {
      // Blind: no eyes to shine. Its jaw seams smoulder instead.
      const head = e.body?.nodes[0];
      if (!head) break;
      const beat = 0.8 + Math.sin(t * 0.1) * 0.2;
      glowAt(out, head.x, head.y - 0.6, 2.8, [1, 0.55, 0.14], k * 0.5 * beat);
      const nodes = e.body!.nodes;
      for (let i = 1; i < nodes.length; i++) glowAt(out, nodes[i].x, nodes[i].y - 0.6, 1.3, [1, 0.5, 0.1], k * 0.18);
      break;
    }
    case 'rootloper': {
      // Spores and root tips: a faint amber breath around the crown.
      glowAt(out, e.x, e.y - 12, 3.2, [1, 0.72, 0.3], k * 0.12);
      break;
    }
    default:
      break;
  }
}
