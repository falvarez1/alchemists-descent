import { describe, expect, it } from 'vitest';

import { createBuilderHost } from '@/app/BuilderHost';
import type { Ctx } from '@/core/types';

function makeCtx(paused = false): Ctx {
  const camera = {
    x: 0,
    y: 0,
    zoom: 1,
    zoomLock: null as number | null,
    snapTo(x: number, y: number): void {
      camera.x = x;
      camera.y = y;
    },
  };

  return {
    state: {
      mode: 'build',
      paused,
      currentBiome: 'earthen',
      worldSeed: 123,
      playtestSource: null,
      builderWandLightPreview: { enabled: false },
      editorLights: null,
    },
    levels: { current: null },
    camera,
    events: {
      on: () => () => {},
      emit: () => {},
    },
  } as unknown as Ctx;
}

describe('BuilderHost pause ownership', () => {
  it('keeps the game paused until every held builder claim is released', () => {
    const ctx = makeCtx();
    const host = createBuilderHost(ctx);

    const editor = host.claimPause('authoring-session');
    const modal = host.claimPause('open-intent-modal');

    expect(editor.held).toBe(true);
    expect(modal.held).toBe(true);
    expect(ctx.state.paused).toBe(true);

    host.releasePause(editor);
    expect(ctx.state.paused).toBe(true);

    host.releasePause(modal);
    expect(ctx.state.paused).toBe(false);
  });

  it('lets settle preview run without losing the active authoring pause claim', () => {
    const ctx = makeCtx();
    const host = createBuilderHost(ctx);

    const editor = host.claimPause('authoring-session');
    host.setPaused(false, 'settle-preview');
    expect(ctx.state.paused).toBe(false);

    host.setPaused(true, 'settle-preview');
    expect(ctx.state.paused).toBe(true);

    host.releasePause(editor);
    expect(ctx.state.paused).toBe(false);
  });

  it('does not claim ownership of an unrelated pre-existing pause', () => {
    const ctx = makeCtx(true);
    const host = createBuilderHost(ctx);

    const editor = host.claimPause('authoring-session');

    expect(editor.held).toBe(false);
    expect(ctx.state.paused).toBe(true);

    host.releasePause(editor);
    expect(ctx.state.paused).toBe(true);
  });
});
