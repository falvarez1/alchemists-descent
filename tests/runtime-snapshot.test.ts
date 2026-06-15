import { describe, expect, it } from 'vitest';
import { createGameParams } from '@/config/params';
import type { Ctx, Enemy, Mechanism, Pickup, Projectile } from '@/core/types';
import { createDefaultStatus } from '@/entities/status';
import { createPlayer } from '@/entities/Player';
import {
  buildRuntimeEntitySnapshot,
  filterRuntimeRows,
  inferRuntimeSource,
} from '@/game/runtimeSnapshot';
import { Cell } from '@/sim/CellType';

describe('runtime entity snapshot', () => {
  it('builds detached grouped rows from the active runtime', () => {
    const enemy = makeEnemy();
    const projectile = makeProjectile();
    const pickup = makePickup();
    const mechanism = makeMechanism();
    const ctx = makeCtx({
      enemies: [enemy],
      projectiles: [projectile],
      pickups: [pickup],
      mechanisms: [mechanism],
      particles: [
        makeParticle({ type: null, glow: 1.2 }),
        makeParticle({ type: Cell.Sand, homing: true }),
        makeParticle({ type: Cell.Fire, hostileDmg: 4, x: 900 }),
      ],
    });

    const snapshot = buildRuntimeEntitySnapshot(ctx);
    const enemyRow = snapshot.rows.find((row) => row.group === 'enemies')!;

    expect(snapshot.source.id).toBe('builder-playtest');
    expect(snapshot.counts.find((count) => count.group === 'enemies')).toMatchObject({
      total: 1,
      sampled: 1,
    });
    expect(snapshot.particles).toMatchObject({
      total: 3,
      visual: 1,
      depositing: 2,
      homing: 1,
      hostile: 1,
      glowing: 1,
    });
    expect(snapshot.particles.byMaterial.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(['Sand', 'Fire']),
    );
    expect(enemyRow.bounds).toEqual({ x0: 115, y0: 93, x1: 126, y1: 101 });
    expect(snapshot.rows.find((row) => row.group === 'mechanisms')?.bounds).toEqual({
      x0: mechanism.x,
      y0: mechanism.y,
      x1: mechanism.x + mechanism.w,
      y1: mechanism.y + mechanism.h,
    });

    enemy.hp = 1;
    expect(enemyRow.hp).toBe(12);
  });

  it('does not surface parked play runtime rows while authoring in build mode', () => {
    const snapshot = buildRuntimeEntitySnapshot(
      makeCtx({
        mode: 'build',
        pickups: [makePickup()],
        mechanisms: [makeMechanism()],
        particles: [makeParticle({ type: Cell.Fire })],
      }),
    );

    expect(snapshot.source.id).toBe('build');
    expect(snapshot.level).toBeNull();
    expect(snapshot.rows).toHaveLength(0);
    expect(snapshot.particles.total).toBe(0);
  });

  it('keeps object ids stable and reports stale selections when objects disappear', () => {
    const enemy = makeEnemy();
    const ctx = makeCtx({ enemies: [enemy] });
    const first = buildRuntimeEntitySnapshot(ctx);
    const enemyId = first.rows.find((row) => row.group === 'enemies')!.id;

    const selected = buildRuntimeEntitySnapshot(ctx, { selectedId: enemyId });
    ctx.enemies.length = 0;
    const stale = buildRuntimeEntitySnapshot(ctx, { selectedId: enemyId });

    expect(selected.selectedRow?.id).toBe(enemyId);
    expect(stale.selectedRow).toBeNull();
    expect(stale.selectedMissing).toBe(true);
  });

  it('caps high-volume row groups without losing aggregate counts', () => {
    const ctx = makeCtx({
      projectiles: [makeProjectile('bolt'), makeProjectile('bomb'), makeProjectile('warp')],
    });

    const snapshot = buildRuntimeEntitySnapshot(ctx, {
      maxRowsPerGroup: { projectiles: 2 },
    });

    expect(snapshot.capped).toBe(true);
    expect(snapshot.counts.find((count) => count.group === 'projectiles')).toMatchObject({
      total: 3,
      sampled: 2,
    });
    expect(snapshot.rows.filter((row) => row.group === 'projectiles')).toHaveLength(2);
  });

  it('does not mark the snapshot capped for aggregate-only particles', () => {
    const snapshot = buildRuntimeEntitySnapshot(
      makeCtx({
        particles: [makeParticle({ type: Cell.Sand }), makeParticle({ type: null })],
      }),
    );

    expect(snapshot.particles.total).toBe(2);
    expect(snapshot.counts.find((count) => count.group === 'particles')).toMatchObject({
      total: 2,
      sampled: 0,
    });
    expect(snapshot.capped).toBe(false);
  });

  it('counts downward mechanism bodies as visible when their anchor is above the view', () => {
    const mechanism = { ...makeMechanism(), y: -10, h: 50 };
    const snapshot = buildRuntimeEntitySnapshot(makeCtx({ mechanisms: [mechanism] }));

    expect(snapshot.counts.find((count) => count.group === 'mechanisms')?.visible).toBe(1);
  });

  it('keeps a selected row available even when it falls beyond the group cap', () => {
    const projectiles = [makeProjectile('bolt'), makeProjectile('bomb'), makeProjectile('warp')];
    const ctx = makeCtx({ projectiles });
    const selectedId = buildRuntimeEntitySnapshot(ctx).rows.find((row) => row.kind === 'warp')!.id;

    const snapshot = buildRuntimeEntitySnapshot(ctx, {
      selectedId,
      maxRowsPerGroup: { projectiles: 1 },
    });

    expect(snapshot.selectedMissing).toBe(false);
    expect(snapshot.selectedRow?.id).toBe(selectedId);
    expect(snapshot.rows.some((row) => row.id === selectedId)).toBe(true);
    expect(snapshot.counts.find((count) => count.group === 'projectiles')).toMatchObject({
      total: 3,
      sampled: 2,
    });
  });

  it('uses level-scoped durable ids for mechanisms and portals', () => {
    const mechanism = makeMechanism();
    const snapshot = buildRuntimeEntitySnapshot(makeCtx({ mechanisms: [mechanism] }));

    expect(snapshot.rows.find((row) => row.group === 'mechanisms')?.id).toBe('mechanism:test-depth:3');
    expect(snapshot.rows.find((row) => row.group === 'portal')?.id).toBe('portal:test-depth');
  });

  it('reports permanently broken mechanisms when broken is zero', () => {
    const mechanism = { ...makeMechanism(), broken: 0 };
    const snapshot = buildRuntimeEntitySnapshot(makeCtx({ mechanisms: [mechanism] }));
    const row = snapshot.rows.find((candidate) => candidate.group === 'mechanisms')!;

    expect(row.badges).toContain('broken open');
    expect(row.fields.find((field) => field.label === 'broken')?.value).toBe('broken open');
  });

  it('filters cached rows by group and query', () => {
    const snapshot = buildRuntimeEntitySnapshot(
      makeCtx({
        enemies: [makeEnemy('bat')],
        projectiles: [makeProjectile('bomb')],
      }),
    );

    const enemies = filterRuntimeRows(snapshot.rows, 'bat', new Set(['enemies']));
    const misses = filterRuntimeRows(snapshot.rows, 'bat', new Set(['projectiles']));

    expect(enemies).toHaveLength(1);
    expect(enemies[0].kind).toBe('bat');
    expect(misses).toHaveLength(0);
  });

  it('infers source labels from runtime lifecycle state', () => {
    expect(inferRuntimeSource(makeCtx({ mode: 'build' })).id).toBe('build');
    expect(inferRuntimeSource(makeCtx({ playtestSource: null })).id).toBe('expedition');
    expect(inferRuntimeSource(makeCtx({ playtestSource: 'test' })).id).toBe('test-run');
    expect(inferRuntimeSource(makeCtx({ playtestSource: null, debugGodMode: true })).id).toBe('debug-run');
  });
});

