import type { Ctx, PlayerState } from '@/core/types';
import type { Chain } from '@/creatures/rig/chain';
import type { PlayerCostume } from '@/entities/playerCostume';
import type { Skeleton, V } from '@/entities/playerPose';
import { makeSkeleton, poseAlchemist } from '@/entities/playerPose';
import { hex } from '@/render/creatures/palette';
import type { CreatureMaterial, RGB } from '@/render/creatures/palette';
import type { LightField, PixelSurface } from '@/render/pixels';
import type { FighterLook } from '@/render/player/fighterLook';
import { drawFighterBody } from '@/render/player/FighterArt';
import { lookFor } from '@/render/player/looks';

/**
 * Selene's silver: the echoes she leaves (Quicksilver Echo) and the two that run with her (Mirror Hunt) are
 * drawn by the SAME body code as she is (`drawFighterBody`: her skeleton, her cloth, her look), through a
 * material table that turns every one of her materials into translucent mercury. So an echo has her
 * silhouette, her spear and her stride for free, and the terrain shows through it. The table keeps each
 * material's own light and dark (a dark suit stays darker than a bright face), only the colour is silver.
 *
 * Translucency comes in four steps (`level` 0 = most solid .. 3 = a ghost's ghost) so an echo can thin out
 * and flicker without a per-pixel alpha the rasterizer does not have.
 */

const TRANSLUCENT = [0.34, 0.5, 0.66, 0.8] as const;
export const LEVELS = TRANSLUCENT.length;

/** Silver by brightness: the colour of the table's tone at a base luminance 0..1. */
const SILVER_TONES: ReadonlyArray<readonly [number, RGB]> = [
  [0, hex(0x0c1220)],
  [0.3, hex(0x3a4c68)],
  [0.62, hex(0x8ca6c8)],
  [0.85, hex(0xd2e2f6)],
  [1, hex(0xf8fcff)],
];

