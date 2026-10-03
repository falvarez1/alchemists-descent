import { clamp } from '@/core/math';
import { FLASK_SLOT_COUNT, type Ctx, type FlaskApi, type FlaskBottleState, type FlaskState } from '@/core/types';
import { Cell, blocksEntity, isGas, isLiquid } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import { SIPHONABLE_SOLIDS } from '@/content/recipes';

/** Cell types the flask can drink: any liquid, plus the loose powders worth carrying and the reagent solids (a leaf, coal). */
function siphonable(t: number): boolean {
  return isLiquid(t) || t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder || SIPHONABLE_SOLIDS.includes(t as Cell);
}

/**
 * MEASURED POUR: aimed over a cauldron's bowl the flask pours a cell at a time (and draws a cell
 * every other frame), so the bowl panel's count can be WATCHED climbing and stopped at: a bowl holds
 * about fourteen cells and a human lets go two or three tenths of a second late, so at the old ten cells
 * a frame no recipe could be poured on purpose. Away from a bowl nothing changes.
 */
const MEASURED_POUR_EVERY = 4;
const MEASURED_DRAW_EVERY = 2;
/**
 * The cursor is over the basin: its nine-cell width and a tall column above it (where a pour is aimed). Narrow on purpose: the
 * fire a player lights beside the bowl (oil poured against the wall, five or six cells off) must still pour as a free stream.
 */
function overBowl(ctx: Ctx): boolean {
  const c = ctx.levels?.current?.cauldron;
  if (!c) return false;
  const m = ctx.input.mouse;
  return Math.abs(m.x - c.x) <= 4 && m.y >= c.y - 14 && m.y <= c.y + 2;
}

/** The exit speed a measured pour is lobbed at (the same 2.4-3.5 cells a frame a free pour leaves at). */
const LOB_SPEED = 3;
/** A lob is taken when it deposits within this many columns of where it was aimed (a bowl is seven wide). */
const LOB_TOLERANCE = 2.5;

/**
 * THE LOB: a stream aimed at a bowl leaves the wand along the aim and falls under gravity, so from ten
 * cells off it grazes the far wall or sails over a seven-cell bowl (measured: 28 cells poured at a bowl's
 * centre, 7 stayed in it). Over a bowl the flask lobs each droplet on the arc that falls INTO it: the
 * velocity (cells/frame) whose flight, as the particle system flies it (vy += grav; x += vx; y += vy),
 * ends on the first solid or liquid cell it meets with the droplet depositing in the bowl's own air
 * (within LOB_TOLERANCE columns of tx, within a row and a half of ty). Found by trying each launch angle; null
 * when no arc does (too close, too far, walled off): then the pour is the ordinary free stream.
 */
export function lobToBowl(
  world: { width: number; height: number; types: Uint8Array },
  x0: number, y0: number, tx: number, ty: number, grav: number,
): { vx: number; vy: number } | null {
  const dir = tx >= x0 ? 1 : -1;
  let best: { vx: number; vy: number } | null = null;
  let bestCost = LOB_TOLERANCE;
  for (let k = 0; k < 120; k++) {
    const phi = -1.4 + (k / 119) * 2.95; // from steeply up to straight down, toward the target
    const vx = dir * LOB_SPEED * Math.cos(phi);
    const vy0 = LOB_SPEED * Math.sin(phi) - 0.25; // (the free stream's touch of lift)
    let x = x0, y = y0, vy = vy0, px = Math.floor(x0), py = Math.floor(y0);
    for (let n = 0; n < 90; n++) {
      vy += grav;
      x += vx;
      y += vy;
      const gx = Math.floor(x), gy = Math.floor(y);
      if (gx < 0 || gy < 0 || gx >= world.width || gy >= world.height) break;
      const t = world.types[gx + gy * world.width];
      if (t !== Cell.Empty && !isGas(t)) {
        // it deposits at the last free cell behind the one it struck
        const cost = Math.abs(py - ty) <= 1.5 ? Math.abs(px - tx) : Infinity;
        if (cost < bestCost) {
          bestCost = cost;
          best = { vx, vy: vy0 };
        }
        break;
      }
      px = gx;
      py = gy;
    }
  }
  return best;
}

