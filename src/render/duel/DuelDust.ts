import type { Ctx, PlayerState } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';

/**
 * Footwork dust (Duel): the puffs a landing, a take-off, a mid-air jump, a sprint's start and a skid kick up, read from
 * the body's own state changes. Presentation only. One short list per slot, aged in game ticks (so a puff keeps rolling
 * through an impact hitstop), drawn under the fighters at presentation resolution.
 */
interface Puff { x: number; y: number; vx: number; vy: number; r: number; born: number; life: number; ring: boolean }
interface Track { frame: number; grounded: boolean; vx: number; vy: number; puffs: Puff[] }

const tracks = new Map<number, Track>();
const MAX_PUFFS = 24;
const DUST: readonly [number, number, number] = [.66, .6, .52];

/** What the body did since the last tick it was seen, as puffs. */
function sense(t: Track, p: PlayerState, frame: number): void {
  const push = (x: number, y: number, vx: number, vy: number, r: number, life: number, ring = false): void => {
    if (t.puffs.length < MAX_PUFFS) t.puffs.push({ x, y, vx, vy, r, born: frame, life, ring });
  };
  if (!t.grounded && p.grounded && t.vy > 1.4) {
    // A landing: two low clouds roll out from the feet, bigger the harder the fall.
    const k = Math.min(1, (t.vy - 1.4) / 5);
    for (const s of [-1, 1]) {
      push(p.x + s * 3, p.y, s * (.45 + .6 * k), -.04, 2 + 1.6 * k, 16 + Math.round(6 * k));
      push(p.x + s * 6, p.y, s * (.8 + .5 * k), -.08, 1.3 + k, 12);
    }
  } else if (t.grounded && !p.grounded && p.vy < -1) {
    // A take-off: a burst under the feet.
    push(p.x, p.y, 0, .04, 2.2, 14);
    push(p.x - 3, p.y, -.4, 0, 1.4, 11);
    push(p.x + 3, p.y, .4, 0, 1.4, 11);
  } else if (!t.grounded && !p.grounded && p.vy < -1 && p.vy - t.vy < -2.2) {
    // A jump in the air: a ring kicked off under the feet.
    push(p.x, p.y + 1, 0, .2, 3, 14, true);
  }
  if (p.grounded && t.grounded) {
    const turn = Math.sign(p.vx) !== Math.sign(t.vx) && Math.abs(t.vx) > 1.1;
    const start = Math.abs(t.vx) < .6 && Math.abs(p.vx) > 1.3;
    if (turn || start) {
      const back = -(Math.sign(p.vx) || 1);
      push(p.x + back * 4, p.y, back * .7, -.04, 1.8, 13);
      push(p.x + back * 7, p.y, back * .5, -.08, 1.2, 10);
    }
  }
}

export function drawDuelDust(out: PixelSurface, ctx: Ctx): void {
  const arena = ctx.arena;
  if (!arena?.stockMatch) return;
  const p = ctx.player, slot = arena.bound, frame = ctx.state.frameCount;
  let t = tracks.get(slot);
  if (!t) { t = { frame, grounded: p.grounded, vx: p.vx, vy: p.vy, puffs: [] }; tracks.set(slot, t); }
  if (frame !== t.frame) {
    // A gap (a respawn, a reload) is not a landing.
    if (!p.dead && frame - t.frame > 0 && frame - t.frame < 4) sense(t, p, frame);
    t.frame = frame; t.grounded = p.grounded; t.vx = p.vx; t.vy = p.vy;
  }
  if (!out.blendFinePx || t.puffs.length === 0) { if (t.puffs.length) t.puffs = t.puffs.filter(f => frame - f.born < f.life); return; }
  const step = out.pixelStep ?? 1;
  let kept = 0;
  for (const f of t.puffs) {
    const age = frame - f.born;
    if (age >= f.life || age < 0) continue;
    t.puffs[kept++] = f;
    const u = age / f.life, cx = f.x + f.vx * age, floor = f.y + .5;
    if (f.ring) {
      const rx = f.r * (1 + 2.2 * u), ry = rx * .3, a = .5 * (1 - u);
      for (let ang = 0; ang < Math.PI * 2; ang += step / Math.max(2, rx)) {
        out.blendFinePx(cx + Math.cos(ang) * rx, f.y + f.vy * age + Math.sin(ang) * ry, DUST[0] * a * 1.2, DUST[1] * a * 1.2, DUST[2] * a * 1.2, a);
      }
      continue;
    }
    const r = f.r * (1.15 + .9 * u), cy = f.y - .5 - r * .45 * u + f.vy * age, a0 = .58 * Math.pow(1 - u, 1.4);
    for (let y = -r; y <= r; y += step) {
      if (cy + y > floor) break; // dust sits on the deck, never in it
      for (let x = -r; x <= r; x += step) {
        const d = (x * x + y * y) / (r * r);
        if (d > 1) continue;
        const a = a0 * (1 - d * .7);
        out.blendFinePx(cx + x, cy + y, DUST[0] * a, DUST[1] * a, DUST[2] * a, a);
      }
    }
  }
  t.puffs.length = kept;
}
