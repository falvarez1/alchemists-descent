import type { Ctx } from '@/core/types';
import { packRGB } from '@/sim/colors';

/**
 * THE HOODED LANTERN (light wave): the stealth verb. The wand's light is a
 * lantern with a brass hood; dropping the hood shutters it to an ember
 * (render/Lighting eases the shutter over ~16 ticks), puts the beam out, and
 * makes the alchemist much harder to see in the dark (creatures/perception).
 * You see less; you are seen less. Every toggle is audible and visible.
 */
export function toggleLantern(ctx: Ctx): boolean {
  if (ctx.state.mode !== 'play' || ctx.player.dead) return false;
  setLanternHooded(ctx, ctx.state.lanternHooded !== true);
  return true;
}

export function setLanternHooded(ctx: Ctx, hooded: boolean, quiet = false): void {
  if ((ctx.state.lanternHooded === true) === hooded) return;
  ctx.state.lanternHooded = hooded;
  const p = ctx.player;
  const tip = ctx.spells?.wandTip?.() ?? { x: p.x + Math.cos(p.aimAngle) * 9, y: p.y - 9 + Math.sin(p.aimAngle) * 9 };
  if (!quiet) {
    if (hooded) {
      // The brass hood drops: a dry click, a short slide, and the flame's
      // last breath curls off the tip as a wisp of smoke and two embers.
      ctx.audio.tone(760, 430, 0.045, 'square', 0.05, tip.x, tip.y);
      ctx.audio.noiseBurst(0.08, 2600, 0.028, true, tip.x, tip.y);
      ctx.particles.burst(tip.x, tip.y - 1, 3, null, () => packRGB(96, 92, 88), 0.35, { grav: -0.03 });
      ctx.particles.burst(tip.x, tip.y, 2, null, () => packRGB(255, 150, 60), 0.5, { glow: 1.4, grav: 0.02 });
    } else {
      // Unhooded: the hood swings back with a brighter click and the flame
      // takes the air again with a small warm flare.
      ctx.audio.tone(520, 880, 0.05, 'square', 0.045, tip.x, tip.y);
      ctx.audio.tone(1180, 1420, 0.14, 'sine', 0.025, tip.x, tip.y);
      ctx.particles.burst(tip.x, tip.y, 5, null, () => packRGB(255, 214, 140), 0.9, { glow: 1.8, grav: -0.015 });
    }
  }
  ctx.events.emit('lanternHooded', { hooded, x: tip.x, y: tip.y });
}