const SIPHON_RADIUS = 8;
/** Max cursor distance from the player for the siphon to reach. */
const SIPHON_REACH = 70;
const SIPHON_RATE = 40;
const POUR_RATE = 10;
const THROW_FORCE = 6.5;
const BOTTLE_GRAV = 0.18;
/** Spill blob never grows past this radius; any overflow splashes out as particles. */
const MAX_SPILL_RADIUS = 20;

const GLASS_COLOR = packRGB(200, 230, 255);

function infiniteFlask(ctx: Ctx): boolean {
  return ctx.state.debugGodMode === true;
}

function hasLineOfSight(ctx: Ctx, fromX: number, fromY: number, toX: number, toY: number): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 1; i <= steps; i++) {
    const x = Math.floor(fromX + (dx * i) / steps);
    const y = Math.floor(fromY + (dy * i) / steps);
    if (!ctx.world.inBounds(x, y)) return false;
    const t = ctx.world.types[ctx.world.idx(x, y)];
    if (blocksEntity(t) && !siphonable(t)) return false;
  }
  return true;
}

// ===================== The Material Flask =====================
/**
 * Siphon real cells out of the world, carry them, pour them back, or throw
 * the bottle. Every stored cell is real: siphoning deletes exactly the cells
 * that pour/throw later return to the grid (as cells or depositing particles).
 * Play mode only.
 */
export class Flask implements FlaskApi {
  private readonly _slots: FlaskState[] = Array.from({ length: FLASK_SLOT_COUNT }, () => ({
    material: null,
    count: 0,
    capacity: 600,
  }));
  private _activeIndex = 0;

  /** The thrown bottle in flight, or null (at most one). */
  private bottle: FlaskBottleState | null = null;

  get state(): FlaskState {
    return this._slots[this._activeIndex];
  }

  get slots(): readonly FlaskState[] {
    return this._slots;
  }

  get activeIndex(): number {
    return this._activeIndex;
  }

