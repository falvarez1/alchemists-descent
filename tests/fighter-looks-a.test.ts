import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ctx, PlayerState } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { makeChain } from '@/creatures/rig/chain';
import type { PlayerCostume } from '@/entities/playerCostume';
import { makeSkeleton } from '@/entities/playerPose';
import type { Skeleton } from '@/entities/playerPose';
import { sharedRaster } from '@/render/creatures/raster';
import { drawFighterBody } from '@/render/player/FighterArt';
import { EXTRA0 } from '@/render/player/fighterLook';
import type { FighterLook } from '@/render/player/fighterLook';
import { lookFor } from '@/render/player/looks';

/**
 * The first batch of fighter looks (Brann Rook, Rusk Emberjaw, Kest Rel) drawn through the real renderer
 * against a fake surface. The rasterizer silently skips a primitive whose material id is not in the table, so
 * a look that names `EXTRA0 + 5` with five extras draws nothing and nobody sees why: this test records every
 * material id the look paints with and demands each is in the table and that every extra material is used.
 */

const IDS = ['brann-rook', 'rusk-emberjaw', 'kest-rel'] as const;

/** Where each primitive keeps its material argument. */
const MAT_ARG: Record<string, number> = { ellipse: 6, capsule: 8, poly: 3, stamp: 5, glowStamp: 5, stroke: 4, dot: 2, tube: 5 };

const spyOnRaster = (): Set<number> => {
  const used = new Set<number>();
  const target = sharedRaster as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [name, idx] of Object.entries(MAT_ARG)) {
    const orig = target[name].bind(sharedRaster);
    vi.spyOn(target, name).mockImplementation((...args: unknown[]) => {
      used.add(args[idx] as number);
      return orig(...args);
    });
  }
  return used;
};

const surface = (): PixelSurface & { n: number } => {
  const s = {
    n: 0, pixelStep: 0.5,
    setFinePx() { s.n++; }, blendFinePx() { s.n++; }, addFinePx() { /* glow */ }, setPx() { s.n++; }, addPx() { /* glow */ },
  };
  return s as unknown as PixelSurface & { n: number };
};

const field = { sample: () => ({ r: 1, g: 1, b: 1 }) } as unknown as LightField;

function pose(kind: Skeleton['kind'], facing: number): Skeleton {
  const s = makeSkeleton();
  const set = (v: { x: number; y: number }, x: number, y: number): void => { v.x = 150 + x * facing; v.y = 90 + y; };
  s.kind = kind; s.facing = facing;
  set(s.hip, 0, -6.2); set(s.chest, 0.2, -11); set(s.neck, 0.35, -12.4); set(s.head, 0.55, -13.75);
  set(s.backKnee, -1.1, -3.5); set(s.backFoot, -2, -0.15); set(s.frontKnee, 1.3, -3.65); set(s.frontFoot, 2, -0.1);
  set(s.backElbow, -2.5, -8.9); set(s.backHand, -2.2, -6.4); set(s.frontElbow, 2.8, -9); set(s.frontHand, 3.5, -6.9);
  set(s.crown, -0.2, -17);
  s.wand.x = s.frontHand.x; s.wand.y = s.frontHand.y; s.wand.angle = facing > 0 ? -0.25 : Math.PI + 0.25; s.wand.visible = true;
  return s;
}

function costumeFor(s: Skeleton): PlayerCostume {
  const f = s.facing;
  return {
    tails: [makeChain(5, s.hip.x - f * 1.5, s.hip.y, -f * 0.3, 1, 1.25, 1.3, 0.8, 0.45), makeChain(5, s.hip.x + f * 1.0, s.hip.y, f * 0.2, 1, 1.2, 1.2, 0.7, 0.45)],
    mantle: makeChain(4, s.chest.x - f * 2.5, s.chest.y, -f * 0.5, 1, 1.0, 1.4, 0.8, 0.4),
    crown: makeChain(4, s.crown.x, s.crown.y, -f * 0.4, -1, 1.25, 1.2, 0.35, 0),
    skel: s, tick: 0, vial: 0, vialV: 0,
  };
}

