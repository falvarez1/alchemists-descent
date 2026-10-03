import { clamp, hash2 } from '@/core/math';
import type { Ctx, PlayerState, RigidBody } from '@/core/types';

/**
 * The alchemist's skeleton, derived from player state every time it is
 * needed (render frames and the costume's tick) — a pure read, so posing can
 * never feed back into movement. The same skeleton is read off the ragdoll
 * after death, so the living and the dead share one body and one art path.
 *
 * World coordinates; `facing` mirrors authored "forward".
 */
export type V = { x: number; y: number };

export interface Skeleton {
  kind: 'stand' | 'crawl' | 'climb' | 'dead';
  facing: number;
  /** Torso tilt (radians, screen space; 0 = upright). */
  lean: number;
  hip: V;
  chest: V;
  neck: V;
  head: V;
  /** Head tilt (radians) and gaze (-1..1 in facing space). */
  headTilt: number;
  gazeX: number;
  gazeY: number;
  eyesShut: boolean;
  /** 0 slack .. 1 open (hurt, casting, drinking). */
  mouth: number;
  backKnee: V; backFoot: V;
  frontKnee: V; frontFoot: V;
  backElbow: V; backHand: V;
  frontElbow: V; frontHand: V;
  /** Wand grip, angle and whether it is in hand. */
  wand: { visible: boolean; x: number; y: number; angle: number; glow: number; spin: number };
  /** Something held in the off hand: 'flask' (drink/siphon/pour/throw) or none. */
  held: null | { kind: 'flask'; x: number; y: number; angle: number };
  /** Crown of the hat (where the tip chain roots) and brim angle. */
  crown: V;
  brimAngle: number;
  /** Coat compression 0..1 (crouch / landing) and flare (fall, levitation). */
  crouch: number;
  flare: number;
  /** Levitation jet strength 0..1 (glow under the boots). */
  lift: number;
  /** 0..1 communion kneel (heart channel). */
  commune: number;
}

const V0 = (): V => ({ x: 0, y: 0 });

export function makeSkeleton(): Skeleton {
  return {
    kind: 'stand', facing: 1, lean: 0, hip: V0(), chest: V0(), neck: V0(), head: V0(), headTilt: 0, gazeX: 0, gazeY: 0,
    eyesShut: false, mouth: 0, backKnee: V0(), backFoot: V0(), frontKnee: V0(), frontFoot: V0(),
    backElbow: V0(), backHand: V0(), frontElbow: V0(), frontHand: V0(),
    wand: { visible: true, x: 0, y: 0, angle: 0, glow: 0.6, spin: 0 }, held: null,
    crown: V0(), brimAngle: 0, crouch: 0, flare: 0, lift: 0, commune: 0,
  };
}

