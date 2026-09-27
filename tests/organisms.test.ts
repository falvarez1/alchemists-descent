import { describe, expect, it, vi } from 'vitest';
import type { Critter, CritterKind, Ctx, Enemy } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { Rng } from '@/core/rng';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import type { OrganismHost } from '@/game/organisms';
import { stepOrganism } from '@/game/organisms';
import { burstPuffer } from '@/game/organisms/puffer';
import { CRAWL, GLOW, LEECH, PUFF, SNAP, SNAP_TELL } from '@/game/organisms/types';
import { placeOrganisms, SPAWN_CLEAR } from '@/game/organisms/placement';
import { mothLight } from '@/game/organisms/ambient';
import { restoreFauna } from '@/game/persistence/ecology';

const noop = (): undefined => undefined;

function makeWorld(): World {
  const world = new World(220, 140);
  // A closed room: stone shell, floor at y=100, ceiling at y=20.
  for (let y = 0; y < 140; y++) for (let x = 0; x < 220; x++) {
    if (y > 100 || y < 20 || x < 4 || x > 215) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555555);
  }
  return world;
}

function makeCtx(world = makeWorld()): { ctx: Ctx; host: OrganismHost; list: Critter[]; damage: ReturnType<typeof vi.fn>; enemyDamage: ReturnType<typeof vi.fn> } {
  const list: Critter[] = [];
  const damage = vi.fn();
  const enemyDamage = vi.fn((e: Enemy, amount: number) => { e.hp -= amount; });
  const ctx = {
    world,
    state: { frameCount: 0, mode: 'play' },
    player: { x: 30, y: 100, vx: 0, vy: 0, dead: false, facing: 1, aimAngle: Math.PI, status: { burning: 0, electrified: 0, wet: 0 } },
    enemies: [] as Enemy[],
    enemyCtl: { defs: ENEMY_DEFS, damage: enemyDamage },
    playerCtl: { damage },
    particles: { burst: noop, spawn: noop },
    audio: new Proxy({}, { get: () => (fn?: unknown) => (typeof fn === 'function' ? undefined : undefined) }),
    events: { emit: noop, on: () => noop },
    projectiles: [],
    critters: { list },
  } as unknown as Ctx;
  const host: OrganismHost = {
    list,
    remove: (c) => { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); },
    find: (id) => list.find(c => c.id === id),
  };
  return { ctx, host, list, damage, enemyDamage };
}

function critter(kind: CritterKind, x: number, y: number, extra: Partial<Critter> = {}): Critter {
  return { kind, id: `${kind}-${x}-${y}`, x, y, vx: 0, vy: 0, phase: 0, gasp: 0, facing: 1, ...extra };
}

function tick(ctx: Ctx, host: OrganismHost, n: number): void {
  for (let i = 0; i < n; i++) {
    (ctx.state as { frameCount: number }).frameCount++;
    for (const c of [...host.list]) {
      if (!host.list.includes(c) || c.heldBy) continue;
      if (!stepOrganism(ctx, c, host)) host.remove(c);
    }
  }
}

describe('snapjaw', () => {
  it('tells before it snaps, then swallows a small critter and digests (a safe window)', () => {
    const { ctx, host, list } = makeCtx();
    const jaw = critter('snapjaw', 100, 100, { anchorX: 100, anchorY: 100, nx: 0, ny: -1, state: SNAP.OPEN, extent: 1, reach: 6 });
    const beetle = critter('beetle', 101, 94);
    list.push(jaw, beetle);
    tick(ctx, host, 2);
    expect(jaw.state).toBe(SNAP.TELL);
    expect(list).toContain(beetle); // the tell is a real beat: nothing is eaten yet
    tick(ctx, host, SNAP_TELL + 10);
    expect(list).not.toContain(beetle);
    expect(jaw.state).toBe(SNAP.CHEW);
    expect(jaw.meal).toBeGreaterThan(0);
  });

  it('bites the alchemist only after its tell, and he can step out of it', () => {
    const { ctx, host, list, damage } = makeCtx();
    const jaw = critter('snapjaw', 100, 100, { anchorX: 100, anchorY: 100, nx: 0, ny: -1, state: SNAP.OPEN, extent: 1, reach: 6 });
    list.push(jaw);
    ctx.player.x = 108; ctx.player.y = 100;
    tick(ctx, host, 3);
    expect(jaw.state).toBe(SNAP.TELL);
    expect(damage).not.toHaveBeenCalled();
    ctx.player.x = 140; // stepped back out of reach during the tell
    tick(ctx, host, SNAP_TELL + 4);
    expect(damage).not.toHaveBeenCalled();
    ctx.player.x = 106;
    tick(ctx, host, 120);
    expect(damage).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.any(Number), 'snapjaw-bite');
  });

  it('catches fire from flame against it and burns through to ash', () => {
    const { ctx, host, list } = makeCtx();
    const jaw = critter('snapjaw', 100, 100, { anchorX: 100, anchorY: 100, nx: 0, ny: -1, state: SNAP.OPEN, extent: 1, reach: 6 });
    list.push(jaw);
    const w = ctx.world;
    for (let t = 0; t < 400 && list.includes(jaw); t++) {
      for (const [x, y] of [[98, 97], [102, 96]]) if (w.types[w.idx(x, y)] === Cell.Empty && t < 60) { w.replaceCellAt(w.idx(x, y), Cell.Fire, 0xff8000); w.life[w.idx(x, y)] = 20; }
      tick(ctx, host, 1);
    }
    expect(list).not.toContain(jaw);
    let ash = 0;
    for (let y = 90; y <= 100; y++) for (let x = 96; x <= 104; x++) if (w.types[w.idx(x, y)] === Cell.Ash) ash++;
    expect(ash).toBeGreaterThan(0);
  });
});

