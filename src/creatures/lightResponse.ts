import type { CreatureLightSense, Ctx, Enemy, EnemyDef } from '@/core/types';
import type { CreatureMind } from './types';
import { LANTERN, LIGHT_RESPONSE, SIGHT } from '@/config/darkness';
import { blocksEntity } from '@/sim/CellType';
import { sightClear } from './perception';

/**
 * CREATURES ANSWER THE LIGHT (light wave). Small, readable rules layered on
 * the per-kind AI, run at tick rate from Enemies.update:
 *
 * - Being lit is information: a creature the aimed beam lands on, with a
 *   clear line to the lantern, knows exactly where the alchemist is.
 * - Photophobes: a Weaver in the beam flinches (crouch, head back) and backs
 *   off — until ~2.5 s of beam in a short window habituates it and it
 *   charges through the light, cranky. A roost the beam touches wakes and
 *   scatters; a bat in flight veers away from it.
 * - The lurker: a Root Loper freezes while the wand's light is on it (its eye
 *   shuts, bark creaks) and creeps faster through the dark when it is not.
 * - Phototaxis: an unaware slime hops toward the beam's lit spot, so the beam
 *   can herd it (into a pit, a pool, a fire).
 * - The Stone Maw is blind: light means nothing to it.
 *
 * No randomness is consumed (the cues use the audio/particle streams only).
 */

const BLIND = new Set<Enemy['kind']>(['stonemaw', 'eggs']);
const BEAM_CONE = 0.5; // radians either side of the aim (the drawn cone is ±0.42)

/** Where on a body the light is read (its eyes, roughly). */
export function lightProbePoint(e: Enemy, def: Pick<EnemyDef, 'h'>): { x: number; y: number } {
  if (e.kind === 'weaver' && e.weaverLoco) return { x: e.weaverLoco.px, y: e.weaverLoco.py };
  return { x: e.x, y: e.y - def.h * 0.6 };
}

function wandTipOf(ctx: Ctx): { x: number; y: number } {
  const p = ctx.player;
  return { x: p.x + Math.cos(p.aimAngle) * 9, y: p.y - 9 + Math.sin(p.aimAngle) * 9 };
}

/** Is a world point inside the aimed beam's cone (ignoring occlusion)? */
export function inBeamCone(ctx: Ctx, x: number, y: number): boolean {
  const tip = wandTipOf(ctx);
  const dx = x - tip.x, dy = y - tip.y;
  if (dx * dx + dy * dy < 16) return true;
  let da = Math.atan2(dy, dx) - ctx.player.aimAngle;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return Math.abs(da) <= BEAM_CONE;
}

/**
 * How visible the alchemist is to eyes, 0 (a hooded shadow in the black) …
 * 1 (a blazing lantern). Unhooded he carries the shipped 0.7 (Torchbearer 1)
 * and a lantern in the dark is a beacon; hooded, only the place's own light
 * shows him, so in an ordinary cave he is dim and in a deep-dark zone he is
 * all but invisible (sight falls to SIGHT.darkRange — close, or by sound).
 */
export function playerVisibility(ctx: Ctx): number {
  const p = ctx.player;
  const torch = p.status.torch > 0 || p.perks?.torchbearer === true;
  const base = torch ? SIGHT.torch : SIGHT.lantern;
  const q = ctx.lightQuery;
  if (!q) return base;
  const dark = q.darkness(p.x, p.y - 9);
  if (!q.hooded) return Math.min(1, base + SIGHT.beacon * dark);
  // The Velvet Hood boon lines the brass hood: the dark drinks more of the spill, so half-dark hides
  // like deep dark. A lamp-lit room (darkness 0) still lights the alchemist exactly as before.
  const shade = 1 - Math.min(1, dark * (p.perks?.velvethood ? SIGHT.velvet : 1));
  return base * shade * shade;
}

function senseOf(e: Enemy): CreatureLightSense {
  return (e.lightSense ??= { wand: 0, beam: false, litT: 0, habit: 0, cd: 0, frozen: 0 });
}