const set = (v: V, p: readonly [number, number]): void => { v.x = p[0]; v.y = p[1]; };
const ease = (t: number): number => t * t * (3 - 2 * t);
const mixP = (p: [number, number], q: readonly [number, number], t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/**
 * THE CHILL in the body (entities/chill): how far the arms hug in, the gait
 * stiffens and the head sinks, and the shiver (a 1-px shudder of the upper
 * body on some frames, deterministic by tick; none with reduced flashes, none
 * inside the ice). Frozen solid is full hug, no breath, no stride.
 */
function chillPose(ctx: Ctx, a: PlayerState, frame: number): { hug: number; stiff: number; shiver: number; shelled: boolean } {
  const c = a.chill;
  if (!c || c.level < 0.18) return { hug: 0, stiff: 0, shiver: 0, shelled: false };
  const shelled = c.shell > 0;
  const hug = shelled ? 1 : clamp((c.level - 0.3) / 0.45, 0, 1);
  const stiff = shelled ? 1 : clamp((c.level - 0.2) / 0.6, 0, 1);
  let shiver = 0;
  if (!shelled && ctx.state.reduceFlashes !== true) {
    const p = clamp((c.level - 0.32) / 0.5, 0, 1) * 0.6;
    if (p > 0 && hash2(frame >> 1, 7, 3) < p) shiver = (frame & 2) !== 0 ? 0.5 : -0.5;
  }
  return { hug, stiff, shiver, shelled };
}

/**
 * Pose the living alchemist. `frame` drives only cosmetic cycles (breathing);
 * everything with gameplay meaning reads the player's own timers.
 */
export function poseAlchemist(ctx: Ctx, a: PlayerState, s: Skeleton): Skeleton {
  const ledge = a === ctx.player && ctx.arena?.stockMatch ? ctx.arena.stockLedge(ctx.arena.bound) : null;
  const attack = a === ctx.player ? ctx.arena?.stockAttack(ctx.arena.bound) : null;
  const shield = a === ctx.player ? ctx.arena?.stockShield?.(ctx.arena.bound) : null;
  const frame = ctx.state.frameCount, f = (ledge?.busy ? ledge.side : attack?.busy ? attack.facing : a.facing) < 0 ? -1 : 1;
  const strike = attack?.busy && attack.spec ? attack : null;
  const windup = strike?.phase === 'startup' ? ease(strike.age / strike.spec!.startup) : 0;
  const follow = strike?.phase === 'active' ? 1 : strike?.phase === 'recovery'
    ? 1 - ease(clamp((strike.age - strike.spec!.startup - strike.spec!.active) / strike.spec!.recovery, 0, 1)) : 0;
  const heavy = ctx.fighters?.id === 'brann-rook';
  const bell = ctx.fighters?.id === 'mara-quell';
  const finish = strike?.kind === 'finisher';
  const risingStrike = strike?.kind === 'launcher';
  s.facing = f; s.eyesShut = a.blinkTimer > 0; s.mouth = 0; s.held = null;
  s.wand.visible = !a.legClub && a.pullT === 0; s.wand.spin = a.swapT > 0 ? (a.swapT / 12) * Math.PI * 2 : 0;
  if (strike && heavy) s.wand.visible = false;
  s.lift = a.levitating ? 1 : 0;
  s.commune = a.recharge > 0 ? 1 : 0;
  // Gaze follows the aim (where the wizard is looking is where he casts).
  const aimX = Math.cos(a.aimAngle), aimY = Math.sin(a.aimAngle);
  s.gazeX = clamp(aimX * f, -1, 1); s.gazeY = clamp(aimY, -1, 1);
  const flask = ctx.input?.drinkHeld ? 'drink' : ctx.input?.siphonHeld ? 'siphon' : ctx.input?.pourHeld ? 'pour' : (a.throwT ?? 0) > 0 ? 'throw' : null;

  if (a.crawling) return poseCrawl(a, s);
  if (ledge?.busy) return poseLedge(a, s, ledge.x, ledge.y, ledge.phase === 'climb');
  if (a.climbing || a.wallGrabT > 0) return poseClimb(a, s, frame);

  s.kind = 'stand';
  const dodge = a === ctx.player ? ctx.arena?.stockDodge(ctx.arena.bound) : null;
  const recovering = a === ctx.player && ctx.arena?.isRecovering(ctx.arena.bound) === true;
  if (recovering) s.lift = 1;
  const evadePose = dodge?.busy ? dodge.phase === 'evade' ? 1 : dodge.phase === 'startup' ? .45 : .25 : 0;
  const cold = chillPose(ctx, a, frame);
  const crouch = Math.max(clamp(a.crouchT / 10, 0, 1), shield?.busy ? .55 : 0, evadePose * .8, windup * (finish ? .8 : .25), finish && (heavy || bell) ? follow * .7 : 0), landing = clamp(a.landTimer / 10, 0, 1);
  const air = a.grounded ? 0 : 1, skid = clamp(a.skidT / 10, 0, 1), hurt = clamp(a.staggerT / 10, 0, 1);
  const pulling = a.pullT > 0 ? 1 : 0;
  const speed = Math.min(1, Math.abs(a._svx || a.vx) / 2.1);
  const dive = a.diveT > 0 ? 1 : 0;
  const swim = a.inLiquid && !a.grounded ? 1 : 0;
  const commune = s.commune;
  const falling = air && a.vy > 0.25 ? clamp(a.vy / 3, 0, 1) : 0;
  const rising = air && a.vy < -0.2 ? clamp(-a.vy / 3.5, 0, 1) : 0;
  // Stride: feet apart at contact (|sin| = 1), passing at sin = 0.
  const ph = a.stridePhase;
  // (A chilled body shuffles: shorter steps, feet kept low, less bob.)
  let stride = a.grounded ? Math.sin(ph) * (1.1 + speed * 2.0) * (1 - 0.42 * cold.stiff) : 0;
  if (skid) stride = -2.1;
  if (cold.shelled) stride = 0;
  const swing = Math.cos(ph); // which foot is travelling forward
  const bob = a.grounded ? Math.abs(Math.sin(ph)) * speed * 0.75 * (1 - 0.6 * cold.stiff) : 0;
  // Breathing: slow at rest; a cold body's breath comes quick and shallow; frozen solid, none.
  const breath = cold.shelled ? 0 : a.grounded && speed < 0.1
    ? cold.hug > 0.3 ? Math.sin(frame * 0.13) * 0.16 : Math.sin(frame * 0.052) * 0.28 : 0;
  // Torso lean: into speed, back on a skid, forward on a dive, arched when hit.
  let lean = f * (speed * 0.11 + skid * -0.18 + dive * 0.5 - pulling * 0.16 + falling * 0.05 + swim * 0.55)
    - (a.staggerDir || -f) * hurt * 0.22;
  if (a.kickT > 0) lean -= f * 0.18;
  if (flask === 'drink') lean -= f * 0.08;
  lean += f * evadePose * .38;
  lean += f * (-windup * (finish ? .3 : .12) + follow * (risingStrike ? -.12 : finish ? .42 : .18));
  // Hunched into the cold.
  if (a.grounded && !swim) lean += f * 0.07 * cold.hug;
  s.lean = lean;
  const squash = crouch * 3.2 + landing * 2.1 + commune * 4.2 + bob;
  const stretch = clamp(a.stretchT / 10, 0, 1) * 1.4 + rising * 0.5;
  s.crouch = Math.max(crouch, landing * 0.8, commune);
  s.flare = Math.max(falling, s.lift * 0.8, swim * 0.4);
  const cos = Math.cos(lean), sin = Math.sin(lean);
  const at = (side: number, up: number): [number, number] => {
    const k = clamp(up / 16, 0, 1);
    const u = up - squash * k + stretch * k + breath * clamp((up - 6) / 8, 0, 1);
    const dx = f * side, dy = -u;
    return [a.x + dx * cos - dy * sin, a.y + dx * sin + dy * cos];
  };
  // The head sinks into the mantle and juts a little as he hunches.
  set(s.hip, at(0, 6.2)); set(s.chest, at(0.2, 11.2));
  set(s.neck, at(0.35 + 0.15 * cold.hug, 12.6 - 0.35 * cold.hug)); set(s.head, at(0.55 + 0.3 * cold.hug, 14.0 - 0.6 * cold.hug));
  // Legs (knees stiffen with the chill).
  const lift = (1.6 + speed * 1.2) * (1 - 0.5 * cold.stiff);
  let bF = at(-2.0 - stride, 0.15 + Math.max(0, -swing) * lift * (a.grounded ? speed : 0));
  let fF = at(2.0 + stride, 0.1 + Math.max(0, swing) * lift * (a.grounded ? speed : 0));
  let bK = at(-1.1 - stride * 0.35 + Math.max(0, -swing) * speed * 1.2, 3.5 + Math.max(0, -swing) * speed * 1.1);
  let fK = at(1.3 + stride * 0.35 + Math.max(0, swing) * speed * 1.4, 3.65 + Math.max(0, swing) * speed * 1.1);
  if (air && !swim) {
    // Rise: knees tuck; fall: legs reach for the ground; apex hangs between.
    const tuck = rising * 1.4 + (1 - rising - falling) * 0.8;
    bF = at(-2.4 + falling * 0.4, 1.4 + tuck - falling * 1.0); fF = at(2.4 - falling * 0.2, 2.2 + tuck * 1.1 - falling * 1.6);
    bK = at(-0.6, 4.0 + tuck * 0.5); fK = at(2.0, 4.4 + tuck * 0.7 - falling * 0.5);
    if (s.lift > 0) { bF = at(-1.4, 0.9); fF = at(1.2, 0.6); bK = at(-0.9, 3.6); fK = at(1.1, 3.4); }
  }
  if (swim) {
    const kick = Math.sin(frame * 0.18) * 1.6;
    bF = at(-5.0, 2.8 + kick); fF = at(-4.4, 4.2 - kick); bK = at(-2.6, 4.2 + kick * 0.4); fK = at(-2.2, 5.0 - kick * 0.4);
  }
  if (pulling) { bF = at(-3.3, 0.1); fF = at(3.0, 0.1); bK = at(-1.8, 3.3); fK = at(1.6, 3.6); }
  if (dive) { bF = at(-4.4, 5.6); fF = at(-2.4, 3.0); bK = at(-1.6, 4.8); fK = at(0.2, 4.0); }
  if (a.kickT > 0) {
    const k = ease(clamp(a.kickT / 8, 0, 1));
    fK = at(3.0 + k * 0.6, 4.4 + k * 0.8); fF = at(4.5 + k * 4.4, 3.2 + k * 2.2);
  }
  if (commune) { bF = at(-2.6, 0.1); fF = at(2.2, 0.1); bK = at(-0.4, 1.0); fK = at(2.6, 2.8); }
  if (evadePose > 0) {
    bF = mixP(bF, at(-5, air ? 4.5 : .2), evadePose);
    fF = mixP(fF, at(1.4, air ? 6 : .15), evadePose);
    bK = mixP(bK, at(-2.8, 4.1), evadePose);
    fK = mixP(fK, at(3.1, air ? 6.8 : 3.6), evadePose);
  }
  if (strike) {
    const spread = finish ? 5.6 : 3.8;
    bF = mixP(bF, at(-spread, air ? 4.2 : .1), Math.max(windup, follow));
    fF = mixP(fF, at(spread, air ? 2.5 : .1), Math.max(windup, follow));
    bK = mixP(bK, at(-2.8, air ? 5.5 : 3), follow);
    fK = mixP(fK, at(3.2, air ? 5.8 : 3.7), follow);
  }
  if (a.stockFastFall) { bF = at(-2.3, 4.5); fF = at(1.5, 6); bK = at(-1, 6); fK = at(3, 7); }
  set(s.backFoot, bF); set(s.frontFoot, fF); set(s.backKnee, bK); set(s.frontKnee, fK);
  // Head: tilts with gaze, snaps back when hit, tips back to drink.
  s.headTilt = f * (s.gazeY * 0.28 * f) - (a.staggerDir || -f) * hurt * 0.35 * f * f + f * 0.12 * cold.hug;
  if (flask === 'drink') s.headTilt = -f * 0.55;
  if (hurt > 0.3) { s.eyesShut = true; s.mouth = 0.7; }
  // Arms. The off (back) arm counter-swings the stride; the wand arm aims.
  const counter = a.grounded ? -stride * 0.45 : 0;
  let bE = at(-2.5 + counter * 0.5, 9.0), bH = at(-2.2 + counter, 6.4);
  let fE = at(2.8 - counter * 0.4, 9.1), fH = at(3.5 - counter * 0.7, 6.9);
  if (air && !swim) {
    const flail = s.lift > 0 ? 0 : Math.sin(frame * 0.35) * falling * 0.8;
    bE = at(-3.3, 10.4 + falling * 0.6); bH = at(-4.6, 11.4 + falling * 1.4 + flail);
    fE = at(3.3, 10.2); fH = at(4.4, 9.0 + falling);
    if (s.lift > 0) { bE = at(-3.6, 9.6); bH = at(-5.2, 8.8); }
  }
  if (swim) {
    const stroke = Math.sin(frame * 0.12);
    bE = at(1.2, 12.4 + stroke); bH = at(4.8 + stroke * 1.6, 12.8); fE = at(2.8, 11.6 - stroke); fH = at(6.0 - stroke * 1.6, 11.2);
  }
  if (cold.hug > 0 && !swim) {
    // Arms held in: the off hand tucked across the chest under the mantle, the wand arm drawn close.
    const k = cold.hug * (air ? 0.6 : 1);
    bE = mixP(bE, at(-0.7, 9.1), k); bH = mixP(bH, at(1.5, 10.1), k);
    fE = mixP(fE, at(1.7, 8.8), k * 0.8); fH = mixP(fH, at(2.7, 8.2), k * 0.8);
  }
  if (hurt > 0.2) { bE = at(-3.2, 11.4); bH = at(-4.4, 13.2); }
  if (commune) {
    // Kneeling communion: both hands cupped at the heart.
    bE = at(-0.6, 8.8); bH = at(1.6, 9.8); fE = at(2.6, 8.6); fH = at(1.9, 10.3);
  }
  if (a.pullT > 0) {
    const t = 1 - clamp(a.pullT / 26, 0, 1), dir = a.pullDir || f;
    fE = [a.x + dir * (3.7 - t), a.y - 9.3 + t * 1.3]; fH = [a.x + dir * (6.0 - t * 2.4), a.y - 8.4 + t * 2.3];
    bE = [a.x + dir * (2.4 - t), a.y - 8.8 + t * 1.1]; bH = [a.x + dir * (5.2 - t * 2.2), a.y - 8.0 + t * 2.2];
  } else if (a.firing || a.recoilT > 0) {
    // Casting: the wand hand rides the very ray the spell travels (the aim
    // pivot Spells.wandTip casts from), so the shot leaves along the wand;
    // the elbow hangs below that line and the off hand braces.
    const sh = at(1.3, 10.7);
    const recoil = a.recoilT > 0 ? (a.recoilT > 3 ? 1.2 : 0.6) : 0;
    const reach = 3.4 - recoil;
    fH = [a.x + aimX * reach, a.y - 9 + aimY * reach];
    fE = [(sh[0] + fH[0]) / 2 - aimY * 0.9 * f, (sh[1] + fH[1]) / 2 + Math.abs(aimX) * 0.9 + 0.3];
    bE = at(0.4, 8.6); bH = [sh[0] + aimX * 2.6 - aimY * 0.6, sh[1] + aimY * 2.6 + 1.2];
  }
  if (flask) {
    // The flask rides the off hand: to the lips, out at the cursor, tipped, or thrown.
    let hx: number, hy: number, ang: number;
    if (flask === 'drink') { [hx, hy] = at(1.9, 13.2); ang = -f * 2.2; bE = at(0.4, 10.6); }
    else if (flask === 'throw') {
      const t = 1 - clamp((a.throwT ?? 0) / 14, 0, 1);
      const arc = -Math.PI * 0.9 + t * Math.PI * 1.1;
      const sh = at(-0.4, 11.2);
      hx = sh[0] + Math.cos(arc) * 5.4 * f; hy = sh[1] + Math.sin(arc) * 5.4;
      ang = arc; bE = [sh[0] + Math.cos(arc) * 2.6 * f, sh[1] + Math.sin(arc) * 2.6 + 0.6];
    } else {
      const sh = at(0.2, 10.8);
      hx = sh[0] + aimX * 5.0; hy = sh[1] + aimY * 5.0;
      ang = flask === 'pour' ? a.aimAngle + f * 1.6 : a.aimAngle;
      bE = [sh[0] + aimX * 2.4 + 0.3, sh[1] + aimY * 2.4 + 0.9];
    }
    bH = [hx, hy];
    s.held = { kind: 'flask', x: hx, y: hy, angle: ang };
  }
  if (evadePose > 0) {
    bE = mixP(bE, at(-2.5, 9), evadePose); bH = mixP(bH, at(-.5, 10.4), evadePose);
    fE = mixP(fE, at(2.8, 9.5), evadePose); fH = mixP(fH, at(4.1, 10.1), evadePose);
  }
  if (recovering) { bE = at(-1.5, 13.2); bH = at(-.5, 18); fE = at(2.7, 10.5); fH = at(3.5, 12); }
  if (shield?.busy) {
    s.wand.visible = false;
    const broken = shield.phase === 'broken';
    bE = at(-1, broken ? 7 : 11); bH = at(1, broken ? 4 : 14);
    fE = at(4, broken ? 6 : 10); fH = at(5, broken ? 3 : 14);
    s.gazeY = broken ? .8 : 0; s.eyesShut = broken;
  }
  if (a.stockFastFall) { bE = at(-2, 9.5); bH = at(-.5, 10); fE = at(3, 9.5); fH = at(3.5, 12); }
  if (strike) {
    fE = mixP(fE, at(-2.2, finish ? 12 : 9), windup); fH = mixP(fH, at(-4, finish ? 14 : 8), windup);
    fE = mixP(fE, at(risingStrike ? 3.5 : 5, risingStrike ? 15 : 10.5), follow);
    fH = mixP(fH, at(risingStrike ? 4 : 8, risingStrike ? 20 : 12), follow);
    bE = mixP(bE, at(heavy ? 4 : -3.5, risingStrike ? 14 : 9), follow);
    bH = mixP(bH, at(heavy ? (risingStrike ? 5 : 9) : -5, heavy && risingStrike ? 19 : 11), follow);
    if (heavy) {
      bE = mixP(bE, at(-1.5, 8), windup); bH = mixP(bH, at(.5, 9), windup);
      fE = mixP(fE, at(-2.5, 8), follow); fH = mixP(fH, at(-5, 10), follow);
      if (finish) bH = mixP(bH, at(9, 6), follow);
    }
    if (bell && finish) { fE = mixP(fE, at(5, 8), follow); fH = mixP(fH, at(9, 6), follow); }
    s.gazeX = 1; s.gazeY = risingStrike ? -.7 : 0;
  }
  const club = a.legClub?.rig;
  if (club) {
    // Both fists on the severed leg: the grip is the club's own hand point.
    const sh = at(1.0, 10.8);
    fH = [club.hand.x, club.hand.y];
    const cx = (sh[0] + fH[0]) / 2, cy = (sh[1] + fH[1]) / 2 + 1.2;
    fE = [cx, cy]; bH = [fH[0] - f * 0.8, fH[1] + 0.9]; bE = [cx - f * 1.2, cy + 0.6];
  }
  set(s.backElbow, bE); set(s.backHand, bH); set(s.frontElbow, fE); set(s.frontHand, fH);
  // The wand in the front hand, always pointing where it will shoot. (Aiming
  // it at the muzzle point from the hand skews it badly when the hand sits a
  // few pixels off the aim ray — the muzzle is only 9 cells out.)
  s.wand.x = fH[0]; s.wand.y = fH[1];
  s.wand.angle = evadePose > 0 ? (f > 0 ? .45 : Math.PI - .45) : a.aimAngle;
  if (strike) {
    const angle = risingStrike ? -1.25 * follow + .6 * windup : -.15 * follow - 1.7 * windup;
    s.wand.angle = f > 0 ? angle : Math.PI - angle;
  }
  s.wand.glow = a.firing ? 1 : a.swapT > 6 ? 0.2 : 0.55 + Math.sin(frame * 0.2) * 0.07;
  set(s.crown, at(-0.2 + 0.3 * cold.hug, 17.2 - 0.6 * cold.hug));
  s.brimAngle = lean + s.headTilt * 0.6;
  if (cold.shiver !== 0 && !a.firing && a.recoilT <= 0) {
    // The shudder: the upper body only (the boots stay planted), one fine pixel.
    // (Never mid-cast: the wand hand stays on the ray the spell leaves along.)
    const d = cold.shiver;
    for (const v of [s.chest, s.neck, s.head, s.crown, s.backElbow, s.backHand, s.frontElbow, s.frontHand]) v.x += d;
    s.wand.x += d;
    if (s.held) s.held.x += d;
  }
  return s;
}

function poseLedge(a: PlayerState, s: Skeleton, gripX: number, gripY: number, climbing: boolean): Skeleton {
  const f = s.facing;
  s.kind = 'stand'; s.lean = climbing ? f * .3 : -f * .08;
  s.crouch = climbing ? .45 : 0; s.flare = .15; s.lift = 0; s.commune = 0;
  s.gazeX = 1; s.gazeY = -.5; s.headTilt = -f * .2;
  s.hip.x = a.x; s.hip.y = a.y - 6;
  s.chest.x = a.x + f; s.chest.y = a.y - 11;
  s.neck.x = a.x + f; s.neck.y = a.y - 13;
  s.head.x = a.x + f; s.head.y = a.y - 15;
  s.frontHand.x = gripX - f * .3; s.frontHand.y = gripY - .5;
  // Once the hips clear the lip, the hand releases into the final step instead of stretching the arm.
  if (a.y < gripY + 4) { s.frontHand.x = a.x + f * 3; s.frontHand.y = a.y - 9; }
  s.frontElbow.x = (s.chest.x + s.frontHand.x) / 2 - f;
  s.frontElbow.y = (s.chest.y + s.frontHand.y) / 2 + 1;
  s.backElbow.x = a.x - f * 2; s.backElbow.y = a.y - 9;
  s.backHand.x = a.x - f * 3; s.backHand.y = a.y - 6;
  s.backKnee.x = a.x - f * 1.5; s.backKnee.y = a.y - 3;
  s.backFoot.x = a.x - f * 2; s.backFoot.y = a.y;
  s.frontKnee.x = a.x + f * (climbing ? 3.5 : 2); s.frontKnee.y = a.y - (climbing ? 7 : 4.5);
  s.frontFoot.x = a.x + f * 2.8; s.frontFoot.y = a.y - (climbing ? 5 : 2);
  if (climbing && s.hip.y < gripY + 2 && a.y >= gripY + 4) {
    s.frontKnee.x = gripX + f * 2; s.frontKnee.y = gripY - 2;
    s.frontFoot.x = gripX + f * 4; s.frontFoot.y = gripY - .5;
  }
  s.wand.visible = true; s.wand.x = s.backHand.x; s.wand.y = s.backHand.y; s.wand.angle = Math.PI / 2; s.wand.glow = .35;
  s.crown.x = s.head.x - f * .5; s.crown.y = s.head.y - 3;
  s.brimAngle = -f * .1;
  return s;
}

function poseCrawl(a: PlayerState, s: Skeleton): Skeleton {
  s.kind = 'crawl';
  const f = s.facing, angle = Math.atan(clamp(a.crawlSlope, -1, 1)) * f;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const at = (along: number, up: number): [number, number] => {
    const dx = f * along, dy = -up;
    return [a.x + dx * cos - dy * sin, a.y + dx * sin + dy * cos];
  };
  const st = Math.sin(a.stridePhase), st2 = Math.cos(a.stridePhase);
  s.lean = angle + f * Math.PI * 0.44;
  set(s.hip, at(-3.8, 2.1)); set(s.chest, at(1.2, 3.0)); set(s.neck, at(2.8, 3.1)); set(s.head, at(4.6, 3.2));
  set(s.backFoot, at(-8.4 + Math.max(0, -st) * 1.2, 0.5)); set(s.backKnee, at(-6.0, 1.0 + Math.max(0, st) * 0.9));
  set(s.frontFoot, at(-8.0 + Math.max(0, st) * 1.2, 0.9)); set(s.frontKnee, at(-5.6, 0.6 + Math.max(0, -st) * 0.9));
  set(s.backElbow, at(2.4, 0.9)); set(s.backHand, at(5.4 + Math.max(0, -st) * 1.4, 0.4));
  set(s.frontElbow, at(3.2, 1.3 + Math.max(0, st2) * 0.4)); set(s.frontHand, at(6.4 + Math.max(0, st) * 1.4, 0.35));
  s.headTilt = angle; s.crouch = 1; s.flare = 0;
  if (a.firing || a.recoilT > 0) {
    // Prone cast: the hand leaves the floor for the prone aim pivot (feet - 4).
    const aimX = Math.cos(a.aimAngle), aimY = Math.sin(a.aimAngle);
    set(s.frontHand, [a.x + aimX * 4.2, a.y - 4 + aimY * 4.2]);
    set(s.frontElbow, at(3.0, 2.2));
  }
  s.wand.x = s.frontHand.x; s.wand.y = s.frontHand.y; s.wand.angle = a.aimAngle;
  s.wand.glow = 0.5;
  set(s.crown, at(4.2, 6.3));
  s.brimAngle = angle + f * 0.2;
  return s;
}

function poseClimb(a: PlayerState, s: Skeleton, frame: number): Skeleton {
  s.kind = 'climb';
  const wall = a.climbing ? (a.climbDir || s.facing) : (a.wallGrabDir || s.facing);
  s.facing = wall;
  const phase = a.climbing ? a.climbPhase : frame * 0.025, reach = Math.sin(phase) * 1.9;
  const lean = clamp(a.climbLean, -0.3, 0.3);
  const at = (side: number, up: number): [number, number] => [a.x + wall * side + lean * up, a.y - up];
  s.lean = -wall * 0.08;
  set(s.hip, at(-2.0, 6.4)); set(s.chest, at(-1.2, 11.2)); set(s.neck, at(-0.7, 12.6)); set(s.head, at(-0.4, 14.0));
  set(s.backKnee, at(-3.5, 3.8)); set(s.backFoot, at(0.8, 1.6 + Math.max(0, -reach)));
  set(s.frontKnee, at(-3.0, 4.6)); set(s.frontFoot, at(1.4, 1.0 + Math.max(0, reach)));
  set(s.backElbow, at(-2.4, 11.8)); set(s.backHand, at(2.1, 14.3 + Math.max(0, -reach)));
  set(s.frontElbow, at(2.9, 11.5)); set(s.frontHand, at(2.6, 15.9 + Math.max(0, reach)));
  s.headTilt = -wall * 0.1; s.gazeX = 0.7; s.gazeY = -0.3; s.crouch = 0; s.flare = 0.1;
  s.wand.visible = false;
  set(s.crown, at(-0.9, 17.2));
  s.brimAngle = -wall * 0.1;
  return s;
}

/** The skeleton of the fallen: read straight off the ragdoll's solved parts. */
export function poseRagdoll(parts: Record<string, RigidBody>, facing: number, s: Skeleton, alpha = 1): Skeleton {
  const p = (name: string, x: number, y: number): V => {
    const b = parts[name];
    const px = b.previousX ?? b.x, py = b.previousY ?? b.y, pa = b.previousAngle ?? b.angle;
    const ang = pa + Math.atan2(Math.sin(b.angle - pa), Math.cos(b.angle - pa)) * alpha;
    return { x: px + (b.x - px) * alpha + x * Math.cos(ang) - y * Math.sin(ang), y: py + (b.y - py) * alpha + x * Math.sin(ang) + y * Math.cos(ang) };
  };
  const ang = (name: string): number => parts[name].angle;
  s.kind = 'dead'; s.facing = facing; s.eyesShut = true; s.mouth = 0.4; s.held = null;
  s.wand.visible = false; s.lift = 0; s.commune = 0; s.crouch = 0; s.flare = 0; s.gazeX = 0; s.gazeY = 0;
  const hip = p('torso', 0, 2.8), chest = p('torso', 0, -3), neck = p('torso', 0, -3.8), head = p('head', 0, 0);
  Object.assign(s.hip, hip); Object.assign(s.chest, chest); Object.assign(s.neck, neck); Object.assign(s.head, head);
  s.lean = ang('torso'); s.headTilt = ang('head');
  const near = facing > 0 ? 'right' : 'left', far = facing > 0 ? 'left' : 'right';
  Object.assign(s.frontKnee, p(`${near}Thigh`, 0, 1.7)); Object.assign(s.frontFoot, p(`${near}Shin`, 0, 1.3));
  Object.assign(s.backKnee, p(`${far}Thigh`, 0, 1.7)); Object.assign(s.backFoot, p(`${far}Shin`, 0, 1.3));
  Object.assign(s.frontElbow, p(`${near}Arm`, 0, 1.7)); Object.assign(s.frontHand, p(`${near}Forearm`, 0, 1.6));
  Object.assign(s.backElbow, p(`${far}Arm`, 0, 1.7)); Object.assign(s.backHand, p(`${far}Forearm`, 0, 1.6));
  // The hat is its own body now; the crown point rides the head for the tip chain.
  Object.assign(s.crown, p('head', 0, -3.2));
  s.brimAngle = ang('hat');
  return s;
}