function silverAt(lum: number): [number, number, number] {
  const L = lum < 0 ? 0 : lum > 1 ? 1 : lum;
  for (let i = 1; i < SILVER_TONES.length; i++) {
    const [t1, c1] = SILVER_TONES[i];
    if (L <= t1) {
      const [t0, c0] = SILVER_TONES[i - 1];
      const k = (L - t0) / Math.max(1e-6, t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  const last = SILVER_TONES[SILVER_TONES.length - 1][1];
  return [last[0], last[1], last[2]];
}

const OUTLINE: RGB = hex(0x7e96b8);

function silverOf(m: CreatureMaterial, translucent: number): CreatureMaterial {
  const steps = m.ramp.steps, rgb = new Float32Array(steps * 3);
  // Her own light parts (the blade, the eye) stay the brightest things on the figure.
  const lift = m.emissive > 0.5 ? 0.35 : 0;
  for (let j = 0; j < steps; j++) {
    const lum = m.ramp.rgb[j * 3] * 0.3 + m.ramp.rgb[j * 3 + 1] * 0.5 + m.ramp.rgb[j * 3 + 2] * 0.2;
    const c = silverAt(lum + lift);
    rgb[j * 3] = c[0]; rgb[j * 3 + 1] = c[1]; rgb[j * 3 + 2] = c[2];
  }
  // Her own ghost trail (already translucent in her look) stays fainter than the body it follows.
  const t = m.translucent > 0.6 ? Math.min(0.92, Math.max(translucent + 0.12, m.translucent)) : translucent;
  return {
    ramp: { steps, rgb },
    gloss: Math.max(m.gloss, 0.45),
    shine: m.shine,
    rim: Math.max(m.rim, 0.8),
    emissive: Math.max(m.emissive * 0.8, 0.3),
    glow: m.emissive > 0.5 ? [0.18, 0.3, 0.52] : [0.05, 0.08, 0.14],
    translucent: t,
    outline: OUTLINE,
    farDarken: m.farDarken * 0.8,
  };
}

const LOOKS: Array<FighterLook | null> = [];

/** Selene's look in silver at translucency step `level` (0..3), or null when her look is not loaded. */
export function silverLook(level: number): FighterLook | null {
  const i = level < 0 ? 0 : level >= LEVELS ? LEVELS - 1 : Math.round(level);
  const hit = LOOKS[i];
  if (hit !== undefined) return hit;
  const base = lookFor('selene-wraith');
  const look = base ? { ...base, mats: base.mats.map((m) => silverOf(m, TRANSLUCENT[i])) } : null;
  LOOKS[i] = look;
  return look;
}

// ======================================================================== copies of her pose

const SPOTS = [
  'hip', 'chest', 'neck', 'head', 'backKnee', 'backFoot', 'frontKnee', 'frontFoot', 'backElbow', 'backHand', 'frontElbow', 'frontHand', 'crown',
] as const;

/** Copy a skeleton into another (a frozen pose: the echo she leaves behind). */
export function copySkeleton(src: Skeleton, dst: Skeleton): Skeleton {
  for (const k of SPOTS) { dst[k].x = src[k].x; dst[k].y = src[k].y; }
  dst.kind = src.kind; dst.facing = src.facing; dst.lean = src.lean; dst.headTilt = src.headTilt;
  dst.gazeX = src.gazeX; dst.gazeY = src.gazeY; dst.eyesShut = src.eyesShut; dst.mouth = src.mouth;
  Object.assign(dst.wand, src.wand);
  dst.held = src.held ? { ...src.held } : null;
  dst.brimAngle = src.brimAngle; dst.crouch = src.crouch; dst.flare = src.flare; dst.lift = src.lift; dst.commune = src.commune;
  return dst;
}

const cloneChain = (c: Chain): Chain => ({ pts: c.pts.map((p) => ({ ...p })), seg: c.seg, radius: c.radius });

/** The cloth of a costume, copied (the echo's ponytail and scarf hang as they hung). */
export function cloneCostume(src: PlayerCostume, skel: Skeleton): PlayerCostume {
  return { tails: [cloneChain(src.tails[0]), cloneChain(src.tails[1])], mantle: cloneChain(src.mantle), crown: cloneChain(src.crown), skel, tick: src.tick, vial: src.vial, vialV: 0 };
}

/** Re-hang `dst`'s cloth where `src`'s is, moved by (dx, dy): a living copy follows her cloth without a second cloth simulation. */
export function moveCostume(src: PlayerCostume, dst: PlayerCostume, dx: number, dy: number): void {
  const pairs: Array<[Chain, Chain]> = [[src.tails[0], dst.tails[0]], [src.tails[1], dst.tails[1]], [src.mantle, dst.mantle], [src.crown, dst.crown]];
  for (const [s, d] of pairs) {
    const n = Math.min(s.pts.length, d.pts.length);
    for (let i = 0; i < n; i++) { d.pts[i].x = s.pts[i].x + dx; d.pts[i].y = s.pts[i].y + dy; }
  }
  dst.vial = src.vial;
}

/**
 * A stand-in for her body state that an echo is posed from: every field she has, read live (the stride, the
 * aim, the spear), but standing on the ground it rides and carrying none of her statuses (no flame, no
 * shock, no frost on a copy).
 */
export function ghostState(real: PlayerState): PlayerState {
  const g = Object.create(real) as PlayerState;
  Object.assign(g, {
    grounded: true, vy: 0, staggerT: 0, skidT: 0, climbing: false, wallGrabT: 0, inLiquid: false, diveT: 0, levitating: false,
    recharge: 0, pullT: 0, bloodStain: 0, kickT: 0, chill: undefined,
    status: { ...real.status, burning: 0, electrified: 0 },
  });
  return g;
}

/** A frozen copy of her as she stands now: what the echo she leaves is. */
export interface EchoShell {
  skel: Skeleton;
  costume: PlayerCostume | undefined;
  ghost: PlayerState;
}

export function snapshotShell(ctx: Ctx): EchoShell {
  const p = ctx.player;
  const skel = makeSkeleton();
  poseAlchemist(ctx, p, skel);
  const costume = p.costume ? cloneCostume(p.costume, skel) : undefined;
  const ghost = ghostState(p);
  // (a frozen copy is still: whatever she does next, its ponytail and its trail do not follow)
  Object.assign(ghost, { x: p.x, y: p.y, vx: 0, _svx: 0, firing: false });
  return { skel, costume, ghost };
}

/** A live copy of her, riding wherever it is put: the echoes of Mirror Hunt. */
export class LiveCopy {
  private readonly skel = makeSkeleton();
  private readonly ghost: PlayerState;
  private costume: PlayerCostume | undefined;

  constructor(ctx: Ctx) {
    this.ghost = ghostState(ctx.player);
  }

  /** Pose her as she moves right now at (x, y) (feet) and draw it at translucency `level`. */
  draw(out: PixelSurface, field: LightField, ctx: Ctx, x: number, y: number, level: number): void {
    const p = ctx.player;
    const g = this.ghost;
    g.x = x; g.y = y;
    poseAlchemist(ctx, g, this.skel);
    let costume: PlayerCostume | undefined;
    if (p.costume) {
      this.costume ??= cloneCostume(p.costume, this.skel);
      moveCostume(p.costume, this.costume, x - p.x, y - p.y);
      costume = this.costume;
    }
    drawBody(out, field, ctx, g, this.skel, costume, level);
  }
}

/** Draw a posed body in silver. On a surface without fine pixels (a legacy canvas) a plain additive figure stands in. */
export function drawBody(out: PixelSurface, field: LightField, ctx: Ctx, ghost: PlayerState, skel: Skeleton, costume: PlayerCostume | undefined, level: number): void {
  const look = silverLook(level);
  if (look && out.setFinePx) {
    drawFighterBody(out, field, ctx, ghost, skel, costume, null, 1, look);
    return;
  }
  drawFigure(out, skel, 1 - level / LEVELS);
}

/** The plain stand-in: limbs as additive dots. */
function drawFigure(out: PixelSurface, s: Skeleton, k: number): void {
  const seg = (a: V, b: V, w: number): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      for (let d = 0; d < w; d++) out.addPx(Math.round(a.x + (b.x - a.x) * t) + d, Math.round(a.y + (b.y - a.y) * t), 0.42 * k, 0.55 * k, 0.75 * k);
    }
  };
  seg(s.hip, s.chest, 3); seg(s.chest, s.head, 2); seg(s.hip, s.backKnee, 1); seg(s.backKnee, s.backFoot, 1);
  seg(s.hip, s.frontKnee, 1); seg(s.frontKnee, s.frontFoot, 1); seg(s.chest, s.frontHand, 1);
}

// ======================================================================== the marks around them

type Put = (this: PixelSurface, wx: number, wy: number, r: number, g: number, b: number) => void;

/** A ring of silver light on the ground: where the echo stands, and what the recall will return her to. */
export function drawGroundRing(out: PixelSurface, x: number, y: number, k: number, frame: number, calm: boolean): void {
  if (k <= 0.02) return;
  const step = out.pixelStep ?? 1;
  const add = (out.addFinePx ?? out.addPx) as Put;
  const pulse = calm ? 0.8 : 0.7 + 0.3 * Math.sin(frame * 0.18);
  const n = Math.max(24, Math.round(36 / step / 2));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (calm ? 0 : frame * 0.03);
    const wx = x + Math.cos(a) * 7.5, wy = y + 0.6 + Math.sin(a) * 1.7;
    add.call(out, wx, wy, 0.3 * k * pulse, 0.42 * k * pulse, 0.62 * k * pulse);
  }
}

/** A ring that grows and thins: an echo popping, a blink's ends. `t` is 0 (just now) .. 1 (gone). */
export function drawBurstRing(out: PixelSurface, x: number, y: number, t: number, radius: number): void {
  if (t >= 1) return;
  const step = out.pixelStep ?? 1;
  const add = (out.addFinePx ?? out.addPx) as Put;
  const r = 2 + radius * (1 - (1 - t) * (1 - t));
  const k = (1 - t) * (1 - t);
  const n = Math.max(20, Math.ceil((Math.PI * 2 * r) / Math.max(0.5, step * 2)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    add.call(out, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9, 0.5 * k, 0.66 * k, 0.95 * k);
  }
}
