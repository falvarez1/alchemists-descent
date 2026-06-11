import { HEIGHT, SIM_MARGIN, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { CameraApi, Ctx } from '@/core/types';
import type { World } from '@/sim/World';

/**
 * Smooth lerp-follow camera. In play mode it tracks the player with a small
 * facing lookahead; in build mode the WASD keys pan it. Also derives the
 * active simulation window and leans in (idle zoom) when the wizard stands still.
 */
export class Camera implements CameraApi {
  x = 0;
  y = 0;
  tx = 0;
  ty = 0;
  zoom = 1;
  idleFrames = 0;
  /** Integer camera snapshot used for the current frame's texture (set by the renderer). */
  renderX = 0;
  renderY = 0;

  update(ctx: Ctx): void {
    const { player, state, input } = ctx;
    if (state.mode === 'play' && !player.dead) {
      this.tx = player.x - VIEW_W / 2 + player.facing * 26;
      // Crouch-peek: holding the stance tilts the view below the ledge
      // (the lerp below turns the offset into a smooth glance down).
      this.ty = player.y - 9 - VIEW_H / 2 + (player.crouchT / 10) * 48;
    } else if (state.mode === 'build') {
      const pan = 9;
      if (input.keys.left) this.tx -= pan;
      if (input.keys.right) this.tx += pan;
      if (input.keys.jump) this.ty -= pan;
      if (input.keys.down) this.ty += pan;
    }
    this.tx = clamp(this.tx, 0, WIDTH - VIEW_W);
    this.ty = clamp(this.ty, 0, HEIGHT - VIEW_H);
    this.x += (this.tx - this.x) * 0.085;
    this.y += (this.ty - this.y) * 0.085;

    // Idle zoom: lean in when the wizard stands still, pull back the moment he moves
    const busy =
      state.mode !== 'play' ||
      player.dead ||
      Math.abs(player.vx) > 0.25 ||
      !player.grounded ||
      player.firing;
    this.idleFrames = busy ? 0 : this.idleFrames + 1;
    const zTarget = this.idleFrames > 55 ? 1.13 : 1.0;
    this.zoom += (zTarget - this.zoom) * 0.035;
  }

  updateSimBounds(world: World): void {
    const cx = Math.floor(this.x);
    const cy = Math.floor(this.y);
    world.simBounds.x0 = Math.max(0, cx - SIM_MARGIN);
    world.simBounds.x1 = Math.min(WIDTH, cx + VIEW_W + SIM_MARGIN);
    world.simBounds.y0 = Math.max(0, cy - SIM_MARGIN);
    world.simBounds.y1 = Math.min(HEIGHT, cy + VIEW_H + SIM_MARGIN);
  }

  /** Hard-snap camera + render snapshot to center on a world position (bypasses smoothing). */
  snapTo(x: number, y: number): void {
    this.x = this.tx = clamp(x - VIEW_W / 2, 0, WIDTH - VIEW_W);
    this.y = this.ty = clamp(y - VIEW_H / 2, 0, HEIGHT - VIEW_H);
    this.renderX = Math.floor(this.x);
    this.renderY = Math.floor(this.y);
  }
}
