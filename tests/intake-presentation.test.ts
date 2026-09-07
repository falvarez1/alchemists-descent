import { describe, expect, it } from 'vitest';
import type { Ctx, Mechanism, RigidBody } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { crankAngle, drawMechanismSprite } from '@/render/sprites/MechanismSprites';
import { drawTeaLinkages } from '@/render/TeaMachineLinkages';
import { drawPlayerSprite } from '@/render/sprites/PlayerSprite';
import { createPlayer } from '@/entities/Player';
import { TEA_BODIES } from '@/world/teaMachine';
import { Cell } from '@/sim/CellType';

type RGB = readonly [number, number, number];
type Recorded = Map<string, RGB>;
const key = (x: number, y: number): string => `${x},${y}`;
const parse = (k: string): [number, number] => k.split(',').map(Number) as [number, number];

function fineSurface(): { s: PixelSurface; fine: Recorded; cellWrites: number; fineWrites: () => number } {
  const fine: Recorded = new Map();
  let fineWrites = 0;
  const s: PixelSurface = {
    pixelStep: 0.5,
    setPx(x, y, r, g, b) {
      for (const dy of [0, 0.5]) for (const dx of [0, 0.5]) fine.set(key(Math.round(x) + dx, Math.round(y) + dy), [r, g, b]);
    },
    addPx() {},
    setFinePx(x, y, r, g, b) { fineWrites++; fine.set(key(Math.round(x * 2) / 2, Math.round(y * 2) / 2), [r, g, b]); },
    addFinePx() {},
  };
  return { s, fine, cellWrites: 0, fineWrites: () => fineWrites };
}

function cellSurface(): { s: PixelSurface; cells: Recorded } {
  const cells: Recorded = new Map();
  const s: PixelSurface = { setPx(x, y, r, g, b) { cells.set(key(Math.round(x), Math.round(y)), [r, g, b]); }, addPx() {} };
  return { s, cells };
}

const lever = (look?: Mechanism['look'], extra: Partial<Mechanism> = {}): Mechanism =>
  ({ id: 1, kind: 'lever', x: 100, y: 100, w: 6, h: 10, state: 0, targetId: -1, look, ...extra });

const farthest = (fine: Recorded, cx: number, cy: number): number =>
  Math.max(...[...fine.keys()].map(k => { const [x, y] = parse(k); return Math.hypot(x - cx, y - cy); }));

