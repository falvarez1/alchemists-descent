import { FIGHTER_DEFS } from '@/content/fighters';
import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';
import { crescent, sparks, star, type RGB } from '@/render/duel/DuelFx';

/**
 * Contact marks from core-attacks.png: the opener's spark at the point of contact, the launcher's rising arc, the
 * aerial's forward sweep, the finisher's committed thrust, slam or toll. Tied to the attack's real phases and hit volume;
 * never a screen flash or a substitute for the body pose. Reduced flashes keep the shapes and drop their glow.
 */
export function drawStockAttackFx(out: PixelSurface, ctx: Ctx): void {
  const arena = ctx.arena, p = ctx.player;
  if (!arena?.stockMatch || p.dead) return;
  const attack = arena.stockAttack(arena.bound), spec = attack?.spec;
  if (!attack?.busy || !spec || !attack.kind) return;
  const quiet = ctx.state.reduceFlashes === true;
  const id = ctx.fighters?.id ?? null;
  const violet = id === 'mara-quell', heavy = id === 'brann-rook';
  const color: RGB = violet ? [.74, .42, 1] : heavy ? [1, .66, .26] : id === 'ilyra-voss' ? [1, .58, .18] : accentOf(id);
  const f = attack.facing < 0 ? -1 : 1;
  if (attack.phase === 'startup') {
    // A glint gathers on the weapon as the windup completes (the anticipation beat).
    const t = attack.age / spec.startup;
    if (t > .55) star(out, p.x - f * 4, p.y - 18, 1.5 + 2.5 * (t - .55) / .45, color, (t - .55) / .45 * .8, quiet);
    return;
  }
  const lag = attack.age - spec.startup - spec.active;
  const fade = attack.phase === 'active' ? 1 : Math.max(0, 1 - lag / 6);
  if (fade <= 0) return;
  const top = p.y + spec.top, bottom = p.y + spec.bottom;
  const midY = (top + bottom) / 2, half = (bottom - top) / 2;
  const tipX = p.x + f * spec.reach;
  switch (attack.kind) {
    case 'opener': {
      // A tight contact star where the blow lands, with a short ivory streak from the weapon.
      star(out, tipX, p.y - 12, 4 + 2 * fade, color, fade, quiet);
      if (!quiet) sparks(out, tipX, p.y - 12, f, 0, 6, 9, color, fade, attack.id);
      return;
    }
    case 'launcher': {
      // A crescent rising from the front foot to over the head (Ilyra's up launcher, Brann's heave, Mara's toll).
      const cx = p.x + f * 4, cy = p.y - 14;
      crescent(out, cx, cy, spec.reach - 2, -spec.top - 8, f > 0 ? -Math.PI * .95 : -Math.PI * .05, f > 0 ? Math.PI * .15 : -Math.PI * 1.15,
        3.5, color, fade, quiet);
      if (!quiet) sparks(out, cx + f * 6, top + 2, f * .3, -1, 7, 10, color, fade, attack.id);
      return;
    }
    case 'aerial': {
      // A forward sweep around the body, from above the head to below the feet.
      crescent(out, p.x + f * 6, midY, spec.reach - 4, half + 4, f > 0 ? -Math.PI * .55 : Math.PI * .45, f > 0 ? Math.PI * .55 : Math.PI * 1.55,
        3.2, color, fade, quiet);
      return;
    }
    case 'finisher': {
      if (heavy) {
        // The slam ends at the floor in a fan of brass sparks and a ground star.
        star(out, tipX - f * 6, p.y - 1, 6, color, fade, quiet);
        for (let ray = 0; ray < (quiet ? 2 : 6); ray++) sparks(out, tipX - f * 6, p.y - 2, f * Math.cos(-1.9 + ray * .3), Math.sin(-1.9 + ray * .3), 3, 12, color, fade, attack.id + ray);
        return;
      }
      if (violet) {
        // The last toll: a wide, low violet crescent.
        crescent(out, p.x + f * 8, p.y - 10, spec.reach - 6, 16, f > 0 ? -Math.PI * .45 : Math.PI * .1, f > 0 ? Math.PI * .9 : Math.PI * 1.45,
          4.5, color, fade, quiet);
        return;
      }
      // A committed thrust: a long ivory streak ending in a hard star.
      const y = p.y - 12;
      for (let x = 12; x <= spec.reach; x += out.pixelStep ?? 1) {
        const k = (x - 12) / (spec.reach - 12);
        crescentDot(out, p.x + f * x, y, color, fade * (.4 + .6 * k), quiet);
      }
      star(out, tipX, y, 6 + 2 * fade, color, fade, quiet);
      if (!quiet) sparks(out, tipX, y, f, 0, 8, 12, color, fade, attack.id);
      return;
    }
  }
}

function crescentDot(out: PixelSurface, x: number, y: number, color: RGB, a: number, quiet: boolean): void {
  if (out.blendFinePx) {
    out.blendFinePx(x, y, a, .94 * a, .78 * a, a);
    out.blendFinePx(x, y - .5, color[0] * a * .7, color[1] * a * .7, color[2] * a * .7, a * .7);
    out.blendFinePx(x, y + .5, color[0] * a * .7, color[1] * a * .7, color[2] * a * .7, a * .7);
    if (!quiet && out.addFinePx) out.addFinePx(x, y, color[0] * a * .25, color[1] * a * .25, color[2] * a * .25);
  } else out.addPx(x, y, a, .94 * a, .78 * a);
}

function accentOf(id: string | null): RGB {
  const hex = Number.parseInt(((id ? FIGHTER_DEFS[id as keyof typeof FIGHTER_DEFS]?.accent : null) ?? '#efac58').slice(1), 16);
  return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
}
