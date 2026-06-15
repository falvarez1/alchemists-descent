import type {
  CardId,
  Ctx,
  Projectile,
  WandFrame,
  WandLoadoutSave,
  WandRuntimeSnapshot,
  WandsApi,
  WandState,
} from '@/core/types';
import { Cell, isGas, isLiquid } from '@/sim/CellType';
import { acidColor, emberColor, fireColor, glassColor, packRGB, smokeColor, stoneColor } from '@/sim/colors';
import { ALL_CARD_IDS, CARD_DEFS } from './cards';
import { compileWand, type CastAction, type CastGroup } from './compiler';
import { BOUNCE_COUNTS, INFUSED, TRIGGERED } from './projectileMarks';

/**
 * Wand frames available at launch. Only 'oak' and 'bone' exist as actual
 * wands today; 'brass' and 'void' are listed for the bench's future upgrade
 * path (granted later, out of scope for Wave D v1).
 */
export const WAND_FRAMES: Record<string, WandFrame> = {
  oak: { id: 'oak', name: 'Oak Sprig', capacity: 3, castDelay: 14, recharge: 30, manaMax: 90, manaRegen: 0.5, spread: 0.02 },
  bone: { id: 'bone', name: 'Bone Crook', capacity: 4, castDelay: 9, recharge: 45, manaMax: 120, manaRegen: 0.65, spread: 0.05 },
  brass: { id: 'brass', name: 'Brass Injector', capacity: 5, castDelay: 6, recharge: 60, manaMax: 160, manaRegen: 0.8, spread: 0.08 },
  void: { id: 'void', name: 'Void Lattice', capacity: 5, castDelay: 16, recharge: 20, manaMax: 220, manaRegen: 1.1, spread: 0 },
};

/** Cards a lit waystone can gift (weighted toward build-shaping mods). */
const MOD_POOL: CardId[] = ['speed', 'heavy', 'spread', 'bounce', 'trigger', 'infuser', 'double', 'triple'];
/** Cards a first visit to a new depth can gift. */
const PROJ_POOL: CardId[] = [
  'spark',
  'bomb',
  'lightning',
  'flame',
  'dig',
  'warp',
  'blackhole',
  'vitriol',
  'frostshard',
  'icelance',
  'wisp',
  'meteor',
  'conjure',
  'emberstorm',
];
/** waystoneLit grant: chance the gift is a modifier/multicast rather than a projectile. */
const WAYSTONE_MOD_BIAS = 0.75;

/** Extra aim jitter for the stacked bolts of a dmgMul > 1 spark cast. */
const STACK_JITTER = 0.06;
/** Flame card: frames of stream burst per cast / hard cap while spamming. */
const FLAME_BURST_FRAMES = 4;
const FLAME_BURST_CAP = 16;

export interface BuiltInWandLoadout {
  id: string;
  name: string;
  frameId: string;
  cards: CardId[];
  status: 'live' | 'review';
}

export const STARTING_WAND_LOADOUTS: BuiltInWandLoadout[] = [
  { id: 'starter-oak', name: 'Starter Oak Sprig', frameId: 'oak', cards: ['spark'], status: 'live' },
  { id: 'starter-bone', name: 'Starter Bone Crook', frameId: 'bone', cards: ['dig'], status: 'live' },
];

export const REVIEW_WAND_LOADOUTS: BuiltInWandLoadout[] = [
  { id: 'review-brass-injector', name: 'Review Brass Injector', frameId: 'brass', cards: ['spark', 'double', 'speed', 'flame', 'lightning'], status: 'review' },
  { id: 'review-void-lattice', name: 'Review Void Lattice', frameId: 'void', cards: ['dig', 'conjure', 'vitriol', 'blackhole', 'warp'], status: 'review' },
];

const REVIEW_WAND_CARDS: [CardId[], CardId[]] = [
  REVIEW_WAND_LOADOUTS[0].cards,
  REVIEW_WAND_LOADOUTS[1].cards,
];

const STARTING_COLLECTION: CardId[] = ['double', 'flame', 'icelance', 'emberstorm', 'blackhole', 'warp'];