describe('Intake machine presentation', () => {
  it('rests the crank handle on the side its state names and swings it half a turn per pull', () => {
    expect(crankAngle({ state: 0 })).toBeCloseTo(Math.PI / 2);
    expect(crankAngle({ state: 1 })).toBeCloseTo(Math.PI * 1.5);
    let last = crankAngle({ state: 0, pullT: 26 });
    for (let t = 25; t >= 1; t--) {
      const a = crankAngle({ state: 0, pullT: t });
      expect(a).toBeGreaterThanOrEqual(last - 1e-9); // one direction, no jitter
      last = a;
    }
    // the pull lands where state 1 rests, so the flip is continuous
    expect(crankAngle({ state: 0, pullT: 1 })).toBeCloseTo(crankAngle({ state: 1 }), 1);
  });

  it('draws the engine crank as a wheel with a connecting rod, not a lever arm under a ring', () => {
    const plain = fineSurface();
    drawMechanismSprite(plain.s, lever(), 0);
    expect(farthest(plain.fine, 100, 100)).toBeLessThan(7);
    const crank = fineSurface();
    drawMechanismSprite(crank.s, lever('crank'), 0);
    expect(farthest(crank.fine, 100, 95)).toBeGreaterThan(7.5); // the wheel rim
    // the connecting rod reaches the striker rod's foot up and to the right
    const rodFoot = [...crank.fine.keys()].some(k => { const [x, y] = parse(k); return Math.hypot(x - 112, y - 85) < 1.5; });
    expect(rodFoot).toBe(true);
    expect(crank.fineWrites()).toBeGreaterThan(200); // rasterised at presentation resolution
  });

  it('turns the sluice handwheel with the valve and never draws the bare lever under it', () => {
    const still = fineSurface(), turned = fineSurface(), bare = fineSurface();
    drawMechanismSprite(still.s, lever('handwheel'), 0, { turn: 0 });
    drawMechanismSprite(turned.s, lever('handwheel'), 0, { turn: 0.7 });
    drawMechanismSprite(bare.s, lever(), 0);
    expect(farthest(still.fine, 100, 86)).toBeGreaterThan(10);
    const differs = [...still.fine.keys()].some(k => JSON.stringify(still.fine.get(k)) !== JSON.stringify(turned.fine.get(k)));
    expect(differs).toBe(true);
    // the plain lever's knob glow (bright red at the arm tip) is absent
    const knob = [...bare.fine.values()].find(c => c[0] > 1.0 && c[1] < 0.5)!;
    expect(knob).toBeDefined();
    const tip = [...bare.fine.entries()].find(([, c]) => c === knob)![0];
    expect(still.fine.get(tip)).not.toEqual(knob);
  });

  function machineScene(renderX: number, renderY: number): { ctx: Ctx; light: LightField } {
    const tea = { stage: 0, ticks: 0, stageTicks: 0, completed: false, stalled: false, bodies: [], travel: {} };
    const bodies = TEA_BODIES.map((def, i) => ({
      id: i, tag: `tea-${def.key}`, x: def.x, y: def.y, angle: 0, vx: 0, vy: 0, va: 0, shape: def.shape,
      color: 0xffffff, sleeping: true, restitution: 0, friction: 0, kind: 'crate',
    })) as unknown as RigidBody[];
    const ctx = {
      levels: { current: { living: { tea } } }, camera: { renderX, renderY }, rigidBodies: { bodies },
      world: { type: () => Cell.Metal, idx: () => 0, charge: new Uint8Array(1) }, state: { frameCount: 0 },
    } as unknown as Ctx;
    return { ctx, light: { sample: () => ({ r: 1, g: 1, b: 1 }) } as unknown as LightField };
  }

  it('rasterises nothing of the engine while the camera is elsewhere', () => {
    const away = fineSurface(), { ctx, light } = machineScene(0, 800);
    drawTeaLinkages(away.s, light, ctx, 1);
    expect(away.fine.size).toBe(0);
    const near = fineSurface(), scene = machineScene(1000, 0);
    drawTeaLinkages(near.s, scene.light, scene.ctx, 1);
    expect(near.fine.size).toBeGreaterThan(500);
    // everything drawn lies inside the padded view
    for (const k of near.fine.keys()) {
      const [x, y] = parse(k);
      expect(x).toBeGreaterThanOrEqual(1000 - 26); expect(x).toBeLessThanOrEqual(1000 + 640 + 26);
      expect(y).toBeLessThanOrEqual(360 + 26);
    }
  });

  function playerScene(): Ctx {
    const player = createPlayer();
    player.x = 100.25; player.y = 100; player.grounded = true; player.facing = 1;
    return {
      player, state: { mode: 'play', frameCount: 10, reduceFlashes: false },
      spells: { wandTip: () => ({ x: player.x + 10, y: player.y - 10 }) },
      input: { bombCharge: -1 }, params: { global: { maxBrightness: 1 } }, enemies: [],
      physics: { entityFree: () => true, cellBlocks: () => false },
    } as unknown as Ctx;
  }

  it('draws the alchemist at presentation resolution with a one-pixel rim that stops at his feet', () => {
    const { s, fine, fineWrites } = fineSurface();
    drawPlayerSprite(s, {} as LightField, playerScene());
    expect(fineWrites()).toBeGreaterThan(300);
    const rimKeys = [...fine.entries()].filter(([, c]) => c[0] < 0.03 && c[2] < 0.08 && c[2] > 0.06).map(([k]) => k);
    expect(rimKeys.length).toBeGreaterThan(40);
    for (const k of rimKeys) {
      const [x, y] = parse(k);
      expect(y).toBeLessThanOrEqual(100.5);
      const touchesBody = [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].some(([dx, dy]) => {
        const c = fine.get(key(x + dx, y + dy));
        return !!c && !(c[0] < 0.03 && c[2] < 0.08);
      });
      expect(touchesBody).toBe(true);
    }
  });

  it('keeps the classic cell drawing on a surface without fine pixels', () => {
    const { s, cells } = cellSurface();
    drawPlayerSprite(s, {} as LightField, playerScene());
    expect(cells.size).toBeGreaterThan(100);
    for (const k of cells.keys()) { const [x, y] = parse(k); expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true); }
  });
});
