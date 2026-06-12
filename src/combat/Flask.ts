import { clamp } from '@/core/math';
import type { Ctx, FlaskApi, FlaskState } from '@/core/types';
import { Cell, isGas, isLiquid } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';

/** Cell types the flask can drink: any liquid, plus the loose powders worth carrying. */
function siphonable(t: number): boolean {
  return isLiquid(t) || t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder;
}

const SIPHON_RADIUS = 8;
/** Max cursor distance from the player for the siphon to reach. */
const SIPHON_REACH = 70;
const SIPHON_RATE = 40;
const POUR_RATE = 10;
const POUR_RADIUS = 2;
const THROW_FORCE = 6.5;
const BOTTLE_GRAV = 0.18;
/** Spill blob never grows past this radius; any overflow splashes out as particles. */
const MAX_SPILL_RADIUS = 20;

const GLASS_COLOR = packRGB(200, 230, 255);

// ===================== The Material Flask =====================
/**
 * Siphon real cells out of the world, carry them, pour them back, or throw
 * the bottle. Every stored cell is real: siphoning deletes exactly the cells
 * that pour/throw later return to the grid (as cells or depositing particles).
 * Play mode only.
 */
export class Flask implements FlaskApi {
  readonly state: FlaskState = { material: null, count: 0, capacity: 600 };

  /** The thrown bottle in flight, or null (at most one). */
  private bottle: { x: number; y: number; vx: number; vy: number } | null = null;