  selectSlot(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this._slots.length) return false;
    this._activeIndex = index;
    return true;
  }

  setSlot(index: number, material: number | null, count: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this._slots.length) return;
    const slot = this._slots[index];
    const clamped = material === null ? 0 : Math.max(0, Math.min(slot.capacity, Math.floor(count)));
    slot.material = clamped > 0 ? material : null;
    slot.count = clamped;
  }

  clearSlots(): void {
    for (const slot of this._slots) {
      slot.material = null;
      slot.count = 0;
    }
    this._activeIndex = 0;
    this.cancelBottle();
  }

  cancelBottle(): void {
    this.bottle = null;
  }

  restoreBottle(bottle: FlaskBottleState | null): void {
    this.bottle = bottle ? { ...bottle, count: Math.max(0, Math.floor(bottle.count)) } : null;
  }

  bottleView(): FlaskBottleState | null {
    return this.bottle ? { ...this.bottle } : null;
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode === 'play' && !ctx.player.dead && !ctx.player.climbing && !ctx.arena?.isActionLocked(ctx.arena.bound)) {
      if (ctx.input.siphonHeld) this.siphon(ctx);
      if (ctx.input.pourHeld) this.pour(ctx);
    }
    if (this.bottle) this.flyBottle(ctx);
  }

  throwFlask(ctx: Ctx): void {
    if (ctx.arena?.isActionLocked(ctx.arena.bound)) return;
    if (ctx.state.mode !== 'play' || ctx.player.dead || ctx.player.climbing) return;
    if (this.state.count === 0 && !this.bottle) {
      this.refuse(ctx); // hurling an empty bottle helps no one
      return;
    }
    if (this.bottle || this.state.count === 0) return;
    const s = this.state;
    const tip = ctx.spells.wandTip();
    const a = Math.atan2(ctx.input.mouse.y - tip.y, ctx.input.mouse.x - tip.x);
    this.bottle = {
      x: tip.x,
      y: tip.y,
      vx: Math.cos(a) * THROW_FORCE,
      vy: Math.sin(a) * THROW_FORCE,
      material: s.material,
      count: s.count,
    };
    ctx.audio.sfx('flask.throw');
    const thrownMaterial = s.material;
    const thrownAmount = s.count;
    if (thrownMaterial !== null) ctx.telemetry.count('flask.throw.' + this.materialName(ctx, thrownMaterial));
    if (!infiniteFlask(ctx)) {
      s.material = null;
      s.count = 0;
    }
    ctx.events.emit('flaskUsed', { verb: 'throw', material: thrownMaterial, amount: thrownAmount });
    ctx.player.throwT = 14; // presentation: the arm follows through
  }

  /** Refused flask verb: hollow click + the FLSK bar flinches (throttled). */
  private lastRefuse = -99;
  private refuse(ctx: Ctx): void {
    if (ctx.state.frameCount - this.lastRefuse < 30) return;
    this.lastRefuse = ctx.state.frameCount;
    ctx.audio.sfx('flask.dry');
    ctx.events.emit('flaskDry');
  }

  // ===================== Siphon =====================
  private siphon(ctx: Ctx): void {
    const { world, player, input } = ctx;
    const s = this.state;
    if (s.count >= s.capacity) {
      this.refuse(ctx); // tank's full — the slurp has nowhere to go
      return;
    }
    const mx = input.mouse.x, my = input.mouse.y;
    // Reach check against the wand-height body point, same anchor the streaks fly to.
    const rx = mx - player.x, ry = my - (player.y - 9);
    if (rx * rx + ry * ry > SIPHON_REACH * SIPHON_REACH) return;

    const measured = overBowl(ctx);
    if (measured && ctx.state.frameCount % MEASURED_DRAW_EVERY !== 0) return;
    const rate = measured ? 1 : SIPHON_RATE;
    // An empty flask draws what the cursor is ON: the nearest cell it can take, not the first in scan order
    // (a brewed potion in a bowl with a stray leaf or a splash of water beside it was drawn as the leaf).
    if (s.material === null) {
      let bestD = Infinity;
      for (let dy = -SIPHON_RADIUS; dy <= SIPHON_RADIUS; dy++) {
        for (let dx = -SIPHON_RADIUS; dx <= SIPHON_RADIUS; dx++) {
          const d = dx * dx + dy * dy;
          if (d >= bestD || d > SIPHON_RADIUS * SIPHON_RADIUS) continue;
          const x = mx + dx, y = my + dy;
          if (!world.inBounds(x, y)) continue;
          const t = world.types[world.idx(x, y)];
          if (!siphonable(t) || !hasLineOfSight(ctx, player.x, player.y - 9, x, y)) continue;
          bestD = d;
          s.material = t;
        }
      }
    }
    let taken = 0;
    for (let dy = -SIPHON_RADIUS; dy <= SIPHON_RADIUS && taken < rate; dy++) {
      for (let dx = -SIPHON_RADIUS; dx <= SIPHON_RADIUS && taken < rate; dx++) {
        if (dx * dx + dy * dy > SIPHON_RADIUS * SIPHON_RADIUS) continue;
        if (s.count >= s.capacity) break;
        const x = mx + dx, y = my + dy;
        if (!world.inBounds(x, y)) continue;
        const t = world.types[world.idx(x, y)];
        if (!siphonable(t)) continue;
        if (!hasLineOfSight(ctx, player.x, player.y - 9, x, y)) continue;
        // First cell fixes the flask's contents; afterwards only matches are taken.
        if (s.material === null) s.material = t;
        else if (t !== s.material) continue;
        world.clearCell(x, y);
        s.count++;
        taken++;
      }
    }
    if (taken === 0 || s.material === null) return;

    // Streaks getting sucked from the siphon area toward the wizard — bumped up
    // (count + glow) so the pull reads clearly against the brighter wand light.
    const colorFn = COLOR_FN[s.material];
    const streaks = 4 + (entityRandom() < 0.5 ? 2 : 0);
    for (let j = 0; j < streaks; j++) {
      const a = entityRandom() * Math.PI * 2;
      const r = entityRandom() * SIPHON_RADIUS;
      const px = mx + Math.cos(a) * r, py = my + Math.sin(a) * r;
      const dx = player.x - px, dy = (player.y - 9) - py;
      const d = Math.hypot(dx, dy) || 1;
      const spd = 2.6 + entityRandom() * 1.4;
      ctx.particles.spawn(px, py, (dx / d) * spd, (dy / d) * spd, null, colorFn(),
        12 + Math.floor(entityRandom() * 8), { grav: 0, glow: 1.6 });
    }
    if (ctx.state.frameCount % 8 === 0) ctx.audio.sfx('flask.siphon.loop');
    ctx.telemetry.count('flask.siphon.' + this.materialName(ctx, s.material), taken);
    ctx.events.emit('flaskUsed', { verb: 'siphon', material: s.material, amount: taken });
  }

  // ===================== Pour =====================
  private pour(ctx: Ctx): void {
    const s = this.state;
    const material = s.material;
    if (s.count === 0 || material === null) {
      this.refuse(ctx); // tipping an empty flask
      return;
    }
    const tip = ctx.spells.wandTip();
    const colorFn = COLOR_FN[material];
    const aim = ctx.player.aimAngle;
    const dirX = Math.cos(aim), dirY = Math.sin(aim);
    const liquid = isLiquid(material);

    // SPRAY out of the wand tip in an arc, like a hose: the stream LEAVES the
    // wand along the aim and falls under gravity, so a pour of lava lands where
    // you point — not straight down on the wizard's own head. Each droplet
    // carries a real cell that deposits when it lands (deposit:true also drops it
    // on expiry, so siphoned material is conserved even over open space).
    const infinite = infiniteFlask(ctx);
    const measured = overBowl(ctx);
    if (measured && ctx.state.frameCount % MEASURED_POUR_EVERY !== 0) return;
    const n = Math.min(measured ? 1 : POUR_RATE, s.count);
    const glow = material === Cell.Lava ? 1.4 : material === Cell.Acid ? 0.7 : 0.35;
    const grav = liquid ? 0.11 : 0.15;
    const bowl = measured ? ctx.levels?.current?.cauldron : null;
    for (let j = 0; j < n; j++) {
      const a = aim + (entityRandom() - 0.5) * 0.16; // a little nozzle spread
      const sp = 2.4 + entityRandom() * 1.1; // exit speed (cells/frame)
      // over a bowl: the arc that falls into it (a little spread across its width), else the aim itself
      const lob = bowl ? lobToBowl(ctx.world, tip.x, tip.y, bowl.x + (entityRandom() - 0.5) * 4, bowl.y - 1, grav) : null;
      ctx.particles.spawn(
        lob ? tip.x : tip.x + dirX * 2,
        lob ? tip.y : tip.y + dirY * 2,
        lob ? lob.vx : Math.cos(a) * sp,
        lob ? lob.vy : Math.sin(a) * sp - 0.25, // a touch of lift gives the hose arc
        material,
        colorFn(),
        55 + Math.floor(entityRandom() * 25),
        { grav, glow, deposit: true },
      );
      if (!infinite) s.count--;
    }
    if (ctx.state.frameCount % 8 === 0) ctx.audio.sfx('flask.pour.loop');
    ctx.telemetry.count('flask.pour.' + this.materialName(ctx, material), n);
    if (!infinite && s.count === 0) s.material = null;
    ctx.events.emit('flaskUsed', { verb: 'pour', material, amount: n });
  }

  // ===================== Thrown bottle =====================
  private flyBottle(ctx: Ctx): void {
    const b = this.bottle!;
    const { world } = ctx;
    b.vy += BOTTLE_GRAV;
    // Sub-step along the velocity so a fast bottle can't tunnel through walls.
    const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy)));
    for (let st = 0; st < steps; st++) {
      const px = b.x, py = b.y;
      b.x += b.vx / steps;
      b.y += b.vy / steps;
      const gx = Math.floor(b.x), gy = Math.floor(b.y);
      if (!world.inBounds(gx, gy)) {
        this.shatter(ctx, clamp(gx, 0, world.width - 1), clamp(gy, 0, world.height - 1));
        return;
      }
      const t = world.types[world.idx(gx, gy)];
      if (t !== Cell.Empty && !isGas(t)) {
        // Back off to the last free cell so the spill starts in open air.
        this.shatter(ctx, Math.floor(px), Math.floor(py));
        return;
      }
    }
    // Glassy glint trail so the throw reads before the renderer draws the bottle body.
    const spin = ctx.state.frameCount * 0.45;
    ctx.particles.spawn(b.x, b.y, 0, 0, null, GLASS_COLOR, 6, { grav: 0, glow: 0.9 });
    if (ctx.state.frameCount % 3 === 0) {
      ctx.particles.spawn(
        b.x + Math.cos(spin) * 1.4,
        b.y + Math.sin(spin) * 1.4,
        -b.vx * 0.02,
        -b.vy * 0.02,
        null,
        GLASS_COLOR,
        8,
        { grav: 0, glow: 1.2 },
      );
    }
  }

  private shatter(ctx: Ctx, ix: number, iy: number): void {
    const bottle = this.bottle!;
    this.bottle = null;
    const material = bottle.material;
    let remaining = bottle.count;

    for (let j = 0; j < 8; j++) {
      const a = entityRandom() * Math.PI * 2;
      const sp = 1.2 + entityRandom() * 1.6;
      ctx.particles.spawn(ix, iy, Math.cos(a) * sp, Math.sin(a) * sp - 0.6, null, GLASS_COLOR,
        25 + Math.floor(entityRandom() * 15), { glow: 1.5 });
    }
    ctx.audio.sfx('flask.shatter', ix, iy);
    if (material === null || remaining === 0) return;

    const colorFn = COLOR_FN[material];
    // ~30% splashes out as flying particles that re-deposit where they land.
    let splash = Math.round(remaining * 0.3);
    remaining -= splash;
    for (; splash > 0; splash--) {
      const a = entityRandom() * Math.PI * 2;
      const sp = 0.8 + entityRandom() * 2.2;
      ctx.particles.spawn(ix, iy, Math.cos(a) * sp, Math.sin(a) * sp - 1.0, material, colorFn(),
        70 + Math.floor(entityRandom() * 50));
    }
    // The rest pools straight into empty cells, ring by expanding ring.
    const world = ctx.world;
    for (let r = 0; r <= MAX_SPILL_RADIUS && remaining > 0; r++) {
      const inner = (r - 1) * (r - 1);
      for (let dy = -r; dy <= r && remaining > 0; dy++) {
        for (let dx = -r; dx <= r && remaining > 0; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r || (r > 0 && d2 <= inner)) continue;
          const x = ix + dx, y = iy + dy;
          if (!world.inBounds(x, y)) continue;
          const i = world.idx(x, y);
          const t = world.types[i];
          if (t !== Cell.Empty && !isGas(t)) continue;
          world.replaceCellAt(i, material, colorFn());
          remaining--;
        }
      }
    }
    // Whatever the cave had no room for still leaves the bottle as splash.
    for (; remaining > 0; remaining--) {
      const a = entityRandom() * Math.PI * 2;
      const sp = 1.0 + entityRandom() * 2.5;
      ctx.particles.spawn(ix, iy, Math.cos(a) * sp, Math.sin(a) * sp - 1.2, material, colorFn(),
        80 + Math.floor(entityRandom() * 60));
    }
  }

  private materialName(ctx: Ctx, m: number): string {
    return ctx.params.materials[m]?.name ?? 'Material ' + m;
  }
}
