import type { FighterDrawable, FighterMeter } from '@/core/fighters';
import { entityRandom, fxRandom } from '@/core/simRandom';
import type { AuthoredLight, Ctx, Enemy, EnemyDamageSource } from '@/core/types';
import { aimOf, punch, shoulderOf } from '@/fighters/effects';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import type { FighterSystem } from '@/fighters/FighterSystem';
import {
  Mixture, TUNING, blastKnock, channelOf, glideStep, launchVial, selfShove, stepVial, trailSpan, trailing,
} from '@/fighters/kits/ilyra-voss-logic';
import type { Vial, VialEnd } from '@/fighters/kits/ilyra-voss-logic';
import { Cell, blocksEntity, isGas, isLiquid } from '@/sim/CellType';
import { emberColor, fireColor, packRGB } from '@/sim/colors';
import { drawDuelEffect, duelSocket } from '@/render/duel/DuelFighterSprites';

/**
 * ILYRA VOSS, THE CINDER ALCHEMIST (docs/FIGHTERS.md "01", docs/fighters/ilyra-voss.md).
 *
 *  - Volatile Mixture (passive): two different weapons inside 4 s prime her; the next hit lands Scorch, a real
 *    burning status plus a flare. A "weapon" is a damage channel (`channelOf`): a spell card, a kick, a flask,
 *    a body she threw, her own crucible.
 *  - Flash Crucible (Z): a vial thrown along the aim that bursts at the first solid, on a foe or after a 40-tick
 *    fuse. It carves nothing and never hurts her; it throws foes outward and her too.
 *  - Phoenix Draft (T): faster hands (the wand's real cooldown runs down twice a tick), fireproof, faster, and
 *    a trail of real Fire and Ember cells.
 *
 * The numbers are in `TUNING` (ilyra-voss-logic.ts, beside the arithmetic the unit tests hold).
 */
export { TUNING } from '@/fighters/kits/ilyra-voss-logic';

const RIM_GOLD: readonly [number, number, number] = [1.0, 0.72, 0.26];
const HOT: readonly [number, number, number] = [1.0, 0.62, 0.22];
const RING_TICKS = 14;
const FIRE_IMMUNE: readonly string[] = ['fire', 'burning', 'oiled-fire'];

interface Ring { x: number; y: number; age: number }

function openCell(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return false;
  const t = w.types[w.idx(x, y)];
  return t === Cell.Empty || isGas(t);
}

