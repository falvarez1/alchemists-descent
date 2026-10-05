import type { FighterMeter } from '@/core/fighters';
import { entityRandom, fxRandom } from '@/core/simRandom';
import type { AuthoredLight, Projectile } from '@/core/types';
import { punch, stampDisc } from '@/fighters/effects';
import type { FighterSystem } from '@/fighters/FighterSystem';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import { TUNING, PressureVessel, blowOrigin, blowFromFront, plateDir, segmentSectorEntry } from '@/fighters/kits/brann-rook-logic';
import type { NearFoe } from '@/fighters/kits/brann-rook-logic';
import { drawPlate, drawRedlineAura, newPlateView } from '@/fighters/kits/brann-rook-plate';
import { Cell } from '@/sim/CellType';
import { drawDuelEffect } from '@/render/duel/DuelFighterSprites';

export { TUNING } from '@/fighters/kits/brann-rook-logic';

/**
 * BRANN ROOK, the Iron Pilgrim (Bulwark): docs/FIGHTERS.md and docs/fighters/brann-rook.md.
 *
 *  - Pressure Vessel (passive): health lost to a single blow of >= 6 fills Pressure; at full she vents a
 *    puff of real Steam cells, resets, and holds her footing for 4 s.
 *  - Boiler Guard (Z): an iron plate stands 14 cells out along the aim for 3.5 s. Hostile shots that cross
 *    its front arc are eaten (a clang and sparks); melee and blasts from the front are halved; she walks
 *    at x0.75. Z again lowers it early (the cooldown keeps running).
 *  - Redline (T): half damage, no knockback at all, a ring of Steam around her and a scald for every foe
 *    within 16 cells; her light flares red.
 */

const SPARK_GOLD = [0xffe9a8, 0xffc050, 0xffffff, 0xff9a30] as const;
const SPARK_EMBER = [0xff6a10, 0xffae40, 0xd04008] as const;
const STEAM_WISP = [0xdfe3ea, 0xc7ccd6, 0xf2f4f8] as const;

