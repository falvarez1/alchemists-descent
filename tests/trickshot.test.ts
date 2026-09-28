import { describe, expect, it, vi } from 'vitest';
import type { Ctx, Enemy } from '@/core/types';
import { createPlayer } from '@/entities/Player';
import { createGameParams } from '@/config/params';
import { sanitizeTrickshot, TRICKSHOT_DEFAULTS } from '@/config/trickshot';
import { advanceTrickshotClock, beginFinisher, canHumiliate, confirmFinisher, finisherEnabled, finisherPhase, recordTrickshot } from '@/combat/Trickshot';
import { getAimGuide } from '@/combat/AimGuide';
import { compileWand } from '@/combat/wands/compiler';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { Projectiles } from '@/combat/Projectiles';

function fixture() {
  const player = createPlayer(); player.x = 30; player.y = 70;
  const actions = compileWand(['spark']).flatMap(g => g.actions);
  return { state: { mode: 'play', frameCount: 0, trickshot: { ...TRICKSHOT_DEFAULTS, enabled: true } }, player,
    fx: {}, telemetry: { count: vi.fn() }, world: new World(300, 140), enemies: [], params: createGameParams(),
    input: { mouse: { x: 230, y: 61 } }, rigidBodies: { hitTest: () => null },
    enemyCtl: { defs: ENEMY_DEFS }, wands: { active: 0, wands: [{ castIndex: 0, mana: 100 }],
      peekCast: () => ({ actions, spread: 0, affordable: true }) },
  } as unknown as Ctx;
}

