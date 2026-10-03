import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ARENA_RULES } from '@/config/arenaRules';
import { ArenaSlots } from '@/arena/ArenaSlots';
import type { SlotBundle } from '@/core/arena';
import { EventBus } from '@/core/events';
import type { Ctx, Enemy, Projectile } from '@/core/types';
import { Projectiles } from '@/combat/Projectiles';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { World } from '@/sim/World';
import { FighterSystem } from '@/fighters/FighterSystem';
import { kit as ruskKit } from '@/fighters/kits/rusk-emberjaw';

/** The arena's slot machinery (src/arena/ArenaSlots, core/events scoping) against fakes: no game, no world. */

interface FakeBody {
  x: number; y: number; vx: number; vy: number; hp: number; maxHp: number; grounded: boolean; dead: boolean;
  invuln: number; stunT: number; status: Record<string, number>; maxMana: number; mana: number; levit: number; maxLevit: number;
  firing: boolean; fx: number; fy: number; crawling: boolean; climbing: boolean;
}

function body(x: number): FakeBody {
  return { x, y: 100, vx: 0, vy: 0, hp: 100, maxHp: 100, grounded: true, dead: false, invuln: 0, stunT: 0, status: { burning: 0, wet: 0, frozen: 0 }, maxMana: 100, mana: 100, levit: 50, maxLevit: 50, firing: false, fx: 0, fy: 0, crawling: false, climbing: false };
}

interface Calls { damage: Array<{ boundPlayer: unknown; amount: number; kx: number; ky: number; src?: string }>; impulse: Array<{ boundPlayer: unknown; vx: number; vy: number }> }

function setup(ready = Promise.resolve(), realFighters = false): { ctx: Ctx; arena: ArenaSlots; calls: Calls; made: SlotBundle[]; base: SlotBundle } {
  const calls: Calls = { damage: [], impulse: [] };
  const events = new EventBus();
  const ctx = {
    events,
    enemies: [] as Enemy[],
    projectiles: [] as Projectile[],
    state: { frameCount: 10, mode: 'play' },
    audio: { sfx: () => undefined },
    camera: { inspectionFocus: null },
    world: { width: 1600, height: 1000 },
    physics: { entityFree: () => true, cellBlocks: () => false },
    projectileCtl: { invalidateEnemyIndex: () => undefined },
  } as unknown as Ctx;
  const mk = (x: number, dealt: number, slot: number): SlotBundle => {
    const player = body(x);
    const b: SlotBundle = {
      player: player as unknown as SlotBundle['player'],
      input: { keys: { left: false, right: false, up: false, jump: false, wallJump: false, down: false, grab: false }, mouse: { x: 0, y: 0 } } as unknown as SlotBundle['input'],
      playerCtl: {
        damage: (amount: number, kx: number, ky: number, src?: string) => { calls.damage.push({ boundPlayer: ctx.player, amount, kx, ky, src }); player.hp -= amount; },
        applyImpulse: (vx: number, vy: number) => { calls.impulse.push({ boundPlayer: ctx.player, vx, vy }); player.vx += vx; player.vy += vy; },
        update: () => undefined,
        resetTransientState: () => undefined,
        kick: () => undefined,
        kill: () => undefined,
        respawn: () => undefined,
        grabVine: () => false,
        releaseVine: () => undefined,
        findSpawnPoint: () => ({ x: 0, y: 0 }),
      } as unknown as SlotBundle['playerCtl'],
      wands: { update: () => undefined, wands: [], dispose: () => undefined, snapshotLoadout: () => ({}), loadLoadout: () => undefined } as unknown as SlotBundle['wands'],
      flask: { update: () => undefined, slots: [], clearSlots: () => undefined, setSlot: () => undefined } as unknown as SlotBundle['flask'],
      fighters: {
        id: null, body: { dealt, maxHp: 1, jetFuel: 1 }, bindScope: null, update: () => undefined, reset: () => undefined, refill: () => undefined,
        equip(id: unknown) { (this as { id: unknown }).id = id; }, whenReady: () => ready, dispose: () => undefined,
        enemyRuns: () => true, isStunned: () => false, interceptProjectile: () => false,
      } as unknown as SlotBundle['fighters'],
      chill: { update: () => undefined, reset: () => undefined } as unknown as SlotBundle['chill'],
    };
    if (realFighters) b.fighters = slot === 0
      ? new FighterSystem(ctx, () => ready.then(() => ruskKit))
      : events.asSlot(slot, () => new FighterSystem(ctx, () => ready.then(() => ruskKit)));
    return b;
  };
  const base = mk(100, 1, 0);
  Object.assign(ctx, { player: base.player, input: base.input, playerCtl: base.playerCtl, wands: base.wands, flask: base.flask, fighters: base.fighters, chill: base.chill });
  const made: SlotBundle[] = [];
  const arena = new ArenaSlots(ctx, (slot) => { const b = mk(300, 1.5, slot); made[slot] = b; return b; });
  ctx.arena = arena;
  return { ctx, arena, calls, made, base };
}