export const kit: FighterKitDef = {
  id: 'brann-rook',
  tacticalCooldown: TUNING.guard.cooldown,
  ultimateDuration: TUNING.redline.duration,
  create(sys: FighterSystem): KitInstance {
    const ctx = sys.ctx;
    const vessel = new PressureVessel();
    const view = newPlateView();
    const meterBag: FighterMeter = { label: 'Pressure', value: 0, max: TUNING.pressure.max };
    /** Ticks the plate has left (0 = down) and how long it has been up. */
    let guardLeft = 0;
    let guardAge = 0;
    let dropPlate: (() => void) | null = null;
    let dropAura: (() => void) | null = null;
    let auraK = 0;
    let redlineLight: AuthoredLight | null = null;
    const spriteEffects: Array<{ age: number; drop: () => void }> = [];
    const clearSpriteEffects = (): void => { for (const effect of spriteEffects) effect.drop(); spriteEffects.length = 0; };
    const spriteEffect = (name: string, x: number, y: number): void => {
      if (!ctx.arena?.stockMatch) return;
      if (spriteEffects.length >= 4) spriteEffects.shift()!.drop();
      const effect = { age: 0, drop: () => {} };
      const mirror = ctx.player.facing < 0;
      effect.drop = sys.addDrawable({ layer: 'over', draw: (out, _field, c) => {
        drawDuelEffect(out, c, name, effect.age, x, y, mirror, .8);
      } });
      spriteEffects.push(effect);
    };
    const unsub = ctx.events.on('playerRespawned', () => { vessel.reset(); });

    // ------------------------------------------------------------------ the world's cells and the senses

    /** A ragged puff of real Steam cells (written, with a life, into open air only: it rises, scalds foes and condenses on its own). */
    const puff = (x: number, y: number, r: number, keep: number, life: number): number =>
      stampDisc(ctx, x, y, r, Cell.Steam, { life, keep: () => entityRandom() < keep });

    /** Compact clouds of Steam scattered about (x, y) within `spread` cells: a vent, not a haze. */
    const clouds = (x: number, y: number, spread: number, count: number, radius: number, keep: number, life: number): number => {
      let n = 0;
      for (let i = 0; i < count; i++) {
        const a = entityRandom() * Math.PI * 2, d = Math.sqrt(entityRandom()) * spread;
        n += puff(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, radius, keep, life);
      }
      return n;
    };

    /** Scratch objects (the engine's hooks are allocation-free): read the result at once, never keep it. */
    const chestAt = { x: 0, y: 0 };
    const chest = (): { x: number; y: number } => {
      const p = ctx.player;
      chestAt.x = p.x;
      chestAt.y = p.y - (p.crawling ? 4 : 9); // shoulderOf(ctx)
      return chestAt;
    };

    const sparks = (x: number, y: number, count: number, speed: number, angle: number, spread: number, colors: readonly number[], life = 24): void => {
      ctx.sparks?.burst(x, y, { count, speed, angle, spread, colors, kind: 'spark', glow: 1.3, radius: 1.5, life });
    };

    const wisps = (x: number, y: number, count: number): void => {
      ctx.sparks?.burst(x, y, { count, speed: 0.5, angle: -Math.PI / 2, spread: 0.9, colors: STEAM_WISP, kind: 'smoke', life: 34, glow: 0.6, radius: 2 });
    };

    // ------------------------------------------------------------------ Pressure Vessel

    const vent = (): void => {
      const p = ctx.player, c = chest();
      spriteEffect('pressure', c.x, c.y);
      spriteEffect('boiler_vent', c.x, c.y);
      spriteEffect('vent_cloud', c.x, c.y - 4);
      const t = TUNING.pressure;
      clouds(c.x, c.y, t.ventRadius, t.ventPuffs, t.puffRadius, t.puffKeep, t.ventLife);
      sys.setMod('pressure-vent', t.resistTicks, { staggerResist: true });
      ctx.audio.sfx('mat.steam', p.x, p.y, { gain: 1.6, pitch: -2 });
      ctx.audio.sfx('mech.vault', p.x, p.y, { gain: 0.5, pitch: 4 });
      sparks(c.x, c.y - 4, 22, 1.7, -Math.PI / 2, 1.3, SPARK_EMBER, 30);
      wisps(c.x, c.y - 4, 28);
      sys.callout('VENTED');
      punch(ctx, 0.016, 0.3);
    };

    // ------------------------------------------------------------------ Boiler Guard

    const geom = { cx: 0, cy: 0, dir: { x: 1, y: 0 } };
    const guardGeom = (): { cx: number; cy: number; dir: { x: number; y: number } } => {
      const c = chest();
      geom.cx = c.x;
      geom.cy = c.y;
      plateDir(ctx.player.aimAngle, TUNING.guard.tilt, geom.dir);
      return geom;
    };

    const nearestFoe = (g: { cx: number; cy: number }): NearFoe | null => {
      const near = sys.enemiesNear(g.cx, g.cy, TUNING.guard.meleeReach);
      const defs = ctx.enemyCtl.defs;
      for (const e of near) {
        if (e.hp <= 0 || e.sleeping === true) continue;
        const def = defs[e.kind];
        return { dx: e.x - g.cx, dy: e.y - (def ? def.h * 0.5 : 5) - g.cy };
      }
      return null;
    };

    /** The clang: sparks fanning out from the plate toward the blow, a ring of the iron, a flash of light, the plate shoved back. */
    const clang = (angle: number, gain: number): void => {
      const g = guardGeom();
      const r = TUNING.guard.reach;
      const x = g.cx + Math.cos(angle) * r, y = g.cy + Math.sin(angle) * r;
      view.flash = 1;
      spriteEffect('guard_impact', x, y);
      view.flashAngle = angle;
      view.recoil = 2.5;
      sparks(x, y, 30, 2.6, angle, 1.0, SPARK_GOLD);
      ctx.particles.burst(x, y, 6, null, () => (fxRandom() < 0.5 ? 0xffe0a0 : 0xffffff), 2.2, { glow: 2, grav: 0.06 });
      ctx.audio.sfx('body.impact.metal', x, y, { gain, pitch: fxRandom() * 3 - 4 });
      sys.addLight(x, y, { rgb: [1, 0.82, 0.5], intensity: 1.3, radius: 34, bloom: 0.9, flicker: 0 }, 9);
      ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, 1);
      punch(ctx, 0.012, 0.25);
    };

    const lower = (reason: 'time' | 'early' | 'reset'): void => {
      if (guardLeft <= 0 && !view.up) return;
      guardLeft = 0;
      guardAge = 0;
      view.up = false;
      view.warn = false;
      sys.clearMod('boiler-guard');
      if (dropPlate) { dropPlate(); dropPlate = null; }
      if (reason === 'reset') return;
      // The plate folds away with a hiss of steam at its edge.
      const g = guardGeom(), r = TUNING.guard.reach;
      const x = g.cx + g.dir.x * (r - 2), y = g.cy + g.dir.y * (r - 2);
      spriteEffect('steam_jet', x, y);
      puff(x, y, 3.5, 0.5, 20);
      ctx.audio.sfx('mech.latch', x, y, { gain: 0.9, pitch: -3 });
      ctx.audio.sfx('mat.steam', x, y, { gain: 0.5, pitch: 2 });
      sparks(x, y, 8, 0.9, Math.atan2(g.dir.y, g.dir.x), 1.2, SPARK_GOLD, 16);
    };

    // ------------------------------------------------------------------ Redline

    const scald = (): void => {
      const c = chest();
      const r = TUNING.redline;
      // A copy: a kill can reshuffle the system's reused buffer under the loop.
      const targets = sys.enemiesNear(c.x, c.y, r.scaldRadius).slice();
      for (const e of targets) {
        if (e.hp <= 0) continue;
        const away = Math.sign(e.x - c.x) || 1;
        sys.hurt(e, r.scaldDamage, away * 0.25, -0.1);
        ctx.particles.burst(e.x, e.y - 6, 3, null, () => 0xf2f4f8, 1.0, { glow: 1.2, grav: -0.03 });
      }
      if (targets.length > 0) ctx.audio.sfx('mat.sizzle', c.x, c.y, { gain: 0.8 });
    };

    return {
      tick(): void {
        for (let i = spriteEffects.length - 1; i >= 0; i--) {
          if (++spriteEffects[i].age >= 36) { spriteEffects[i].drop(); spriteEffects.splice(i, 1); }
        }
        vessel.tick();
        const c = chest();
        // Venting: a steady plume off the shoulders while the held footing lasts.
        if (vessel.resist > 0 && (vessel.resist & 3) === 0) wisps(c.x + (fxRandom() - 0.5) * 8, c.y - 3, 2);

        if (guardLeft > 0) {
          guardLeft--;
          guardAge++;
          view.raise = Math.min(1, guardAge / TUNING.guard.raiseTicks);
          view.warn = guardLeft <= TUNING.guard.warnTicks;
          if (guardLeft === 0) lower('time');
        }
        view.flash = view.flash > 0.02 ? view.flash * 0.82 : 0;
        view.recoil = view.recoil > 0.05 ? view.recoil * 0.78 : 0;
        view.heat = vessel.value / TUNING.pressure.max;
      },

      // ---------------------------------------------------------------- Boiler Guard (Z)
      tactical(): boolean {
        const g = guardGeom();
        const r = TUNING.guard.reach;
        guardLeft = TUNING.guard.duration;
        guardAge = 0;
        view.up = true;
        view.raise = 0;
        view.warn = false;
        view.flash = 0;
        view.recoil = 0;
        sys.setMod('boiler-guard', TUNING.guard.duration, { moveScale: TUNING.guard.moveScale });
        if (!dropPlate) dropPlate = sys.addDrawable({ layer: 'over', draw: (out, field, c) => drawPlate(out, field, c, view) });
        const x = g.cx + g.dir.x * r, y = g.cy + g.dir.y * r;
        ctx.audio.sfx('mech.latch', x, y, { gain: 1.2, pitch: -2 });
        ctx.audio.sfx('body.impact.metal', x, y, { gain: 0.9, pitch: -6 });
        sparks(x, y, 18, 1.5, Math.atan2(g.dir.y, g.dir.x), 1.6, SPARK_GOLD, 18);
        sys.addLight(x, y, { rgb: [1, 0.78, 0.45], intensity: 0.8, radius: 28, bloom: 0.5, flicker: 0 }, 10);
        punch(ctx, 0.01, 0.2);
        return true;
      },
      tacticalAgain(): boolean {
        if (guardLeft <= 0) return false;
        lower('early');
        return true;
      },
      tacticalActive(): number {
        return guardLeft > 0 ? guardLeft / TUNING.guard.duration : 0;
      },

      /** A hostile shot is eaten if its path this tick crosses the plate's front arc (the whole segment, so nothing tunnels it). */
      intercept(shot: Projectile): boolean {
        if (guardLeft <= 0) return false;
        const g = guardGeom();
        const back = shot.age <= 1 ? 0 : 1; // a shot born this tick has no earlier path
        const ax = shot.x - shot.vx * back, ay = shot.y - shot.vy * back;
        const t = segmentSectorEntry(ax, ay, shot.x, shot.y, g.cx, g.cy, g.dir, TUNING.guard.reach, TUNING.guard.halfArc);
        if (t === null) return false;
        const hx = ax + (shot.x - ax) * t, hy = ay + (shot.y - ay) * t;
        const toward = Math.atan2(hy - g.cy, hx - g.cx);
        clang(Number.isFinite(toward) ? toward : Math.atan2(g.dir.y, g.dir.x), 1.1);
        return true;
      },

      /** Melee and blasts from the front are taken at half: the plate stands between the blow and her. */
      reduceIncoming(amount: number, _source: string | undefined, kx: number, ky: number): number {
        if (guardLeft <= 0) return amount;
        const g = guardGeom();
        const foe = nearestFoe(g);
        const o = blowOrigin(foe, kx, ky);
        if (!o || !blowFromFront(g.dir, TUNING.guard.halfArc, foe, kx, ky)) return amount;
        clang(Math.atan2(o.y, o.x), 1.25);
        return amount * TUNING.guard.frontalTaken;
      },

      // ---------------------------------------------------------------- Pressure Vessel
      onPlayerHurt(lost: number): void {
        if (lost >= 12) spriteEffect('armor_scraps', ctx.player.x, ctx.player.y - 9);
        if (vessel.add(lost)) vent();
      },

      meter(): FighterMeter {
        meterBag.value = vessel.value;
        return meterBag;
      },

      // ---------------------------------------------------------------- Redline (T)
      ultimate(): boolean {
        const r = TUNING.redline;
        const p = ctx.player, c = chest();
        spriteEffect('boiler_flare', c.x, c.y);
        spriteEffect('redline_heat', c.x, c.y - 4);
        sys.setMod('redline', r.duration, { damageTaken: r.damageTaken, staggerResist: true });
        // The ignition: a great gout of steam, a blow of heat, a red flare that stays with her.
        clouds(c.x, c.y, r.ventRadius + 1, 4, r.puffRadius + 0.5, 0.5, r.ventLife + 4);
        sparks(c.x, c.y - 2, 60, 2.4, -Math.PI / 2, Math.PI, SPARK_EMBER, 34);
        wisps(c.x, c.y - 2, 40);
        ctx.audio.sfx('boom.small', p.x, p.y, { gain: 0.7, pitch: -5 });
        ctx.audio.sfx('mat.steam', p.x, p.y, { gain: 1.5, pitch: -3 });
        ctx.audio.sfx('mech.vault', p.x, p.y, { gain: 0.9, pitch: -4 });
        redlineLight = sys.addLight(c.x, c.y, { rgb: [1, 0.3, 0.12], intensity: 1.6, radius: 120, bloom: 1.0, flicker: 0.12 }, r.duration);
        auraK = 1;
        if (!dropAura) dropAura = sys.addDrawable({ layer: 'over', draw: (out, field, c2) => drawRedlineAura(out, field, c2, auraK) });
        punch(ctx, 0.03, 0.8);
        return true;
      },
      ultimateTick(remaining: number): void {
        const r = TUNING.redline;
        const elapsed = r.duration - remaining;
        const c = chest();
        if (redlineLight) {
          redlineLight.x = c.x;
          redlineLight.y = c.y;
        }
        // The aura fades out over the last second.
        auraK = Math.min(1, remaining / 60);
        if (elapsed % r.ventEvery === 0) {
          clouds(c.x, c.y, r.ventRadius, 1, r.puffRadius, r.puffKeep, r.ventLife);
          if (elapsed % (r.ventEvery * 3) === 0) ctx.audio.sfx('mat.steam', c.x, c.y, { gain: 0.8, pitch: fxRandom() * 2 - 3 });
        }
        if (elapsed % r.scaldEvery === 0) scald();
        if (elapsed % 4 === 0) {
          ctx.sparks?.burst(c.x + (fxRandom() - 0.5) * 8, c.y - 6, { count: 5, speed: 0.9, angle: -Math.PI / 2, spread: 0.9, colors: SPARK_EMBER, kind: 'ember', life: 42, glow: 1.1, radius: 2 });
        }
      },
      ultimateEnd(): void {
        sys.clearMod('redline');
        if (dropAura) { dropAura(); dropAura = null; }
        auraK = 0;
        const c = chest();
        // The last of the heat leaves her in a sigh of steam.
        if (ctx.state.mode === 'play' && !ctx.player.dead) {
          puff(c.x, c.y, 6, 0.4, 24);
          ctx.audio.sfx('mat.steam', c.x, c.y, { gain: 0.9, pitch: -4 });
          wisps(c.x, c.y - 4, 20);
        }
        redlineLight = null;
      },

      // ---------------------------------------------------------------- lifecycle and save
      reset(): void {
        clearSpriteEffects();
        lower('reset');
        if (dropAura) { dropAura(); dropAura = null; }
        auraK = 0;
        redlineLight = null;
        // The vent's held footing was a modifier, which a reset clears with the rest; the vessel itself carries on.
        vessel.resist = 0;
        view.flash = 0;
        view.recoil = 0;
      },
      dispose(): void {
        clearSpriteEffects();
        unsub();
        if (dropPlate) { dropPlate(); dropPlate = null; }
        if (dropAura) { dropAura(); dropAura = null; }
      },
      save(): Record<string, number> {
        return { ...vessel.save() };
      },
      load(bag: Record<string, number>): void {
        vessel.load(bag);
        // Re-hold the footing a vent had earned.
        if (vessel.resist > 0) sys.setMod('pressure-vent', vessel.resist, { staggerResist: true });
      },
    };
  },
};
