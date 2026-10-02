import { describe, expect, it } from 'vitest';

import { FLOOR_DARKNESS } from '@/config/darkness';
import { SFX_CUES } from '@/content/audio/sfxCues';
import { darkMapFor } from '@/core/darkness';
import { EventBus } from '@/core/events';
import type { AuthoredLight, Ctx, DarkZone, Enemy } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit } from '@/fighters/kits/nox-calder';
import {
  SootSense, TUNING, bloomCount, cloudBox, dawnLevel, duskLevel, easeCover, lineClear, newCanister, nightZone,
  planCloud, shadeIndex, sightBrightness, smokeCover, smoothstep, stepCanister, throwRoom, withZone,
} from '@/fighters/kits/nox-calder-math';
import { Cell } from '@/sim/CellType';

/**
 * Nox Calder's rules, node-only: the cover curve, Soot Sight's on/off, the canister's flight against an independent
 * copy of the Flask's own arithmetic, the cloud's plan, the lamps' dusk and dawn, and the kit wired to the real
 * FighterSystem over a fake world (the cloud's cells and their lives, the smoke that burns beside flame, the lamps put
 * back exactly, the zone array put back by identity, a lent darkness profile removed). What it does to the real engine
 * is probed in scripts/verify-fighter-nox.mjs.
 */

const G = TUNING.glass;
const N = TUNING.night;

/** A fixed stream: an LCG, so a test that needs "random" is the same every run. */
function lcg(seed = 20261001): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------------------------------- cover

