import type { Ctx, Enemy } from '@/core/types';
import { clamp, lerp } from '@/core/math';
import { blocksEntity } from '@/sim/CellType';
import { createChain, tickChain } from './body';

/** All integration is simulation-owned. Rendering can sample this state any number of times. */
export function tickCreaturePose(ctx: Ctx, e: Enemy): void {
  const frame = ctx.state.frameCount;
  if (e.kind === 'slime' || e.kind === 'acidslime' || e.kind === 'bomber') {
    if (e.grounded && !e.prevG && Math.abs(e.vy) < 0.1) e.splat = 8;
    e.prevG = e.grounded;
    if (e.splat > 0) e.splat--;
    if (e.kind !== 'bomber') {
      if (e.blink > 0) e.blink--;
      else if ((frame + Math.floor(e.bobPhase * 100)) % 147 === 0) e.blink = 6;
    }
  }
  if (e.kind === 'golem' || e.kind === 'colossus' || e.kind === 'leviathan') {
    const x = e.x + e.fx;
    const delta = x - (e._px ?? x);
    e._px = x;
    e._svx = (e._svx ?? 0) * 0.55 + (Math.abs(delta) > 8 ? 0 : delta) * 0.45;
    if (e.grounded && Math.abs(e._svx) > 0.06) e.stride += Math.abs(e._svx) * (e.kind === 'golem' ? 0.22 : 0.16);
  }
  if (e.kind === 'rillback' || e.kind === 'stonemaw') {
    const facing = e.mind?.facing ?? Math.sign(e.vx || 1);
    e.body ??= createChain(e.x, e.y - 4, facing, e.kind === 'rillback' ? 9 : 7);
    tickChain(ctx.world, e.body, e.x + e.fx, e.y - 4 + e.fy, (e.rillWet ?? 0) >= 0.28, frame);
    e.rillSegments = e.body.nodes;
  }
  if (e.kind === 'rootloper') {
    e.feet ??= Array.from({ length: 6 }, (_, i) => ({ x: e.x, y: e.y, gripX: e.x, gripY: e.y, planted: false, phase: i / 6 }));
    for (let i = 0; i < e.feet.length; i++) {
      const foot = e.feet[i];
      const side = i < 3 ? -1 : 1;
      const reach = 11 + i % 3 * 4;
      if (foot.planted && (!ctx.world.inBounds(foot.gripX, foot.gripY) || !blocksEntity(ctx.world.type(foot.gripX, foot.gripY)) || Math.hypot(foot.x - e.x, foot.y - e.y) > reach + 8)) foot.planted = false;
      if (!foot.planted && (frame + i * 5) % 12 === 0) {
        const x = Math.floor(e.x + side * reach + e.vx * 5);
        for (let y = Math.floor(e.y - 9); y <= e.y + 15; y++) {
          if (!ctx.world.inBounds(x, y) || !blocksEntity(ctx.world.type(x, y))) continue;
          foot.gripX = x; foot.gripY = y; foot.planted = true; break;
        }
      }
      foot.x = lerp(foot.x, foot.planted ? foot.gripX : e.x + side * reach * 0.5, 0.3);
      foot.y = lerp(foot.y, foot.planted ? foot.gripY - 1 : e.y - 4, 0.3);
    }
    // Attached tendrils share the body's load. Losing a ledge immediately
    // releases the affected feet and removes their traction on the next tick.
    const contacts = e.feet.filter(foot => foot.planted).length;
    e.rootSupport = Math.min(e.rootSupport ?? 1, contacts / 4);
    if (contacts >= 3 && e.vy > 0 && e.vy < 1.5) e.vy *= 0.65;
  }
  if (e.kind !== 'weaver') return;
  const loco = e.weaverLoco;
  const asleep = e.sleeping === true;
  const airborne = !asleep && loco?.mode === 'airborne';
  const speed = loco?.speed ?? 0;
  const unstable = !asleep && !airborne && ((loco?.recoverT ?? 0) > 0 || (e.weaverFallT ?? 0) > 10);
  const poised = (e.windup ?? 0) > 0;
  const weaving = e.blink > 0;
  const feeding = (e.weaverFeedT ?? 0) > 0;
  const cranky = (e.cranky ?? 0) > 0;
  const aware = e.alerted && !asleep;
  const tx = e.mind?.targetX ?? e.x, ty = e.mind?.targetY ?? e.y;
  const overhead = aware ? clamp((e.y - 9 - ty) / 58, 0, 1) : 0;
  const near = aware ? clamp(1 - Math.abs(tx - e.x) / 170, 0, 1) : 0;
  const reach = unstable || airborne || feeding || poised || weaving ? 0 : overhead * (0.35 + 0.65 * near);
  e.weaverReach = lerp(e.weaverReach ?? 0, reach, 0.06);
  const aggro = aware && speed > 0.08 && !feeding && !unstable && !poised && !weaving && e.weaverReach < 0.3 ? clamp(0.45 + (cranky ? 0.55 : 0) + speed * 0.4, 0, 1) : 0;
  e.weaverAggro = lerp(e.weaverAggro ?? 0, aggro, aggro > (e.weaverAggro ?? 0) ? 0.08 : 0.04);
  const trackX = aware ? clamp((tx - e.x) / 52, -1, 1) : Math.sin(frame * 0.017 + e.bobPhase * 2.7) * 0.7;
  const trackY = aware ? clamp(-(ty - e.y + 11) / 60, -1, 1.2) : Math.sin(frame * 0.012 + e.bobPhase * 1.3) * 0.4;
  const hx = clamp(trackX * 3.6 + (loco?.vx ?? 0) * 1.4 + (aware ? 0 : (loco?.face ?? 1) * 0.6), -5.5, 5.5);
  const hy = clamp(trackY * 3.1 + e.weaverReach * 2 + Math.sin(frame * 0.05 + e.bobPhase) * 0.3, -4, 4.5);
  const stiffness = cranky ? 0.27 : poised || weaving ? 0.34 : 0.18;
  e.weaverHeadVX = (e.weaverHeadVX ?? 0) * 0.74 + (hx - (e.weaverHeadX ?? 0)) * stiffness;
  e.weaverHeadVY = (e.weaverHeadVY ?? 0) * 0.74 + (hy - (e.weaverHeadY ?? 0)) * stiffness;
  e.weaverHeadX = clamp((e.weaverHeadX ?? 0) + e.weaverHeadVX, -7, 7);
  e.weaverHeadY = clamp((e.weaverHeadY ?? 0) + e.weaverHeadVY, -5, 6);
}
