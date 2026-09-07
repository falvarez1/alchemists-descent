import type { Ctx, Enemy, FinisherPhase, TrickshotRuntime } from '@/core/types';
import { packRGB } from '@/sim/colors';

/**
 * The combat time director.
 *
 * Two things borrow time here and they must never multiply: the chain
 * slow-motion (a post-contact beat after a kill, a sever, or hits on distinct
 * enemies) and the humiliation finisher, which is a DIRECTED sequence with
 * phases — approach, impact, release — driven by contact, not by a timer that
 * kills the creature before the leg lands. Presentation time owns all of it:
 * pause spends none of it, and the material/AI/physics systems still take
 * unchanged fixed-size ticks at whatever rate the clock allows.
 */

const FINISHER_APPROACH_SCALE = 0.25;
/** A stale opportunity expires here; the world is never held slow indefinitely. */
const FINISHER_APPROACH_BUDGET_MS = 1100;
const FINISHER_RELEASE_MS = 180;
const FINISHER_TRAIL = 14;
const FINISHER_ZOOM = 1.06;
const FINISHER_LEAN_CELLS = 22;
const FINISHER_VIGNETTE_LIFT = 0.16;

function runtime(ctx: Ctx): TrickshotRuntime {
  return ctx.fx.trickshot ??= { remainingMs: 0, elapsedMs: 0, scale: 1, chainMs: 0, chain: 0,
    seen: new Set(), label: '', labelMs: 0, continuousMs: 0, recoveryMs: 0,
    phase: 'idle', phaseMs: 0, target: null, trail: [] };
}

/** The vignette this window had before a finisher lifted it; restored on every exit path. */
let vignetteBase: number | null = null;
/** True once a finisher has written framing, so nothing is reset that was never touched. */
let presenting = false;

function endFinisherPresentation(ctx: Ctx): void {
  if (!presenting) return;
  presenting = false;
  const camera = ctx.camera;
  camera.cineDx = 0;
  camera.cineDy = 0;
  camera.cineZoom = 1;
  if (vignetteBase !== null) {
    ctx.state.postFx.vignette = vignetteBase;
    vignetteBase = null;
  }
}

/** Ease the frame toward the victim while the beat lasts; ease home during release. */
function updateFinisherPresentation(ctx: Ctx, r: TrickshotRuntime): void {
  presenting = true;
  const target = r.target;
  const p = ctx.player;
  const strength = r.phase === 'release' ? 1 - Math.min(1, r.phaseMs / FINISHER_RELEASE_MS) : Math.min(1, r.phaseMs / 140);
  const motion = ctx.state.trickshot?.cameraMotion === true && !ctx.state.reduceCameraShake;
  const camera = ctx.camera;
  if (motion && target) {
    const tx = target.weaverLoco?.px ?? target.x;
    const ty = target.weaverLoco?.py ?? target.y - 7;
    const lean = (v: number): number => Math.max(-FINISHER_LEAN_CELLS, Math.min(FINISHER_LEAN_CELLS, v * 0.35));
    camera.cineDx = lean(tx - p.x) * strength;
    camera.cineDy = lean(ty - (p.y - 9)) * strength;
    camera.cineZoom = 1 + (FINISHER_ZOOM - 1) * strength;
  } else {
    camera.cineDx = 0;
    camera.cineDy = 0;
    camera.cineZoom = 1;
  }
  if (!ctx.state.reduceFlashes) {
    vignetteBase ??= ctx.state.postFx.vignette;
    ctx.state.postFx.vignette = vignetteBase + FINISHER_VIGNETTE_LIFT * strength;
  }
  // The knee's recent path: the brass trail the overlay draws.
  const knee = p.legClub?.rig?.knee;
  if (knee && r.phase !== 'release') {
    const last = r.trail[r.trail.length - 1];
    if (!last || Math.hypot(knee.x - last.x, knee.y - last.y) > 0.6) {
      r.trail.push({ x: knee.x, y: knee.y });
      if (r.trail.length > FINISHER_TRAIL) r.trail.shift();
    }
  } else if (r.trail.length > 0 && r.phaseMs > 60) {
    r.trail.shift();
  }
}