describe('Trickshot experiment', () => {
  it('defaults off, clamps malformed preferences, and removes all slow motion when switched off', () => {
    expect(sanitizeTrickshot(null).enabled).toBe(false);
    expect(sanitizeTrickshot({ timeScale: NaN, assistDegrees: 90, durationMs: -10 })).toMatchObject({ timeScale: .35, assistDegrees: 8, durationMs: 300 });
    const ctx = fixture(); recordTrickshot(ctx, {} as Enemy, 'sever');
    expect(advanceTrickshotClock(ctx, 100)).toBeLessThan(.5);
    ctx.state.trickshot!.enabled = false;
    expect(advanceTrickshotClock(ctx, 16)).toBe(1); expect(ctx.fx.trickshot).toBeUndefined();
  });

  it('rewards distinct targets without farming repeated hits, pauses its window, and returns to full speed', () => {
    const ctx = fixture(), a = {} as Enemy, b = {} as Enemy;
    recordTrickshot(ctx, a, 'hit'); recordTrickshot(ctx, a, 'hit');
    expect(ctx.fx.trickshot!.chain).toBe(1); expect(advanceTrickshotClock(ctx, 20)).toBe(1);
    recordTrickshot(ctx, b, 'hit'); expect(ctx.fx.trickshot!.chain).toBe(2);
    expect(advanceTrickshotClock(ctx, 100)).toBeLessThan(.5);
    const remaining = ctx.fx.trickshot!.remainingMs; ctx.state.paused = true;
    advanceTrickshotClock(ctx, 100); expect(ctx.fx.trickshot!.remainingMs).toBe(remaining);
    ctx.state.paused = false;
    ctx.time = { manual: true } as Ctx['time'];
    advanceTrickshotClock(ctx, 100); expect(ctx.fx.trickshot!.remainingMs).toBe(remaining);
    ctx.time = { manual: false } as Ctx['time'];
    for (let i = 0; i < 30; i++) advanceTrickshotClock(ctx, 100);
    expect(advanceTrickshotClock(ctx, 16)).toBe(1); expect(ctx.fx.trickshot!.chain).toBe(0);
  });

  it('requires the weakened owner of the carried limb for the humiliation finish', () => {
    const ctx = fixture(), e = { kind: 'weaver', hp: 30, maxHp: 122, weaverSalvageId: 'a' } as Enemy;
    ctx.player.legClub = { owner: 'b', length: 34, durability: 6, swingT: 0, cooldown: 0, angle: 0 };
    expect(canHumiliate(ctx, e)).toBe(false); ctx.player.legClub.owner = 'a';
    expect(canHumiliate(ctx, e)).toBe(true); e.hp = 80; expect(canHumiliate(ctx, e)).toBe(false);
  });

  it('ships the finisher on by default without the experiment, and names it over the victim', () => {
    const ctx = fixture();
    ctx.state.trickshot = { ...TRICKSHOT_DEFAULTS }; // the experiment itself stays off
    expect(TRICKSHOT_DEFAULTS.enabled).toBe(false);
    expect(finisherEnabled(ctx)).toBe(true);
    const e = { kind: 'weaver', hp: 30, maxHp: 122, weaverSalvageId: 'a', x: 60, y: 70 } as Enemy;
    ctx.player.legClub = { owner: 'a', length: 34, durability: 6, swingT: 0, cooldown: 0, angle: 0 };
    expect(canHumiliate(ctx, e)).toBe(true);
    const callouts: Array<{ text: string; tone?: string }> = [];
    Object.assign(ctx, {
      audio: { sfx: () => undefined, creature: () => undefined, finisherWhip: vi.fn(), duck: vi.fn(), at: vi.fn(), shellCrack: vi.fn() },
      particles: { burst: vi.fn() },
      camera: { cineDx: 0, cineDy: 0, cineZoom: 1 },
      events: { emit: (name: string, payload: { text: string; tone?: string }) => { if (name === 'combatCallout') callouts.push(payload); } },
    });
    ctx.state.postFx = { vignette: 0 } as Ctx['state']['postFx'];
    // No chain slow motion without the experiment...
    recordTrickshot(ctx, e, 'hit');
    expect(advanceTrickshotClock(ctx, 16)).toBe(1);
    // ...but the finisher's directed beat runs.
    beginFinisher(ctx, e);
    expect(finisherPhase(ctx)).toBe('approach');
    expect(advanceTrickshotClock(ctx, 16)).toBeCloseTo(0.25);
    confirmFinisher(ctx, e, 60, 60, 1, 0);
    expect(callouts).toEqual([{ x: 60, y: 48, text: 'RETURNED WITH INTEREST', tone: 'finisher' }]);
    for (let i = 0; i < 20; i++) advanceTrickshotClock(ctx, 50);
    expect(finisherPhase(ctx)).toBe('idle');
    expect(advanceTrickshotClock(ctx, 16)).toBe(1);
    // The player can still switch the finisher off.
    ctx.state.trickshot.finisher = false;
    expect(canHumiliate(ctx, e)).toBe(false);
  });

  it('shows the actual first wall contact and keeps the aim guide read-only', () => {
    const ctx = fixture();
    for (let y = 0; y < ctx.world.height; y++) ctx.world.replaceCellAt(ctx.world.idx(150, y), Cell.Metal, 0);
    const before = ctx.world.types.slice(), mana = ctx.wands.wands[0].mana;
    const guide = getAimGuide(ctx)!;
    expect(guide.contact).toBe(true); expect(guide.points.at(-1)!.x).toBeGreaterThanOrEqual(150);
    expect(guide.points.at(-1)!.x).toBeLessThan(151.01); expect(guide.enemy).toBeNull();
    expect(ctx.world.types).toEqual(before); expect(ctx.wands.wands[0].mana).toBe(mana); expect(ctx.wands.wands[0].castIndex).toBe(0);
  });

  it('limits assistance and rejects a target concealed behind material', () => {
    const ctx = fixture(), e = { kind: 'slime', hp: 48, x: 180, y: 72 } as Enemy;
    ctx.enemies.push(e); ctx.input.mouse = { x: 180, y: 65 };
    const raw = Math.atan2(4, 150), guide = getAimGuide(ctx)!;
    expect(guide.enemy).toBe(e); expect(guide.assisted).toBe(true);
    expect(Math.abs(guide.angle - raw)).toBeLessThanOrEqual(4 * Math.PI / 180);
    for (let y = 0; y < ctx.world.height; y++) ctx.world.replaceCellAt(ctx.world.idx(130, y), Cell.Metal, 0);
    ctx.state.frameCount++;
    const covered = getAimGuide(ctx)!;
    expect(covered.enemy).toBeNull(); expect(covered.assisted).toBe(false); expect(covered.angle).toBeCloseTo(raw);
  });

  it('places a live bolt impact in the reticle cell', () => {
    const ctx = fixture();
    for (let y = 0; y < ctx.world.height; y++) ctx.world.replaceCellAt(ctx.world.idx(150, y), Cell.Metal, 0);
    ctx.input.mouse.y = 77;
    const guide = getAimGuide(ctx)!, start = guide.points[0], end = guide.points.at(-1)!;
    ctx.projectiles = [{ ...start, vx: Math.cos(guide.angle) * ctx.params.spells.bolt.velocityForce!,
      vy: Math.sin(guide.angle) * ctx.params.spells.bolt.velocityForce!, type: 'bolt', life: 180, age: 0, charging: false, hostile: false }];
    ctx.particles = { spawn: vi.fn(), burst: vi.fn() } as unknown as Ctx['particles'];
    ctx.audio = { sfx: () => undefined, creature: () => undefined, hollowKnock: vi.fn(), implode: vi.fn() } as unknown as Ctx['audio'];
    ctx.events = { emit: vi.fn() } as unknown as Ctx['events'];
    ctx.explosions = { trigger: vi.fn() } as unknown as Ctx['explosions'];
    ctx.spells = { erodeAt: vi.fn() } as unknown as Ctx['spells'];
    const projectiles = new Projectiles();
    for (let i = 0; i < 50 && ctx.projectiles.length; i++) projectiles.update(ctx);
    expect(ctx.projectiles).toHaveLength(0);
    expect(ctx.explosions.trigger).toHaveBeenCalledWith(Math.floor(end.x), Math.floor(end.y), expect.any(Number), undefined);
  });
});
