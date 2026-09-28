import { describe, expect, it } from 'vitest';

import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import { HEIGHT, WIDTH } from '@/config/constants';
import type { Ctx, GameStateData, LevelDef } from '@/core/types';
import { blocksEntity, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { fnv1aString } from '@/core/rng';
import { WorldGen } from '@/world/CaveGenerator';
import { bodyCanCollect, wizardMask } from '@/world/validate';

/**
 * THE FIXTURE FOOTING CONTRACT (world/fixtureFooting): at the end of generation
 * every placed fixture stands on its own stamp and on ground — the waystones'
 * bowls, the cauldron's basin, the hand-triggers' brackets, bowls and sills —
 * no mechanism is wrecked before the player arrives (its gate would fall open
 * by itself), and the golden key is somewhere the alchemist's body can take it.
 * QA 2026-09-28 found 30/30 waystones, 15/15 cauldrons and 18 triggers
 * floating, 32 mechanisms wrecked on arrival and 3 keys sealed.
 */

const noop = (): undefined => undefined;
const noopSubsystem = (): unknown => new Proxy({}, { get: () => noop });

function makeCtx(world: World, worldSeed: number): Ctx {
  const state: GameStateData = {
    mode: 'build', score: 0, frameCount: 0, activeInputMode: 'element', currentElement: Cell.Sand, currentSpell: 'bolt',
    currentBiome: 'earthen', brushSize: 6, playerSpawned: false, worldSeed, paused: false, postFx: createDefaultPostFxSettings(), editorLights: null,
  };
  return {
    world, state, player: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2), vx: 0, vy: 0, fx: 0, fy: 0 },
    enemies: [], enemyCtl: { spawn: noop }, events: { emit: noop, on: noop, off: noop }, audio: noopSubsystem(), particles: noopSubsystem(),
    rigidBodies: noopSubsystem(), fx: {}, levels: { current: null }, sanctum: { open: noop },
  } as unknown as Ctx;
}

function generate(def: LevelDef, seed: number) {
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  return { world, out: gen.generateLevel(ctx, def, seed) };
}

function footingProblems(world: World, out: ReturnType<WorldGen['generateLevel']>): string[] {
  const problems: string[] = [];
  const solid = (x: number, y: number): boolean => blocksEntity(world.types[world.idx(x, y)]);
  const row = (x0: number, x1: number, y: number): boolean => {
    for (let x = x0; x <= x1; x++) if (!solid(x, y)) return false;
    return true;
  };
  // The generated bowls come first; a prefab's waystone is its own stamp.
  for (const ws of out.waystones.slice(0, 2)) {
    const at = `waystone@${ws.x},${ws.y}`;
    if (!row(ws.x - 3, ws.x + 3, ws.y + 1) || !solid(ws.x - 3, ws.y - 1) || !solid(ws.x + 3, ws.y - 1)) problems.push(`${at}: bowl stamp broken`);
    if (!row(ws.x - 3, ws.x + 3, ws.y + 2)) problems.push(`${at}: no ground under the bowl`);
    if (!bowlOpen(world, ws.x - 2, ws.x + 2, ws.y - 1, ws.y)) problems.push(`${at}: bowl filled`);
  }
  const c = out.cauldron;
  if (c) {
    const at = `cauldron@${c.x},${c.y}`;
    if (!row(c.x - 4, c.x + 4, c.y + 1) || !solid(c.x - 4, c.y - 1) || !solid(c.x + 4, c.y - 1)) problems.push(`${at}: basin stamp broken`);
    if (!row(c.x - 4, c.x + 4, c.y + 2)) problems.push(`${at}: no ground under the basin`);
  }
  for (const m of out.mechanisms) {
    const at = `${m.kind}@${m.x},${m.y}`;
    if (m.body?.length && m.kind !== 'plug' && m.kind !== 'valve' && m.kind !== 'door') {
      const intact = m.body.filter(([x, y]) => solid(x, y)).length;
      if (intact < m.body.length / 2) problems.push(`${at}: wrecked before arrival (${intact}/${m.body.length})`);
    }
    // A lever's bracket and a plate's sill are set FLUSH in their shelf: on
    // ground, or a shelf that goes on past them.
    const inShelf = (x0: number, x1: number, y: number): boolean => row(x0, x1, y + 1) || solid(x0 - 1, y) || solid(x1 + 1, y);
    if (m.kind === 'lever' && !m.look && (!row(m.x - 1, m.x + 1, m.y + 1) || !inShelf(m.x - 1, m.x + 1, m.y + 1))) problems.push(`${at}: bracket over air`);
    if (m.kind === 'brazier' && !row(m.x - 2, m.x + 2, m.y + 1)) problems.push(`${at}: bowl over air`);
    if (m.kind === 'plate' && !inShelf(m.x, m.x + m.w - 1, m.y)) problems.push(`${at}: sill over air`);
  }
  const wiz = wizardMask({ world, spawn: out.spawn });
  for (const p of out.pickups) {
    if (p.kind === 'key' && !bodyCanCollect(wiz, world, p.x, p.y)) problems.push(`key@${Math.round(p.x)},${Math.round(p.y)}: the body cannot take it`);
  }
  return problems;
}

function bowlOpen(world: World, x0: number, x1: number, y0: number, y1: number): boolean {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (blocksEntity(world.types[world.idx(x, y)])) return false;
  return true;
}

describe('fixtures stand on their footing at the end of generation', () => {
  for (const id of ['d2', 'd2b', 'd3', 'd3b', 'd4'] as const) {
    it(`${id}: bowls, basin, triggers on ground; nothing wrecked; the key takeable (expeditions 1, 42, 1337)`, () => {
      const problems: string[] = [];
      // The floors a run on these expedition seeds generates (the QA audit's).
      for (const expedition of [1, 42, 1337]) {
        const { world, out } = generate(LEVELS[id], (expedition ^ fnv1aString(id)) >>> 0);
        for (const p of footingProblems(world, out)) problems.push(`e${expedition} ${p}`);
      }
      expect(problems).toEqual([]);
    }, 120000);
  }
});
