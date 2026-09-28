import type { Ctx } from '@/core/types';
import { DARKNESS } from '@/config/darkness';
import { setLanternHooded } from '@/game/Lantern';
import { updateLumenBlooms } from '@/game/lumenBlooms';

/** Darkness under the player that counts as having stepped into the dark (hysteresis below). */
const DARK_ENTER = DARKNESS.enterDark;
const DARK_LEAVE = DARKNESS.leaveDark;

/**
 * The light wave's per-tick housekeeping, run beside the mechanisms: the
 * lantern's hood (a new floor or a death lifts it), the "you have entered
 * the dark" beat, and the lumen blooms. Photocells are ordinary mechanism
 * sensors (sensorType 'light', game/Mechanisms).
 */
export class LightDevices {
  private inDark = false;
  private readonly disposers: Array<() => void> = [];

  constructor(ctx: Ctx) {
    this.disposers.push(
      ctx.events.on('levelChanged', () => {
        this.inDark = false;
        setLanternHooded(ctx, false, true);
      }),
      ctx.events.on('playerDied', () => {
        this.inDark = false;
        setLanternHooded(ctx, false, true);
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.state.paused) return;
    const runtime = ctx.levels.current;
    if (!runtime) return;
    const q = ctx.lightQuery;
    if (q && !ctx.player.dead) {
      const d = q.darkness(ctx.player.x, ctx.player.y - 9);
      if (!this.inDark && d >= DARK_ENTER) {
        this.inDark = true;
        ctx.events.emit('darkZoneEntered', { x: ctx.player.x, y: ctx.player.y, darkness: d });
      } else if (this.inDark && d < DARK_LEAVE) {
        this.inDark = false;
      }
    }
    if (runtime.lumenBlooms?.length) updateLumenBlooms(ctx, runtime.lumenBlooms);
  }
}