/**
 * The wand engine (DESIGN.md pillar 6): frames + slotted spell cards + the
 * deterministic cast compiler replace the fixed 7-spell loadout in PLAY mode
 * (build-mode sandbox spells are untouched). Execution reuses the existing
 * combat primitives — projectiles, lightning, dig ray, particles — through Ctx.
 *
 * HUD note: the active wand's mana is mirrored into ctx.player.mana/maxMana
 * every update() (after PlayerControl's own regen ran), so the existing HUD
 * mana bar and hotbar affordability shading keep working without HUD surgery.
 *
 * "heavy = more bolts" v1: the frozen Projectile contract carries no damage
 * multiplier and bolt impact damage/radius are read from params at impact, so
 * dmgMul > 1 on a spark cast spawns round(dmgMul) stacked bolts at tiny
 * spread instead — the extra firepower reads honestly on screen. On lightning
 * dmgMul casts the arc floor(dmgMul) times (max 2); on dig it widens the
 * erosion radius x1.7. On bomb/warp/blackhole dmgMul is inert in v1.
 */
export class WandSystem implements WandsApi {
  readonly wands: [WandState, WandState] = [
    { frame: WAND_FRAMES.oak, cards: ['spark', null, null], mana: WAND_FRAMES.oak.manaMax, cooldown: 0, castIndex: 0 },
    { frame: WAND_FRAMES.bone, cards: ['dig', null, null, null], mana: WAND_FRAMES.bone.manaMax, cooldown: 0, castIndex: 0 },
  ];

  // Starting kit: utility/multicast basics plus the four signature payloads
  // the (15) build shipped in its active inventory — Ice Lance, Ember Storm,
  // Black Hole, and Warp Bolt are equippable from the first bench visit.
  readonly collection: CardId[] = [...STARTING_COLLECTION];

  /** Compiled programs, rebuilt lazily when a wand's slots change. */
  private readonly compiled: [CastGroup[] | null, CastGroup[] | null] = [null, null];
  /** Last dry-fire feedback frame (throttles the click while held). */
  private lastDryFire = -99;
  private _active: 0 | 1 = 0;
  /** Frames of flame-card stream left to spray from the wand tip. */
  private flameBurst = 0;
  /** Depths whose first-visit projectile card was already granted. */
  private readonly depthsGranted = new Set<number>();
  private infuserGranted = false;

  constructor(private readonly ctx: Ctx) {
    // Card economy v1: the world hands out cards through existing events.
    ctx.events.on('waystoneLit', () => {
      const pool = Math.random() < WAYSTONE_MOD_BIAS ? MOD_POOL : PROJ_POOL;
      this.grantCard(this.ctx, pool[Math.floor(Math.random() * pool.length)]);
    });
    ctx.events.on('levelChanged', ({ depth }) => {
      if (depth < 2 || this.depthsGranted.has(depth)) return;
      this.depthsGranted.add(depth);
      this.grantCard(this.ctx, PROJ_POOL[Math.floor(Math.random() * PROJ_POOL.length)]);
    });
    // The first brewed recipe proves you speak material — the Infuser answers.
    ctx.events.on('recipeDiscovered', () => {
      if (this.infuserGranted) return;
      this.infuserGranted = true;
      this.grantCard(this.ctx, 'infuser');
    });
    // Respawn refills the player pool (Levels does); keep the wands in step
    // so death isn't compounded by dry-firing at the waystone.
    ctx.events.on('playerRespawned', () => {
      for (const w of this.wands) {
        w.mana = w.frame.manaMax;
        w.cooldown = 0;
        w.castIndex = 0;
      }
    });
  }

  get active(): 0 | 1 {
    return this._active;
  }

  set active(v: 0 | 1) {
    if (v === this._active) return;
    this._active = v;
    if (this.ctx.state.mode === 'play') {
      this.ctx.audio.wandSwap();
      // The character sells the swap too: holster-to-aim draw arc.
      this.ctx.player.swapT = 12;
    }
    this.ctx.events.emit('wandChanged');
  }

  /* ---------------- the cast cycle ---------------- */