describe('Blackglass: the cover the smoke gives', () => {
  it('is nothing in thin smoke, all of its maximum in dense smoke, and climbs smoothly between', () => {
    const open = 285;
    expect(smokeCover(0, open)).toBe(0);
    expect(smokeCover(open * G.cover.lo * 0.9, open)).toBe(0);
    expect(smokeCover(open * G.cover.hi, open)).toBeCloseTo(G.cover.max, 9);
    expect(smokeCover(open, open)).toBeCloseTo(G.cover.max, 9);
    let last = -1;
    for (let n = 0; n <= open; n += 5) {
      const c = smokeCover(n, open);
      expect(c).toBeGreaterThanOrEqual(last);
      expect(c).toBeLessThanOrEqual(G.cover.max + 1e-12);
      last = c;
    }
  });

  it('a cramped crack cannot read as a full cloud: a box with few open cells is held to a floor of open cells', () => {
    // 30 smoke in a box with 30 open cells is a crack with a little smoke in it, not a cloud she stands in.
    expect(smokeCover(30, 30)).toBe(smokeCover(30, G.cover.minOpen));
    expect(smokeCover(30, 30)).toBeLessThan(G.cover.max);
    expect(smokeCover(G.cover.minOpen, 30)).toBeCloseTo(G.cover.max, 9);
  });

  it('eases up fast and down slowly, and settles exactly on its target', () => {
    const up = easeCover(0, 0.85) - 0;
    const down = 0.85 - easeCover(0.85, 0);
    expect(up).toBeGreaterThan(down * 3);
    let c = 0;
    for (let i = 0; i < 200; i++) c = easeCover(c, 0.6);
    expect(c).toBe(0.6);
    for (let i = 0; i < 400; i++) c = easeCover(c, 0);
    expect(c).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------- Soot Sight

describe('Soot Sight: when it is on', () => {
  it('comes on at once in the dark or in smoke, and reports the edge once', () => {
    const s = new SootSense();
    expect(s.update(0, 0)).toBe(0);
    expect(s.on).toBe(false);
    expect(s.update(0.51, 0)).toBe(1);
    expect(s.on).toBe(true);
    expect(s.update(0.9, 0)).toBe(0);
    const t = new SootSense();
    expect(t.update(0, 5)).toBe(0); // 5 cells is not smoke
    expect(t.update(0, 6)).toBe(1); // 6 is
    expect(new SootSense().update(0.5, 0)).toBe(0); // "above" 0.5, not at it
  });

  it('goes out only after it has been lost for a while, so a flickering mist does not strobe it', () => {
    const s = new SootSense();
    s.update(0, 8);
    for (let i = 0; i < TUNING.soot.offDelay - 1; i++) expect(s.update(0, 0)).toBe(0);
    expect(s.on).toBe(true);
    expect(s.update(0, 8)).toBe(0); // the mist came back: the count starts again
    for (let i = 0; i < TUNING.soot.offDelay - 1; i++) s.update(0, 0);
    expect(s.on).toBe(true);
    expect(s.update(0, 0)).toBe(-1);
    expect(s.on).toBe(false);
    expect(s.update(0, 0)).toBe(0);
  });

  it('silhouettes are brightest near and dimmest at the edge of her sight, and there are none beyond it', () => {
    const S = TUNING.soot;
    expect(sightBrightness(10)).toBe(S.nearK);
    expect(sightBrightness(S.range)).toBeCloseTo(S.farK, 9);
    expect(sightBrightness(S.range + 1)).toBe(0);
    let last = 2;
    for (let d = 0; d <= S.range; d += 5) {
      const k = sightBrightness(d);
      expect(k).toBeLessThanOrEqual(last + 1e-12);
      last = k;
    }
    expect(shadeIndex(S.farK)).toBe(0);
    expect(shadeIndex(S.nearK)).toBe(S.shades - 1);
    expect(shadeIndex(5)).toBe(S.shades - 1);
    expect(shadeIndex(-5)).toBe(0);
  });

  it('a sight line is blocked by anything solid between, but a foe pressed to a wall is still seen', () => {
    const wall = (x: number, y: number): boolean => x === 50 && y >= 0 && y < 100;
    expect(lineClear(() => false, 0, 40, 100, 40)).toBe(true);
    expect(lineClear(wall, 0, 40, 100, 40)).toBe(false);
    // the target stands right against the wall (its centre is the wall's face): the last cells are not tested
    expect(lineClear(wall, 0, 40, 51, 40)).toBe(true);
    expect(lineClear(wall, 0, 40, 60, 40)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------- the canister

/** The Flask's own bottle (combat/Flask.ts flyBottle), copied step for step and with no knowledge of the kit. */
function flaskReference(x: number, y: number, a: number, blocked: (gx: number, gy: number) => boolean): { x: number; y: number; ticks: number; burst: 'solid' | 'fuse' } {
  const vx = Math.cos(a) * 6.5;
  let vy = Math.sin(a) * 6.5, bx = x, by = y;
  for (let tick = 1; tick <= 45; tick++) {
    vy += 0.18;
    const steps = Math.max(1, Math.ceil(Math.hypot(vx, vy)));
    for (let st = 0; st < steps; st++) {
      const px = bx, py = by;
      bx += vx / steps;
      by += vy / steps;
      if (blocked(Math.floor(bx), Math.floor(by))) return { x: Math.floor(px), y: Math.floor(py), ticks: tick, burst: 'solid' };
    }
  }
  return { x: Math.floor(bx), y: Math.floor(by), ticks: 45, burst: 'fuse' };
}

describe('Blackglass: the canister in flight', () => {
  const floor = (_x: number, y: number): boolean => y >= 150;
  const anywhere = (): boolean => true;

  it('flies exactly as the Flask\'s bottle does: same speed, same gravity, same sub-stepping, same last free cell', () => {
    for (const deg of [-70, -45, -10, 0, 20, 45, 70]) {
      const a = (deg * Math.PI) / 180;
      const ref = flaskReference(100, 120, a, floor);
      const c = newCanister(100, 120, a);
      let burst = null as ReturnType<typeof stepCanister>;
      let ticks = 0;
      while (!burst && ticks < 200) { burst = stepCanister(c, floor, anywhere); ticks++; }
      expect(burst, `aim ${deg}`).not.toBeNull();
      expect(ticks, `aim ${deg}`).toBe(ref.ticks);
      expect(burst?.x, `aim ${deg}`).toBe(ref.x);
      expect(burst?.y, `aim ${deg}`).toBe(ref.y);
      expect(burst?.why, `aim ${deg}`).toBe(ref.burst);
    }
  });

  it('bursts in the last free cell before the first solid, and cannot tunnel a thin wall at full speed', () => {
    const c = newCanister(10, 100, 0);
    c.vx = 60; // a freak speed: sub-stepping must still find a one-cell wall
    const wall = (x: number): boolean => x === 40;
    let burst = null as ReturnType<typeof stepCanister>;
    for (let i = 0; i < 5 && !burst; i++) burst = stepCanister(c, (x) => wall(x), anywhere);
    expect(burst?.why).toBe('solid');
    expect(burst?.x).toBe(39);
  });

  it('bursts when the fuse runs out in open air, 45 ticks after the throw', () => {
    const c = newCanister(100, 20, -Math.PI / 2); // straight up, high in a tall shaft
    let burst = null as ReturnType<typeof stepCanister>;
    let ticks = 0;
    while (!burst && ticks < 100) { burst = stepCanister(c, () => false, anywhere); ticks++; }
    expect(burst?.why).toBe('fuse');
    expect(ticks).toBe(G.fuse);
  });

  it('bursts on a foe\'s body in its path, and at the edge of the map', () => {
    const c = newCanister(100, 120, 0);
    const foe = (x: number, y: number): boolean => x >= 130 && x <= 142 && y >= 100 && y <= 126;
    let burst = null as ReturnType<typeof stepCanister>;
    for (let i = 0; i < 20 && !burst; i++) burst = stepCanister(c, () => false, anywhere, foe);
    expect(burst?.why).toBe('foe');
    expect(burst?.x).toBeGreaterThanOrEqual(130);
    const d = newCanister(5, 120, Math.PI);
    let edge = null as ReturnType<typeof stepCanister>;
    for (let i = 0; i < 20 && !edge; i++) edge = stepCanister(d, () => false, (x) => x >= 0);
    expect(edge?.why).toBe('bounds');
  });

  it('counts the room along a throw, so a wall at her nose can be refused', () => {
    const wallAt = (x: number): boolean => x >= 104;
    expect(throwRoom((x) => wallAt(x), 100, 100, 1, 0, 12)).toBe(3);
    expect(throwRoom((x) => wallAt(x), 100, 100, -1, 0, 12)).toBe(12);
  });
});

// ---------------------------------------------------------------------------------------- the cloud

describe('Blackglass: planning the cloud', () => {
  const open = (x: number, y: number): boolean => y < 200 && y > 0 && x > 0 && x < 400;

  it('in open air is a disc of about radius 20 with the nearest cells first and a ragged rim', () => {
    const { xs, ys } = planCloud(open, 200, 150, lcg());
    expect(xs.length).toBe(G.cloud.cells);
    let last = -1, far = 0;
    for (let i = 0; i < xs.length; i++) {
      const d2 = (xs[i] - 200) ** 2 + (ys[i] - 150) ** 2;
      expect(d2).toBeGreaterThanOrEqual(last);
      last = d2;
      far = Math.max(far, Math.sqrt(d2));
    }
    const rEst = Math.sqrt(G.cloud.cells / Math.PI);
    expect(far).toBeGreaterThan(rEst * 0.95);
    expect(far).toBeLessThan(rEst * 1.6);
    // the nearest cells are all there; the rim is thinner than the core
    const inner = (xs.length - 1) > 0 ? Array.from(xs).filter((x, i) => Math.hypot(x - 200, ys[i] - 150) <= rEst * 0.6).length : 0;
    expect(inner).toBeGreaterThan(Math.PI * (rEst * 0.6) ** 2 * 0.95);
  });

  it('fills the room it is in: nothing leaks through a wall, not even a one-cell wall with a diagonal gap', () => {
    // A box 60 wide and 40 tall with a one-cell wall; the burst is inside. A diagonal crack in one corner must not leak.
    const inBox = (x: number, y: number): boolean => x >= 100 && x <= 160 && y >= 100 && y <= 140;
    const crack = (x: number, y: number): boolean => inBox(x, y) || (x === 161 && y === 141); // touches the corner diagonally only
    const { xs, ys } = planCloud(crack, 130, 120, lcg());
    expect(xs.length).toBeGreaterThan(500);
    for (let i = 0; i < xs.length; i++) expect(inBox(xs[i], ys[i])).toBe(true);
    expect(xs.length).toBeLessThanOrEqual(61 * 41);
  });

  it('runs along a corridor up to its reach when it has no room to spread', () => {
    const corridor = (x: number, y: number): boolean => y >= 100 && y <= 105 && x > 0 && x < 400;
    const { xs } = planCloud(corridor, 200, 102, lcg());
    // 6 cells tall: the cloud stretches along it, never beyond the reach, and does not reach the full 1250 cells
    expect(Math.max(...Array.from(xs).map((x) => Math.abs(x - 200)))).toBeLessThanOrEqual(G.cloud.reach);
    expect(xs.length).toBeLessThan(G.cloud.cells);
    expect(xs.length).toBeGreaterThan(300);
  });

  it('plans nothing from a solid cell, and is the same from the same stream', () => {
    expect(planCloud(() => false, 10, 10, lcg()).xs.length).toBe(0);
    const a = planCloud(open, 200, 150, lcg(7)), b = planCloud(open, 200, 150, lcg(7));
    expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
    expect(Array.from(a.ys)).toEqual(Array.from(b.ys));
  });

  it('the bloom writes most of the cloud at once and all of it in 10 ticks; the box it can be in follows it up', () => {
    const total = 1000;
    expect(bloomCount(total, 0)).toBe(0);
    expect(bloomCount(total, 1)).toBeGreaterThan(150);
    expect(bloomCount(total, 5)).toBeGreaterThan(700);
    expect(bloomCount(total, G.cloud.bloomTicks)).toBe(total);
    expect(bloomCount(total, 999)).toBe(total);
    const a = cloudBox(100, 300, 0), b = cloudBox(100, 300, 200);
    expect(b.y0).toBeLessThan(a.y0);
    expect(b.y1).toBe(a.y1);
    expect(a.x0).toBeLessThan(100 - G.cloud.reach);
  });
});

// ---------------------------------------------------------------------------------------- Long Night

describe('Long Night: the lamps and the zone list', () => {
  it('the nearest lamps go out first and each goes smoothly from lit to out; dawn is the same the other way', () => {
    expect(duskLevel(0, 0)).toBe(1);
    expect(duskLevel(N.fade + 1, 0)).toBe(0);
    expect(duskLevel(8, 10)).toBeLessThan(duskLevel(8, 150)); // the near one is already going; the far one is still lit
    let last = 2;
    for (let t = 0; t <= 60; t++) {
      const v = duskLevel(t, 100);
      expect(v).toBeLessThanOrEqual(last + 1e-12);
      last = v;
    }
    expect(duskLevel(1000, N.lampRange)).toBe(0);
    // the farthest lamp is out within the windup and the wave: a few dozen ticks
    expect(N.lampRange * N.wave + N.fade).toBeLessThan(60);
    expect(dawnLevel(0, 0)).toBe(0);
    expect(dawnLevel(N.dawnFade + 1, 0)).toBe(1);
    expect(dawnLevel(N.dawn, N.lampRange)).toBe(1); // the farthest is back by the end of the dawn
    expect(dawnLevel(5, 10)).toBeGreaterThan(dawnLevel(5, 200));
  });

  it('the zone goes into a NEW array and the level\'s own is never touched (the bake keys on identity)', () => {
    const own: DarkZone[] = [{ x: 1, y: 2, rx: 3, ry: 4 }];
    const next = withZone(own, nightZone(100, 200));
    expect(next).not.toBe(own);
    expect(own).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ x: 100, y: 200, rx: N.zone.rx, ry: N.zone.ry, strength: N.zone.strength, shape: 'ellipse' });
    expect(withZone(undefined, nightZone(0, 0))).toHaveLength(1);
  });

  it('smoothstep is the usual', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 9);
  });
});

// ---------------------------------------------------------------------------------------- the kit over the real system

const W = 400, H = 220, FLOOR = 150;

interface Rig {
  ctx: Ctx;
  sys: FighterSystem;
  step(n?: number): void;
  enemies: Enemy[];
  types: Uint8Array;
  life: Int16Array;
  rt: { def: { id: string }; authoredLights: AuthoredLight[]; darkZones?: DarkZone[] };
  light: { dark: number };
  count(cell: number, x0?: number, y0?: number, x1?: number, y1?: number): number;
  sfx: string[];
  instance(): { lastBakeMs: number; lastRefusal: string | null };
}

function lamp(x: number, y: number, intensity: number): AuthoredLight {
  return { x, y, r: 1, g: 0.8, b: 0.4, intensity, radius: 90, bloom: 0.4, flicker: 0.1, flickerPhase: 1, falloff: 'soft', occluded: true };
}

function rig(opts: { id?: string; zones?: DarkZone[] | undefined; lights?: AuthoredLight[]; level?: boolean } = {}): Rig {
  const types = new Uint8Array(W * H);
  const life = new Int16Array(W * H);
  const colors = new Uint32Array(W * H);
  for (let y = FLOOR; y < H; y++) for (let x = 0; x < W; x++) types[x + y * W] = Cell.Stone;
  const world = {
    width: W, height: H, types, life, colors,
    inBounds: (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H,
    idx: (x: number, y: number): number => x + y * W,
    replaceCellAt: (i: number, cell: number, color: number): void => { types[i] = cell; life[i] = 0; colors[i] = color; },
    clearCellAt: (i: number): void => { types[i] = 0; life[i] = 0; },
  };
  const rt = { def: { id: opts.id ?? 'unit-level' }, authoredLights: opts.lights ?? [], darkZones: 'zones' in opts ? opts.zones : undefined } as Rig['rt'];
  if (!('zones' in opts)) delete rt.darkZones;
  const enemies: Enemy[] = [];
  const sfx: string[] = [];
  const light = { dark: 0 };
  const player = {
    x: 100, y: FLOOR - 1, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, crouchT: 0, crawling: false, swinging: false, aimAngle: 0.9, throwT: 0, lastDamageSource: null as string | null,
  };
  const state = { mode: 'play', frameCount: 1, paused: false };
  const ctx = {
    events: new EventBus(),
    state,
    player,
    enemies,
    world,
    fx: { hitstop: 0, screenShake: 0, bloomKick: 0 },
    camera: { renderX: 0, renderY: 80 },
    levels: { current: opts.level === false ? null : rt },
    lightQuery: { darkness: () => light.dark, level: () => 1, wandLight: () => 0, hooded: false },
    enemyCtl: { defs: { slime: { hp: 40, halfW: 4, h: 8, bounty: 0 } }, damage: () => undefined },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    particles: { burst: () => undefined, spawn: () => undefined },
    physics: { tryMoveEntity: () => true, entityFree: () => true },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sys.equip('nox-calder');
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { state.frameCount++; sys.update(ctx); } };
  step(1);
  return {
    ctx, sys, step, enemies, types, life, rt, light, sfx,
    count: (cell, x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (types[x + y * W] === cell) n++;
      return n;
    },
    instance: () => (sys as unknown as { kit: { lastBakeMs: number; lastRefusal: string | null } }).kit,
  };
}

function slime(x: number, y = FLOOR - 1): Enemy {
  return { x, y, hp: 40, maxHp: 40, kind: 'slime', vx: 0, vy: 0, bobPhase: 0 } as unknown as Enemy;
}

describe('Soot Sight on the fighter system', () => {
  it('shows nothing in the light, and foes within 160 cells with a clear line in the dark or in smoke', () => {
    const r = rig();
    const near = slime(180), edge = slime(250), far = slime(300), walled = slime(30);
    r.enemies.push(near, edge, far, walled);
    // a stone column between her and the one at the left
    for (let y = 100; y < FLOOR; y++) r.types[70 + y * W] = Cell.Stone;
    r.step(40);
    for (const e of r.enemies) expect(r.sys.isRevealed(e)).toBe(false);

    r.light.dark = 0.8; // the dark
    r.step(TUNING.soot.sweepTicks + 4);
    expect(r.sys.isRevealed(near)).toBe(true); // 80 cells
    expect(r.sys.isRevealed(edge)).toBe(true); // 150 cells: inside 160
    expect(r.sys.isRevealed(far)).toBe(false); // 200 cells
    expect(r.sys.isRevealed(walled)).toBe(false); // 70 cells, but the stone column at x = 70 is between
    // out of the dark: the silhouettes lapse within a few ticks of the sense going out
    r.light.dark = 0;
    r.step(TUNING.soot.offDelay + TUNING.soot.hold + 10);
    expect(r.sys.isRevealed(near)).toBe(false);
  });

  it('is turned on by six Smoke cells in the 9 x 9 around her, and by five it is not', () => {
    const r = rig();
    const e = slime(160);
    r.enemies.push(e);
    const put = (n: number): void => { for (let i = 0; i < n; i++) r.types[96 + i + (FLOOR - 12) * W] = Cell.Smoke; };
    put(5);
    r.step(TUNING.soot.sweepTicks + 4);
    expect(r.sys.isRevealed(e)).toBe(false);
    put(6);
    r.step(TUNING.soot.sweepTicks + 4);
    expect(r.sys.isRevealed(e)).toBe(true);
  });

  it('the sweep reaches the near foes first', () => {
    const r = rig();
    const a = slime(130), b = slime(250);
    r.enemies.push(a, b);
    r.light.dark = 0.9;
    r.step(3);
    expect(r.sys.isRevealed(a)).toBe(false); // the pulse has not got that far
    r.step(TUNING.soot.sweepTicks);
    expect(r.sys.isRevealed(a)).toBe(true);
    expect(r.sys.isRevealed(b)).toBe(true);
  });
});

describe('Blackglass on the fighter system', () => {
  it('Z throws a canister that bursts into real Smoke cells, each with a life, and fills her cover', () => {
    const r = rig();
    r.ctx.player.aimAngle = 0.3;
    expect(r.sys.concealment()).toBe(0);
    expect(r.sys.view.tactical.ready).toBe(true);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.ready).toBe(false);
    expect(r.sys.drawables.length).toBeGreaterThanOrEqual(1); // the canister, in flight
    expect(r.sfx).toContain('flask.throw');
    let ticks = 0;
    while (r.count(Cell.Smoke) === 0 && ticks < 60) { r.step(1); ticks++; }
    expect(ticks).toBeLessThan(40); // it burst on the floor
    expect(r.sfx).toContain('flask.shatter');
    r.step(G.cloud.bloomTicks + 2);
    const smoke = r.count(Cell.Smoke);
    expect(smoke).toBeGreaterThan(900);
    expect(smoke).toBeLessThanOrEqual(G.cloud.cells + G.cloud.ventPerTick * 3);
    // every smoke cell carries a life in the band (without one it would vanish at once)
    let min = 1e9, max = 0;
    for (let i = 0; i < r.types.length; i++) if (r.types[i] === Cell.Smoke) { min = Math.min(min, r.life[i]); max = Math.max(max, r.life[i]); }
    expect(min).toBeGreaterThanOrEqual(G.cloud.lifeMin);
    expect(max).toBeLessThanOrEqual(G.cloud.lifeMax);
    // she is in it (it burst a few cells away): her cover is high, and the chip says so
    expect(r.sys.concealment()).toBeGreaterThan(0.6);
    expect(r.sys.concealment()).toBeLessThanOrEqual(G.cover.max + 1e-9);
    expect(r.sys.view.tactical.active).toBeGreaterThan(0.7);
    // the canister's drawable is gone; what is left is the smoke's veil and Soot Sight's (it came on because she is standing in smoke)
    expect(r.sys.drawables).toHaveLength(2);
    expect(r.sys.view.tactical.active).toBeGreaterThan(0);
    // it wrote nothing solid
    expect(r.count(Cell.Stone)).toBe(W * (H - FLOOR));
  });

  it('is refused (and costs nothing) with a wall at her nose, and while it cools', () => {
    const r = rig();
    for (let y = 100; y < FLOOR; y++) for (let x = 104; x < 110; x++) r.types[x + y * W] = Cell.Stone; // a wall 4 cells from her
    r.ctx.player.aimAngle = 0;
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.ready).toBe(true);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(0);
    expect(r.instance().lastRefusal).toBe('NO ROOM TO THROW');
    expect(r.count(Cell.Smoke)).toBe(0);
    // aimed away from the wall it goes; a second Z while it cools is an ordinary refusal
    r.ctx.player.aimAngle = Math.PI - 0.9;
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.ready).toBe(false);
    const refused = r.sys.view.tactical.refusedAt;
    r.step(40);
    r.sys.press('tactical');
    r.step(1);
    expect(r.sys.view.tactical.refusedAt).toBeGreaterThan(refused);
  });

  it('a vent keeps the nearest cells fed for four seconds, then stops (the cloud ages out by itself)', () => {
    const r = rig();
    r.sys.press('tactical');
    r.step(40);
    const burstAt = r.count(Cell.Smoke);
    // knock a hole in the cloud's core (as the sim would, by smoke rising out of it): the vent refills it
    let cx = 0, cy = 0, n = 0;
    for (let i = 0; i < r.types.length; i++) if (r.types[i] === Cell.Smoke) { cx += i % W; cy += Math.floor(i / W); n++; }
    cx = Math.round(cx / n); cy = Math.round(cy / n);
    const hole = (): void => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const i = cx + dx + (cy + dy) * W; if (r.types[i] === Cell.Smoke) { r.types[i] = 0; r.life[i] = 0; } } };
    hole();
    const holed = r.count(Cell.Smoke);
    expect(holed).toBeLessThan(burstAt);
    r.step(30);
    expect(r.count(Cell.Smoke)).toBeGreaterThan(holed + 40);
    // after the vent has closed nothing is written any more
    r.step(G.cloud.ventTicks + 10);
    hole();
    const after = r.count(Cell.Smoke);
    r.step(60);
    expect(r.count(Cell.Smoke)).toBe(after);
  });

  it('flame in a cloud burns the smoke beside it away; smoke far from the flame is left alone', () => {
    const r = rig();
    r.sys.press('tactical');
    r.step(G.cloud.bloomTicks + G.cloud.ventTicks + 30); // the cloud is up and its vent has closed
    let cx = 0, cy = 0, n = 0;
    for (let i = 0; i < r.types.length; i++) if (r.types[i] === Cell.Smoke) { cx += i % W; cy += Math.floor(i / W); n++; }
    cx = Math.round(cx / n); cy = Math.round(cy / n);
    const near = (): number => r.count(Cell.Smoke, cx - 3, cy - 3, cx + 3, cy + 3);
    const farFrom = (): number => r.count(Cell.Smoke, cx + 8, cy - 8, cx + 40, cy + 8);
    const before = { near: near(), far: farFrom() };
    expect(before.near).toBeGreaterThan(20);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) r.types[cx + dx + (cy + dy) * W] = Cell.Fire; // a small fire in the middle of it
    r.step(30);
    expect(near()).toBeLessThan(before.near * 0.1);
    expect(farFrom()).toBe(before.far);
    // with no flame, a cloud is left exactly as it is
    const r2 = rig();
    r2.sys.press('tactical');
    r2.step(G.cloud.bloomTicks + G.cloud.ventTicks + 30);
    const a = r2.count(Cell.Smoke);
    r2.step(60);
    expect(r2.count(Cell.Smoke)).toBe(a);
  });

  it('flame reaching a cloud while its vent is open shuts the vent for good (what was left in the canister burns)', () => {
    const run = (withFlame: boolean): { holed: number; after: number; sfx: string[] } => {
      const r = rig();
      r.sys.press('tactical');
      r.step(40);
      let cx = 0, cy = 0, n = 0;
      for (let i = 0; i < r.types.length; i++) if (r.types[i] === Cell.Smoke) { cx += i % W; cy += Math.floor(i / W); n++; }
      cx = Math.round(cx / n); cy = Math.round(cy / n);
      if (withFlame) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) r.types[cx + dx + (cy + dy) * W] = Cell.Fire;
        r.step(12);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) r.types[cx + dx + (cy + dy) * W] = 0; // the fire is out: nothing more burns
      }
      // a hole well away from the flame, in the vent's nearest cells
      for (let dy = -3; dy <= 3; dy++) for (let dx = 8; dx <= 14; dx++) { const i = cx + dx + (cy + dy) * W; if (r.types[i] === Cell.Smoke) { r.types[i] = 0; r.life[i] = 0; } }
      const holed = r.count(Cell.Smoke);
      r.step(30);
      return { holed, after: r.count(Cell.Smoke), sfx: r.sfx };
    };
    const open = run(false), lit = run(true);
    expect(open.after).toBeGreaterThan(open.holed + 20); // the vent refills the hole
    expect(lit.after).toBe(lit.holed); // lit: it does not
    expect(lit.sfx).toContain('mat.sizzle');
    expect(open.sfx).not.toContain('mat.sizzle');
  });

  it('a new floor or a death stops the vent and the canister: nothing more is written, nothing is left in flight', () => {
    const r = rig();
    r.ctx.player.aimAngle = 0.3;
    r.sys.press('tactical');
    r.step(2);
    expect(r.sys.drawables).toHaveLength(1); // still in the air
    r.ctx.events.emit('levelChanged', undefined as never);
    expect(r.sys.drawables).toHaveLength(0);
    r.step(60);
    expect(r.count(Cell.Smoke)).toBe(0); // the canister never burst: it was dropped with the floor
    const s = rig();
    s.sys.press('tactical');
    s.step(30);
    const now = s.count(Cell.Smoke);
    expect(now).toBeGreaterThan(0);
    s.ctx.events.emit('playerRespawned', undefined as never);
    s.step(60);
    expect(s.count(Cell.Smoke)).toBe(now); // the vent closed with the reset
  });
});

