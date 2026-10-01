import { playerBlow } from '@/core/bossWard';
import type { ArenaApi, Bout, BundleFactory, RivalPhase, SlotBundle } from '@/core/arena';
import type { FighterId } from '@/content/fighters';
import type { Ctx, Enemy, EnemyDamageSource, EntityStatus, Projectile } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';

/**
 * ARENA SLOTS (docs/arena/ARCHITECTURE.md, D-001): two fighters in one world.
 *
 * A slot is one fighter's bundle (player, input, controller, wands, flask, fighter system, chill). Whichever slot is BOUND has its
 * bundle installed on the base `Ctx`, so every shared system reads the acting fighter as it reads the lone Alchemist. The other
 * fighter appears to the bound slot as one `Enemy` (the STAND-IN, kind 'fighter'): its position, velocity, health, grounding and
 * status are copied from the real body each time the binding changes, and what an attacker does to it (a blow, a shove, a velocity
 * written, a stun, a slow) is carried back to the real body. A blow aimed at the stand-in is handed to `Enemies.damage`'s redirect
 * (`hit`), which runs the victim's own `playerCtl.damage` under the victim's binding.
 *
 * Deviation from the design (recorded in ARCHITECTURE.md 10): ONE stand-in object serves both directions (it is rewritten to mirror
 * "the opponent of the bound slot" at each binding change) instead of one per slot toggled in and out of `ctx.enemies`. With two
 * fighters that is equivalent, and it never mutates `ctx.enemies` while a system is iterating it. More than two fighters need one
 * stand-in per slot and the toggling the design describes.
 *
 * The exactly-once rule holds because the bound slot never sees itself: the stand-in always mirrors the OTHER fighter, and a blow to a
 * stand-in whose slot is the bound slot is dropped.
 */

interface Slot {
  bundle: SlotBundle;
  /** A scripted drive or a brain: called once a tick under this slot's binding, before its body phase. */
  driver: (() => void) | null;
  /** Gate: may this slot run its body this tick (a foe's slow is TIME, so a slowed fighter runs a fraction of its ticks). */
  runs: boolean;
}

const OPPONENT_WINDOW = 90; // a fall or a hazard within this many ticks of a blow still counts as the blow's doing

function newStand(): Enemy {
  return {
    kind: 'fighter',
    fighter: 1,
    x: 0, y: 0, fx: 0, fy: 0, vx: 0, vy: 0,
    hp: 100, maxHp: 100, dmgK: 1, flash: 0,
    timer: 0, attackCd: 0, bobPhase: 0,
    grounded: false, stride: 0, splat: 0, prevG: false, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: undefined as unknown as EntityStatus,
  };
}

export class ArenaSlots implements ArenaApi {
  private readonly slots: Array<Slot | undefined> = [];
  private boundSlot = 0;
  private readonly stand: Enemy = newStand();
  private inEnemies = false;
  /** Which slot the stand-in mirrors right now, and the values it was last given (to see what an attacker changed). */
  private standFor = 1;
  private readonly sent = { x: 0, y: 0, vx: 0, vy: 0 };
  private spawns: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  private readonly lastBlow: Array<{ by: number; at: number }> = [{ by: -1, at: -1e9 }, { by: -1, at: -1e9 }];
  private readonly focus = { x: 0, y: 0 };
  private ownerBound = false;
  readonly bout: Bout = { state: 'idle', winner: null, startedAt: -1, endedAt: -1, downs: [] };

  constructor(private readonly ctx: Ctx, private readonly factory: BundleFactory) {
    // A new floor is a new world: the rival stays behind with the old one.
    ctx.events.on('levelChanged', () => { if (this.active) this.removeRival(1); });
  }

  // ================================================================================== the slots

  get active(): boolean { return this.slots.length > 1; }
  get bound(): number { return this.boundSlot; }
  get slotCount(): number { return this.slots.length; }