  fire(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.player.dead) return;
    // Heart communion roots the wand arm; so does hauling on a lever.
    if (ctx.player.recharge > 0 || ctx.player.pullT > 0 || ctx.player.climbing) return;
    const wand = this.wands[this._active];
    if (wand.cooldown > 0) return;
    const program = this.program(this._active);
    if (program.length === 0) return;

    if (wand.castIndex >= program.length) wand.castIndex = 0;
    const group = program[wand.castIndex];
    if (wand.mana < group.manaCost) {
      // DRY FIRE: tell the player WHY nothing happened — hollow click,
      // mana bar flash (HUD listens), a sad fizzle at the wand tip.
      if (ctx.state.frameCount - this.lastDryFire > 14) {
        this.lastDryFire = ctx.state.frameCount;
        ctx.audio.dryFire();
        ctx.events.emit('dryFire');
        const tip = ctx.spells.wandTip();
        ctx.particles.burst(tip.x, tip.y, 3, null, () => packRGB(120, 150, 180), 0.7, {
          glow: 0.8,
          grav: 0.04,
        });
      }
      return;
    }

    wand.mana -= group.manaCost;
    wand.castIndex++;
    const wrapped = wand.castIndex >= program.length;
    if (wrapped) wand.castIndex = 0;
    // Recharge stacks onto the cast delay when the cycle wraps to the top.
    wand.cooldown = wand.frame.castDelay + (wrapped ? wand.frame.recharge : 0);
    wand.cooldownMax = wand.cooldown;
    // CAST RECOIL: the arm kicks back along the aim and the hat takes the
    // jolt through its spring — heavier groups kick harder.
    ctx.player.recoilT = group.manaCost >= 25 ? 7 : 5;
    const ra = ctx.player.aimAngle;
    ctx.player.hat.vx -= Math.cos(ra) * 1.0;
    ctx.player.hat.vy -= Math.sin(ra) * 0.7 + 0.3;