describe('EventBus slot scoping', () => {
  async function meleeSetup() {
    const result = setup();
    const { arena, base, ctx } = result;
    await arena.addRival('ilyra-voss', 120, 100);
    arena.configureStocks({ left: 0, right: 600, top: 0, bottom: 500 });
    for (let i = 0; i < 121; i++) arena.endTick();
    const rival = arena.bundle(1)!;
    for (const [slot, bundle] of [base, rival].entries()) {
      Object.assign(bundle.player, { x: slot ? 120 : 100, y: 100, facing: slot ? -1 : 1, invuln: 0, grounded: true });
      bundle.player.status.stoneskin = 0;
      bundle.playerCtl.damage = (damage, x, y) => { arena.takeStockDamage(damage, x, y); };
    }
    const step = (ticks: number) => { for (let i = 0; i < ticks; i++) {
      arena.with(0, () => arena.updateStockAttack(true)); arena.with(1, () => arena.updateStockAttack(true)); arena.endTick();
    } };
    return { ...result, ctx, rival, step };
  }
  test('stock melee waits for contact, hits once, locks end lag and preserves HP', async () => {
    const { arena, base, rival, step } = await meleeSetup();
    expect(arena.requestStockAttack()).toBe(true);
    step(3); expect(arena.stockMatch?.fighters[1].volatility).toBe(0);
    step(1); const damage = arena.stockMatch!.fighters[1].volatility;
    expect(damage).toBeGreaterThan(0); expect(rival.player.hp).toBe(rival.player.maxHp);
    rival.player.x = 120; step(3);
    expect(arena.stockMatch?.fighters[1].volatility).toBe(damage);
    expect(arena.stockAttack(0)?.phase).toBe('recovery'); expect(arena.isActionLocked(0)).toBe(true);
    expect(arena.requestStockAttack()).toBe(false);
    arena.updateStockDodge(true, true); expect(arena.stockDodge(0)?.busy).toBe(false);
    step(10); expect(arena.isActionLocked(0)).toBe(false);
    base.input.keys.down = true; expect(arena.requestStockAttack()).toBe(true);
    expect(arena.stockAttack(0)?.kind).toBe('finisher');
    arena.takeStockDamage(5, 2, -1); expect(arena.stockAttack(0)?.busy).toBe(false);
  });
  test('stock melee cannot hit through solid cells or dodge invulnerability', async () => {
    const { arena, ctx, step } = await meleeSetup();
    ctx.physics.cellBlocks = () => true;
    arena.requestStockAttack(); step(7);
    expect(arena.stockMatch?.fighters[1].volatility).toBe(0);
    ctx.physics.cellBlocks = () => false; step(10);
    arena.with(1, () => { arena.updateStockDodge(true, true); for (let i = 0; i < 3; i++) arena.updateStockDodge(false, true); });
    arena.requestStockAttack(); step(4);
    expect(arena.stockMatch?.fighters[1].volatility).toBe(0);
  });
  test('simultaneous stock contacts trade and interrupt both attackers', async () => {
    const { arena, step } = await meleeSetup();
    arena.requestStockAttack(); arena.with(1, () => arena.requestStockAttack()); step(4);
    expect(arena.stockMatch!.fighters.every(f => f.volatility > 0)).toBe(true);
    expect(arena.stockAttack(0)?.busy).toBe(false); expect(arena.stockAttack(1)?.busy).toBe(false);
    expect(arena.bound).toBe(0);
  });
  test('stock melee rejects restrained bodies and clears on rematch', async () => {
    const { arena, base } = await meleeSetup();
    base.player.climbing = true; expect(arena.requestStockAttack()).toBe(false);
    base.player.climbing = false; base.player.recharge = 4; expect(arena.requestStockAttack()).toBe(false);
    base.player.recharge = 0; base.player.grounded = false; expect(arena.requestStockAttack()).toBe(true);
    expect(arena.stockAttack(0)?.kind).toBe('aerial');
    arena.reset(); expect(arena.stockAttack(0)?.busy).toBe(false);
  });
  test('stock dodges reject blows during evasion and lock attacks through end lag', async () => {
    const { arena, base } = setup();
    await arena.addRival('brann-rook', 300, 100);
    arena.configureStocks({ left: 0, right: 600, top: 0, bottom: 500 });
    for (let i = 0; i < 121; i++) arena.endTick();
    base.player.grounded = true;
    arena.updateStockDodge(true, true);
    expect(arena.isActionLocked(0)).toBe(true); expect(arena.isEvading(0)).toBe(false);
    for (let i = 0; i < 3; i++) arena.updateStockDodge(false, true);
    expect(arena.isEvading(0)).toBe(true);
    arena.takeStockDamage(40, 3, 0); expect(arena.stockMatch?.fighters[0].volatility).toBe(0);
    for (let i = 0; i < 11; i++) arena.updateStockDodge(false, true);
    expect(arena.isEvading(0)).toBe(false); expect(arena.isActionLocked(0)).toBe(true);
    arena.takeStockDamage(40, 0, 0); expect(arena.stockMatch?.fighters[0].volatility).toBe(40);
    arena.reset(); expect(arena.stockDodge(0)?.phase).toBe('idle'); expect(arena.stockDodge(0)?.airReady).toBe(true);
    arena.configureStocks(null); expect(arena.isActionLocked(0)).toBe(false);
  });
  test('a tagged handler hears a per-fighter event only while its slot is bound; untagged and global events reach everyone', () => {
    const bus = new EventBus();
    const heard: string[] = [];
    bus.on('cardCast', () => heard.push('shared'));
    bus.asSlot(1, () => { bus.on('cardCast', () => heard.push('slot1')); bus.on('levelChanged', () => heard.push('slot1-level')); });
    bus.asSlot(0, () => { bus.on('cardCast', () => heard.push('slot0')); });
    bus.emit('cardCast', { id: 'spark' } as never);
    expect(heard).toEqual(['shared', 'slot1', 'slot0']); // not scoped yet: everyone hears
    heard.length = 0;
    bus.scoped = true;
    bus.boundSlot = 0;
    bus.emit('cardCast', { id: 'spark' } as never);
    expect(heard).toEqual(['shared', 'slot0']);
    heard.length = 0;
    bus.boundSlot = 1;
    bus.emit('cardCast', { id: 'spark' } as never);
    expect(heard).toEqual(['shared', 'slot1']);
    heard.length = 0;
    bus.emit('levelChanged', { depth: 1, name: 'x' });
    expect(heard).toEqual(['slot1-level']); // a floor change is not a per-fighter event: it reaches every slot
  });

  test('registration is scoped to the callback and restores the previous tagging', () => {
    const bus = new EventBus();
    bus.asSlot(2, () => { expect(bus.registeringSlot).toBe(2); bus.asSlot(3, () => expect(bus.registeringSlot).toBe(3)); expect(bus.registeringSlot).toBe(2); });
    expect(bus.registeringSlot).toBeNull();
  });
});

