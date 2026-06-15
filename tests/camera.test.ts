import { describe, expect, it } from 'vitest';
import { VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Camera } from '@/render/Camera';

describe('camera inspection focus', () => {
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

    expect(camera.tx).toBe(700 - VIEW_W / 2 + 26);
    expect(camera.ty).toBe(500 - 9 - VIEW_H / 2);
  });
});

function makeCtx(camera: Camera): Ctx {
  return {
    camera,
    state: { mode: 'play' },
    input: { keys: { left: false, right: false, jump: false, down: false } },
    player: {
      x: 600,
      y: 400,
      vx: 0,
      facing: 1,
      crawlT: 0,
      crouchT: 0,
      grounded: true,
      firing: false,
      dead: false,
    },
  } as unknown as Ctx;
}