/** The spot the aimed beam lands on (cached per tick): a raycast through real cells. */
let spotTick = -1;
const spot = { x: 0, y: 0, ok: false };
export function beamSpot(ctx: Ctx): { x: number; y: number; ok: boolean } {
  if (spotTick === ctx.state.frameCount) return spot;
  spotTick = ctx.state.frameCount;
  spot.ok = false;
  if (ctx.player.dead || ctx.lightQuery?.hooded !== false) return spot;
  const tip = wandTipOf(ctx), a = ctx.player.aimAngle, cx = Math.cos(a), cy = Math.sin(a), w = ctx.world;
  for (let d = 2; d < 170; d++) {
    const x = Math.floor(tip.x + cx * d), y = Math.floor(tip.y + cy * d);
    if (!w.inBounds(x, y)) return spot;
    if (blocksEntity(w.types[w.idx(x, y)])) {
      spot.x = tip.x + cx * (d - 1); spot.y = tip.y + cy * (d - 1); spot.ok = true;
      return spot;
    }
  }
  return spot;
}

/**
 * Sense the lantern and answer it (called right after the mind ticks, before
 * the per-kind branch). Mutates the mind (a lit fix) and the kind's own
 * reflex fields (Weaver flinch/retreat, bat flee, Root Loper freeze).
 */