    const tip = ctx.spells.wandTip();
    for (const action of group.actions) {
      // Black hole is a cursor-target spell: it materializes at the mouse.
      const atCursor = action.card === 'blackhole';
      this.castActionAt(
        ctx,
        action,
        atCursor ? ctx.input.mouse.x : tip.x,
        atCursor ? ctx.input.mouse.y : tip.y,
        ctx.player.aimAngle,
      );
    }
  }

  /**
   * Execute one compiled action from (x, y) along `angle` (+ spread jitter).
   * fire() calls this with the wand tip + player aim; the Projectiles.ts
   * trigger-payload consumer calls it with the impact point.
   */
  castActionAt(ctx: Ctx, actionIn: CastAction, x: number, y: number, angle: number): void {
    const frame = this.wands[this._active].frame;
    // Power Surge boon: +25% on every cast's damage multiplier.
    const action: CastAction = ctx.player.perks.might
      ? { ...actionIn, dmgMul: Math.min(4, actionIn.dmgMul * 1.25) }
      : actionIn;
    const jitter = (): number => angle + (Math.random() * 2 - 1) * (frame.spread + action.spreadAdd);
    const sp = ctx.params.spells;
    ctx.telemetry.count('card.cast.' + action.card);

    if (action.card === 'spark') {
      // 'heavy = more bolts' v1 (see class doc): one bolt, plus stacked
      // extras for dmgMul > 1 at a touch more spread.
      const count = Math.max(1, Math.round(action.dmgMul));
      for (let n = 0; n < count; n++) {
        const a = jitter() + (n > 0 ? (Math.random() * 2 - 1) * STACK_JITTER : 0);
        const v = sp.bolt.velocityForce! * action.speedMul;
        const p: Projectile = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, type: 'bolt', life: 180, age: 0, charging: false, hostile: false };
        ctx.projectiles.push(p);
        this.markProjectile(ctx, p, action);
      }
      ctx.audio.zap();
    } else if (action.card === 'bomb') {
      const a = jitter();
      const v = sp.bomb.velocityForce! * action.speedMul;
      const p: Projectile = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, type: 'bomb', life: Math.floor(sp.bomb.fuseTicks!), age: 0, charging: false, hostile: false };
      ctx.projectiles.push(p);
      this.markProjectile(ctx, p, action);
      ctx.audio.noiseBurst(0.06, 700, 0.05);
    } else if (action.card === 'lightning') {
      // dmgMul scaling: cast the arc floor(dmgMul) times, max 2.
      const casts = Math.min(2, Math.max(1, Math.floor(action.dmgMul)));
      for (let n = 0; n < casts; n++) ctx.lightning.cast(x, y, jitter());
    } else if (action.card === 'flame') {
      // Stream card: each cast feeds a 4-frame burst sprayed from the live
      // wand tip in update() (triggered payloads feed the same burst — v1).
      this.flameBurst = Math.min(FLAME_BURST_CAP, this.flameBurst + FLAME_BURST_FRAMES);
      ctx.audio.flame();
    } else if (action.card === 'dig') {
      const a = jitter();
      const hit = ctx.spells.digRay(x, y, a, sp.dig.range!);
      const reach = hit ? Math.hypot(hit.x - x, hit.y - y) : sp.dig.range!;
      ctx.fx.digBeam = { x0: x, y0: y, x1: x + Math.cos(a) * reach, y1: y + Math.sin(a) * reach, life: 3 };
      ctx.audio.dig();
      if (hit) {
        ctx.spells.erodeAt(hit.x, hit.y, action.dmgMul > 1 ? Math.round(4 * 1.7) : 4);
        if (ctx.state.frameCount % 3 === 0) ctx.particles.burst(hit.x, hit.y, 2, Cell.Smoke, smokeColor, 0.7);
        // The excavation beam can strike rune glyphs
        ctx.events.emit('structureStrike', { x: hit.x, y: hit.y, radius: 7 });
      }
    } else if (action.card === 'warp') {
      const a = jitter();
      const v = sp.warp.velocityForce! * action.speedMul;
      const p: Projectile = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, type: 'warp', life: 90, age: 0, charging: false, hostile: false };
      ctx.projectiles.push(p);
      this.markProjectile(ctx, p, action);
      ctx.audio.zap();
    } else if (action.card === 'blackhole') {
      // One charging singularity at a time (original rule) — extra casts fizzle.
      if (ctx.input.activeChargingBlackHole) return;
      const p: Projectile = { x, y, vx: 0, vy: 0, type: 'blackhole', vortexRad: sp.blackhole.baseRadius!, life: 240, age: 0, charging: true, hostile: false };
      ctx.projectiles.push(p);
      ctx.input.activeChargingBlackHole = p;
    } else if (action.card === 'vitriol') {
      // Stream card: a spray of REAL acid particles that pool where they land.
      const count = 4 + Math.max(0, Math.round(action.dmgMul) - 1) * 2;
      for (let j = 0; j < count; j++) {
        const a = jitter() + (Math.random() - 0.5) * 0.3;
        const spd = (3.0 + Math.random() * 2.2) * action.speedMul;
        ctx.particles.spawn(x, y, Math.cos(a) * spd, Math.sin(a) * spd, Cell.Acid, acidColor(),
          30 + Math.floor(Math.random() * 20), { grav: 0.05, glow: 0.8 });
      }
      if (ctx.state.frameCount % 6 === 0) ctx.audio.noiseBurst(0.1, 1400, 0.07, true);
    } else if (action.card === 'frostshard') {
      const a = jitter();
      const v = 11 * action.speedMul;
      const p: Projectile = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, type: 'iceshard', life: 180, age: 0, charging: false, hostile: false, mul: action.dmgMul };
      ctx.projectiles.push(p);
      this.markProjectile(ctx, p, action);
      ctx.audio.tone(1100, 500, 0.08, 'sine', 0.09);
    } else if (action.card === 'icelance') {
      const a = jitter();
      const v = 16 * action.speedMul;
      const p: Projectile = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, type: 'icelance', life: 140, age: 0, charging: false, hostile: false, mul: action.dmgMul };
      ctx.projectiles.push(p);
      this.markProjectile(ctx, p, action);
      ctx.audio.tone(1500, 700, 0.1, 'triangle', 0.1);
    } else if (action.card === 'wisp') {
      // dmgMul >= 2 releases a pair of seekers.
      const seekers = action.dmgMul >= 2 ? 2 : 1;
      for (let n = 0; n < seekers; n++) {
        const a = jitter() + (n > 0 ? 0.5 : 0);
        const v = 4.5 * action.speedMul;
        const p: Projectile = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, type: 'wisp', life: 240, age: 0, charging: false, hostile: false, mul: action.dmgMul };
        ctx.projectiles.push(p);
        this.markProjectile(ctx, p, action);
      }
      ctx.audio.tone(700, 1200, 0.1, 'sine', 0.07);
    } else if (action.card === 'meteor') {
      // Lobbed in a heavy arc — the upward bias makes the descent count.
      const a = jitter();
      const v = 6.5 * action.speedMul;
      const p: Projectile = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2.2, type: 'meteor', life: 300, age: 0, charging: false, hostile: false, mul: action.dmgMul };
      ctx.projectiles.push(p);
      this.markProjectile(ctx, p, action);
      ctx.audio.tone(120, 40, 0.4, 'sawtooth', 0.18);
    } else if (action.card === 'conjure') {
      // Raise a disc of real stone at the cursor, clamped to casting range 130.
      let tx = ctx.input.mouse.x,
        ty = ctx.input.mouse.y;
      const dx = tx - x,
        dy = ty - y;
      const dist = Math.hypot(dx, dy);
      if (dist > 130) {
        tx = x + (dx / dist) * 130;
        ty = y + (dy / dist) * 130;
      }
      const world = ctx.world;
      const cxx = Math.floor(tx),
        cyy = Math.floor(ty);
      for (let oy = -6; oy <= 6; oy++) {
        for (let ox = -6; ox <= 6; ox++) {
          if (ox * ox + oy * oy > 36) continue;
          const X = cxx + ox,
            Y = cyy + oy;
          if (!world.inBounds(X, Y)) continue;
          const ci = world.idx(X, Y);
          const t = world.types[ci];
          if (t === Cell.Empty || isLiquid(t) || isGas(t)) {
            world.types[ci] = Cell.Stone;
            world.colors[ci] = stoneColor();
            world.life[ci] = 0;
            world.charge[ci] = 0;
          }
        }
      }
      ctx.particles.burst(cxx, cyy - 4, 8, null, stoneColor, 1.2, { grav: 0.08 });
      ctx.audio.tone(180, 60, 0.18, 'triangle', 0.2);
    } else if (action.card === 'vitrify') {
      // The Gilded Vault's prize: transmute LIQUID into load-bearing glass
      // at the cursor (the conjure grammar, liquid-only — air stays air, so
      // it can cap and bridge but never wall off dry space).
      let tx = ctx.input.mouse.x,
        ty = ctx.input.mouse.y;
      const dx = tx - x,
        dy = ty - y;
      const dist = Math.hypot(dx, dy);
      if (dist > 130) {
        tx = x + (dx / dist) * 130;
        ty = y + (dy / dist) * 130;
      }
      const world = ctx.world;
      const cxx = Math.floor(tx),
        cyy = Math.floor(ty);
      const r = action.dmgMul > 1 ? 8 : 7;
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue;
          const X = cxx + ox,
            Y = cyy + oy;
          if (!world.inBounds(X, Y)) continue;
          const ci = world.idx(X, Y);
          if (isLiquid(world.types[ci])) {
            world.types[ci] = Cell.Glass;
            world.colors[ci] = glassColor();
            world.life[ci] = 0;
            world.charge[ci] = 0;
          }
        }
      }
      ctx.particles.burst(cxx, cyy - 3, 10, null, glassColor, 1.1, { grav: 0.06 });
      ctx.audio.tone(1250, 300, 0.14, 'triangle', 0.14);
      ctx.audio.tone(640, 90, 0.2, 'sine', 0.1);
    } else if (action.card === 'emberstorm') {
      // A fountain of real embers that smoulder where they land.
      const count = 16 + Math.max(0, Math.round(action.dmgMul) - 1) * 6;
      for (let j = 0; j < count; j++) {
        ctx.particles.spawn(
          x,
          y - 1,
          (Math.random() - 0.5) * 3.2 * action.speedMul,
          -1.4 - Math.random() * 2.2,
          Cell.Ember,
          emberColor(),
          100 + Math.floor(Math.random() * 80),
          { grav: 0.06, glow: 1.5 },
        );
      }
      ctx.audio.flame();
    }
  }

  /** Write the impact-time side-channel marks for a freshly spawned projectile. */
  private markProjectile(ctx: Ctx, p: Projectile, action: CastAction): void {
    if (action.bounces > 0) BOUNCE_COUNTS.set(p, action.bounces);
    if (action.infused) {
      const flask = ctx.flask.state;
      if (flask.material !== null && flask.count > 0) {
        INFUSED.set(p, flask.material);
        // The trail is real material: the flask pays 2 stored cells per cast.
        flask.count = Math.max(0, flask.count - 2);
        if (flask.count === 0) flask.material = null;
      }
    }
    if (action.triggered) TRIGGERED.set(p, action.triggered);
  }

  /* ---------------- per-frame upkeep ---------------- */

  update(ctx: Ctx): void {
    // Mana Font boon: the old ones keep the tanks topped up 60% faster.
    const regenK = ctx.player.perks.manafont ? 1.6 : 1;
    for (const w of this.wands) {
      if (w.cooldown > 0) w.cooldown--;
      w.mana = Math.min(w.frame.manaMax, w.mana + w.frame.manaRegen * regenK);
    }

    // Flame card stream: spray 4 fire particles per burst frame, same recipe
    // as the original flamethrower branch (Spells.firePlayerSpell).
    if (this.flameBurst > 0) {
      this.flameBurst--;
      if (ctx.state.mode === 'play' && !ctx.player.dead) {
        const tip = ctx.spells.wandTip();
        const flame = ctx.params.spells.flame;
        for (let j = 0; j < 4; j++) {
          const a = ctx.player.aimAngle + (Math.random() - 0.5) * flame.spread!;
          const spd = 3.2 + Math.random() * 2.2;
          ctx.particles.spawn(tip.x, tip.y, Math.cos(a) * spd + ctx.player.vx * 0.4,
            Math.sin(a) * spd, Cell.Fire, fireColor(),
            14 + Math.floor(Math.random() * 12), { grav: -0.015, glow: 2.2 });
        }
      }
    }

    // Mirror the active wand's pool into the player so the existing HUD mana
    // bar + hotbar affordability shading keep working without HUD surgery.
    // Runs after PlayerControl.update in the frame order, so the legacy
    // 0.45/frame player regen is overridden by the frame's manaRegen.
    if (ctx.state.mode === 'play') {
      const aw = this.wands[this._active];
      ctx.player.maxMana = aw.frame.manaMax;
      ctx.player.mana = aw.mana;
    }
  }

  /* ---------------- collection + bench ---------------- */

  grantCard(ctx: Ctx, id: CardId): void {
    this.collection.push(id);
    ctx.telemetry.count('card.granted.' + id);
    ctx.events.emit('cardGranted', { id, name: CARD_DEFS[id].name });
  }

  nextCastSlots(): number[] {
    const wand = this.wands[this._active];
    const program = this.program(this._active);
    if (program.length === 0) return [];
    const idx = wand.castIndex >= program.length ? 0 : wand.castIndex;
    return program[idx].slots;
  }

  upgradeFrame(ctx: Ctx, wand: 0 | 1, frameId: string): boolean {
    const frame = WAND_FRAMES[frameId];
    const w = this.wands[wand];
    if (!frame || w.frame.id === frameId) return false;
    w.frame = frame;
    while (w.cards.length < frame.capacity) w.cards.push(null);
    w.cards.length = frame.capacity;
    w.mana = frame.manaMax;
    w.cooldown = 0;
    w.castIndex = 0;
    this.compiled[wand] = null;
    ctx.audio.learn();
    ctx.events.emit('toast', { text: frame.name.toUpperCase() + ' FITTED' });
    ctx.events.emit('wandChanged');
    return true;
  }

  /* ---------------- save-game support ---------------- */

  snapshotLoadout(): WandLoadoutSave {
    return {
      active: this._active,
      collection: [...this.collection],
      wands: this.wands.map((w) => ({
        frameId: w.frame.id,
        cards: [...w.cards],
        mana: w.mana,
      })),
    };
  }

  loadLoadout(data: WandLoadoutSave): void {
    this._active = data.active;
    this.collection.length = 0;
    this.collection.push(...data.collection);
    for (let i = 0; i < this.wands.length && i < data.wands.length; i++) {
      const saved = data.wands[i];
      const w = this.wands[i];
      w.frame = WAND_FRAMES[saved.frameId] ?? w.frame;
      w.cards.length = 0;
      w.cards.push(...saved.cards);
      // pad/trim to the frame's capacity
      while (w.cards.length < w.frame.capacity) w.cards.push(null);
      w.cards.length = w.frame.capacity;
      w.mana = Math.min(w.frame.manaMax, saved.mana);
      w.cooldown = 0;
      w.castIndex = 0;
      this.compiled[i as 0 | 1] = null;
    }
    this.ctx.events.emit('wandChanged');
  }

  snapshotRuntimeState(): WandRuntimeSnapshot {
    return {
      active: this._active,
      collection: [...this.collection],
      wands: this.wands.map((w) => ({
        frameId: w.frame.id,
        cards: [...w.cards],
        mana: w.mana,
        cooldown: w.cooldown,
        ...(w.cooldownMax === undefined ? {} : { cooldownMax: w.cooldownMax }),
        castIndex: w.castIndex,
      })),
      lastDryFire: this.lastDryFire,
      flameBurst: this.flameBurst,
      depthsGranted: [...this.depthsGranted],
      infuserGranted: this.infuserGranted,
    };
  }

  restoreRuntimeState(data: WandRuntimeSnapshot): void {
    this._active = data.active;
    this.collection.length = 0;
    this.collection.push(...data.collection);
    for (let i = 0; i < this.wands.length && i < data.wands.length; i++) {
      const saved = data.wands[i];
      const w = this.wands[i];
      w.frame = WAND_FRAMES[saved.frameId] ?? w.frame;
      w.cards.length = 0;
      w.cards.push(...saved.cards);
      while (w.cards.length < w.frame.capacity) w.cards.push(null);
      w.cards.length = w.frame.capacity;
      w.mana = Math.min(w.frame.manaMax, Math.max(0, saved.mana));
      w.cooldown = Math.max(0, saved.cooldown);
      w.castIndex = Math.max(0, Math.floor(saved.castIndex));
      if (saved.cooldownMax === undefined) delete w.cooldownMax;
      else w.cooldownMax = Math.max(0, saved.cooldownMax);
      this.compiled[i as 0 | 1] = null;
    }
    this.lastDryFire = data.lastDryFire;
    this.flameBurst = Math.max(0, Math.floor(data.flameBurst));
    this.depthsGranted.clear();
    for (const depth of data.depthsGranted) {
      if (Number.isFinite(depth)) this.depthsGranted.add(Math.floor(depth));
    }
    this.infuserGranted = data.infuserGranted;
    this.ctx.events.emit('wandChanged');
  }

  resetLoadout(): void {
    const frames = [WAND_FRAMES.oak, WAND_FRAMES.bone] as const;
    const cards: [CardId[], CardId[]] = [['spark'], ['dig']];
    for (let i = 0; i < this.wands.length; i++) {
      const wand = this.wands[i];
      const frame = frames[i];
      wand.frame = frame;
      wand.cards.length = 0;
      wand.cards.push(...cards[i]);
      while (wand.cards.length < frame.capacity) wand.cards.push(null);
      wand.cards.length = frame.capacity;
      wand.mana = frame.manaMax;
      wand.cooldown = 0;
      wand.castIndex = 0;
      this.compiled[i as 0 | 1] = null;
    }
    this.collection.length = 0;
    this.collection.push(...STARTING_COLLECTION);
    this.depthsGranted.clear();
    this.infuserGranted = false;
    this.flameBurst = 0;
    this.lastDryFire = -99;
    this._active = 0;
    this.ctx.events.emit('wandChanged');
  }

  grantReviewLoadout(): void {
    this.applyReviewLoadout();
    this.ctx.events.emit('wandChanged');
  }

  private applyReviewLoadout(): void {
    const frames = [WAND_FRAMES.brass, WAND_FRAMES.void] as const;
    for (let i = 0; i < this.wands.length; i++) {
      const wand = this.wands[i];
      const frame = frames[i];
      wand.frame = frame;
      wand.cards.length = 0;
      wand.cards.push(...REVIEW_WAND_CARDS[i]);
      while (wand.cards.length < frame.capacity) wand.cards.push(null);
      wand.cards.length = frame.capacity;
      wand.mana = frame.manaMax;
      wand.cooldown = 0;
      wand.castIndex = 0;
      this.compiled[i as 0 | 1] = null;
    }
    this.collection.length = 0;
    this.collection.push(...ALL_CARD_IDS);
  }

  slotCard(wand: 0 | 1, slot: number, id: CardId | null): void {
    const w = this.wands[wand];
    if (slot < 0 || slot >= w.frame.capacity) return;
    const prev = w.cards[slot] ?? null;
    if (id === null) {
      if (prev === null) return;
      w.cards[slot] = null;
      this.collection.push(prev);
    } else {
      const owned = this.collection.indexOf(id);
      if (owned < 0) return; // not in the collection — nothing to place
      this.collection.splice(owned, 1);
      w.cards[slot] = id;
      if (prev !== null) this.collection.push(prev); // swap the old card back
    }
    this.compiled[wand] = null; // dirty: recompile lazily on next fire
    w.castIndex = 0; // the program changed — restart its cycle
    this.ctx.events.emit('wandChanged');
  }

  slotCollectionCard(collectionIndex: number, wand: 0 | 1, slot: number): void {
    const w = this.wands[wand];
    if (slot < 0 || slot >= w.frame.capacity) return;
    if (collectionIndex < 0 || collectionIndex >= this.collection.length) return;
    const id = this.collection[collectionIndex];
    const prev = w.cards[slot] ?? null;
    this.collection.splice(collectionIndex, 1);
    w.cards[slot] = id;
    if (prev !== null) this.collection.push(prev);
    this.compiled[wand] = null;
    w.castIndex = 0;
    this.ctx.events.emit('wandChanged');
  }

  swapSlots(sourceWand: 0 | 1, sourceSlot: number, targetWand: 0 | 1, targetSlot: number): void {
    const source = this.wands[sourceWand];
    const target = this.wands[targetWand];
    if (sourceSlot < 0 || sourceSlot >= source.frame.capacity) return;
    if (targetSlot < 0 || targetSlot >= target.frame.capacity) return;
    if (sourceWand === targetWand && sourceSlot === targetSlot) return;
    const sourceCard = source.cards[sourceSlot] ?? null;
    const targetCard = target.cards[targetSlot] ?? null;
    source.cards[sourceSlot] = targetCard;
    target.cards[targetSlot] = sourceCard;
    this.compiled[sourceWand] = null;
    this.compiled[targetWand] = null;
    source.castIndex = 0;
    target.castIndex = 0;
    this.ctx.events.emit('wandChanged');
  }

  moveSlotToCollection(wand: 0 | 1, slot: number, collectionIndex = this.collection.length): void {
    const w = this.wands[wand];
    if (slot < 0 || slot >= w.frame.capacity) return;
    const card = w.cards[slot] ?? null;
    if (card === null) return;
    w.cards[slot] = null;
    const insertAt = Math.max(0, Math.min(this.collection.length, Math.floor(collectionIndex)));
    this.collection.splice(insertAt, 0, card);
    this.compiled[wand] = null;
    w.castIndex = 0;
    this.ctx.events.emit('wandChanged');
  }

  invalidatePrograms(): void {
    this.compiled[0] = null;
    this.compiled[1] = null;
    this.ctx.events.emit('wandChanged');
  }

  /** Lazily (re)compiled program for a wand; invalidated by slotCard. */
  private program(wand: 0 | 1): CastGroup[] {
    let p = this.compiled[wand];
    if (p === null) {
      p = compileWand(this.wands[wand].cards);
      this.compiled[wand] = p;
    }
    return p;
  }
}
