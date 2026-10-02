import type { FighterDrawable, FighterMeter } from '@/core/fighters';
import type { Enemy } from '@/core/types';
import { sightClear } from '@/creatures/perception';
import { aimOf, castToSolid, punch, shoulderOf } from '@/fighters/effects';
import type { FighterSystem } from '@/fighters/FighterSystem';
import type { FighterKitDef, KitInstance } from '@/fighters/kit';
import {
  drawBellBodies, drawBellRings, drawRipples, drawTolled, drawWave, WAVE_SHOWN,
} from '@/fighters/kits/mara-quell-draw';
import type { ChimeWave, Tolled } from '@/fighters/kits/mara-quell-draw';
import {
  BellBook, PURPLE, RippleBook, TUNING, aimDistance, chimeEffectFor, findBellSpot, lineOpen, makesFootfalls,
  newFootTrack, ripplePower, stepFoot, waveRadius, within,
} from '@/fighters/kits/mara-quell-logic';
import type { Bell, BellSpot, FootTrack, SpotProbe } from '@/fighters/kits/mara-quell-logic';
import { blocksEntity, isLiquid } from '@/sim/CellType';

export { TUNING } from '@/fighters/kits/mara-quell-logic';

/**
 * MARA QUELL, the Bell Witch (Controller): docs/FIGHTERS.md and docs/fighters/mara-quell.md.
 *
 *  - Keen Resonance (passive): foes that walk, climb or land within 200 cells and out of her sight line
 *    leave a faint violet ripple at their feet every 14 ticks while they move, drawn through rock;
 *    nearer is brighter. Information only: it changes nothing but what she can see.
 *  - Resonance Bell (Z): a brass bell on a bracket, hung on the open spot nearest the aim (within 70
 *    cells), two at most (a third retires the oldest), 30 s. When a waking foe comes within 70 cells of
 *    it, it rings: every foe within 100 cells is shown in violet for 4 s, with a ring of light; it is deaf
 *    for 6 s after. Bells are the kit's own (never written into the level) and are cleared with it.
 *  - Dead Chime (T): a wave out from her (150 cells over about 20 ticks, drawn through rock) that slows
 *    every foe it reaches x0.45 for 6 s, stuns casters and machines for 3 s and rings hostile shots out
 *    of the air. It never touches a mechanism, a boss or an egg clutch.
 */

/** A drawable the probe can reach into (the game only ever calls `layer` and `draw`). */
interface TaggedDrawable extends FighterDrawable {
  readonly tag: string;
  readonly state: unknown;
}

const VIOLET = [0xa060ff, 0xd0a8ff, 0xffffff, 0x8040e0] as const;
const BRASS_BITS = [0xe8b64a, 0xffd98a, 0xa87420, 0x6a4a18] as const;