describe('ArenaSlots', () => {
  test('health-duel body slow does not suppress the rival wand phase', async () => {
    const { arena, base, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    base.fighters.equip('ilyra-voss');
    base.fighters.enemyRuns = () => false;
    let casts = 0;
    made[1].wands.update = () => { casts++; };
    arena.endTick(); arena.runRivals('wands');
    expect(casts).toBe(1);
  });
  test('removing the opponent idles the stock match, and the next opponent starts fresh', async () => {
    const { arena } = setup();
    await arena.addRival('brann-rook', 300, 100);
    arena.configureStocks({ left: 0, right: 600, top: 0, bottom: 500 });
    arena.removeRival(1);
    expect(arena.stockMatch?.state).toBe('idle');
    expect(arena.stockMatch?.fighters).toHaveLength(0);
    await arena.addRival('brann-rook', 300, 100);
    expect(arena.stockMatch?.state).toBe('countdown');
    expect(arena.stockMatch?.fighters[0].stocks).toBe(3);
  });
  test('stock recovery is consumed once in the air and restored only by landing', async () => {
    const { arena, base } = setup();
    await arena.addRival('brann-rook', 300, 100);
    arena.configureStocks({ left: 0, right: 600, top: 0, bottom: 500 });
    for (let i = 0; i < 121; i++) arena.endTick();
    base.player.grounded = false;
    arena.updateStockRecovery(true);
    expect(base.player.vy).toBe(-7.5);
    for (let i = 0; i < 20; i++) arena.updateStockRecovery(false);
    base.player.vy = 2;
    arena.updateStockRecovery(true);
    expect(base.player.vy).toBe(2);
    base.player.grounded = true; arena.updateStockRecovery(false);
    base.player.grounded = false; arena.updateStockRecovery(true);
    expect(base.player.vy).toBe(-7.5);
  });
  // (these tests count whole blows: the duel's tempo dial is 1 here; its own test is below)
  const was = ARENA_RULES.blowScale;
  const equality = ARENA_RULES.healthEquality;
  beforeEach(() => { ARENA_RULES.blowScale = 1; });
  afterEach(() => { ARENA_RULES.blowScale = was; ARENA_RULES.healthEquality = equality; });

  test('a rematch respawns each Rusk kit in its own slot and restores starting armor', async () => {
    const { ctx, arena, base, made } = setup(Promise.resolve(), true);
    base.fighters.equip('rusk-emberjaw');
    await base.fighters.whenReady();
    base.fighters.update(ctx);
    await arena.addRival('rusk-emberjaw', 300, 100);
    expect(base.fighters.armor).toBe(40); // the rival's arrival cannot respawn slot 0
    const fighters = [base, made[1]];
    const tick = () => fighters.forEach((b, slot) => arena.with(slot, () => b.fighters.update(ctx)));
    tick();
    expect(fighters.map(b => b.fighters.armor)).toEqual([40, 40]);
    const heard: number[] = [];
    fighters.forEach((b, slot) => ctx.events.asSlot(slot, () => ctx.events.on('playerRespawned', () => {
      expect(ctx.player).toBe(b.player);
      heard.push(slot);
    })));
    for (let bout = 0; bout < 2; bout++) {
      arena.noteDown(0, 'fighter');
      arena.reset();
      tick();
      expect(fighters.map(b => b.fighters.armor)).toEqual([40, 40]);
      expect(fighters.map(b => b.fighters.view.ultimate.ready)).toEqual([true, true]);
    }
    expect(heard).toEqual([0, 1, 0, 1]);
  });

  test('a rematch clears both fighters effects on the reused stand-in before endTick', async () => {
    const { ctx, arena, base, made } = setup(Promise.resolve(), true);
    base.fighters.equip('rusk-emberjaw');
    await base.fighters.whenReady();
    await arena.addRival('rusk-emberjaw', 300, 100);
    const fighters = [base, made[1]];
    const stand = ctx.enemies[0];
    for (const b of fighters) {
      const f = b.fighters as FighterSystem;
      f.stunEnemy(stand, 120);
      f.slowEnemy(stand, 0, 120);
      f.markEnemy(stand, 120);
      f.revealEnemy(stand, 120);
    }
    arena.endTick();
    expect(fighters.map(b => b.player.stunT)).toEqual([2, 2]);
    arena.reset();
    arena.endTick();
    expect(ctx.enemies[0]).toBe(stand);
    expect(fighters.map(b => b.player.stunT)).toEqual([0, 0]);
    for (const [slot, b] of fighters.entries()) {
      const f = b.fighters as FighterSystem;
      expect(arena.runsBody(slot)).toBe(true);
      expect(f.isStunned(stand)).toBe(false);
      expect(f.isMarked(stand)).toBe(false);
      expect(f.isRevealed(stand)).toBe(false);
      // Touching the same stand-in again must not resurrect its old slow.
      f.markEnemy(stand, 10);
      expect(f.enemySlow(stand)).toBe(1);
    }
  });

  test.each(['remove', 'level change'] as const)('cancels pending and queued rival loads on %s', async (cause) => {
    const ready = Promise.withResolvers<void>();
    const { ctx, arena, made } = setup(ready.promise);
    const adding = arena.addRival('brann-rook', 500, 200);
    const queued = arena.addRival('edda-morrow', 600, 200);
    const removed = made[1];
    if (cause === 'remove') arena.removeRival(1);
    else ctx.events.emit('levelChanged', { depth: 1, name: 'next' });
    ready.resolve();
    expect(await adding).toBe(-1);
    expect(await queued).toBe(-1);
    expect(arena.active).toBe(false);
    expect(ctx.enemies).toHaveLength(0);
    expect(removed.player.x).toBe(300); // never respawned after removal
    expect(arena.bout.state).toBe('idle');
    expect(ctx.events.scoped).toBe(false);
    expect(await arena.addRival('edda-morrow', 600, 200)).toBe(1);
    expect(ctx.enemies).toHaveLength(1);
  });

  function projectileSetup(ctx: Ctx, arena: ArenaSlots): Projectiles {
    const projectiles = new Projectiles();
    for (let slot = 0; slot < arena.slotCount; slot++) arena.bundle(slot)!.player.invuln = 0;
    arena.with(1, () => undefined);
    Object.assign(ctx, {
      world: new World(600, 300),
      state: { mode: 'play', frameCount: 10 },
      projectileCtl: projectiles,
      enemyCtl: { defs: ENEMY_DEFS, damage: (e: Enemy, amount: number, kx: number, ky: number) => arena.hit(e, amount, kx, ky, 'direct') },
      particles: { spawn: () => undefined, burst: () => undefined },
      audio: { sfx: () => undefined },
      params: { spells: {} },
      fx: {},
    });
    return projectiles;
  }

  test.each([0, 1])('slot %s black holes damage the opponent and attribute its knockout to the caster', async (owner) => {
    const { ctx, arena, calls, base, made } = setup();
    await arena.addRival('nox-calder', 300, 100);
    const projectiles = projectileSetup(ctx, arena);
    const caster = owner === 0 ? base : made[1];
    const victim = owner === 0 ? made[1] : base;
    // A harmless well at the caster also checks that ownership cannot hit itself.
    for (const b of [victim, caster]) ctx.projectiles.push({ x: b.player.x - 2, y: b.player.y, vx: 0, vy: 0, type: 'blackhole', vortexRad: 8, life: 30, age: 0, charging: false, hostile: false, owner });
    projectiles.update(ctx);
    expect(caster.player.hp).toBe(100);
    expect(victim.player.hp).toBeLessThan(100);
    expect(calls.damage).toHaveLength(1);
    expect(calls.damage[0].boundPlayer).toBe(victim.player);
    expect(arena.bound).toBe(0);
    arena.noteDown(1 - owner, 'fighter');
    expect(arena.bout.winner).toBe(owner);
  });

  test.each([true, false])('ice lance interception consumed=%s preserves shield and piercing behavior', async (consumed) => {
    const { ctx, arena, calls, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const projectiles = projectileSetup(ctx, arena);
    let intercepts = 0;
    made[1].fighters.interceptProjectile = () => { intercepts++; expect(arena.bound).toBe(1); return consumed; };
    const lance: Projectile = { x: 300, y: 95, vx: 0, vy: 0, type: 'icelance', life: 30, age: 0, charging: false, hostile: false };
    ctx.projectiles.push(lance);
    projectiles.update(ctx);
    expect(intercepts).toBe(1);
    expect(ctx.projectiles.includes(lance)).toBe(!consumed);
    expect(calls.damage).toHaveLength(consumed ? 0 : 1);
    expect(made[1].player.status.frozen ?? 0).toBe(consumed ? 0 : 150);
    projectiles.update(ctx);
    expect(calls.damage).toHaveLength(consumed ? 0 : 1); // a piercing lance cannot hit the same victim twice
  });

  test('the duel tempo is NOT applied by hit(): the victim controller applies it to everything it takes, blows and fire alike', async () => {
    const { arena, ctx, calls } = setup();
    await arena.addRival('brann-rook', 300, 100);
    ARENA_RULES.blowScale = 0.4;
    arena.hit(ctx.enemies[0], 10, 0, 0, 'direct');
    expect(calls.damage[0].amount).toBeCloseTo(10, 5);
  });

  test.each([0, 0.5, 1])('health equality %s offsets the victim health multiplier in incoming damage', async (equality) => {
    const { arena, ctx, calls, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    (made[1].fighters.body as { maxHp: number }).maxHp = 2;
    made[1].player.maxHp = made[1].player.hp = 200;
    ARENA_RULES.healthEquality = equality;
    arena.hit(ctx.enemies[0], 10, 0, 0, 'direct');
    expect(calls.damage[0].amount).toBeCloseTo(10 * 2 ** equality, 5);
    if (equality === 1) expect((200 - made[1].player.hp) / 200).toBeCloseTo(10 / 100, 5);
  });

  test('is dormant with no rival: not active, slot 0 bound, nothing in the enemies', () => {
    const { arena, ctx } = setup();
    expect(arena.active).toBe(false);
    expect(arena.bound).toBe(0);
    expect(ctx.enemies.length).toBe(0);
    expect(arena.ownerForNew).toBeUndefined();
  });

  test('adding a rival makes it active, puts exactly one stand-in in the enemies and tags the scoped bus', async () => {
    const { arena, ctx } = setup();
    const slot = await arena.addRival('brann-rook', 300, 100);
    expect(slot).toBe(1);
    expect(arena.active).toBe(true);
    expect(ctx.enemies.length).toBe(1);
    expect(ctx.enemies[0].kind).toBe('fighter');
    expect(ctx.events.scoped).toBe(true);
    expect(arena.fighterId(1)).toBe('brann-rook');
  });

  test('the stand-in mirrors the OTHER fighter, and flips with the binding', async () => {
    const { arena, ctx, made, base } = await (async () => { const s = setup(); await s.arena.addRival('brann-rook', 300, 100); return s; })();
    const stand = ctx.enemies[0];
    expect(stand.fighter).toBe(1);
    expect(stand.x).toBe(300);
    arena.with(1, () => {
      expect(ctx.player).toBe(made[1].player);
      expect(stand.fighter).toBe(0);
      expect(stand.x).toBe(100);
      expect(arena.bound).toBe(1);
      expect(arena.ownerForNew).toBe(1);
    });
    expect(ctx.player).toBe(base.player);
    expect(stand.fighter).toBe(1);
    expect(arena.bound).toBe(0);
  });

  test('a blow to the stand-in lands once on the real fighter, under ITS binding, with the attacker\'s power', async () => {
    const { arena, ctx, calls, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const stand = ctx.enemies[0];
    ctx.enemyCtl = undefined as never;
    arena.hit(stand, 10, 2, -1, 'direct'); // slot 0 hits the rival
    expect(calls.damage.length).toBe(1);
    expect(calls.damage[0].boundPlayer).toBe(made[1].player); // the victim's own controller ran with the victim bound
    expect(calls.damage[0].amount).toBe(10); // slot 0's body.dealt is 1
    expect(calls.damage[0].src).toBe('fighter');
    expect(arena.bound).toBe(0);
    arena.with(1, () => { arena.hit(ctx.enemies[0], 10, 2, -1, 'direct'); }); // the rival hits slot 0 with dealt 1.5
    expect(calls.damage.length).toBe(2);
    expect(calls.damage[1].amount).toBe(15);
  });

  test('a blow to the bound slot\'s own stand-in is dropped (a fighter never hurts itself through its mirror)', async () => {
    const { arena, ctx, calls } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const stand = ctx.enemies[0];
    stand.fighter = 0; // as if it mirrored slot 0 while slot 0 is bound
    arena.hit(stand, 10, 0, 0, 'direct');
    expect(calls.damage.length).toBe(0);
  });

  test('a dead victim takes nothing, and a won bout takes nothing more', async () => {
    const { arena, ctx, calls, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const stand = ctx.enemies[0];
    made[1].player.dead = true;
    arena.hit(stand, 10, 0, 0, 'direct');
    expect(calls.damage.length).toBe(0);
    made[1].player.dead = false;
    arena.noteDown(1, 'test');
    expect(arena.bout.state).toBe('won');
    arena.hit(stand, 10, 0, 0, 'direct');
    expect(calls.damage.length).toBe(0);
  });

  test('a shove goes through the victim\'s own impulse path, with a touch of lift', async () => {
    const { arena, ctx, calls, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    arena.shove(ctx.enemies[0], 1, 0, 2);
    expect(calls.impulse.length).toBe(1);
    expect(calls.impulse[0].boundPlayer).toBe(made[1].player);
    expect(calls.impulse[0].vx).toBeCloseTo(2.2, 5);
    expect(calls.impulse[0].vy).toBeLessThan(0);
  });

  test('a velocity an attacker wrote on the stand-in is carried to the real body once, when the binding changes', async () => {
    const { arena, ctx, calls, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const stand = ctx.enemies[0];
    stand.vx += 3; // a kit "launches" the foe
    arena.with(1, () => undefined); // any binding change bridges the stand-in back
    expect(calls.impulse.length).toBe(1);
    expect(calls.impulse[0].boundPlayer).toBe(made[1].player);
    expect(calls.impulse[0].vx).toBe(3);
    arena.with(1, () => undefined);
    expect(calls.impulse.length).toBe(1); // exactly once
  });

  test('a launch started with the knock state (knockVx, knockT) is carried over once and cleared', async () => {
    const { arena, ctx, calls } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const stand = ctx.enemies[0];
    stand.knockVx = 2; stand.knockVy = -1; stand.knockT = 6;
    arena.with(1, () => undefined);
    expect(calls.impulse.length).toBe(1);
    expect(calls.impulse[0].vx).toBe(2);
    expect(calls.impulse[0].vy).toBe(-1);
    expect(stand.knockT).toBe(0);
  });

  test('a projectile\'s pass binds its owner, and releaseOwner returns to slot 0', async () => {
    const { arena, ctx, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    arena.bindOwner(1);
    expect(arena.bound).toBe(1);
    expect(ctx.player).toBe(made[1].player);
    arena.bindOwner(undefined);
    expect(arena.bound).toBe(0);
    arena.bindOwner(1);
    arena.releaseOwner();
    expect(arena.bound).toBe(0);
  });

  test('rival phases run the rival\'s own systems under its binding, and stamp the shots it made', async () => {
    const { arena, ctx, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const seen: unknown[] = [];
    made[1].playerCtl.update = () => { seen.push(ctx.player); ctx.projectiles.push({ x: 0, y: 0, vx: 0, vy: 0, type: 'bolt', life: 5, age: 0, charging: false, hostile: false }); };
    made[1].fighters.update = () => { seen.push(ctx.fighters); };
    arena.runRivals('body');
    expect(seen).toEqual([made[1].player, made[1].fighters]);
    expect(ctx.projectiles[0].owner).toBe(1);
    expect(arena.bound).toBe(0);
  });

  test('a driver runs under the rival\'s binding, before its body', async () => {
    const { arena, ctx, made } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const order: string[] = [];
    arena.setDriver(1, () => { order.push(ctx.player === made[1].player ? 'drive' : 'WRONG'); });
    made[1].playerCtl.update = () => { order.push('body'); };
    arena.runRivals('body');
    expect(order).toEqual(['drive', 'body']);
  });

  test('a slowed or stunned rival is gated: runs false skips its body', async () => {
    const { arena, ctx, made, base } = setup();
    await arena.addRival('brann-rook', 300, 100);
    let ran = 0;
    made[1].playerCtl.update = () => { ran++; };
    // slot 0's effects on the stand-in slow the rival: the gate is decided at the end of the tick
    (base.fighters as unknown as { id: string; enemyRuns: () => boolean }).id = 'ilyra-voss';
    (base.fighters as unknown as { enemyRuns: () => boolean }).enemyRuns = () => false;
    arena.endTick();
    arena.runRivals('body');
    expect(ran).toBe(0);
    expect(arena.runsBody(1)).toBe(false);
    expect(arena.runsBody(0)).toBe(true);
    void ctx;
  });

  test('a knockout is recorded once, names the last blow\'s owner as the winner, and emits fighterDown', async () => {
    const { arena, ctx, calls } = setup();
    await arena.addRival('brann-rook', 300, 100);
    const heard: unknown[] = [];
    ctx.events.on('fighterDown', (e) => heard.push(e));
    arena.hit(ctx.enemies[0], 5, 0, 0, 'direct'); // slot 0 landed a blow on slot 1
    arena.noteDown(1, 'fighter');
    arena.noteDown(0, 'late'); // a second down in the same bout changes nothing
    expect(calls.damage.length).toBe(1);
    expect(arena.bout.state).toBe('won');
    expect(arena.bout.winner).toBe(0);
    expect(arena.bout.downs.length).toBe(1);
    expect(heard.length).toBe(1);
  });

  test('removing the rival restores the single-fighter state: no stand-in, scoping off, slot 0 on the ctx, the rival\'s shots gone', async () => {
    const { arena, ctx, base } = setup();
    await arena.addRival('brann-rook', 300, 100);
    ctx.projectiles.push({ x: 0, y: 0, vx: 0, vy: 0, type: 'bolt', life: 5, age: 0, charging: false, hostile: false, owner: 1 });
    ctx.projectiles.push({ x: 0, y: 0, vx: 0, vy: 0, type: 'bolt', life: 5, age: 0, charging: false, hostile: false });
    arena.removeRival(1);
    expect(arena.active).toBe(false);
    expect(ctx.enemies.length).toBe(0);
    expect(ctx.events.scoped).toBe(false);
    expect(ctx.player).toBe(base.player);
    expect(ctx.projectiles.length).toBe(1);
    expect(ctx.camera.inspectionFocus).toBeNull();
  });

  test('a new floor removes the rival (it stays behind with the old world)', async () => {
    const { arena, ctx } = setup();
    await arena.addRival('brann-rook', 300, 100);
    ctx.events.emit('levelChanged', { depth: 0, name: 'x' });
    expect(arena.active).toBe(false);
    expect(ctx.enemies.length).toBe(0);
  });

  test('the camera is told the midpoint of the fighters; the sim window grows to hold a rival', async () => {
    const { arena, ctx } = setup();
    await arena.addRival('brann-rook', 500, 100);
    arena.endTick();
    expect(ctx.camera.inspectionFocus).toEqual({ x: 300, y: 91 });
    const bounds = { x0: 0, y0: 0, x1: 10, y1: 10 };
    arena.extendSimBounds(bounds);
    expect(bounds.x1).toBeGreaterThan(500);
  });
});