  bundle(slot: number): SlotBundle | undefined { return this.slots[slot]?.bundle; }

  fighterId(slot: number): FighterId | null { return this.slots[slot]?.bundle.fighters.id ?? null; }

  private ensureBase(): void {
    if (this.slots[0]) return;
    const c = this.ctx;
    this.slots[0] = {
      bundle: { player: c.player, input: c.input, playerCtl: c.playerCtl, wands: c.wands, flask: c.flask, fighters: c.fighters!, chill: c.chill },
      driver: null,
      runs: true,
    };
  }

  async addRival(id: FighterId, x: number, y: number): Promise<number> {
    this.ensureBase();
    if (this.slots.length > 1) this.removeRival(1);
    const slot = this.slots.length;
    const bundle = this.factory(slot);
    this.slots[slot] = { bundle, driver: null, runs: true };
    const f = bundle.fighters;
    // The kit's chunk lands later: its creation (and every subscription it makes) must happen under this slot's binding.
    f.bindScope = (fn) => { this.with(slot, fn); };
    this.ctx.events.scoped = true;
    this.with(slot, () => { f.equip(id); });
    await f.whenReady();
    this.spawns[slot] = { x, y };
    this.with(slot, () => { this.respawnBody(bundle, x, y); });
    this.attachStand();
    this.bout.state = 'fighting';
    this.bout.winner = null;
    this.bout.startedAt = this.ctx.state.frameCount;
    this.bout.endedAt = -1;
    this.bout.downs.length = 0;
    this.syncStand();
    return slot;
  }

  removeRival(slot: number): void {
    const rec = this.slots[slot];
    if (!rec || slot === 0) return;
    this.with(0, () => undefined);
    this.detachStand();
    const b = rec.bundle;
    b.fighters.bindScope = null;
    b.fighters.dispose();
    (b.wands as { dispose?: () => void }).dispose?.();
    (b.chill as { dispose?: () => void } | undefined)?.dispose?.();
    this.slots.length = slot;
    // Anything the rival cast goes with it.
    const ps = this.ctx.projectiles;
    for (let i = ps.length - 1; i >= 0; i--) if ((ps[i].owner ?? 0) === slot) ps.splice(i, 1);
    if (this.slots.length <= 1) {
      this.ctx.events.scoped = false;
      this.ctx.events.boundSlot = 0;
      this.ctx.camera.inspectionFocus = null;
      this.bout.state = 'idle';
      this.bout.winner = null;
    }
    this.ctx.projectileCtl?.invalidateEnemyIndex?.();
  }

  setDriver(slot: number, drive: (() => void) | null): void {
    const rec = this.slots[slot];
    if (rec) rec.driver = drive;
  }

  setSpawns(spawns: ReadonlyArray<{ x: number; y: number }>): void {
    this.spawns = spawns.map((s) => ({ x: s.x, y: s.y }));
  }

  // ================================================================================== binding

  with<T>(slot: number, fn: () => T): T {
    this.ensureBase();
    if (slot === this.boundSlot || !this.slots[slot]) return fn();
    const prev = this.boundSlot;
    this.install(slot);
    try { return fn(); } finally { this.install(prev); }
  }

  private rawInstall(b: SlotBundle): void {
    const c = this.ctx;
    c.player = b.player;
    c.input = b.input;
    c.playerCtl = b.playerCtl;
    c.wands = b.wands;
    c.flask = b.flask;
    c.fighters = b.fighters;
    c.chill = b.chill;
  }

  private install(slot: number): void {
    const rec = this.slots[slot];
    if (!rec) return;
    if (this.active) this.bridgeBack();
    this.rawInstall(rec.bundle);
    this.boundSlot = slot;
    this.ctx.events.boundSlot = slot;
    if (this.active) {
      this.syncStand();
      this.ctx.projectileCtl?.invalidateEnemyIndex?.();
    }
  }

