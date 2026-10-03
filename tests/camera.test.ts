import { describe, expect, it } from 'vitest';
import { HEIGHT, VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { ACTION_PAN_MAX_SPEED, Camera, HUD_FLOOR_CLEARANCE } from '@/render/Camera';

describe('action camera travel', () => {
  it('limits diagonal pan speed, eases direction changes and pulls back for a long handoff', () => {
    const camera = new Camera(), ctx = makeCtx(camera);
    camera.snapTo(430, 305);
    camera.actionFocus = { x: 1484, y: 220, zoom: 1.35 };
    let minZoom = 2, previousVx = 0, previousVy = 0;
    for (let tick = 0; tick < 1000; tick++) {
      if (tick === 90) camera.actionFocus = { x: 700, y: 300, zoom: 1.35 };
      const x = camera.x, y = camera.y;
      camera.update(ctx);
      const vx = camera.x - x, vy = camera.y - y;
      expect(Math.hypot(vx, vy)).toBeLessThanOrEqual(ACTION_PAN_MAX_SPEED + .00001);
      expect(Math.hypot(vx - previousVx, vy - previousVy)).toBeLessThan(.61);
      previousVx = vx; previousVy = vy; minZoom = Math.min(minZoom, camera.zoom);
    }
    expect(minZoom).toBeLessThan(.9);
    expect(Math.hypot(camera.x - camera.tx, camera.y - camera.ty)).toBeLessThan(.01);
    expect(camera.zoom).toBeCloseTo(1.35, 2);
  });
});

describe('camera inspection focus', () => {
  it('holds the last stock view with no living subjects despite a cinematic request', () => {
    const camera = new Camera(), ctx = makeCtx(camera);
    camera.snapTo(800, 560);
    ctx.arena = { stockMatch: { zone: { left: 490, right: 1110, top: 390, bottom: 730 } } } as unknown as Ctx['arena'];
    camera.inspectionFocus = { x: 800, y: 560 };
    camera.actionFocus = { x: 1200, y: 900, zoom: 1.5 };
    ctx.player.dead = true; camera.cineZoom = 1.4;
    camera.update(ctx);
    expect(camera.tx).toBe(480); expect(camera.ty).toBe(380); expect(camera.zoom).toBe(1);
  });
  it('holds play camera on an inspection target until cleared', () => {
    const camera = new Camera();
    const ctx = makeCtx(camera);

    camera.setInspectionFocus(900, 500);
    ctx.player.x = 700;
    ctx.player.y = 500;
    camera.update(ctx);

    expect(camera.tx).toBe(900 - VIEW_W / 2);
    expect(camera.ty).toBe(500 - VIEW_H / 2);

    camera.clearInspectionFocus();
    camera.update(ctx);

    expect(camera.tx).toBeGreaterThan(700 - VIEW_W / 2);
    expect(camera.tx).not.toBe(900 - VIEW_W / 2);
    expect(camera.ty).toBe(500 - 9 - VIEW_H / 2);
  });

  it('can retarget inspection focus without snapping the camera position', () => {
    const camera = new Camera();
    const ctx = makeCtx(camera);

    camera.snapTo(500, 400);
    const startX = camera.x;
    const startY = camera.y;

    camera.setInspectionFocus(900, 520, { snap: false });

    expect(camera.x).toBe(startX);
    expect(camera.y).toBe(startY);

    camera.update(ctx);

    expect(camera.tx).toBe(900 - VIEW_W / 2);
    expect(camera.ty).toBe(520 - VIEW_H / 2);
    expect(camera.x).toBeGreaterThan(startX);
  });
});

describe('camera at the world floor (fix4b)', () => {
  it('keeps the alchemist above the HUD bottom band at the world floor, and the floor a hard edge elsewhere', () => {
    const camera = new Camera(), ctx = makeCtx(camera);
    // Swimming at the very bottom of the world (floor 3's drowned sump).
    ctx.player.y = HEIGHT - 6;
    camera.snapTo(ctx.player.x, ctx.player.y);
    for (let tick = 0; tick < 400; tick++) camera.update(ctx);
    expect(camera.y + VIEW_H - ctx.player.y).toBeGreaterThanOrEqual(HUD_FLOOR_CLEARANCE - 0.01);
    // Never more void than the band needs.
    expect(camera.y + VIEW_H - HEIGHT).toBeLessThanOrEqual(HUD_FLOOR_CLEARANCE);
    // A floor well above the world's bottom keeps the old hard edge: no void.
    ctx.player.y = HEIGHT - 60;
    for (let tick = 0; tick < 400; tick++) camera.update(ctx);
    expect(camera.y).toBeLessThanOrEqual(HEIGHT - VIEW_H + 0.01);
  });
});

describe('camera aim lookahead', () => {
  it('ignores blocked gravity velocity when the player is standing on support', () => {
    const camera = new Camera(), ctx = makeCtx(camera);
    for (let tick = 0; tick < 180; tick++) { ctx.player.vy = (tick % 3) * .28; camera.update(ctx); }
    const settled = camera.y;
    for (let tick = 0; tick < 180; tick++) {
      ctx.player.vy = (tick % 3) * .28; camera.update(ctx);
      expect(camera.ty).toBe(ctx.player.y - 9 - VIEW_H / 2);
      expect(Math.abs(camera.y - settled)).toBeLessThan(.0001);
    }
    ctx.player.grounded = false; ctx.player.vy = 2;
    camera.update(ctx);
    expect(camera.ty).toBe(ctx.player.y - 9 - VIEW_H / 2 + 16);
  });
  it('does not fling to the opposite side for near-player crosshair corrections', () => {
    const camera = new Camera();
    const ctx = makeCtx(camera);
    const centeredTx = ctx.player.x - VIEW_W / 2;

    ctx.input.mouse.x = ctx.player.x + 220;
    for (let i = 0; i < 28; i++) camera.update(ctx);
    expect(camera.tx).toBeGreaterThan(centeredTx + 20);

    ctx.input.mouse.x = ctx.player.x - 8;
    camera.update(ctx);

    expect(camera.tx).toBeGreaterThan(centeredTx);
  });

  it('still gives side room when aiming deliberately far across the player', () => {
    const camera = new Camera();
    const ctx = makeCtx(camera);
    const centeredTx = ctx.player.x - VIEW_W / 2;

    ctx.input.mouse.x = ctx.player.x - 220;
    for (let i = 0; i < 28; i++) camera.update(ctx);

    expect(camera.tx).toBeLessThan(centeredTx - 20);
  });
});

function makeCtx(camera: Camera): Ctx {
  return {
    camera,
    state: { mode: 'play' },
    input: {
      keys: { left: false, right: false, jump: false, down: false },
      mouse: { x: 820, y: 390 },
    },
    player: {
      x: 600,
      y: 400,
      vx: 0,
      vy: 0,
      facing: 1,
      crawlT: 0,
      crouchT: 0,
      grounded: true,
      firing: false,
      dead: false,
    },
  } as unknown as Ctx;
}
