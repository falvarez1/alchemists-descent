import { HEIGHT, SIM_MARGIN, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { clamp, smoothstep } from '@/core/math';
import type { CameraApi, Ctx } from '@/core/types';
import type { World } from '@/sim/World';

const AIM_LOOKAHEAD_DEADZONE = 28;
const AIM_LOOKAHEAD_FULL_DISTANCE = 150;
const AIM_LOOKAHEAD_LERP = 0.12;

/**
 * How far the camera may travel BELOW the world floor. The world ends in solid
 * bedrock, so there is nothing to walk to down there — but letting the view drop
 * past the edge keeps the wizard (and any entities/prefabs near the floor) framed
 * instead of pinned to the bottom of the screen. Everything past the edge renders
 * as flat black void (see FrameComposer). Half a viewport lets the deepest stand
 * still center on screen.
 */
const CAMERA_BOTTOM_VOID = Math.floor(VIEW_H / 2);


/**
 * Smooth lerp-follow camera. In play mode it tracks the player with a small
 * aim-distance lookahead; in build mode the WASD keys pan it. Also derives the
 * active simulation window and leans in (idle zoom) when the wizard stands still.
 */
export class Camera implements CameraApi {
  x = 0;
  y = 0;
  tx = 0;
  ty = 0;
  zoom = 1;
  /** Editor zoom override (Builder wheel); null = the game's idle-zoom. */
  zoomLock: number | null = null;
  /** Runtime inspector/debug focus target; null means normal play follow. */
  inspectionFocus: { x: number; y: number } | null = null;
  idleFrames = 0;
  private aimLookaheadX = 0;
  /** Integer camera snapshot used for the current frame's texture (set by the renderer). */
  renderX = 0;
  renderY = 0;

  update(ctx: Ctx): void {
    const { player, state, input } = ctx;
    if (state.mode === 'play' && this.inspectionFocus !== null) {
      this.tx = this.inspectionFocus.x - VIEW_W / 2;
      this.ty = this.inspectionFocus.y - VIEW_H / 2;
    } else if (state.mode === 'play' && !player.dead) {
      const lead = 26 + (player.crawlT / 10) * 14;
      const aimDx = input.mouse.x - player.x;
      const aimDistance = Math.abs(aimDx);
      const leadT = smoothstep(
        clamp(
          (aimDistance - AIM_LOOKAHEAD_DEADZONE) / (AIM_LOOKAHEAD_FULL_DISTANCE - AIM_LOOKAHEAD_DEADZONE),
          0,
          1,
        ),
      );
      const targetLookahead = Math.sign(aimDx) * lead * leadT;
      this.aimLookaheadX += (targetLookahead - this.aimLookaheadX) * AIM_LOOKAHEAD_LERP;
      // Crawl: a mild extra forward lead — you want to see down the tunnel,
      // not under your own knees (crouchT decays in a crawl, so the peek
      // below hands itself over to the lead as the stance changes).
      this.tx = player.x - VIEW_W / 2 + this.aimLookaheadX;
      // Crouch-peek: holding the stance tilts the view below the ledge
      // (the lerp below turns the offset into a smooth glance down).
      this.ty = player.y - 9 - VIEW_H / 2 + (player.crouchT / 10) * 48;
    } else if (state.mode === 'play' && player.dead) {
      // Death: ride the tumbling ragdoll down (don't freeze on the death spot).
      const corpse = ctx.rigidBodies.playerCorpse;
      const fx = corpse ? corpse.x : player.x;
      const fy = corpse ? corpse.y : player.y - 9;
      this.tx = fx - VIEW_W / 2;
      this.ty = fy - VIEW_H / 2;
    } else if (state.mode === 'build') {
      // pan in SCREEN distance: zoomed in, the world moves proportionally less
      const pan = 9 / this.zoom;
      if (input.keys.left) this.tx -= pan;
      if (input.keys.right) this.tx += pan;
      if (input.keys.jump) this.ty -= pan;
      if (input.keys.down) this.ty += pan;
    }
    this.tx = clamp(this.tx, 0, WIDTH - VIEW_W);
    this.ty = clamp(this.ty, 0, HEIGHT - VIEW_H + CAMERA_BOTTOM_VOID);
    this.x += (this.tx - this.x) * 0.085;
    this.y += (this.ty - this.y) * 0.085;

    // Idle zoom: lean in when the wizard stands still, pull back the moment he moves
    const busy =
      state.mode !== 'play' ||
      this.inspectionFocus !== null ||
      player.dead ||
      Math.abs(player.vx) > 0.25 ||
      !player.grounded ||
      player.firing;
    this.idleFrames = busy ? 0 : this.idleFrames + 1;
    const zTarget = this.zoomLock ?? (this.idleFrames > 55 ? 1.13 : 1.0);
    this.zoom += (zTarget - this.zoom) * (this.zoomLock !== null ? 0.16 : 0.035);
  }

  updateSimBounds(world: World): void {
    const cx = Math.floor(this.x);
    const cy = Math.floor(this.y);
    world.simBounds.x0 = Math.max(0, cx - SIM_MARGIN);
    world.simBounds.x1 = Math.min(WIDTH, cx + VIEW_W + SIM_MARGIN);
    world.simBounds.y0 = Math.max(0, cy - SIM_MARGIN);
    world.simBounds.y1 = Math.min(HEIGHT, cy + VIEW_H + SIM_MARGIN);
  }

  setInspectionFocus(x: number, y: number, options: { snap?: boolean } = {}): void {
    this.inspectionFocus = { x, y };
    if (options.snap !== false) this.snapTo(x, y);
  }

  clearInspectionFocus(): void {
    this.inspectionFocus = null;
  }

  /** Hard-snap camera + render snapshot to center on a world position (bypasses smoothing). */
  snapTo(x: number, y: number): void {
    this.x = this.tx = clamp(x - VIEW_W / 2, 0, WIDTH - VIEW_W);
    this.y = this.ty = clamp(y - VIEW_H / 2, 0, HEIGHT - VIEW_H);
    this.renderX = Math.floor(this.x);
    this.renderY = Math.floor(this.y);
  }
}