/** Presentation time owns the short dramatic beat. Pausing never spends it,
 * and the material/AI/physics systems still take unchanged fixed-size ticks. */
export function advanceTrickshotClock(ctx: Ctx, elapsedMs: number): number {
  if (!ctx.state.trickshot?.enabled || ctx.player.dead || ctx.state.mode !== 'play') {
    // Death and transitions cancel everything, including the framing.
    if (ctx.fx.trickshot) endFinisherPresentation(ctx);
    ctx.fx.trickshot = undefined; return 1;
  }
  const r = ctx.fx.trickshot;
  if (!r) return 1;
  if (ctx.state.paused || ctx.time?.manual) return 1;
  const dt = Math.max(0, Math.min(100, elapsedMs));
  r.remainingMs = Math.max(0, r.remainingMs - dt); r.elapsedMs += dt;
  r.labelMs = Math.max(0, r.labelMs - dt); r.chainMs = Math.max(0, r.chainMs - dt);
  r.recoveryMs = Math.max(0, r.recoveryMs - dt);
  if (r.chainMs === 0) { r.chain = 0; r.seen.clear(); }
  if (r.remainingMs > 0) {
    r.continuousMs += dt;
    if (r.continuousMs >= 4000) { r.remainingMs = 0; r.recoveryMs = 600; }
  } else r.continuousMs = 0;
  const envelope = Math.min(1, r.elapsedMs / 75, r.remainingMs / 180);
  const chainScale = 1 - (1 - r.scale) * Math.max(0, envelope);

  // The finisher's phases run on the same real-time clock.
  let phaseScale = 1;
  if (r.phase !== 'idle') {
    r.phaseMs += dt;
    if (r.phase === 'approach') {
      phaseScale = FINISHER_APPROACH_SCALE;
      if (r.phaseMs > FINISHER_APPROACH_BUDGET_MS || !r.target || r.target.hp <= 0) missFinisher(ctx);
    } else if (r.phase === 'impact') {
      phaseScale = FINISHER_APPROACH_SCALE;
      if (r.phaseMs >= (ctx.state.trickshot.impactPauseMs ?? 50)) { r.phase = 'release'; r.phaseMs = 0; }
    }
    if (r.phase === 'release') {
      const t = Math.min(1, r.phaseMs / FINISHER_RELEASE_MS);
      // Smooth return, never a snap.
      phaseScale = FINISHER_APPROACH_SCALE + (1 - FINISHER_APPROACH_SCALE) * (t * t * (3 - 2 * t));
      if (t >= 1) {
        r.phase = 'idle'; r.phaseMs = 0; r.target = null; r.trail.length = 0;
        endFinisherPresentation(ctx);
        return Math.min(chainScale, 1);
      }
    }
    updateFinisherPresentation(ctx, r);
  }
  // Slowdowns never multiply: the deeper of the two wins.
  return Math.min(chainScale, phaseScale);
}

export function recordTrickshot(ctx: Ctx, enemy: Enemy, kind: 'hit' | 'kill' | 'sever' | 'finish'): void {
  const settings = ctx.state.trickshot;
  if (!settings?.enabled || ctx.player.dead || ctx.state.mode !== 'play') return;
  const r = runtime(ctx), fresh = !r.seen.has(enemy);
  if (!fresh && kind === 'hit') return; // one victim cannot farm a chain
  if (fresh) { r.seen.add(enemy); r.chain++; }
  r.chainMs = settings.chainWindowMs;
  const dramatic = kind !== 'hit' || r.chain >= 2;
  r.label = kind === 'finish' ? 'RETURNED WITH INTEREST' : kind === 'sever' ? 'LEG ON LOAN' : r.chain > 1 ? `${r.chain} TARGET CHAIN` : 'CLEAN HIT';
  r.labelMs = kind === 'finish' ? 2100 : 1100;
  if (dramatic && r.recoveryMs === 0) {
    r.remainingMs = Math.max(r.remainingMs, settings.durationMs * (kind === 'finish' ? 1.35 : 1));
    r.elapsedMs = 0;
    r.scale = kind === 'finish' ? Math.max(.2, settings.timeScale * .75) : settings.timeScale;
  }
  ctx.telemetry.count(`trickshot.${kind}`);
}