describe('spore puffer', () => {
  it('bursts into real marsh gas when a ripe sac is touched, and regrows', () => {
    const { ctx, host, list } = makeCtx();
    const puff = critter('puffer', 60, 100, { anchorX: 60, anchorY: 100, nx: 0, ny: -1, state: PUFF.GROW, extent: 0.9 });
    list.push(puff);
    ctx.player.x = 63; ctx.player.y = 100;
    tick(ctx, host, 1);
    let gas = 0;
    for (let y = 80; y <= 100; y++) for (let x = 45; x <= 75; x++) if (ctx.world.types[ctx.world.idx(x, y)] === Cell.MarshGas) gas++;
    expect(gas).toBeGreaterThan(20);
    expect(puff.state).toBe(PUFF.SPENT);
    expect(puff.extent).toBe(0);
    ctx.player.x = 180;
    tick(ctx, host, 600);
    expect(puff.state).toBe(PUFF.GROW);
    expect(puff.extent).toBeGreaterThan(0.1);
  });

  it('an unripe sac does not burst at a touch', () => {
    const { ctx, host, list } = makeCtx();
    const puff = critter('puffer', 60, 100, { anchorX: 60, anchorY: 100, nx: 0, ny: -1, state: PUFF.GROW, extent: 0.1 });
    list.push(puff);
    ctx.player.x = 62;
    tick(ctx, host, 5);
    expect(puff.state).toBe(PUFF.GROW);
  });

  it('never writes gas into rock', () => {
    const { ctx } = makeCtx();
    const puff = critter('puffer', 6, 100, { anchorX: 6, anchorY: 100, nx: 0, ny: -1, state: PUFF.GROW, extent: 1 });
    const stoneBefore = Array.from(ctx.world.types).filter(t => t === Cell.Stone).length;
    burstPuffer(ctx, puff);
    expect(Array.from(ctx.world.types).filter(t => t === Cell.Stone).length).toBe(stoneBefore);
  });
});

describe('glow-worm', () => {
  it('snares a moth that flies into its thread, reels it up and eats it', () => {
    const { ctx, host, list } = makeCtx();
    ctx.player.x = 200;
    const worm = critter('glowworm', 100, 20, { anchorX: 100, anchorY: 20, state: GLOW.FISH, extent: 30, reach: 30 });
    const moth = critter('moth', 100.5, 40);
    list.push(worm, moth);
    tick(ctx, host, 2);
    expect(worm.state).toBe(GLOW.REEL);
    expect(moth.heldBy).toBe(worm.id);
    tick(ctx, host, 400);
    expect(list).not.toContain(moth);
    expect(worm.meal).toBeGreaterThan(0);
  });

  it('hauls its lure up when the wand light falls on it', () => {
    const { ctx, host, list } = makeCtx();
    ctx.player.x = 200;
    (ctx as { lightQuery?: unknown }).lightQuery = { hooded: false, wandLight: () => 0.9, level: () => 1, darkness: () => 0 };
    const worm = critter('glowworm', 100, 20, { anchorX: 100, anchorY: 20, state: GLOW.FISH, extent: 20, reach: 20 });
    list.push(worm);
    tick(ctx, host, 60);
    expect(worm.state).toBe(GLOW.RETRACT);
    expect(worm.extent).toBe(0);
  });

  it('dies when its ceiling is dug away', () => {
    const { ctx, host, list } = makeCtx();
    const worm = critter('glowworm', 100, 20, { anchorX: 100, anchorY: 20, state: GLOW.FISH, extent: 5, reach: 20 });
    list.push(worm);
    ctx.world.clearCell(100, 19);
    tick(ctx, host, 1);
    expect(list).not.toContain(worm);
  });
});