const playerFor = (patch: Partial<PlayerState> = {}): PlayerState => ({
  x: 150, y: 90, firing: false, _svx: 0, _svy: 0, bloodStain: 0, staggerT: 0, status: { burning: 0, electrified: 0 }, chill: undefined, ...patch,
} as unknown as PlayerState);

const ctxFor = (id: string, view: Record<string, unknown> = {}, reduceFlashes = false): Ctx => ({
  state: { frameCount: 100, reduceFlashes, lanternHooded: false },
  fighters: { id, view: { tactical: { active: 0 }, ultimate: { active: 0 }, armor: 0, armorMax: 0, meter: null, ...view } },
  flask: { state: { material: null, count: 0 } },
} as unknown as Ctx);

const draw = (look: FighterLook, s: Skeleton, opts: { costume?: boolean; a?: Partial<PlayerState>; view?: Record<string, unknown>; calm?: boolean } = {}): number => {
  const out = surface();
  const a = playerFor(opts.a);
  drawFighterBody(out, field, ctxFor(look.id, opts.view, opts.calm), a, s, opts.costume === false ? undefined : costumeFor(s), null, 1, look);
  return out.n;
};

describe('fighter looks: Brann, Rusk, Kest', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  for (const id of IDS) {
    describe(id, () => {
      const look = lookFor(id);

      it('is registered with a full material table and sane build', () => {
        expect(look).toBeDefined();
        expect(look!.id).toBe(id);
        expect(look!.mats.length).toBeGreaterThan(EXTRA0 - 1);
        expect(look!.accent.every((v) => v >= 0 && v <= 1)).toBe(true);
        for (const k of [look!.build?.limb ?? 1, look!.build?.torso ?? 1, look!.build?.head ?? 1]) expect(k).toBeGreaterThan(0.7);
        expect(look!.drawWand).toBeTypeOf('function');
      });

      it('paints only materials in its table, and every extra material it declares', () => {
        const used = spyOnRaster();
        for (const f of [1, -1]) {
          draw(look!, pose('stand', f));
          draw(look!, pose('crawl', f));
          draw(look!, pose('dead', f), { a: { firing: false } });
          draw(look!, pose('stand', f), { costume: false, a: { firing: true } });
        }
        for (const m of used) {
          expect(Number.isInteger(m), `material ${m}`).toBe(true);
          expect(m).toBeGreaterThanOrEqual(1);
          expect(m).toBeLessThanOrEqual(look!.mats.length);
        }
        for (let m = EXTRA0; m < look!.mats.length + 1; m++) expect(used.has(m), `extra material ${m} is never drawn`).toBe(true);
      });

      it('draws pixels in every state a fight puts it in, and never throws', () => {
        const states: Array<Parameters<typeof draw>[2]> = [
          {}, { calm: true }, { a: { firing: true, _svx: 2.4 } }, { a: { staggerT: 9 } }, { a: { status: { burning: 60, electrified: 20 } as PlayerState['status'] } },
          { a: { chill: { level: 0.8, rime: 0.8, shell: 0, cracks: 0, breathAt: -1, breathX: 0, breathY: 0, breathDir: 1, breathK: 0 } as unknown as PlayerState['chill'] } },
          { a: { chill: { level: 1, rime: 1, shell: 30, cracks: 3, breathAt: -1, breathX: 0, breathY: 0, breathDir: 1, breathK: 0 } as unknown as PlayerState['chill'] } },
          { view: { tactical: { active: 1 }, ultimate: { active: 1 }, armor: 40, armorMax: 50, meter: { label: 'Pressure', value: 100, max: 100 } } },
        ];
        for (const st of states) for (const kind of ['stand', 'crawl', 'dead'] as const) {
          expect(() => draw(look!, pose(kind, 1), st)).not.toThrow();
        }
        expect(draw(look!, pose('stand', 1))).toBeGreaterThan(300);
        expect(draw(look!, pose('dead', -1))).toBeGreaterThan(100);
      });
    });
  }
});