function makeCtx(options: {
  mode?: 'build' | 'play';
  playtestSource?: 'builder' | 'test' | null;
  debugGodMode?: boolean;
  enemies?: Enemy[];
  projectiles?: Projectile[];
  pickups?: Pickup[];
  mechanisms?: Mechanism[];
  particles?: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    type: number | null;
    color: number;
    life: number;
    grav: number;
    glow: number;
    homing: boolean;
    hostileDmg: number;
  }>;
} = {}): Ctx {
  const player = createPlayer();
  player.x = 100;
  player.y = 100;
  const current = {
    def: { id: 'test-depth', name: 'Test Depth', depth: 2, biome: 'earthen', nextLevelId: null },
    pickups: options.pickups ?? [],
    mechanisms: options.mechanisms ?? [],
    portal: { x: 220, y: 110, open: false },
  };
  return {
    params: createGameParams(),
    state: {
      mode: options.mode ?? 'play',
      frameCount: 77,
      playtestSource: options.playtestSource === undefined ? 'builder' : options.playtestSource,
      debugGodMode: options.debugGodMode ?? false,
    },
    camera: { renderX: 0, renderY: 0, zoom: 1 },
    player,
    enemies: options.enemies ?? [],
    enemyCtl: {
      defs: {
        slime: { hp: 48, halfW: 5, h: 8, bounty: 30, gore: Cell.Slime, goreFn: () => 0 },
        bat: { hp: 16, halfW: 3, h: 5, bounty: 15, gore: Cell.Blood, goreFn: () => 0 },
      },
    },
    projectiles: options.projectiles ?? [],
    critters: { list: [] },
    particles: { list: options.particles ?? [] },
    levels: { current },
  } as unknown as Ctx;
}