describe('wall crawler', () => {
  it('walks a closed room\'s surface without ever leaving it', () => {
    const { ctx, host, list } = makeCtx();
    ctx.player.x = 400; ctx.player.dead = true;
    const iso = critter('isopod', 50.5, 100.5, { anchorX: 50, anchorY: 100, nx: 0, ny: -1, state: CRAWL.WALK });
    list.push(iso);
    const w = ctx.world;
    const seen = new Set<string>();
    for (let t = 0; t < 6000; t++) {
      tick(ctx, host, 1);
      expect(iso.state).toBe(CRAWL.WALK);
      const ax = iso.anchorX!, ay = iso.anchorY!;
      let touching = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (w.types[w.idx(ax + dx, ay + dy)] === Cell.Stone) touching = true;
      expect(touching).toBe(true);
      seen.add(`${Math.sign(iso.nx ?? 0)},${Math.sign(iso.ny ?? 0)}`);
    }
    // It has been on the floor, a wall and the ceiling.
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('curls into a ball when touched and falls, then unrolls onto the floor', () => {
    const { ctx, host, list } = makeCtx();
    const iso = critter('isopod', 60.5, 20.5, { anchorX: 60, anchorY: 20, nx: 0, ny: 1, state: CRAWL.WALK });
    list.push(iso);
    ctx.player.x = 61; ctx.player.y = 36; // brushing it from below
    tick(ctx, host, 2);
    expect(iso.state).toBe(CRAWL.BALL);
    ctx.player.x = 200;
    tick(ctx, host, 600);
    expect(iso.state).toBe(CRAWL.WALK);
    expect(iso.anchorY).toBe(100);
  });
});

describe('leech', () => {
  it('latches onto a wading alchemist and drinks until he climbs out and dries', () => {
    const world = makeWorld();
    for (let y = 80; y <= 100; y++) for (let x = 20; x < 120; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0x2255aa);
    const { ctx, host, list, damage } = makeCtx(world);
    ctx.player.x = 60; ctx.player.y = 100;
    const leech = critter('leech', 70, 96, { state: LEECH.SWIM });
    list.push(leech);
    tick(ctx, host, 200);
    expect(leech.state).toBe(LEECH.LATCHED);
    tick(ctx, host, 320);
    expect(damage).toHaveBeenCalledWith(expect.any(Number), 0, 0, 'leech');
    // Out of the pool and dry: it lets go.
    for (let y = 80; y <= 100; y++) for (let x = 20; x < 120; x++) world.clearCell(x, y);
    tick(ctx, host, 400);
    expect(leech.state).not.toBe(LEECH.LATCHED);
  });
});

describe('lantern moths', () => {
  it('follow the wand only while its light reaches them', () => {
    const { ctx } = makeCtx();
    ctx.player.x = 100; ctx.player.y = 100; ctx.player.aimAngle = 0;
    const moth = critter('moth', 160, 91);
    (ctx as { lightQuery?: unknown }).lightQuery = { hooded: false, wandLight: () => 0.8, level: () => 1, darkness: () => 0 };
    expect(mothLight(ctx, moth)).toBe(true);
    expect(moth.vx).toBeLessThan(0);
    const dark = critter('moth', 160, 91);
    (ctx as { lightQuery?: unknown }).lightQuery = { hooded: true, wandLight: () => 0.8, level: () => 1, darkness: () => 0 };
    expect(mothLight(ctx, dark)).toBe(false);
    expect(dark.vx).toBe(0);
  });
});

describe('organism worldgen', () => {
  it('is deterministic per seed, bounded, off the spawn, and writes no cells', () => {
    const world = makeWorld();
    for (let y = 100; y < 104; y++) for (let x = 20; x < 200; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0x2255aa);
    const before = Array.from(world.types);
    const def = { id: 'dx', name: 'X', biome: 'fungal' as const, depth: 2, nextLevelId: null };
    const spawn = { x: 30, y: 99 };
    const a = placeOrganisms(world, def, spawn, null, new Rng(7))!;
    const b = placeOrganisms(world, def, spawn, null, new Rng(7))!;
    expect(a.map(c => `${c.kind}${c.x},${c.y}`)).toEqual(b.map(c => `${c.kind}${c.x},${c.y}`));
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(100);
    for (const c of a) expect(Math.hypot(c.x - spawn.x, c.y - spawn.y)).toBeGreaterThanOrEqual(SPAWN_CLEAR - 2);
    expect(Array.from(world.types)).toEqual(before);
    expect(new Set(a.map(c => c.id)).size).toBe(a.length);
  });
});

describe('fauna saves', () => {
  it('keep organism state and free live relations', () => {
    const saved = [
      critter('snapjaw', 50, 60, { anchorX: 50, anchorY: 60, nx: 0, ny: -1, state: SNAP.CHEW, meal: 300, extent: 0.1, reach: 6 }),
      critter('leech', 40, 40, { state: LEECH.LATCHED, anchorX: -2, anchorY: -8 }),
      critter('glowworm', 30, 30, { anchorX: 30, anchorY: 30, state: GLOW.REEL, extent: 12, reach: 20, holds: 'x' }),
    ];
    const restored = restoreFauna(JSON.parse(JSON.stringify(saved)))!;
    expect(restored).toHaveLength(3);
    expect(restored[0]).toMatchObject({ kind: 'snapjaw', anchorX: 50, anchorY: 60, state: SNAP.CHEW, meal: 300, reach: 6 });
    expect(restored[1].state).toBe(LEECH.BEACHED);
    expect(restored[2].state).toBe(GLOW.FISH);
    expect(restored[2].holds).toBeUndefined();
  });
});