export function canHumiliate(ctx: Ctx, enemy: Enemy): boolean {
  const owner = ctx.player.legClub?.owner;
  return ctx.state.trickshot?.enabled === true && enemy.kind === 'weaver' && enemy.hp > 0 &&
    enemy.hp <= Math.min(40, enemy.maxHp * .3) && !!owner && owner === enemy.weaverSalvageId;
}

export function finisherPhase(ctx: Ctx): FinisherPhase {
  return ctx.fx.trickshot?.phase ?? 'idle';
}

/**
 * The wizard commits the wrist stroke at a recognized opportunity: time eases
 * toward a quarter speed for the approach, the ambience ducks under a rising
 * whip, and the creature recoils — it knows that leg. Nothing here guarantees
 * the hit: contact drives the phase change, and a miss just costs the moment.
 */
export function beginFinisher(ctx: Ctx, enemy: Enemy): void {
  const settings = ctx.state.trickshot;
  if (!settings?.enabled || !settings.finisher || ctx.player.dead || ctx.state.mode !== 'play') return;
  const r = runtime(ctx);
  if (r.phase !== 'idle' || r.recoveryMs > 0) return;
  r.phase = 'approach'; r.phaseMs = 0; r.target = enemy; r.trail.length = 0;
  // A recoil, not an escape: a quarter-second crouched back-step, legs drawn in.
  // Longer and the victim would simply leave the reach it was recognized in.
  enemy.weaverFlinchT = Math.max(enemy.weaverFlinchT ?? 0, 26);
  enemy.weaverRetreatT = Math.max(enemy.weaverRetreatT ?? 0, 14);
  enemy.windup = 0; enemy.blink = 0;
  ctx.audio.finisherWhip();
  ctx.audio.duck(0.45, 700);
  ctx.telemetry.count('trickshot.finisherStart');
}

/** Only a swept contact confirms the finisher: hit pause, the cue, and the release beat. */
export function confirmFinisher(ctx: Ctx, enemy: Enemy, x: number, y: number, dirX: number, dirY: number): void {
  const r = runtime(ctx);
  if (r.phase !== 'approach' || r.target !== enemy) return;
  r.phase = 'impact'; r.phaseMs = 0;
  const pauseMs = ctx.state.trickshot?.impactPauseMs ?? 50;
  ctx.fx.hitstop = Math.max(ctx.fx.hitstop ?? 0, Math.round(pauseMs / 16.7));
  ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick ?? 0, ctx.state.reduceFlashes ? 0.2 : 0.55);
  // Brass off the limb, chitin off the victim, both along the actual stroke.
  ctx.particles.burst(x, y, 9, null, () => packRGB(222, 184, 92), 2.6, { glow: 1.6, grav: 0.05 });
  ctx.particles.burst(x + dirX * 3, y + dirY * 3, 7, null, () => packRGB(157, 185, 147), 2.2, { grav: 0.14 });
  ctx.audio.at(x, y, () => ctx.audio.shellCrack());
  ctx.telemetry.count('trickshot.finisherLanded');
}

/** The stroke ended without its contact, or something else took it: normal time, a short recovery, no cue. */
export function missFinisher(ctx: Ctx): void {
  const r = ctx.fx.trickshot;
  if (!r || r.phase === 'idle' || r.phase === 'release') return;
  r.phase = 'release'; r.phaseMs = 0;
  r.recoveryMs = Math.max(r.recoveryMs, 500);
  ctx.telemetry.count('trickshot.finisherMissed');
}