function create(sys: FighterSystem): KitInstance {
  const ctx = sys.ctx;
  const mix = new Mixture();

  // ---- what the passive can see of the wand and the flask ----
  let card: string | null = null;
  let cardAt = -1e9;
  let flaskUntil = -1;
  const off: Array<() => void> = [
    ctx.events.on('cardCast', ({ id }) => { card = id; cardAt = ctx.state.frameCount; }),
    ctx.events.on('flaskUsed', ({ verb }) => {
      if (verb === 'throw' || verb === 'pour') flaskUntil = ctx.state.frameCount + TUNING.flaskWindow;
    }),
  ];

  // ---- the crucible ----
  let vial: Vial | null = null;
  const rings: Ring[] = [];
  const spriteEffects: Array<Ring & { name: string }> = [];
  const spriteEffect = (name: string, x: number, y: number): void => {
    if (!ctx.arena?.stockMatch) return;
    if (spriteEffects.length >= 8) spriteEffects.shift();
    spriteEffects.push({ name, x, y, age: 0 }); ensureDrawable();
  };

  // ---- the draught ----
  let phoenix = false;
  /** Frames of afterglow once the draught ends (the rim fades rather than vanishing). */
  let fade = 0;
  let glow: AuthoredLight | null = null;
  let lastTrailX: number | null = null;
  let trailDrops = 0;
  let embersLaid = 0;

  // ---- drawing ----
  let unregister: (() => void) | null = null;
  const drawable: FighterDrawable = { layer: 'over', draw: (out, _field, c) => drawFx(out, c) };
  const ensureDrawable = (): void => { if (!unregister) unregister = sys.addDrawable(drawable); };
  const releaseIfIdle = (now: number): void => {
    if (unregister && !vial && rings.length === 0 && spriteEffects.length === 0 && !phoenix && fade <= 0 && !mix.primed(now)) {
      unregister();
      unregister = null;
    }
  };
  let wasPrimed = false;

  // ====================================================================== Volatile Mixture

  const bodyOf = (e: Enemy): { cx: number; cy: number; h: number; halfW: number } => {
    const def = ctx.enemyCtl.defs[e.kind];
    const h = def ? def.h : 10;
    return { cx: e.x, cy: e.y - h * 0.5, h, halfW: def ? def.halfW : 4 };
  };

  /** A hit landed on `e` by weapon `channel`: prime her, or (already primed) spend the prime on a Scorch. */
  function noteHit(e: Enemy, channel: string, killed: boolean): void {
    const now = ctx.state.frameCount;
    if (mix.primed(now)) {
      // The rest of the blow that primed her (a bolt's impact, then its blast, in one tick) is not "the next hit";
      // nor is a killing blow: nothing is left to burn, so the mixture waits.
      if (!mix.ready(now) || killed) return;
      scorch(e);
      spendPrime();
      return;
    }
    if (mix.note(channel, now)) primedFx(now);
  }

  function spendPrime(): void {
    mix.spend();
    wasPrimed = false;
  }

  /** The tell for a pair that has just primed her: an amber flicker at the wand hand and a soft strike. */
  function primedFx(now: number): void {
    const tip = ctx.spells.wandTip();
    spriteEffect('volatile_spark', tip.x, tip.y);
    ctx.particles.burst(tip.x, tip.y, 7, null, () => packRGB(255, 150 + ((fxRandom() * 70) | 0), 40), 1.3, { glow: 2.4, grav: -0.03 });
    ctx.audio.sfx('spell.flame.ignite', tip.x, tip.y, { gain: 0.55, pitch: 4 });
    ensureDrawable();
    wasPrimed = mix.primed(now);
  }

  /**
   * SCORCH: a 6-damage flare, and a real burning status of at least `scorchBurn` ticks (the engine's own status
   * loop then sheds Fire cells, spreads to flammables and burns it down). Fire-proof foes take the flare only,
   * which `splashHazard` tells us: it refuses a body that fire cannot hurt.
   */
  function scorch(e: Enemy): void {
    const { cx, cy, h, halfW } = bodyOf(e);
    spriteEffect('scorch', cx, cy);
    // Scorch belongs to the hit that just landed. Its new invulnerability must not swallow the bonus.
    const stockVictim = e.fighter !== undefined && ctx.arena?.stockMatch ? ctx.arena.bundle(e.fighter)?.player : null;
    const invuln = stockVictim?.invuln ?? 0;
    if (stockVictim) stockVictim.invuln = 0;
    try { sys.hurt(e, TUNING.scorchFlare, (entityRandom() - 0.5) * 0.4, -0.5); }
    finally { if (stockVictim) stockVictim.invuln = Math.max(invuln, stockVictim.invuln); }
    let lit = false;
    if (stockVictim && !stockVictim.dead) {
      stockVictim.status.burning = Math.max(stockVictim.status.burning, TUNING.scorchBurn);
      lit = true;
    } else if (e.hp > 0 && ctx.enemies.includes(e)) {
      const hp = e.hp;
      if (ctx.enemyCtl.splashHazard(cx, cy, Cell.Fire, 'direct') && e.hp < hp) {
        e.status.burning = Math.max(e.status.burning, TUNING.scorchBurn);
        lit = true;
      }
    }
    // The strike: sparks and a few real flames licking the body (only where fire can take hold).
    ctx.particles.burst(cx, cy, 12, null, () => packRGB(255, 130 + ((fxRandom() * 100) | 0), 30), 2.0, { glow: 2.6, grav: -0.02 });
    ctx.sparks?.burst(cx, cy, { count: 36, speed: 1.8, kind: 'spark', glow: 1.3, radius: halfW, colors: [0xffd27a, 0xffa030, 0xff7a18] });
    if (lit) {
      for (let i = 0; i < 4; i++) {
        const side = entityRandom() < 0.5 ? -1 : 1;
        placeCell(Math.round(cx + side * (halfW + 1 + ((entityRandom() * 2) | 0))), Math.round(cy - h * 0.5 + entityRandom() * h), Cell.Fire, 16 + ((entityRandom() * 10) | 0), 0);
      }
    }
    ctx.audio.sfx('spell.crit.pyre', cx, cy, { gain: lit ? 1.0 : 0.7 });
    sys.addLight(cx, cy - 2, { rgb: [1.0, 0.55, 0.22], intensity: 1.5, radius: 46, bloom: 0.9, flicker: 0.05 }, 16);
    ctx.events.emit('combatCallout', { x: cx, y: e.y - h - 6, text: lit ? 'SCORCH' : 'FLARE', tone: 'brass' });
    punch(ctx, 0.008, 0.25);
  }

  /** Write one real cell if the spot is open; returns whether it was. `avoid` keeps cells off the fighter. */
  function placeCell(x: number, y: number, cell: number, life: number, avoid: number): boolean {
    if (!openCell(ctx, x, y)) return false;
    if (avoid > 0) {
      const p = ctx.player;
      if (Math.hypot(x - p.x, y - (p.y - 8)) < avoid) return false;
    }
    const w = ctx.world;
    const i = w.idx(x, y);
    w.replaceCellAt(i, cell, cell === Cell.Ember ? emberColor() : fireColor());
    if (life > 0) w.life[i] = life;
    return true;
  }

  // ====================================================================== Flash Crucible

  const inBody = (e: Enemy, x: number, y: number): boolean => {
    if (e.hp <= 0) return false;
    const def = ctx.enemyCtl.defs[e.kind];
    if (!def) return false;
    return Math.abs(x - e.x) <= def.halfW + 1 && y <= e.y + 1 && y > e.y - def.h - 1;
  };

  const probe = {
    inBounds: (x: number, y: number): boolean => ctx.world.inBounds(x, y),
    solid: (x: number, y: number): boolean => {
      const t = ctx.world.types[ctx.world.idx(x, y)];
      return blocksEntity(t) || isLiquid(t);
    },
    foe: (x: number, y: number): boolean => {
      for (const e of ctx.enemies) if (inBody(e, x, y)) return true;
      return false;
    },
  };

  function throwVial(): boolean {
    if (vial) return false;
    const p = ctx.player;
    const aim = aimOf(ctx);
    let origin = ctx.spells.wandTip();
    const clear = (o: { x: number; y: number }): boolean => openCell(ctx, Math.floor(o.x), Math.floor(o.y));
    if (!clear(origin)) {
      origin = shoulderOf(ctx);
      if (!clear(origin)) return false; // no room to throw: refused, no cooldown spent
    }
    vial = launchVial(origin.x, origin.y, aim.angle);
    p.throwT = 14; // the arm follows through
    ctx.audio.sfx('flask.throw', origin.x, origin.y, { gain: 1.0, pitch: 3 });
    ctx.particles.burst(origin.x, origin.y, 6, null, () => packRGB(255, 170 + ((fxRandom() * 60) | 0), 60), 1.1, { glow: 2.2, grav: -0.02 });
    ensureDrawable();
    return true;
  }

  function flyVial(): void {
    const v = vial;
    if (!v) return;
    const end = stepVial(v, probe);
    if (end) { detonate(end); return; }
    // A hot comet: sparks shed along the flight.
    if (ctx.state.frameCount % 2 === 0) {
      ctx.particles.spawn(v.x, v.y, -v.vx * 0.04 + (fxRandom() - 0.5) * 0.3, -v.vy * 0.04 - 0.1, null, packRGB(255, 150 + ((fxRandom() * 70) | 0), 40), 14, { glow: 2.4, grav: -0.01 });
    }
  }

  /**
   * THE BURST. Nothing is carved and she takes no damage: foes within `burstRadius` take `burstDamage` and are
   * thrown outward, a few real Fire and Ember cells scatter (never near her), and she is shoved clear.
   */
  function detonate(end: VialEnd): void {
    const p = ctx.player;
    vial = null;
    const { x, y } = end;
    spriteEffect('crucible_fragments', x, y);
    const now = ctx.state.frameCount;
    ctx.audio.sfx('flask.shatter', x, y, { gain: 1.0 });
    ctx.audio.sfx('boom.small', x, y, { gain: 0.8, pitch: 2 });
    ctx.audio.sfx('spell.flame.ignite', x, y, { gain: 0.8 });

    // Foes first (a copy: the buffer is reused and a kill reshuffles the list).
    const victims = sys.enemiesNear(x, y, TUNING.burstRadius).slice();
    const scorchBlast = mix.ready(now);
    let struck = 0;
    for (const e of victims) {
      if (e.hp <= 0 || !ctx.enemies.includes(e)) continue;
      const { cx, cy } = bodyOf(e);
      const dx = cx - x, dy = cy - y;
      const { kx, ky } = blastKnock(dx, dy, Math.hypot(dx, dy), p.facing);
      sys.hurt(e, TUNING.burstDamage, kx, ky);
      struck++;
    }
    if (struck > 0) {
      if (scorchBlast) {
        // A primed blast is one hit that lands on everything it caught.
        let burned = 0;
        for (const e of victims) if (e.hp > 0 && ctx.enemies.includes(e)) { scorch(e); burned++; }
        if (burned > 0) spendPrime();
      } else if (mix.note('crucible', now)) primedFx(now);
      ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 2);
    }

    // Real cells: a few flames and coals, scattered where there is air, never over her.
    const R = TUNING.scatterRadius;
    for (let i = 0; i < TUNING.scatterFire + TUNING.scatterEmber; i++) {
      const a = entityRandom() * Math.PI * 2, r = Math.sqrt(entityRandom()) * R;
      const ember = i >= TUNING.scatterFire;
      placeCell(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.8), ember ? Cell.Ember : Cell.Fire, ember ? 0 : 18 + ((entityRandom() * 12) | 0), TUNING.safeRadius);
    }

    // Her own shove: the vial is also a way to leave.
    const aim = aimOf(ctx);
    const shove = selfShove(p.x - x, p.y - 8 - y, aim.x, aim.y);
    if (shove) {
      // A raw impulse dies in the floor's friction in three ticks, so she is carried: a short glide that bleeds off and arcs.
      sys.startMove({ ticks: TUNING.shoveTicks, step: (t) => glideStep(shove.vx, shove.vy, t), exitVx: shove.vx * TUNING.shoveExit, exitVy: 0 });
      if (p.hat) { p.hat.vx += Math.sign(shove.vx) * 2.0; p.hat.vy -= 1.2; }
      if (p.robe) p.robe.vx += Math.sign(shove.vx) * 1.4;
    }

    // Props, critters and the look of it.
    ctx.rigidBodies.applyRadialImpulse(x, y, TUNING.burstRadius * 1.2, 2.0);
    ctx.critters?.scatter(x, y, TUNING.burstRadius * 1.5, 1.6);
    ctx.sparks?.burst(x, y, { count: 220, speed: 3.0, kind: 'spark', glow: 1.4, radius: 5, colors: [0xfff0c0, 0xffd27a, 0xffa030, 0xff7a18] });
    ctx.sparks?.burst(x, y, { count: 60, speed: 0.9, kind: 'ember', glow: 1.1, radius: 8, colors: [0xff6a10, 0xffae40, 0xd04008] });
    ctx.particles.burst(x, y, 18, null, () => packRGB(255, 170 + ((fxRandom() * 70) | 0), 60), 2.6, { glow: 2.6, grav: -0.01 });
    sys.addLight(x, y, { rgb: [1.0, 0.78, 0.46], intensity: 3.0, radius: 90, bloom: 1.4, flicker: 0.02 }, 22);
    rings.push({ x, y, age: 0 });
    ensureDrawable();
    punch(ctx, 0.03, 0.65);
  }

  // ====================================================================== Phoenix Draft

  /** Lay the trail: a flame behind her for every column she has covered since the last drop, a coal now and then. */
  function dropTrail(): void {
    const p = ctx.player;
    spriteEffect('fire_trail', p.x - p.facing * 7, p.y - 2);
    const dir = Math.abs(p.vx) > 0.3 ? Math.sign(p.vx) : -p.facing;
    const cols = trailSpan(lastTrailX, p.x, dir);
    lastTrailX = cols[cols.length - 1];
    for (const cx of cols) {
      if (entityRandom() < 0.12) continue; // a ragged edge, not a ruled line
      trailDrops++;
      const coal = embersLaid < TUNING.trailEmberBudget && trailDrops % TUNING.trailEmberEvery === 0;
      const life = TUNING.trailLifeMin + ((entityRandom() * TUNING.trailLifeSpread) | 0);
      // At her feet; if that cell is taken, one up (a step, a lip of rubble).
      const placed = coal
        ? placeCell(cx, p.y, Cell.Ember, 0, 0) || placeCell(cx, p.y - 1, Cell.Ember, 0, 0)
        : placeCell(cx, p.y, Cell.Fire, life, 0) || placeCell(cx, p.y - 1, Cell.Fire, life, 0);
      if (placed && coal) embersLaid++;
      if (placed && !coal) {
        // a taller lick: a second flame above most columns and a third above some (a foe wading in is touched by many
        // flame cells at once, which is what catches it alight), and a spark of the same fire
        if (entityRandom() < 0.65) placeCell(cx, p.y - 2, Cell.Fire, life - 4, 0);
        if (entityRandom() < 0.3) placeCell(cx, p.y - 3, Cell.Fire, life - 8, 0);
        ctx.particles.spawn(cx + 0.5, p.y - 1, (entityRandom() - 0.5) * 0.25, -0.55 - entityRandom() * 0.5, null, packRGB(255, 120 + ((fxRandom() * 90) | 0), 20), 18, { glow: 2.6, grav: -0.03 });
      }
    }
  }

  function startPhoenix(): boolean {
    spriteEffect('phoenix_charge', ctx.player.x, ctx.player.y - 9);
    const p = ctx.player;
    sys.setMod('phoenix', TUNING.phoenixTicks, { moveScale: TUNING.phoenixMove, immuneTo: FIRE_IMMUNE });
    phoenix = true;
    fade = 0;
    lastTrailX = null;
    trailDrops = 0;
    embersLaid = 0;
    p.status.burning = 0;
    glow = sys.addLight(p.x, p.y - 9, { rgb: [1.0, 0.72, 0.34], intensity: 1.7, radius: 56, bloom: 0.9, flicker: 0.1 }, TUNING.phoenixTicks);
    // The kindling: a ring of flame leaves her in every direction.
    ctx.particles.burst(p.x, p.y - 9, 26, null, () => packRGB(255, 150 + ((fxRandom() * 90) | 0), 40), 3.2, { glow: 2.8, grav: -0.02 });
    ctx.sparks?.burst(p.x, p.y - 9, { count: 160, speed: 2.4, kind: 'spark', glow: 1.3, radius: 6, colors: [0xfff0c0, 0xffd27a, 0xffb040] });
    ctx.audio.sfx('spell.emberstorm', p.x, p.y, { gain: 1.0 });
    ctx.audio.sfx('mat.ignite', p.x, p.y, { gain: 0.9 });
    rings.push({ x: p.x, y: p.y - 9, age: 0 });
    ensureDrawable();
    punch(ctx, 0.02, 0.7);
    return true;
  }

  function endPhoenix(): void {
    if (!phoenix) return;
    const p = ctx.player;
    phoenix = false;
    fade = 18;
    sys.clearMod('phoenix');
    if (glow) { glow.intensity = 0; glow = null; } // (the light lapses with its own clock)
    ctx.particles.burst(p.x, p.y - 9, 14, null, () => packRGB(255, 130 + ((fxRandom() * 80) | 0), 30), 1.6, { glow: 2.0, grav: -0.02 });
    ctx.audio.sfx('mat.sizzle', p.x, p.y, { gain: 0.9 });
  }

  // ====================================================================== drawing (render rate: no seeded streams here)

  function drawFx(out: Parameters<FighterDrawable['draw']>[0], c: Ctx): void {
    const frame = c.state.frameCount;
    const calm = c.state.reduceFlashes === true;
    const add = out.addFinePx ?? out.addPx;
    const p = c.player;
    for (const effect of spriteEffects) drawDuelEffect(out, c, effect.name, effect.age, effect.x, effect.y, false, .75);

    // The vial in flight: a glass body with a hot core, tumbling, in a halo, and a comet behind it.
    const v = vial;
    if (v) {
      const x = v.x - v.vx * 0.5, y = v.y - v.vy * 0.5;
      if (!drawDuelEffect(out, c, 'crucible_spin', frame % 48, x, y)) {
      const spin = frame * 0.55;
      const sx = Math.round(Math.cos(spin) * 1.4), sy = Math.round(Math.sin(spin) * 1.4);
      const rx = Math.round(x), ry = Math.round(y);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > 3.3) continue;
          const g = (1 - d / 3.4) * (1 - d / 3.4);
          out.addPx(rx + dx, ry + dy, 0.9 * g, 0.42 * g, 0.08 * g);
        }
      }
      out.setPx(rx + sx, ry + sy, 0.9, 0.96, 1.0);
      out.setPx(rx - sx, ry - sy, 0.55, 0.68, 0.85);
      out.setPx(rx, ry, 1.0, 0.82, 0.4);
      out.setPx(rx, ry + 1, 1.0, 0.55, 0.15);
      out.addPx(rx, ry, 0.9, 0.45, 0.1);
      }
      const sp = Math.hypot(v.vx, v.vy) || 1;
      for (let i = 1; i <= 10; i++) {
        const k = (1 - i / 11);
        const tx = x - (v.vx / sp) * i * 1.2, ty = y - (v.vy / sp) * i * 1.2 + i * 0.1;
        out.addPx(tx, ty, HOT[0] * k * 0.95, HOT[1] * k * 0.95, HOT[2] * k * 0.95);
        add.call(out, tx + 0.5, ty + 0.5, HOT[0] * k * 0.6, HOT[1] * k * 0.6, HOT[2] * k * 0.6);
      }
    }

    // The shockwave rings: a white-hot flash that opens into a bright amber ring, fading as it goes.
    const step = out.pixelStep ?? 1;
    for (const r of rings) {
      if (drawDuelEffect(out, c, 'crucible_burst', r.age / RING_TICKS * 35, r.x, r.y, false, .8)) continue;
      const t = r.age / RING_TICKS;
      const e = 1 - (1 - t) * (1 - t);
      const radius = 2 + e * (TUNING.burstRadius - 2);
      const k = Math.pow(1 - t, 1.1) * (calm ? 0.6 : 1.0);
      // Three nested rings (a front and its wake), dense enough to read as a line, not dots.
      for (let w = 0; w < 3; w++) {
        const rr = radius - w * 1.1;
        if (rr < 1) continue;
        const kw = k * (w === 0 ? 1.0 : w === 1 ? 0.6 : 0.3);
        // the front is drawn a whole cell thick so it reads as a line at any zoom; its wake is fine and soft
        const n = Math.ceil((Math.PI * 2 * rr) / (w === 0 ? 1 : step));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const px = r.x + Math.cos(a) * rr, py = r.y + Math.sin(a) * rr * 0.92;
          if (w === 0) out.addPx(px, py, HOT[0] * kw, HOT[1] * kw, HOT[2] * kw);
          else add.call(out, px, py, HOT[0] * kw, HOT[1] * kw, HOT[2] * kw);
        }
      }
      if (r.age < 5 && !calm) {
        const core = (1 - r.age / 5) * 0.9;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const d = Math.hypot(dx, dy);
            if (d > 5) continue;
            const f = core * (1 - d / 5.5);
            out.addPx(r.x + dx, r.y + dy, f, f * 0.85, f * 0.55);
          }
        }
      }
    }

    // The draught: a gold rim around the body, a slow chase of brightness round it, and a crown of sparks.
    if ((phoenix || fade > 0) && !p.dead) {
      const x = p.x - p.vx * 0.5, y = p.y - p.vy * 0.5 - 8.5;
      const life = phoenix ? 1 : fade / 18;
      if (!drawDuelEffect(out, c, 'phoenix_aura', 12 + frame % 12, x, y, false, life * .65)) {
      const pulse = calm ? 0.8 : 0.78 + 0.22 * Math.sin(frame * 0.28);
      // An inner ring a whole cell thick (so it reads at normal zoom) and a soft fine halo outside it.
      const cells = Math.ceil(54);
      for (let i = 0; i < cells; i++) {
        const a = (i / cells) * Math.PI * 2;
        const gate = 0.35 + 0.65 * Math.max(0, Math.cos(a * 2 - frame * 0.22));
        const k = 0.75 * life * pulse * gate;
        out.addPx(x + Math.cos(a) * 6.4, y + Math.sin(a) * 10.6, RIM_GOLD[0] * k, RIM_GOLD[1] * k, RIM_GOLD[2] * k);
      }
      const n = Math.ceil(58 / step);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const gate = 0.5 + 0.5 * Math.max(0, Math.cos(a * 2 - frame * 0.22));
        const k = 0.9 * life * pulse * gate;
        add.call(out, x + Math.cos(a) * 7.7, y + Math.sin(a) * 11.9, RIM_GOLD[0] * k * 0.5, RIM_GOLD[1] * k * 0.5, RIM_GOLD[2] * k * 0.5);
        add.call(out, x + Math.cos(a) * 9.0, y + Math.sin(a) * 13.2, RIM_GOLD[0] * k * 0.2, RIM_GOLD[1] * k * 0.2, RIM_GOLD[2] * k * 0.2);
      }
      for (let i = 0; i < 5; i++) {
        const lift = ((frame * 0.7 + i * 5) % 14);
        const k = (1 - lift / 14) * 0.7 * life;
        add.call(out, x + Math.sin(i * 2.3 + frame * 0.05) * 4, y - 11 - lift, 1.0 * k, 0.8 * k, 0.35 * k);
      }
    }

    }
    // A primed mixture: a small amber star kindling at the wand hand, breathing.
    if (!p.dead && mix.primed(frame)) {
      const tip = duelSocket(c, 'muzzle') ?? c.spells.wandTip();
      const left = mix.primedLeft(frame);
      const lapsing = left < 60 && frame % 8 < 3; // flickers out as it goes cold
      const pulse = lapsing ? 0.25 : calm ? 0.7 : 0.7 + 0.3 * Math.sin(frame * 0.35);
      const x = Math.round(tip.x), y = Math.round(tip.y);
      out.addPx(x, y, 1.0 * pulse, 0.62 * pulse, 0.2 * pulse);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) out.addPx(x + dx, y + dy, 0.55 * pulse, 0.3 * pulse, 0.08 * pulse);
      const a = frame * 0.18;
      add.call(out, x + Math.cos(a) * 3.2, y + Math.sin(a) * 3.2, 0.8 * pulse, 0.45 * pulse, 0.12 * pulse);
      add.call(out, x - Math.cos(a) * 3.2, y - Math.sin(a) * 3.2, 0.8 * pulse, 0.45 * pulse, 0.12 * pulse);
    }
  }

  // ====================================================================== the kit

  return {
    tick(): void {
      const now = ctx.state.frameCount;
      for (let i = spriteEffects.length - 1; i >= 0; i--) if (++spriteEffects[i].age >= 36) spriteEffects.splice(i, 1);
      flyVial();
      for (let i = rings.length - 1; i >= 0; i--) {
        if (++rings[i].age > RING_TICKS) rings.splice(i, 1);
      }
      if (fade > 0) fade--;
      const primed = mix.primed(now);
      if (primed) {
        if (now % 9 === 0 && !ctx.player.dead) {
          const tip = ctx.spells.wandTip();
          ctx.particles.spawn(tip.x + (fxRandom() - 0.5) * 3, tip.y, (fxRandom() - 0.5) * 0.2, -0.35 - fxRandom() * 0.3, null, packRGB(255, 160, 50), 16, { glow: 2.2, grav: -0.02 });
        }
      } else if (wasPrimed) {
        // The mixture went cold unspent: one small hiss, no fuss.
        wasPrimed = false;
        const tip = ctx.spells.wandTip();
        ctx.particles.burst(tip.x, tip.y, 4, null, () => packRGB(150, 110, 90), 0.6, { grav: -0.02 });
      }
      releaseIfIdle(now);
    },

    tactical: throwVial,

    ultimate: startPhoenix,

    ultimateTick(): void {
      const p = ctx.player;
      p.status.burning = 0; // she is fire-proof: whatever lit her goes out
      // Faster reloads: the wand's own cooldown (cast delay plus recharge) runs down a second time each tick,
      // so a cast group is ready in half the ticks. WandSystem.update takes the first decrement.
      for (const w of ctx.wands.wands) if (w.cooldown > 0) w.cooldown -= TUNING.phoenixReloadRate - 1;
      if (glow) { glow.x = p.x; glow.y = p.y - 9; }
      const now = ctx.state.frameCount;
      if (now % TUNING.trailEvery === 0 && trailing(p.vx, p.vy)) dropTrail();
      if (now % 2 === 0) {
        ctx.particles.spawn(p.x + (fxRandom() - 0.5) * 9, p.y - 3 - fxRandom() * 14, (fxRandom() - 0.5) * 0.3 - p.vx * 0.12, -0.45 - fxRandom() * 0.6, null, packRGB(255, 170 + ((fxRandom() * 70) | 0), 50), 22, { glow: 2.5, grav: -0.02 });
      }
    },

    ultimateEnd: endPhoenix,

    onEnemyHurt(e: Enemy, amount: number, source: EnemyDamageSource, killed: boolean): void {
      if (amount < TUNING.minHit) return;
      const now = ctx.state.frameCount;
      const channel = channelOf({ source, melee: sys.recentMelee, card, cardAge: now - cardAt, flaskOpen: now < flaskUntil });
      if (channel !== null) noteHit(e, channel, killed);
    },

    meter(): FighterMeter | null {
      const now = ctx.state.frameCount;
      if (mix.primed(now)) return { label: 'SCORCH PRIMED', value: mix.primedLeft(now), max: TUNING.primeTicks };
      const open = mix.windowLeft(now);
      return open > 0 ? { label: 'MIXTURE', value: open, max: TUNING.mixtureWindow } : null;
    },

    save(): Record<string, number> {
      return { primed: mix.primedLeft(ctx.state.frameCount) };
    },

    load(bag: Record<string, number>): void {
      mix.restore(bag.primed ?? 0, ctx.state.frameCount);
    },

    reset(): void {
      vial = null;
      spriteEffects.length = 0;
      rings.length = 0;
      phoenix = false;
      fade = 0;
      glow = null; // (the system drops its lights itself)
      lastTrailX = null;
      mix.clear();
      wasPrimed = false;
      if (unregister) { unregister(); unregister = null; }
    },

    dispose(): void {
      spriteEffects.length = 0;
      if (unregister) { unregister(); unregister = null; }
      for (const f of off.splice(0)) f();
    },
  };
}

export const kit: FighterKitDef = {
  id: 'ilyra-voss',
  tacticalCooldown: TUNING.tacticalCooldown,
  ultimateDuration: TUNING.phoenixTicks,
  create,
};