  bindOwner(owner: number | undefined): void {
    if (!this.active) return;
    const o = owner !== undefined && this.slots[owner] ? owner : 0;
    if (o === this.boundSlot) return;
    this.install(o);
    this.ownerBound = o !== 0;
  }

  releaseOwner(): void {
    if (!this.ownerBound) return;
    this.ownerBound = false;
    if (this.boundSlot !== 0) this.install(0);
  }

  get ownerForNew(): number | undefined {
    return this.active && this.boundSlot !== 0 ? this.boundSlot : undefined;
  }

  // ================================================================================== the stand-in

  isStandIn(e: Enemy): boolean { return e.fighter !== undefined; }

  private attachStand(): void {
    if (this.inEnemies) return;
    this.ctx.enemies.push(this.stand);
    this.inEnemies = true;
  }

  private detachStand(): void {
    if (!this.inEnemies) return;
    const es = this.ctx.enemies;
    const at = es.indexOf(this.stand);
    if (at >= 0) es.splice(at, 1);
    this.inEnemies = false;
  }

  /** Make the stand-in mirror the opponent of the bound slot. */
  private syncStand(): void {
    if (!this.active) return;
    const opp = this.boundSlot === 0 ? 1 : 0;
    const v = this.slots[opp]?.bundle.player;
    if (!v) return;
    const s = this.stand;
    s.fighter = opp;
    s.x = v.x; s.y = v.y; s.vx = v.vx; s.vy = v.vy;
    s.fx = 0; s.fy = 0;
    s.hp = v.hp > 0.5 ? v.hp : 0.5;
    s.maxHp = v.maxHp;
    s.grounded = v.grounded;
    s.status = v.status as EntityStatus;
    s.knockT = 0; s.knockVx = 0; s.knockVy = 0;
    s.flash = v.invuln > 0 ? 3 : 0;
    s.alerted = true;
    s.sleeping = false;
    this.sent.x = v.x; this.sent.y = v.y; this.sent.vx = v.vx; this.sent.vy = v.vy;
    this.standFor = opp;
  }

  /**
   * What an attacker did to the stand-in since it was last copied (a velocity written, a launch started, a pull) goes to the real
   * body, once, through its own impulse path (weight, stoneskin, stagger resistance all apply).
   */
  private bridgeBack(): void {
    const v = this.slots[this.standFor];
    if (!v) return;
    const s = this.stand;
    const sent = this.sent;
    let dvx = s.vx - sent.vx, dvy = s.vy - sent.vy;
    if ((s.knockT ?? 0) > 0) {
      dvx += s.knockVx ?? 0;
      dvy += s.knockVy ?? 0;
      s.knockVx = 0; s.knockVy = 0; s.knockT = 0;
    }
    const moved = Math.abs(s.x - sent.x) > 0.5 || Math.abs(s.y - sent.y) > 0.5;
    if (dvx === 0 && dvy === 0 && !moved) return;
    sent.vx = s.vx; sent.vy = s.vy;
    const here = this.slots[this.boundSlot]!.bundle;
    this.rawInstall(v.bundle);
    try {
      if (moved) {
        // A pull or a teleport written onto the stand-in: move the body there if it fits.
        const p = v.bundle.player;
        if (this.ctx.physics.entityFree(Math.round(s.x), Math.round(s.y), PLAYER_HALF_W, PLAYER_H)) { p.x = s.x; p.y = s.y; }
        sent.x = s.x; sent.y = s.y;
      }
      if (dvx !== 0 || dvy !== 0) v.bundle.playerCtl.applyImpulse(dvx, dvy);
    } finally {
      this.rawInstall(here);
    }
  }

  // ================================================================================== blows

