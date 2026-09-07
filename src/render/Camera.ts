import { HEIGHT, SIM_MARGIN, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { clamp, smoothstep } from '@/core/math';
import type { CameraApi, Ctx } from '@/core/types';
import type { World } from '@/sim/World';

const AIM_LOOKAHEAD_DEADZONE = 28;
const AIM_LOOKAHEAD_FULL_DISTANCE = 150;
const AIM_LOOKAHEAD_LERP = 0.12;
export const ACTION_PAN_MAX_SPEED = 2.4; // world cells/tick, shared by both axes

/** Ease out across a handoff, then close in once the camera catches up. */
export function actionCameraZoom(zoom: number, distance: number): number {
  return zoom + (Math.min(zoom, .82) - zoom) * smoothstep(clamp((distance - 45) / 150, 0, 1));
}

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
  /** Cinematic framing written by the combat time director; see CameraApi. */
  cineDx = 0;
  cineDy = 0;
  cineZoom = 1;
  actionFocus: { x: number; y: number; zoom: number } | null = null;
  idleFrames = 0;
  private aimLookaheadX = 0;
  private actionVx = 0;
  private actionVy = 0;
  /** Integer camera snapshot used for the current frame's texture (set by the renderer). */
  renderX = 0;
  renderY = 0;
  presentationX?: number;
  presentationY?: number;

  update(ctx: Ctx): void {
    const { player, state, input } = ctx;
    const action = state.mode === 'play' ? this.actionFocus : null;
    if (action) {
      this.tx = action.x - VIEW_W / 2;
      this.ty = action.y - VIEW_H / 2;
    } else if (state.mode === 'play' && this.inspectionFocus !== null) {
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
      this.tx = player.x - VIEW_W / 2 + this.aimLookaheadX + clamp(player.vx * 8, -22, 22);
      // Crouch-peek: holding the stance tilts the view below the ledge
      // (the lerp below turns the offset into a smooth glance down).
      // The integer-cell mover accumulates gravity before attempting a whole
      // cell of motion. That bookkeeping velocity is not a fall while grounded.
      const fallLead = player.grounded ? 0 : clamp(player.vy * 8, -12, 38);
      this.ty = player.y - 9 - VIEW_H / 2 + (player.crouchT / 10) * 48 + fallLead;
      // A finisher leans the frame a little toward its victim. One camera
      // transform for everything, and never enough to hide an incoming hazard.
      this.tx += this.cineDx;
      this.ty += this.cineDy;
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
    const padX = action ? VIEW_W * (1 - 1 / Math.max(1, this.zoom)) / 2 : 0;
    const padY = action ? VIEW_H * (1 - 1 / Math.max(1, this.zoom)) / 2 : 0;
    this.tx = clamp(this.tx, -padX, WIDTH - VIEW_W + padX);
    this.ty = clamp(this.ty, -padY, HEIGHT - VIEW_H + CAMERA_BOTTOM_VOID);
    const actionDistance = Math.hypot(this.tx - this.x, this.ty - this.y);
    if (action) {
      const scale = actionDistance > 0 ? Math.min(.065, ACTION_PAN_MAX_SPEED / actionDistance) : 0;
      this.actionVx += ((this.tx - this.x) * scale - this.actionVx) * .12;
      this.actionVy += ((this.ty - this.y) * scale - this.actionVy) * .12;
      // Deceleration near the target must not overshoot it.
      this.x += Math.sign(this.actionVx) === Math.sign(this.tx - this.x) ? Math.sign(this.actionVx) * Math.min(Math.abs(this.actionVx), Math.abs(this.tx - this.x)) : this.actionVx;
      this.y += Math.sign(this.actionVy) === Math.sign(this.ty - this.y) ? Math.sign(this.actionVy) * Math.min(Math.abs(this.actionVy), Math.abs(this.ty - this.y)) : this.actionVy;
    } else {
      this.actionVx = 0; this.actionVy = 0;
      this.x += (this.tx - this.x) * 0.12;
      this.y += (this.ty - this.y) * 0.085;
    }
    if (Math.abs(this.tx - this.x) < .0001) this.x = this.tx;
    if (Math.abs(this.ty - this.y) < .0001) this.y = this.ty;

    // Idle zoom: lean in when the wizard stands still, pull back the moment he moves
    const busy =
      state.mode !== 'play' ||
      this.inspectionFocus !== null ||
      player.dead ||
      Math.abs(player.vx) > 0.25 ||
      !player.grounded ||
      player.firing;
    this.idleFrames = busy ? 0 : this.idleFrames + 1;
    const zTarget = action ? actionCameraZoom(action.zoom, actionDistance) : this.zoomLock ?? this.cineZoom;
    this.zoom += (zTarget - this.zoom) * (action ? .035 : this.zoomLock !== null ? 0.16 : this.cineZoom !== 1 ? 0.09 : 0.035);
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
    this.presentationX = this.x; this.presentationY = this.y;
    // Clear the SMOOTHING STATE too, not just the position. Every level entry
    // snaps, and leaving these behind means the new level starts with the last
    // one's aim offset baked into the target (so the camera drifts a cell or
    // two on arrival) and with its idle counter still running (so a fresh level
    // can begin the idle zoom-in immediately). Found by the determinism probe:
    // the sim window follows the camera, so a one-cell difference here changed
    // which cells were simulated at all.
    this.aimLookaheadX = 0;
    this.actionVx = 0; this.actionVy = 0;
    this.idleFrames = 0;
  }
}