function makeEnemy(kind: Enemy['kind'] = 'slime'): Enemy {
  return {
    kind,
    x: 120,
    y: 100,
    fx: 0,
    fy: 0,
    vx: 1,
    vy: -0.5,
    hp: 12,
    maxHp: 20,
    flash: 0,
    timer: 3,
    attackCd: 9,
    bobPhase: 0,
    grounded: true,
    stride: 0,
    splat: 0,
    prevG: false,
    blink: 0,
    jetFuel: 0,
    jetCd: 0,
    stuckT: 0,
    status: createDefaultStatus(),
  };
}

function makeProjectile(type: Projectile['type'] = 'bolt'): Projectile {
  return {
    x: 130,
    y: 96,
    vx: 4,
    vy: 0,
    type,
    life: 44,
    age: 8,
    charging: false,
    hostile: false,
  };
}

function makePickup(): Pickup {
  return {
    kind: 'heart',
    x: 140,
    y: 100,
    vx: 0,
    vy: 0,
    taken: false,
    data: {},
  };
}

function makeMechanism(): Mechanism {
  return {
    id: 3,
    kind: 'door',
    x: 160,
    y: 100,
    w: 6,
    h: 20,
    state: 0,
    targetId: -1,
  };
}

function makeParticle(
  overrides: Partial<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    type: number | null;
    color: number;
    life: number;
    grav: number;
    glow: number;
    homing: boolean;
    hostileDmg: number;
  }> = {},
): {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: number | null;
  color: number;
  life: number;
  grav: number;
  glow: number;
  homing: boolean;
  hostileDmg: number;
} {
  return {
    x: 120,
    y: 100,
    vx: 0,
    vy: 0,
    type: null,
    color: 0xffffff,
    life: 30,
    grav: 0,
    glow: 0,
    homing: false,
    hostileDmg: 0,
    ...overrides,
  };
}