describe('Long Night on the fighter system', () => {
  const lights = (): AuthoredLight[] => [lamp(130, FLOOR - 40, 1.4), lamp(250, FLOOR - 40, 1.05), lamp(100 + 400, FLOOR - 40, 1.4)];

  it('snuffs the lamps within 260 cells (nearest first), leaves the far one, and puts them back to the exact value', () => {
    const ls = lights();
    const r = rig({ lights: ls });
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(1);
    expect(r.sys.view.ultimate.active).toBeGreaterThan(0.9);
    expect(ls[0].intensity).toBeGreaterThan(0); // not yet: the wave starts at the press
    r.step(40);
    expect(ls[0].intensity).toBe(0);
    expect(ls[1].intensity).toBe(0);
    expect(ls[2].intensity).toBe(1.4); // 400 cells away: untouched
    // while it lasts, they stay out (the quiet middle of the night)
    r.step(300);
    expect(ls[0].intensity).toBe(0);
    expect(ls[1].intensity).toBe(0);
    r.step(N.duration);
    expect(r.sys.view.ultimate.active).toBe(0);
    expect(ls.map((l) => l.intensity)).toEqual([1.4, 1.05, 1.4]);
  });

  it('the dawn relights the lamps over the last moments, nearest first, before the dark lifts', () => {
    const ls = lights();
    const r = rig({ lights: ls });
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(N.duration - N.dawn - 2);
    expect(ls[0].intensity).toBe(0);
    r.step(N.dawn - 8);
    // the nearest lamp has begun to come back (a stutter, never above its own value), the farther one is later
    expect(ls[0].intensity).toBeGreaterThan(0);
    expect(ls[0].intensity).toBeLessThanOrEqual(1.4);
    expect(ls[1].intensity).toBeLessThanOrEqual(ls[0].intensity / 1.4 * 1.05 + 1e-9);
  });

  it('adds the zone as a NEW array once (the original untouched), and puts the original back by identity', () => {
    const own: DarkZone[] = [{ x: 10, y: 10, rx: 20, ry: 20 }];
    const r = rig({ id: 'd1', zones: own });
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(N.windup - 2);
    expect(r.rt.darkZones).toBe(own); // the dark has not fallen yet
    r.step(4);
    const during = r.rt.darkZones;
    expect(during).not.toBe(own);
    expect(own).toHaveLength(1);
    expect(during).toHaveLength(2);
    expect(during?.[1]).toMatchObject({ rx: N.zone.rx, ry: N.zone.ry });
    expect(r.instance().lastBakeMs).toBeGreaterThan(0);
    // the bake has run (the map exists) and the array identity never changes again: no per-tick rebake
    const map = darkMapFor(r.rt as never);
    expect(map).not.toBeNull();
    r.step(200);
    expect(r.rt.darkZones).toBe(during);
    expect(darkMapFor(r.rt as never)).toBe(map);
    r.step(N.duration);
    expect(r.rt.darkZones).toBe(own); // by identity
    expect(darkMapFor(r.rt as never)).not.toBe(map); // a fresh bake from the original list
    // a known floor's own darkness profile was neither lent nor removed
    expect(FLOOR_DARKNESS.d1).toEqual({ base: 0, deep: 1 });
  });

  it('on a level that had no zones the property is gone again afterwards; on a level with no darkness profile one is lent and then removed', () => {
    const r = rig({ id: 'unit-no-profile' });
    expect('darkZones' in r.rt).toBe(false);
    expect('unit-no-profile' in FLOOR_DARKNESS).toBe(false);
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(N.windup + 2);
    expect('unit-no-profile' in FLOOR_DARKNESS).toBe(true);
    expect(darkMapFor(r.rt as never)).not.toBeNull(); // without the lent profile this would bake to nothing
    r.step(N.duration);
    expect('unit-no-profile' in FLOOR_DARKNESS).toBe(false);
    expect('darkZones' in r.rt).toBe(false);
    expect(darkMapFor(r.rt as never)).toBeNull();
  });

  it('half-hides her while it lasts, and the lantern\'s own modifiers are not touched', () => {
    const r = rig();
    expect(r.sys.concealment()).toBe(0);
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(5);
    expect(r.sys.concealment()).toBeCloseTo(N.concealment, 9);
    expect(r.sys.moveScale()).toBe(1);
    r.step(N.duration);
    expect(r.sys.concealment()).toBe(0);
  });

  it('a death, a respawn, a new fighter or a new floor puts everything back at once: the lamps, the zones, the profile', () => {
    const cases: Array<[string, (r: Rig) => void]> = [
      ['respawn', (r) => r.ctx.events.emit('playerRespawned', undefined as never)],
      ['death', (r) => { r.ctx.player.dead = true; r.step(1); }],
      ['unequip', (r) => r.sys.equip(null)],
      ['new floor', (r) => r.ctx.events.emit('levelChanged', undefined as never)],
    ];
    for (const [name, end] of cases) {
      const ls = lights();
      const own: DarkZone[] = [{ x: 10, y: 10, rx: 20, ry: 20 }];
      const r = rig({ id: 'unit-mid', lights: ls, zones: own });
      r.sys.addCharge(1);
      r.sys.press('ultimate');
      r.step(60);
      expect(r.rt.darkZones, name).not.toBe(own);
      expect('unit-mid' in FLOOR_DARKNESS, name).toBe(true);
      end(r);
      expect(r.rt.darkZones, name).toBe(own);
      expect('unit-mid' in FLOOR_DARKNESS, name).toBe(false);
      expect(ls.map((l) => l.intensity), name).toEqual([1.4, 1.05, 1.4]);
      expect(r.sys.concealment(), name).toBe(0);
    }
  });

  it('a new floor restores the level it darkened, not the one that is now current', () => {
    const ls = lights();
    const own: DarkZone[] = [{ x: 10, y: 10, rx: 20, ry: 20 }];
    const r = rig({ id: 'unit-old', lights: ls, zones: own });
    const other = { def: { id: 'unit-new' }, authoredLights: [lamp(120, 100, 0.9)], darkZones: [] as DarkZone[] };
    const otherZones = other.darkZones;
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(60);
    (r.ctx.levels as unknown as { current: unknown }).current = other; // the descent has happened
    r.ctx.events.emit('levelChanged', undefined as never);
    expect(r.rt.darkZones).toBe(own);
    expect(ls.map((l) => l.intensity)).toEqual([1.4, 1.05, 1.4]);
    expect(other.darkZones).toBe(otherZones);
    expect(other.authoredLights[0].intensity).toBe(0.9);
    expect('unit-old' in FLOOR_DARKNESS).toBe(false);
  });

  it('leaving play for the editor puts the night back at once', () => {
    const ls = lights();
    const own: DarkZone[] = [{ x: 10, y: 10, rx: 20, ry: 20 }];
    const r = rig({ id: 'unit-editor', lights: ls, zones: own });
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(60);
    expect(r.rt.darkZones).not.toBe(own);
    r.ctx.events.emit('modeChanged', { mode: 'build' });
    expect(r.rt.darkZones).toBe(own);
    expect(ls.map((l) => l.intensity)).toEqual([1.4, 1.05, 1.4]);
    expect('unit-editor' in FLOOR_DARKNESS).toBe(false);
  });

  it('works with no level at all (a bare context): it simply hides her', () => {
    const r = rig({ level: false });
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(20);
    expect(r.sys.concealment()).toBeCloseTo(N.concealment, 9);
    r.step(N.duration);
    expect(r.sys.concealment()).toBe(0);
  });

  it('is refused with the bar empty', () => {
    const r = rig();
    r.sys.press('ultimate');
    r.step(2);
    expect(r.sys.view.ultimate.active).toBe(0);
    expect(r.sys.view.ultimate.refusedAt).toBeGreaterThan(0);
  });

  it('does not snuff a light the kit itself added (a burst\'s flash)', () => {
    const ls = lights();
    const originals = [...ls];
    const r = rig({ lights: ls });
    r.ctx.player.aimAngle = 0.3;
    r.sys.press('tactical');
    let ticks = 0;
    while (r.count(Cell.Smoke) === 0 && ticks++ < 60) r.step(1); // the canister has just burst: its flash is in the level's lights
    const flashes = r.rt.authoredLights.filter((l) => !originals.includes(l));
    expect(flashes.length).toBeGreaterThan(0);
    r.sys.addCharge(1);
    r.sys.press('ultimate');
    r.step(2);
    // the night did not take it: a lamp snuffed is set to 0 at the press's wave, and the flash is nowhere in that list
    for (const f of flashes) expect(f.intensity).toBeGreaterThan(0.3);
  });
});

describe('the sounds it asks for', () => {
  it('are all cues the game already has (nothing new is generated: it is paid)', () => {
    const ls = [lamp(130, FLOOR - 40, 1.4), lamp(250, FLOOR - 40, 1.05)];
    const r = rig({ lights: ls });
    r.ctx.player.aimAngle = 0.3;
    r.sys.press('tactical'); // a throw, a burst, a vent
    r.step(60);
    r.types[100 + (FLOOR - 25) * W] = Cell.Fire; // a flame in the cloud
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) r.types[110 + dx + (FLOOR - 4 + dy) * W] = Cell.Fire;
    r.step(40);
    r.sys.press('tactical'); // a refusal while cooling
    r.step(2);
    r.light.dark = 0.9; // Soot Sight comes on
    r.step(5);
    r.sys.addCharge(1);
    r.sys.press('ultimate'); // the night, its dusk, its fall and its dawn, its end
    r.step(N.duration + 10);
    const asked = new Set(r.sfx);
    expect(asked.size).toBeGreaterThan(8);
    for (const id of asked) expect(Object.keys(SFX_CUES), id).toContain(id);
  });
});