  bottleView(): { x: number; y: number; vx: number; vy: number } | null {
    return this.bottle ? { ...this.bottle } : null;
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode === 'play' && !ctx.player.dead) {
      if (ctx.input.siphonHeld) this.siphon(ctx);
      if (ctx.input.pourHeld) this.pour(ctx);
    }
    if (this.bottle) this.flyBottle(ctx);
  }

  throwFlask(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.player.dead) return;
    if (this.state.count === 0 && !this.bottle) {
      this.refuse(ctx); // hurling an empty bottle helps no one
      return;
    }
    if (this.bottle || this.state.count === 0) return;
    const tip = ctx.spells.wandTip();
    const a = Math.atan2(ctx.input.mouse.y - tip.y, ctx.input.mouse.x - tip.x);
    this.bottle = {
      x: tip.x,
      y: tip.y,
      vx: Math.cos(a) * THROW_FORCE,
      vy: Math.sin(a) * THROW_FORCE,
    };
    ctx.audio.tone(520, 320, 0.08, 'sine', 0.06);
    if (this.state.material !== null) {
      ctx.telemetry.count('flask.throw.' + this.materialName(ctx, this.state.material));
    }
  }

  /** Refused flask verb: hollow click + the FLSK bar flinches (throttled). */
  private lastRefuse = -99;
  private refuse(ctx: Ctx): void {
    if (ctx.state.frameCount - this.lastRefuse < 30) return;
    this.lastRefuse = ctx.state.frameCount;
    ctx.audio.dryFire();
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

    let taken = 0;
    for (let dy = -SIPHON_RADIUS; dy <= SIPHON_RADIUS && taken < SIPHON_RATE; dy++) {
      for (let dx = -SIPHON_RADIUS; dx <= SIPHON_RADIUS && taken < SIPHON_RATE; dx++) {
        if (dx * dx + dy * dy > SIPHON_RADIUS * SIPHON_RADIUS) continue;
        if (s.count >= s.capacity) break;
        const x = mx + dx, y = my + dy;
        if (!world.inBounds(x, y)) continue;
        const t = world.types[world.idx(x, y)];
        if (!siphonable(t)) continue;
        // First cell fixes the flask's contents; afterwards only matches are taken.
        if (s.material === null) s.material = t;
        else if (t !== s.material) continue;
        world.clearCell(x, y);
        s.count++;
        taken++;
      }
    }
    if (taken === 0 || s.material === null) return;

    // Streaks getting sucked from the siphon area toward the wizard.
    const colorFn = COLOR_FN[s.material];
    const streaks = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let j = 0; j < streaks; j++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * SIPHON_RADIUS;
      const px = mx + Math.cos(a) * r, py = my + Math.sin(a) * r;
      const dx = player.x - px, dy = (player.y - 9) - py;
      const d = Math.hypot(dx, dy) || 1;
      const spd = 2.2 + Math.random() * 1.2;
      ctx.particles.spawn(px, py, (dx / d) * spd, (dy / d) * spd, null, colorFn(),
        10 + Math.floor(Math.random() * 8), { grav: 0, glow: 0.8 });
    }
    if (ctx.state.frameCount % 8 === 0) ctx.audio.noiseBurst(0.08, 900, 0.05, true);
    ctx.telemetry.count('flask.siphon.' + this.materialName(ctx, s.material), taken);
  }

  // ===================== Pour =====================
  private pour(ctx: Ctx): void {
    const s = this.state;
    const material = s.material;
    if (s.count === 0 || material === null) {
      this.refuse(ctx); // tipping an empty flask
      return;
    }
    const { world } = ctx;
    const tip = ctx.spells.wandTip();
    const cx = Math.round(tip.x), cy = Math.round(tip.y);
    const colorFn = COLOR_FN[material];

    let released = 0;
    for (let dy = -POUR_RADIUS; dy <= POUR_RADIUS && released < POUR_RATE; dy++) {
      for (let dx = -POUR_RADIUS; dx <= POUR_RADIUS && released < POUR_RATE; dx++) {
        if (dx * dx + dy * dy > POUR_RADIUS * POUR_RADIUS) continue;
        if (s.count === 0) break;
        const x = cx + dx, y = cy + dy;
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y);
        const t = world.types[i];
        if (t !== Cell.Empty && !isGas(t)) continue;
        world.types[i] = material;
        world.colors[i] = colorFn();
        world.life[i] = 0;
        world.charge[i] = 0;
        s.count--;
        released++;
      }
    }
    if (released === 0) return;
    if (ctx.state.frameCount % 2 === 0) {
      const aim = ctx.player.aimAngle;
      for (let j = 0; j < Math.min(3, released); j++) {
        ctx.particles.spawn(
          tip.x + Math.cos(aim) * j,
          tip.y + Math.sin(aim) * j,
          Math.cos(aim) * (0.45 + Math.random() * 0.25),
          Math.sin(aim) * (0.45 + Math.random() * 0.25) + 0.2,
          null,
          colorFn(),
          12 + Math.floor(Math.random() * 7),
          { grav: isLiquid(material) ? 0.08 : 0.13, glow: 0.6 },
        );
      }
    }
    if (ctx.state.frameCount % 8 === 0) ctx.audio.noiseBurst(0.06, 600, 0.035);
    ctx.telemetry.count('flask.pour.' + this.materialName(ctx, material), released);
    if (s.count === 0) s.material = null;
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
    this.bottle = null;
    const s = this.state;
    const material = s.material;
    let remaining = s.count;
    s.material = null;
    s.count = 0;

    for (let j = 0; j < 8; j++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 1.6;
      ctx.particles.spawn(ix, iy, Math.cos(a) * sp, Math.sin(a) * sp - 0.6, null, GLASS_COLOR,
        25 + Math.floor(Math.random() * 15), { glow: 1.5 });
    }
    ctx.audio.tone(1400, 300, 0.12, 'triangle', 0.18);
    ctx.audio.noiseBurst(0.12, 2600, 0.12, true);
    if (material === null || remaining === 0) return;

    const colorFn = COLOR_FN[material];
    // ~30% splashes out as flying particles that re-deposit where they land.
    let splash = Math.round(remaining * 0.3);
    remaining -= splash;
    for (; splash > 0; splash--) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 2.2;
      ctx.particles.spawn(ix, iy, Math.cos(a) * sp, Math.sin(a) * sp - 1.0, material, colorFn(),
        70 + Math.floor(Math.random() * 50));
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
          world.types[i] = material;
          world.colors[i] = colorFn();
          world.life[i] = 0;
          world.charge[i] = 0;
          remaining--;
        }
      }
    }
    // Whatever the cave had no room for still leaves the bottle as splash.
    for (; remaining > 0; remaining--) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.0 + Math.random() * 2.5;
      ctx.particles.spawn(ix, iy, Math.cos(a) * sp, Math.sin(a) * sp - 1.2, material, colorFn(),
        80 + Math.floor(Math.random() * 60));
    }
  }

  private materialName(ctx: Ctx, m: number): string {
    return ctx.params.materials[m]?.name ?? 'Material ' + m;
  }
}
