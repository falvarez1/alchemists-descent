import type { Ctx } from '@/core/types';
import type { PixelSurface } from './pixels';
import { getAimGuide } from '@/combat/AimGuide';
import { canHumiliate } from '@/combat/Trickshot';

export function drawTrickshotOverlay(out: PixelSurface, ctx: Ctx): void {
  if (!ctx.state.trickshot?.enabled || ctx.player.dead || ctx.state.mode !== 'play') return;
  const guide = getAimGuide(ctx);
  const pixel = (x: number, y: number, gold: boolean, strength = 1) =>
    (out.setFinePx ?? out.setPx).call(out, x, y, (gold ? .96 : .65) * strength, (gold ? .72 : .86) * strength, (gold ? .35 : .77) * strength);
  if (guide) {
    const gold = guide.leg >= 0, points = guide.points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d < length; d += 5) pixel(a.x + (b.x - a.x) * d / length, a.y + (b.y - a.y) * d / length, gold, guide.affordable ? .52 : .25);
    }
    const end = points.at(-1)!;
    const radius = 3 + Math.min(8, Math.hypot(end.x - points[0].x, end.y - points[0].y) * Math.tan(guide.spread));
    for (let i = 0; i < 32; i++) {
      if ((guide.uncertain || !guide.contact) && i % 4 > 1) continue;
      const a = i / 32 * Math.PI * 2; pixel(end.x + Math.cos(a) * radius, end.y + Math.sin(a) * radius, gold, guide.affordable ? 1 : .4);
    }
    if (guide.enemy) for (const s of [-1, 1]) { pixel(end.x + s * (radius + 1.5), end.y, gold); pixel(end.x, end.y + s * (radius + 1.5), gold); }
  }
  for (const e of ctx.enemies) {
    if (!canHumiliate(ctx, e) || Math.hypot(e.x - ctx.player.x, e.y - ctx.player.y) > 100) continue;
    const x = e.x, y = e.y - 25;
    for (let i = -3; i <= 3; i += .5) { pixel(x + i, y - 3 + Math.abs(i), true); pixel(x + i, y + 3 - Math.abs(i), true); }
  }
  if ((ctx.fx.trickshot?.remainingMs ?? 0) > 0) for (const p of ctx.projectiles) {
    if (p.hostile) continue;
    for (let i = 1; i < 8; i++) pixel(p.x - p.vx * i / 5, p.y - p.vy * i / 5, false, .6 * (1 - i / 8));
  }
}