  hit(stand: Enemy, amount: number, kx: number, ky: number, source: EnemyDamageSource): void {
    const victim = stand.fighter;
    if (victim === undefined || victim === this.boundSlot) return;
    const rec = this.slots[victim];
    if (!rec || rec.bundle.player.dead || this.bout.state === 'won') return;
    const attacker = this.boundSlot;
    const dealt = playerBlow(source) ? this.slots[attacker]?.bundle.fighters.body.dealt ?? 1 : 1;
    const dmg = amount * dealt;
    if (dmg > 0) this.lastBlow[victim] = { by: attacker, at: this.ctx.state.frameCount };
    const tag = source === 'direct' ? 'fighter' : String(source);
    this.with(victim, () => { rec.bundle.playerCtl.damage(dmg, kx, ky, tag); });
  }

  shove(stand: Enemy, dirX: number, dirY: number, strength: number): void {
    const victim = stand.fighter;
    if (victim === undefined || victim === this.boundSlot || strength <= 0) return;
    const rec = this.slots[victim];
    if (!rec || rec.bundle.player.dead || this.bout.state === 'won') return;
    const push = strength * 1.1;
    this.with(victim, () => { rec.bundle.playerCtl.applyImpulse(dirX * push, dirY * push - push * 0.18); });
  }

  intercept(stand: Enemy, p: Projectile): boolean {
    const victim = stand.fighter;
    if (victim === undefined || victim === this.boundSlot) return false;
    const rec = this.slots[victim];
    if (!rec || rec.bundle.player.dead) return false;
    const f = rec.bundle.fighters;
    if (f.id === null) return false;
    return this.with(victim, () => f.interceptProjectile(p));
  }

  /** Called by the controller's arena branch when a fighter is knocked out. */
  noteDown(slot: number, source: string): void {
    const p = this.slots[slot]?.bundle.player;
    if (!p || this.bout.state === 'won') return;
    const blow = this.lastBlow[slot];
    const by = this.ctx.state.frameCount - blow.at <= OPPONENT_WINDOW && blow.by >= 0 ? blow.by : slot;
    const ev = { slot, by, source, x: p.x, y: p.y };
    this.bout.downs.push(ev);
    this.bout.state = 'won';
    this.bout.winner = by === slot ? (slot === 0 ? 1 : 0) : by;
    this.bout.endedAt = this.ctx.state.frameCount;
    this.ctx.events.emit('fighterDown', ev);
  }

  // ================================================================================== the tick

  runRivals(phase: RivalPhase): void {
    if (!this.active) return;
    const ctx = this.ctx;
    for (let s = 1; s < this.slots.length; s++) {
      const rec = this.slots[s];
      if (!rec) continue;
      this.with(s, () => {
        const b = rec.bundle;
        if (phase === 'body') {
          const n0 = ctx.projectiles.length;
          rec.driver?.();
          if (!b.player.dead && rec.runs) {
            b.playerCtl.update(ctx);
            b.chill?.update(ctx);
            b.fighters.update(ctx);
          }
          this.stampOwners(n0, s);
        } else if (phase === 'flask') {
          const n0 = ctx.projectiles.length;
          b.flask.update(ctx);
          this.stampOwners(n0, s);
        } else {
          const n0 = ctx.projectiles.length;
          b.wands.update(ctx);
          this.stampOwners(n0, s);
        }
      });
    }
  }

  /** May slot 0 run its body this tick (a rival's slow is time)? */
  runsBody(slot: number): boolean {
    return this.slots[slot]?.runs ?? true;
  }

  private stampOwners(from: number, slot: number): void {
    const ps = this.ctx.projectiles;
    for (let i = from; i < ps.length; i++) if (ps[i].owner === undefined) ps[i].owner = slot;
  }

