import { describe, expect, it } from 'vitest';
import { LIGHT_RESPONSE, SIGHT } from '@/config/darkness';
import type { Ctx, Enemy, EnemyDef, LightQueryApi } from '@/core/types';
import { inBeamCone, lightMotion, playerVisibility, respondToLight } from '@/creatures/lightResponse';
import { ensureCreatureMind, sightRangeScale } from '@/creatures/perception';
import { World } from '@/sim/World';

/** A light query whose answers the test dictates. */
function query(over: Partial<{ wand: number; level: number; dark: number; hooded: boolean }> = {}): LightQueryApi & { set: typeof over } {
  const s = { wand: 0, level: 0.4, dark: 1, hooded: false, ...over };
  return {
    set: s,
    level: () => s.level,
    wandLight: () => (s.hooded ? 0 : s.wand),
    darkness: () => s.dark,
    get hooded() { return s.hooded; },
  };
}

function makeCtx(q: LightQueryApi | undefined, player: Partial<Ctx['player']> = {}): Ctx {
  const world = new World();
  return {
    world,
    state: { frameCount: 100, mode: 'play' },
    player: { x: 400, y: 500, vx: 0, vy: 0, aimAngle: 0, dead: false, status: { torch: 0 }, perks: {}, ...player },
    enemies: [],
    lightQuery: q,
    audio: { at: () => undefined, tone: () => undefined, chitin: () => undefined, squeak: () => undefined, creak: () => undefined },
  } as unknown as Ctx;
}

function enemy(kind: Enemy['kind'], x: number, y: number): Enemy {
  return { kind, x, y, vx: 0, vy: 0, fx: 0, fy: 0, hp: 20, maxHp: 20, timer: 0, attackCd: 0, bobPhase: 0.3, status: {} } as unknown as Enemy;
}
const DEF = { h: 12, halfW: 6 } as unknown as EnemyDef;

describe('sight scales with the light on the alchemist', () => {
  it('keeps the shipped range for an ordinary lantern and a torch', () => {
    expect(sightRangeScale(0.7)).toBeCloseTo(0.52 + 0.7 * 0.48, 6);
    expect(sightRangeScale(1)).toBeCloseTo(1, 6);
  });

  it('falls to darkRange for a hooded shadow in the black', () => {
    expect(sightRangeScale(0)).toBeCloseTo(SIGHT.darkRange, 6);
    expect(sightRangeScale(0.35)).toBeGreaterThan(SIGHT.darkRange);
    expect(sightRangeScale(0.35)).toBeLessThan(sightRangeScale(0.7));
  });

  it('an unhooded lantern in the dark is a beacon; hooded it is a shadow', () => {
    const q = query({ dark: 1 });
    const ctx = makeCtx(q);
    expect(playerVisibility(ctx)).toBeCloseTo(Math.min(1, SIGHT.lantern + SIGHT.beacon), 6);
    q.set.hooded = true;
    expect(playerVisibility(ctx)).toBeCloseTo(0, 6);
    q.set.dark = 0;
    // In the lamp-lit Works the hood hides nothing: the room lights you.
    expect(playerVisibility(ctx)).toBeCloseTo(SIGHT.lantern, 6);
  });

  it('small contexts without a light query keep the old 0.7 / torch 1', () => {
    expect(playerVisibility(makeCtx(undefined))).toBe(SIGHT.lantern);
    expect(playerVisibility(makeCtx(undefined, { status: { torch: 5 } } as never))).toBe(SIGHT.torch);
  });
});

describe('creatures answer the beam', () => {
  it('reads the aimed cone, not the omni spill', () => {
    const ctx = makeCtx(query());
    expect(inBeamCone(ctx, 480, 491)).toBe(true); // straight down the aim (+x)
    expect(inBeamCone(ctx, 320, 491)).toBe(false); // behind the wizard
  });

  it('a creature in the beam knows exactly where the lantern is', () => {
    const ctx = makeCtx(query({ wand: 0.4 }));
    const e = enemy('slime', 470, 500);
    const mind = ensureCreatureMind(e, 1);
    respondToLight(ctx, e, DEF, mind);
    expect(mind.visible).toBe(true);
    expect(mind.targetX).toBe(400);
    expect(mind.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('a Weaver flinches and backs off, then habituates and charges', () => {
    const ctx = makeCtx(query({ wand: 0.4 }));
    const w = enemy('weaver', 480, 500);
    const mind = ensureCreatureMind(w, 1);
    respondToLight(ctx, w, DEF, mind);
    expect(w.weaverFlinchT).toBe(LIGHT_RESPONSE.weaverFlinch);
    expect(w.weaverRetreatT).toBe(LIGHT_RESPONSE.weaverRetreat);
    for (let t = 0; t < LIGHT_RESPONSE.weaverHabit + 2; t++) respondToLight(ctx, w, DEF, mind);
    expect(w.cranky ?? 0).toBeGreaterThan(0);
  });

  it('the beam on a roost wakes the colony and scatters it away from the light', () => {
    const ctx = makeCtx(query({ wand: 0.3 }));
    const a = enemy('bat', 470, 480), b = enemy('bat', 478, 482), far = enemy('bat', 700, 480);
    for (const bat of [a, b, far]) bat.sleeping = true;
    ctx.enemies.push(a, b, far);
    respondToLight(ctx, a, DEF, ensureCreatureMind(a, 1));
    expect(a.sleeping).toBe(false);
    expect(b.sleeping).toBe(false);
    expect(far.sleeping).toBe(true);
    expect(a.fleeDir).toBe(1);
    expect(a.fleeT).toBe(LIGHT_RESPONSE.batScatter);
  });

  it('a Root Loper freezes while lit and holds a beat after', () => {
    const q = query({ wand: 0.2 });
    const ctx = makeCtx(q);
    const l = enemy('rootloper', 470, 500);
    const mind = ensureCreatureMind(l, 1);
    respondToLight(ctx, l, DEF, mind);
    l.vx = 0.5;
    lightMotion(ctx, l, true);
    expect(l.vx).toBe(0);
    q.set.wand = 0;
    respondToLight(ctx, l, DEF, mind);
    expect(l.lightSense?.frozen).toBe(LIGHT_RESPONSE.lurkerHold - 1);
    for (let t = 0; t < LIGHT_RESPONSE.lurkerHold; t++) respondToLight(ctx, l, DEF, mind);
    l.vx = 0.5;
    lightMotion(ctx, l, true);
    expect(l.vx).toBeCloseTo(0.5 * LIGHT_RESPONSE.lurkerCreep, 6);
  });

  it('the Stone Maw is blind to all of it', () => {
    const ctx = makeCtx(query({ wand: 0.9 }));
    const m = enemy('stonemaw', 470, 500);
    const mind = ensureCreatureMind(m, 1);
    respondToLight(ctx, m, DEF, mind);
    expect(mind.visible).toBe(false);
    expect(m.lightSense?.wand).toBe(0);
  });

  it('a hooded lantern lights nothing, so nothing answers it', () => {
    const ctx = makeCtx(query({ wand: 0.9, hooded: true }));
    const w = enemy('weaver', 480, 500);
    respondToLight(ctx, w, DEF, ensureCreatureMind(w, 1));
    expect(w.weaverFlinchT ?? 0).toBe(0);
  });
});