export function respondToLight(ctx: Ctx, e: Enemy, def: EnemyDef, mind: CreatureMind): void {
  const q = ctx.lightQuery;
  const s = senseOf(e);
  if (s.cd > 0) s.cd--;
  if (!q || BLIND.has(e.kind) || ctx.player.dead) {
    s.wand = 0; s.beam = false; s.litT = 0; s.frozen = 0;
    return;
  }
  const at = lightProbePoint(e, def);
  const wasBeam = s.beam;
  s.wand = q.wandLight(at.x, at.y);
  s.beam = s.wand >= LANTERN.beamOn && inBeamCone(ctx, at.x, at.y);
  s.litT = s.wand >= LANTERN.beamOn ? s.litT + 1 : 0;
  s.habit = s.beam ? s.habit + 1 : Math.max(0, s.habit - LIGHT_RESPONSE.habitLeak);
  const p = ctx.player;
  const tick = ctx.state.frameCount;

  // THE CATCH: the beam finds a pair of eyes in the dark — a small glassy
  // glint as they flash back (render/creatures/eyeshine draws the flash; the
  // event is the sound's: audio/EventCues).
  if (s.beam && !wasBeam && !e.sleeping && tick - (s.glintAt ?? -999) > 50 && q.darkness(at.x, at.y) >= 0.5) {
    s.glintAt = tick;
    ctx.events?.emit('eyeshineCaught', { kind: e.kind, x: at.x, y: at.y });
  }

  // BEING LIT IS INFORMATION: a creature looking down the beam sees the lantern.
  // (Not during the arrival's grace, game/arrival: while a floor's name is up nothing sees him.)
  if (s.beam && s.wand >= SIGHT.litFix && !e.sleeping && !(tick < (ctx.state.arrivalGraceUntil ?? -1))) {
    const tip = wandTipOf(ctx);
    if (sightClear(ctx.world, at.x, at.y, tip.x, tip.y)) {
      mind.visible = true;
      // (a fighter's decoy, Mirror Hunt: a foe that was drawn to an echo finds the lantern on the echo, not on her)
      const lure = ctx.fighters && ctx.fighters.id !== null ? ctx.fighters.decoyFor(e) : null;
      mind.targetX = lure ? lure.x : p.x; mind.targetY = lure ? lure.y : p.y; mind.targetVx = lure ? lure.vx : p.vx;
      mind.lastSeen = ctx.state.frameCount;
      mind.confidence = Math.max(mind.confidence, 0.75);
    }
  }

  switch (e.kind) {
    case 'weaver': {
      const dist = Math.hypot(p.x - e.x, p.y - e.y);
      if (!s.beam || e.sleeping || s.wand < LIGHT_RESPONSE.flinchAt || dist < 26) break;
      if ((e.cranky ?? 0) > 0) break; // an angry Weaver comes through the light
      if (s.habit >= LIGHT_RESPONSE.weaverHabit) {
        // Habituated: the light stops frightening it and starts annoying it.
        e.cranky = Math.max(e.cranky ?? 0, 150);
        s.habit = 0;
        ctx.audio.at?.(e.x, e.y, () => ctx.audio.chitin?.(1.3), 260);
        break;
      }
      if (s.cd > 0) break;
      // The flinch: the body drops into a crouch, the head snaps back from the
      // glare and it backs away from the lantern.
      e.weaverFlinchT = Math.max(e.weaverFlinchT ?? 0, LIGHT_RESPONSE.weaverFlinch);
      e.weaverRetreatT = Math.max(e.weaverRetreatT ?? 0, LIGHT_RESPONSE.weaverRetreat);
      e.windup = 0; e.blink = 0;
      e.weaverHeadVX = (e.weaverHeadVX ?? 0) - Math.sign(p.x - e.x || 1) * 1.6;
      e.weaverHeadVY = (e.weaverHeadVY ?? 0) - 0.8;
      s.cd = LIGHT_RESPONSE.weaverCooldown;
      ctx.audio.at?.(e.x, e.y, () => ctx.audio.chitin?.(0.8), 240);
      break;
    }
    case 'bat': {
      if (s.wand < LIGHT_RESPONSE.flinchAt || !s.beam) break;
      if (s.habit > LIGHT_RESPONSE.weaverHabit * 1.6) break; // a starving bat stops caring
      if (e.sleeping) {
        // The roost wakes: every sleeper near this one drops and scatters
        // (a burst of wings: the organism event's sound, audio/EventCues).
        for (const o of ctx.enemies) {
          if (o.kind !== 'bat' || !o.sleeping || Math.abs(o.x - e.x) > 40 || Math.abs(o.y - e.y) > 30) continue;
          o.sleeping = false;
          o.vy = 1.1;
          o.fear = 1;
          o.fleeT = LIGHT_RESPONSE.batScatter;
          o.fleeDir = Math.sign(o.x - p.x || 1);
          o.alerted = true;
        }
        ctx.events?.emit('organism', { kind: 'bat', action: 'scatter', x: e.x, y: e.y });
        s.cd = 30;
        break;
      }
      if (s.cd > 0) break;
      // In flight: flinch out of the dive and veer off.
      e.windup = 0; e.swoop = 0;
      e.fear = Math.max(e.fear ?? 0, 0.95);
      e.fleeT = Math.max(e.fleeT ?? 0, 30);
      e.fleeDir = Math.sign(e.x - p.x || 1);
      e.vy -= 0.6;
      s.cd = 40;
      ctx.audio.at?.(e.x, e.y, () => ctx.audio.squeak?.(), 220);
      break;
    }
    case 'rootloper': {
      const lit = s.wand >= LIGHT_RESPONSE.lurkerFreeze && !e.sleeping && (e.rootPanic ?? 0) <= 0;
      if (lit) {
        if (s.frozen <= 0) ctx.audio.at?.(e.x, e.y, () => ctx.audio.creak?.(0.9), 240);
        s.frozen = LIGHT_RESPONSE.lurkerHold;
        if ((e.rootLashT ?? 0) <= 0) e.windup = 0;
      } else if (s.frozen > 0) {
        s.frozen--;
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Motion answers, after the per-kind branch has decided this tick's velocity
 * (and before the threat reflexes override it).
 */
export function lightMotion(ctx: Ctx, e: Enemy, targetAlive: boolean): void {
  const s = e.lightSense;
  const q = ctx.lightQuery;
  if (!s || !q) return;
  if (e.kind === 'rootloper') {
    if (s.frozen > 0) {
      // Still as wood while you watch it.
      e.vx = 0;
      e.fx = 0;
    } else if (targetAlive && q.darkness(e.x, e.y - 8) >= 0.5 && s.wand < LANTERN.beamOn) {
      // …and quicker than it should be when you look away.
      e.vx *= LIGHT_RESPONSE.lurkerCreep;
    }
    return;
  }
  if ((e.kind === 'slime' || e.kind === 'acidslime') && !targetAlive && e.grounded) {
    const at = beamSpot(ctx);
    if (!at.ok) return;
    const dx = at.x - e.x, dy = at.y - e.y;
    if (dx * dx + dy * dy > LIGHT_RESPONSE.slimeLure * LIGHT_RESPONSE.slimeLure || Math.abs(dx) < 6) return;
    if (!sightClear(ctx.world, e.x, e.y - 4, at.x, at.y)) return;
    // Drawn to the light: gather more often, and every hop leans toward it.
    if (!e.windup && e.timer % 38 === 0) e.windup = 9;
    if (e.vy <= -2.2) e.vx = Math.sign(dx) * (1.4 + Math.min(1, Math.abs(dx) / 80));
  }
}