  endTick(): void {
    if (!this.active) return;
    if (this.boundSlot !== 0) this.install(0);
    this.bridgeBack();
    const ctx = this.ctx;
    // Each fighter's slow and stun, set by the other's effects on its stand-in, apply to the NEXT tick.
    for (let victim = 0; victim < this.slots.length; victim++) {
      const rec = this.slots[victim];
      if (!rec) continue;
      const attacker = this.slots[victim === 0 ? 1 : 0];
      if (!attacker) continue;
      // The attacker's effects are keyed by the one stand-in object, which mirrors the victim only while the attacker is bound.
      const af = attacker.bundle.fighters;
      rec.runs = af.id === null ? true : af.enemyRuns(this.stand);
      const stunned = af.id !== null && af.isStunned(this.stand);
      if (stunned) rec.bundle.player.stunT = Math.max(rec.bundle.player.stunT ?? 0, 2);
    }
    this.syncStand();
    // The camera holds both fighters.
    const a = this.slots[0]!.bundle.player;
    const rivals = this.slots.slice(1).filter((r): r is Slot => r !== undefined).map((r) => r.bundle.player);
    let sx = a.x, sy = a.y - 9, n = 1;
    for (const r of rivals) { sx += r.x; sy += r.y - 9; n++; }
    this.focus.x = sx / n;
    this.focus.y = sy / n;
    ctx.camera.inspectionFocus = this.focus;
    void VIEW_W; void VIEW_H;
  }

  extendSimBounds(bounds: { x0: number; y0: number; x1: number; y1: number }): void {
    const world = this.ctx.world;
    for (let s = 1; s < this.slots.length; s++) {
      const p = this.slots[s]?.bundle.player;
      if (!p) continue;
      bounds.x0 = Math.min(bounds.x0, Math.max(0, Math.floor(p.x - VIEW_W / 2 - 80)));
      bounds.x1 = Math.max(bounds.x1, Math.min(world.width, Math.ceil(p.x + VIEW_W / 2 + 80)));
      bounds.y0 = Math.min(bounds.y0, Math.max(0, Math.floor(p.y - VIEW_H / 2 - 80)));
      bounds.y1 = Math.max(bounds.y1, Math.min(world.height, Math.ceil(p.y + VIEW_H / 2 + 80)));
    }
  }

  // ================================================================================== a new bout

  /** Stand the body at (x, y), whole, still and ready (a bout's start; under the slot's binding). */
  private respawnBody(b: SlotBundle, x: number, y: number): void {
    const p = b.player;
    p.dead = false;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
    p.crawling = false; p.climbing = false; p.grounded = false;
    p.stunT = 0;
    p.invuln = 60;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    p.levit = p.maxLevit;
    p.firing = false;
    for (const k of Object.keys(p.status) as Array<keyof typeof p.status>) {
      const cur = p.status[k];
      if (typeof cur === 'number') (p.status as unknown as Record<string, number>)[k as string] = 0;
    }
    for (const key of Object.keys(b.input.keys) as Array<keyof typeof b.input.keys>) b.input.keys[key] = false;
    b.playerCtl.resetTransientState(this.ctx);
    b.fighters.reset();
    b.fighters.refill();
    b.chill?.reset();
  }

  reset(): void {
    if (!this.active) return;
    this.install(0);
    this.ctx.projectiles.length = 0;
    for (let s = 0; s < this.slots.length; s++) {
      const rec = this.slots[s];
      if (!rec) continue;
      const at = this.spawns[s] ?? this.spawns[0];
      this.with(s, () => {
        this.respawnBody(rec.bundle, at.x, at.y);
        rec.runs = true;
        rec.bundle.wands.clearTransientState?.();
        for (const w of rec.bundle.wands.wands) { w.mana = w.frame.manaMax; w.cooldown = 0; w.castIndex = 0; }
      });
    }
    this.lastBlow[0] = { by: -1, at: -1e9 };
    this.lastBlow[1] = { by: -1, at: -1e9 };
    this.bout.state = 'fighting';
    this.bout.winner = null;
    this.bout.startedAt = this.ctx.state.frameCount;
    this.bout.endedAt = -1;
    this.bout.downs.length = 0;
    this.syncStand();
    this.ctx.projectileCtl?.invalidateEnemyIndex?.();
  }
}
