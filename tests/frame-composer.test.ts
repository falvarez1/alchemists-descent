import { describe, expect, it } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx, Enemy, RuntimeDecor } from '@/core/types';
import { FrameComposer } from '@/render/FrameComposer';
import type {
  CompositorLens,
  LightField,
  OverlaySurface,
  ParallaxLayers,
  PixelSurface,
  RenderTarget,
} from '@/render/pixels';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { World } from '@/sim/World';

function makeOverlay(): OverlaySurface {
  return {
    data: new Float32Array(VIEW_W * VIEW_H * 4),
    mark: () => undefined,
  };
}

function makeTarget(lightFlags: boolean[]): RenderTarget {
  return {
    pixelData: new Float32Array(VIEW_W * VIEW_H * 4),
    gpuComposeAvailable: true,
    markTextureDirty: () => undefined,
    beginGpuCompose: (
      _ctx: Ctx,
      _light: LightField,
      _layers: ParallaxLayers,
      _lenses: readonly CompositorLens[],
      lightRebuilt: boolean,
    ) => {
      lightFlags.push(lightRebuilt);
      return makeOverlay();
    },
    commitGpuCompose: () => undefined,
  };
}

function makeLight(): LightField & { builds: number } {
  const lw = (VIEW_W >> 1) + 1;
  const lh = (VIEW_H >> 1) + 1;
  return {
    builds: 0,
    LW: lw,
    LH: lh,
    lightR: new Float32Array(lw * lh),
    lightG: new Float32Array(lw * lh),
    lightB: new Float32Array(lw * lh),
    lightAtt: new Float32Array(lw * lh),
    vignette: new Float32Array(VIEW_W * VIEW_H).fill(1),
    build() {
      this.builds++;
    },
    sample: () => ({ r: 1, g: 1, b: 1 }),
  };
}

function makeCtx(frameCount: number): Ctx {
  const world = new World();
  return {
    world,
    camera: { x: 12, y: 20, renderX: 0, renderY: 0 },
    state: {
      mode: 'build',
      frameCount,
      postFx: { ...createGameParams().postFx, gpuCompose: true },
    },
    params: createGameParams(),
    projectiles: [],
    shockwaves: [],
    particles: { list: [] },
    lightning: { arcs: [] },
    fx: { digBeam: null },
    rigidBodies: { bodies: [], heldBody: () => null },
    vineStrands: { strands: [] },
    enemies: [],
    enemyCtl: { defs: {} },
    levels: {
      current: {
        decors: [],
        waystones: [],
        mechanisms: [],
        runeVaults: [],
        pickups: [],
      },
    },
    events: { emit: () => undefined },
    player: { dead: false },
    input: {},
    flask: { state: { material: null, count: 0 }, bottleView: () => null },
    spells: { wandTip: () => ({ x: 0, y: 0 }) },
    critters: { list: [] },
  } as unknown as Ctx;
}

describe('FrameComposer light rebuild cadence', () => {
  it('rebuilds light once per fixed frame and camera snapshot', () => {
    const lightFlags: boolean[] = [];
    const target = makeTarget(lightFlags);
    const light = makeLight();
    const layers: ParallaxLayers = { backdropLayers: [], ready: true };
    const composer = new FrameComposer(
      target,
      light,
      layers,
      () => undefined,
      (_s: PixelSurface, _l: LightField, _ctx: Ctx, _e: Enemy) => undefined,
      (_s: PixelSurface, _l: LightField, _ctx: Ctx, _d: RuntimeDecor) =>
        undefined,
    );
    const ctx = makeCtx(10);

    composer.compose(ctx);
    composer.compose(ctx);
    ctx.camera.x = 13;
    composer.compose(ctx);
    ctx.state.frameCount = 11;
    composer.compose(ctx);
    ctx.state.frameCount = 12;
    composer.compose(ctx);

    expect(light.builds).toBe(3);
    expect(lightFlags).toEqual([true, false, true, false, true]);
  });
});
