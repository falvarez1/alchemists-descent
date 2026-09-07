import type { Ctx } from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { Cell, isLiquid } from '@/sim/CellType';

export class HabitatAudio {
  private lastX = 0;
  private lastY = 0;
  private stride = 0;

  update(ctx: Ctx): void {
    // The ears sit on the wizard in play and on the camera otherwise, so a
    // positional voice in the Sandbox or Builder still comes from the right side.
    if (ctx.state.mode === 'play' && !ctx.player.dead) ctx.audio.setListener(ctx.player.x, ctx.player.y - 8);
    else ctx.audio.setListener(ctx.camera.x + VIEW_W / 2, ctx.camera.y + VIEW_H / 2);
    if (ctx.state.mode !== 'play' || ctx.player.dead) return;
    const { player, world } = ctx;
    const distance = Math.hypot(player.x - this.lastX, player.y - this.lastY);
    this.lastX = player.x; this.lastY = player.y;
    if (distance < 10 && player.grounded) this.stride += distance;
    if (this.stride > 13) {
      this.stride %= 13;
      const x = Math.floor(player.x), y = Math.min(world.height - 1, Math.floor(player.y + 1));
      const type = world.inBounds(x, y) ? world.type(x, y) : Cell.Stone;
      const torso = world.inBounds(x, y - 5) ? world.type(x, y - 5) : Cell.Empty;
      const kind = isLiquid(torso) ? 'water' : type === Cell.Metal ? 'metal' : 'stone';
      ctx.audio.worldSound?.(kind, player.x, player.y, player.x, player.y);
    }
    if (ctx.state.frameCount % 12 !== 0) return;
    for (const enemy of ctx.enemies) {
      if (enemy.hp <= 0 || Math.abs(enemy.vx) + Math.abs(enemy.vy) < 0.1) continue;
      if (enemy.kind !== 'weaver' && enemy.kind !== 'rillback') continue;
      if ((ctx.state.frameCount + (enemy.mind?.phase ?? 0)) % 48 >= 12) continue;
      ctx.audio.worldSound?.(enemy.kind, enemy.x, enemy.y, player.x, player.y);
      if (Math.hypot(enemy.x - player.x, enemy.y - player.y) < 330) {
        ctx.events.emit('habitatSound', { kind: enemy.kind, x: enemy.x, y: enemy.y });
      }
    }
  }
}