export const kit: FighterKitDef = {
  id: 'mara-quell',
  tacticalCooldown: TUNING.bell.cooldown,
  ultimateDuration: TUNING.chime.duration,
  create(sys: FighterSystem): KitInstance {
    const ctx = sys.ctx;
    // (Not `ctx.world` held here: every floor is its own World and the Ctx points at the one that is current.)
    const meterBag: FighterMeter = { label: 'Bells', value: 0, max: TUNING.bell.max };
    const ripples = new RippleBook();
    const bells = new BellBook();
    let tracks = new WeakMap<Enemy, FootTrack>();
    let lastPing = -100000;

    let wave: (ChimeWave & { stepping: boolean; tinks: number; shots: number }) | null = null;
    const reached = new Set<Enemy>();
    const tolled: Tolled[] = [];
    let naturalEnd = false;

    // ---- drawables: the bells' and the chime's are registered when there is something to show and dropped when there is
    // not; the ripples' stays for as long as she does. A floor change or a death removes them all (after `reset()` has
    // forgotten the handles), and the next tick puts back what is still needed. ----
    let dropRipples: (() => void) | null = null;
    let dropBodies: (() => void) | null = null;
    let dropRings: (() => void) | null = null;
    let dropChime: (() => void) | null = null;

    const ensureRipples = (): void => {
      if (dropRipples) return;
      const d: TaggedDrawable = { layer: 'over', tag: 'mara.ripples', state: ripples, draw: (out, _f, c) => drawRipples(out, c, ripples) };
      dropRipples = sys.addDrawable(d);
    };
    const ensureBells = (): void => {
      if (!dropBodies) {
        const d: TaggedDrawable = { layer: 'under', tag: 'mara.bells', state: bells, draw: (out, f, c) => drawBellBodies(out, f, c, bells.bells) };
        dropBodies = sys.addDrawable(d);
      }
      if (!dropRings) {
        const d: TaggedDrawable = { layer: 'over', tag: 'mara.rings', state: bells, draw: (out, _f, c) => drawBellRings(out, c, bells.bells) };
        dropRings = sys.addDrawable(d);
      }
    };
    const ensureChime = (): void => {
      if (dropChime) return;
      const d: TaggedDrawable = {
        layer: 'over', tag: 'mara.chime', state: { get wave() { return wave; }, tolled },
        draw: (out, _f, c) => {
          if (wave) drawWave(out, c, wave);
          if (tolled.length > 0) drawTolled(out, c, tolled);
        },
      };
      dropChime = sys.addDrawable(d);
    };
    const dropAll = (): void => {
      for (const drop of [dropRipples, dropBodies, dropRings, dropChime]) drop?.();
      dropRipples = dropBodies = dropRings = dropChime = null;
    };

    // ---- small helpers ----
    const centreOf = (e: Enemy): { x: number; y: number } => {
      const def = ctx.enemyCtl.defs[e.kind];
      return { x: e.x, y: e.y - (def ? def.h * 0.5 : 5) };
    };

    const sparks = (x: number, y: number, count: number, speed: number, colors: readonly number[], life = 26, radius = 2, angle?: number, spread?: number): void => {
      ctx.sparks?.burst(x, y, { count, speed, colors, kind: 'magic', glow: 1.3, radius, life, ...(angle !== undefined ? { angle, spread } : {}) });
    };

    // ======================================================================================= Keen Resonance
    const listen = (now: number): void => {
      const R = TUNING.resonance;
      const p = ctx.player;
      const ex = p.x, ey = p.y - 9;
      const defs = ctx.enemyCtl.defs;
      // The ripples' drawable stays for as long as she does (a floor change takes it; this puts it back).
      ensureRipples();
      ripples.prune(now);
      for (const e of ctx.enemies) {
        if (e.hp <= 0 || e.sleeping === true || !makesFootfalls(e.kind)) continue;
        const dx = e.x - ex;
        if (dx > R.range || dx < -R.range) continue;
        const def = defs[e.kind];
        const dy = e.y - (def ? def.h * 0.5 : 5) - ey;
        const d2 = dx * dx + dy * dy;
        if (d2 > R.range * R.range) continue;
        const onSurface = e.grounded || (e.kind === 'weaver' && (e.weaverFallT ?? 0) <= 0);
        const t = tracks.get(e);
        if (!t) {
          tracks.set(e, newFootTrack(e.x, e.y, onSurface));
          continue;
        }
        const ev = stepFoot(t, e.x, e.y, onSurface);
        if (ev === null) continue;
        // Only what she cannot see: a foe in plain sight needs no ripple.
        if (sightClear(ctx.world, ex, ey, e.x, e.y - 5)) continue;
        const power = ripplePower(Math.sqrt(d2));
        ripples.add(e.x, e.y, now, power, ev === 'land');
        // A faint ping the first time a stranger starts walking behind the rock, so the ear learns what the eye will see.
        if (now - t.last > R.newAfter && now - lastPing >= R.pingGap) {
          lastPing = now;
          ctx.audio.sfx('pickup.bell', e.x, e.y, { gain: R.pingGain * power, pitch: 14 });
        }
        t.last = now;
      }
    };

    // ======================================================================================== Resonance Bell
    const probe: SpotProbe = {
      solid: (x, y) => {
        const w = ctx.world;
        return !w.inBounds(x, y) || blocksEntity(w.types[w.idx(x, y)]);
      },
      open: (x, y) => {
        const w = ctx.world;
        if (!w.inBounds(x, y)) return false;
        const t = w.types[w.idx(x, y)];
        return !blocksEntity(t) && !isLiquid(t);
      },
    };

    /** The open place nearest where she aims, within 70 cells of her, in sight of the aim; her own feet when there is none. */
    const chooseSpot = (): BellSpot | null => {
      const B = TUNING.bell;
      const p = ctx.player;
      const sh = shoulderOf(ctx);
      const aim = aimOf(ctx);
      const side: 1 | -1 = p.facing < 0 ? -1 : 1;
      const cursor = Math.hypot(ctx.input.mouse.x - sh.x, ctx.input.mouse.y - sh.y);
      const reach = aimDistance(cursor);
      const atFeet = cursor < B.feetRadius;
      const aimed = atFeet ? { x: p.x + side * 5, y: p.y - 7 } : castToSolid(ctx, sh.x, sh.y, aim.x, aim.y, reach);
      const find = (tx: number, ty: number): BellSpot | null => findBellSpot(probe, tx, ty, {
        search: B.search,
        prefSide: side,
        accept: (s) => Math.hypot(s.cx - p.x, s.cy - (p.y - 9)) <= B.reach && lineOpen(probe, tx, ty, s.cx, s.cy),
      });
      return find(aimed.x, aimed.y) ?? (atFeet ? null : find(p.x + side * 5, p.y - 7));
    };

    const farewell = (b: Bell, why: 'replaced' | 'expired' | 'fell'): void => {
      if (why === 'fell') {
        ctx.audio.sfx('body.impact.metal', b.cx, b.cy, { gain: 0.55, pitch: -3 });
        sparks(b.cx, b.cy + 2, 12, 1.1, BRASS_BITS, 26, 3, Math.PI / 2, 1.2);
      } else {
        // The bell is let go: a low note as it fades, a puff of violet where it hung.
        ctx.audio.sfx('pickup.bell', b.cx, b.cy, { gain: 0.42, pitch: -7 });
        sparks(b.cx, b.cy, 12, 0.7, VIOLET, 30, 3);
      }
    };

    const ring = (b: Bell, now: number): void => {
      const B = TUNING.bell;
      bells.ring(b, now);
      for (const e of ctx.enemies) {
        if (e.hp <= 0) continue;
        const c = centreOf(e);
        if (within(b, c.x, c.y, B.revealRadius)) sys.revealEnemy(e, B.revealTicks, PURPLE);
      }
      ctx.audio.sfx('pickup.bell', b.cx, b.cy, { gain: 1.0, pitch: -1 });
      ctx.audio.sfx('world.gong', b.cx, b.cy, { gain: 0.24, pitch: 7 });
      sys.addLight(b.cx, b.cy, { rgb: PURPLE, intensity: 1.5, radius: B.revealRadius, bloom: 0.9, flicker: 0 }, B.lightTicks);
      sparks(b.cx, b.cy, 16, 1.5, VIOLET, 28, 2);
    };

    const supported = (b: Bell): boolean => (b.mode === 'post' ? probe.solid(b.x, b.y + 1) : probe.solid(b.x, b.y - 1));

    const tickBells = (now: number): void => {
      const B = TUNING.bell;
      for (const b of bells.tick(now)) farewell(b, 'expired');
      const all = bells.bells;
      // A bell hangs from real terrain: when the floor under its post or the rock over its chain is dug or burned away, it comes down.
      if (now % B.supportEvery === 0) {
        for (let i = 0; i < all.length; i++) {
          const b = all[i];
          if (b.retiredAt >= 0 || supported(b)) continue;
          bells.retire(b, now);
          farewell(b, 'fell');
        }
      }
      for (let i = 0; i < all.length; i++) {
        const b = all[i];
        if (b.retiredAt >= 0) continue;
        if (!bells.listening(b, now)) {
          // Deaf: it begins to listen again with a small bright note.
          if (now === b.rearmAt && b.rungAt > 0) ctx.audio.sfx('pickup.bell', b.cx, b.cy, { gain: 0.16, pitch: 14 });
          continue;
        }
        for (const e of ctx.enemies) {
          if (e.hp <= 0 || e.sleeping === true || e.kind === 'eggs') continue;
          const c = centreOf(e);
          if (within(b, c.x, c.y, B.triggerRadius)) {
            ring(b, now);
            break;
          }
        }
      }
      if (bells.bells.length === 0) {
        dropBodies?.();
        dropRings?.();
        dropBodies = dropRings = null;
      }
    };

    // ========================================================================================== Dead Chime
    const strikeFoe = (e: Enemy, now: number, w2: NonNullable<typeof wave>): void => {
      const C = TUNING.chime;
      const fx = chimeEffectFor(e.kind);
      if (!fx.slow && !fx.stun) return;
      if (fx.slow) sys.slowEnemy(e, C.slowFactor, C.slowTicks);
      if (fx.stun) sys.stunEnemy(e, C.stunTicks);
      tolled.push({ e, slowUntil: fx.slow ? now + C.slowTicks : 0, stunUntil: fx.stun ? now + C.stunTicks : 0 });
      const c = centreOf(e);
      sparks(c.x, c.y, fx.stun ? 12 : 7, 0.9, VIOLET, 22, 3);
      if (w2.tinks < 4) {
        w2.tinks++;
        ctx.audio.sfx('pickup.bell', e.x, e.y, { gain: 0.34, pitch: 9 + w2.tinks });
      }
    };

    const stepWave = (now: number): void => {
      const wv = wave;
      if (!wv || !wv.stepping) return;
      const elapsed = now - wv.born;
      const r = waveRadius(elapsed + 1);
      const r2 = r * r;
      for (const e of ctx.enemies) {
        if (e.hp <= 0 || reached.has(e)) continue;
        const c = centreOf(e);
        const dx = c.x - wv.x, dy = c.y - wv.y;
        if (dx * dx + dy * dy > r2) continue;
        reached.add(e);
        strikeFoe(e, now, wv);
      }
      const shots = ctx.projectiles;
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        if (!s.hostile) continue;
        const dx = s.x - wv.x, dy = s.y - wv.y;
        if (dx * dx + dy * dy > r2) continue;
        // Rung out of the air: removed in place (the array is shared), a violet puff where it was.
        const last = shots.length - 1;
        if (i !== last) shots[i] = shots[last];
        shots.pop();
        sparks(s.x, s.y, 6, 0.8, VIOLET, 18, 1);
        if (wv.shots++ < 3) ctx.audio.sfx('pickup.bell', s.x, s.y, { gain: 0.3, pitch: 12 + wv.shots });
      }
      if (elapsed >= TUNING.chime.expandTicks) wv.stepping = false;
    };

    const tickChime = (now: number): void => {
      if (wave && now - wave.born > WAVE_SHOWN) wave = null;
      for (let i = tolled.length - 1; i >= 0; i--) {
        const t = tolled[i];
        if (t.e.hp <= 0 || now >= Math.max(t.slowUntil, t.stunUntil)) tolled.splice(i, 1);
      }
      if (!wave && tolled.length === 0 && dropChime) {
        dropChime();
        dropChime = null;
        reached.clear();
      }
    };

    // ====================================================================================== the kit proper
    const wipe = (): void => {
      bells.clear();
      ripples.clear();
      tracks = new WeakMap<Enemy, FootTrack>();
      wave = null;
      tolled.length = 0;
      reached.clear();
      naturalEnd = false;
      dropAll();
    };

    return {
      tick(): void {
        const now = ctx.state.frameCount;
        listen(now);
        if (bells.bells.length > 0) tickBells(now);
        if (wave || tolled.length > 0) tickChime(now);
      },

      // ---------------------------------------------------------------- Resonance Bell (Z)
      tactical(): boolean {
        const now = ctx.state.frameCount;
        const p = ctx.player;
        const spot = chooseSpot();
        if (!spot) {
          // No open place within reach: nothing is spent, and she is told so.
          ctx.audio.sfx('tk.fizzle', p.x, p.y, { gain: 0.7 });
          sparks(p.x, p.y - 12, 6, 0.6, VIOLET, 18, 2, -Math.PI / 2, 1.2);
          return false;
        }
        const { bell, retired } = bells.place(spot, now);
        ensureBells();
        if (retired) farewell(retired, 'replaced');
        // The bracket takes the bell: iron seats, brass answers, a pulse of violet.
        ctx.audio.sfx('mech.latch', bell.cx, bell.cy, { gain: 0.9, pitch: -2 });
        ctx.audio.sfx('pickup.bell', bell.cx, bell.cy, { gain: 0.55, pitch: 5, delay: 0.05 });
        sparks(bell.cx, bell.cy, 10, 0.9, VIOLET, 22, 2);
        sys.addLight(bell.cx, bell.cy, { rgb: PURPLE, intensity: 0.8, radius: 30, bloom: 0.5, flicker: 0 }, 16);
        punch(ctx, 0.006, 0.15);
        return true;
      },

      // ---------------------------------------------------------------- Dead Chime (T)
      ultimate(): boolean {
        const now = ctx.state.frameCount;
        const c = shoulderOf(ctx);
        const C = TUNING.chime;
        wave = { x: c.x, y: c.y, born: now, stepping: true, tinks: 0, shots: 0 };
        reached.clear();
        naturalEnd = false;
        ensureChime();
        ctx.audio.sfx('world.gong', c.x, c.y, { gain: 0.85, pitch: -3 });
        ctx.audio.sfx('pickup.bell', c.x, c.y, { gain: 1.1, pitch: -2 });
        ctx.audio.sfx('pickup.bell', c.x, c.y, { gain: 0.6, pitch: 5, delay: 0.09 });
        sys.addLight(c.x, c.y, { rgb: [0.78, 0.58, 1], intensity: 1.9, radius: C.radius, bloom: 1.1, flicker: 0 }, C.lightTicks);
        sparks(c.x, c.y, 40, 2.4, VIOLET, 30, 3);
        punch(ctx, 0.03, 0.9);
        return true;
      },
      ultimateTick(remaining: number): void {
        naturalEnd = remaining <= 1;
        stepWave(ctx.state.frameCount);
      },
      ultimateEnd(): void {
        // The effect has run its six seconds: one low note, and the marks on the foes are already gone.
        if (naturalEnd && ctx.state.mode === 'play' && !ctx.player.dead) {
          const p = ctx.player;
          ctx.audio.sfx('pickup.bell', p.x, p.y, { gain: 0.3, pitch: -9 });
        }
        naturalEnd = false;
        if (wave) wave.stepping = false;
      },

      meter(): FighterMeter {
        meterBag.value = bells.count();
        return meterBag;
      },

      reset(): void {
        wipe();
      },
      dispose(): void {
        wipe();
      },
    };
  },
};
