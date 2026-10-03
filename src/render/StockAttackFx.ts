import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';

/** Local contact accents from core-attacks.png. Never a screen flash or a substitute for the body pose. */
export function drawStockAttackFx(out: PixelSurface, ctx: Ctx): void {
  const arena = ctx.arena, p = ctx.player;
  if (!arena?.stockMatch || p.dead) return;
  const attack = arena.stockAttack(arena.bound), spec = attack?.spec;
  if (!attack?.busy || !spec) return;
  const quiet = ctx.state.reduceFlashes === true;
  const violet = ctx.fighters?.id === 'mara-quell';
  const heavy = ctx.fighters?.id === 'brann-rook';
  const color = violet ? [.77, .47, 1] : [1, .7, .29];
  const dot = (x: number, y: number, alpha: number, ivory = false): void => {
    const r = ivory ? 1 : color[0], g = ivory ? .91 : color[1], b = ivory ? .7 : color[2];
    if (out.blendFinePx) out.blendFinePx(x, y, r * alpha, g * alpha, b * alpha, alpha);
    else out.addPx(x, y, r * alpha, g * alpha, b * alpha);
  };
  const f = attack.facing;
  if (attack.phase === 'startup') {
    if (attack.age / spec.startup > .4) for (let i = -2; i <= 2; i++) {
      dot(p.x - f * 5 + i, p.y - 18, quiet ? .35 : .65);
      dot(p.x - f * 5, p.y - 18 + i, quiet ? .35 : .65);
    }
    return;
  }
  const lag = attack.age - spec.startup - spec.active;
  const fade = attack.phase === 'active' ? 1 : Math.max(0, 1 - lag / 5);
  if (fade <= 0) return;
  const top = p.y + spec.top, bottom = p.y + spec.bottom;
  const cy = (top + bottom) / 2, ry = (bottom - top) / 2;
  if (attack.kind === 'opener' || (attack.kind === 'finisher' && !violet && !heavy)) {
    // Ilyra's thrust and the quick openers make a contact spark, not the aerial's sweep.
    const y = p.y - 12;
    for (let x = 14; x <= spec.reach; x += .5) dot(p.x + f * x, y, fade * (quiet ? .3 : .8), true);
    for (let i = -3; i <= 3; i += .5) {
      dot(p.x + f * spec.reach, y + i, fade * (quiet ? .25 : .7));
      dot(p.x + f * spec.reach + i, y, fade * (quiet ? .25 : .7));
    }
    return;
  }
  if (heavy && attack.kind === 'finisher') {
    // The slam ends at the floor in a tight fan of brass sparks.
    for (let ray = 0; ray < (quiet ? 2 : 5); ray++) for (let i = 0; i < 13; i += .5) {
      const angle = -1.8 + ray * .35;
      dot(p.x + f * (15 + Math.cos(angle) * i), p.y - 1 + Math.sin(angle) * i, fade * (1 - i / 15) * (quiet ? .3 : .8));
    }
    return;
  }
  // A narrow open crescent bounds the forward contact, with a smaller echo for the bell.
  const lines = quiet ? 1 : violet ? 3 : 2;
  for (let k = 0; k < lines; k++) for (let i = 0; i <= 70; i++) {
    const t = i / 70, angle = -.5 * Math.PI + t * Math.PI;
    const edge = 10 + Math.cos(angle) * (spec.reach - 10 - k * 2);
    const x = p.x + f * edge, y = cy + Math.sin(angle) * (ry - k * .7);
    const alpha = fade * (quiet ? .35 : k ? .36 : .82) * (.5 + .5 * Math.sin(t * Math.PI));
    dot(x, y, alpha, k === 0 && !violet);
    if (attack.kind === 'finisher' && !quiet) dot(x - f * .5, y, alpha * .6);
  }
}
