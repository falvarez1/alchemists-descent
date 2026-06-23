import type { ProceduralLegIkState } from '@/core/types';
import { clamp } from '@/core/math';

export const LEG_IK_FLAG_ENVELOPE_CLAMPED = 1 << 0;
export const LEG_IK_FLAG_EXTENSION_CLAMPED = 1 << 1;
export const LEG_IK_FLAG_MIN_REACH_CLAMPED = 1 << 2;
export const LEG_IK_FLAG_POLE_CORRECTED = 1 << 3;
export const LEG_IK_FLAG_JOINT_LIMITED = 1 << 4;
export const LEG_IK_FLAG_ANGULAR_LIMITED = 1 << 5;

export interface Vec2 {
  x: number;
  y: number;
}

export interface LegIkEnvelope {
  basisX?: Vec2;
  basisY?: Vec2;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  minRadius?: number;
  maxRadius?: number;
}

export interface LegIkLimits {
  /** Fraction of total chain length. Values below 1 preserve a visible bend. */
  maxExtension?: number;
  /** Flex angle is 0 when straight and rises as the joint bends. */
  minFlex?: number;
  maxFlex?: number;
  /** Maximum absolute segment-angle delta per rendered frame. */
  maxAngularStep?: number;
}

export interface ConstrainedLegIkInput {
  hip: Vec2;
  target: Vec2;
  lengths: readonly [number, number, number];
  pole: Vec2;
  envelope?: LegIkEnvelope;
  limits?: LegIkLimits;
  previous?: ProceduralLegIkState;
  iterations?: number;
}

export interface ConstrainedLegIkSolution {
  upper: Vec2;
  lower: Vec2;
  foot: Vec2;
  state: ProceduralLegIkState;
}

const DEFAULT_MIN_FLEX = 0.3;
const DEFAULT_MAX_FLEX = 2.5;
const DEFAULT_MAX_EXTENSION = 0.9;
const EPS = 0.0001;

export function solveConstrainedLegIk(input: ConstrainedLegIkInput): ConstrainedLegIkSolution {
  const [l1, l2, l3] = input.lengths;
  const chain = Math.max(EPS, l1 + l2 + l3);
  const maxExtension = clamp(input.limits?.maxExtension ?? DEFAULT_MAX_EXTENSION, 0.45, 0.985);
  const minFlex = clamp(input.limits?.minFlex ?? DEFAULT_MIN_FLEX, 0.02, Math.PI - 0.02);
  const maxFlex = clamp(input.limits?.maxFlex ?? DEFAULT_MAX_FLEX, minFlex + 0.02, Math.PI - 0.02);
  let flags = 0;

  const target = applyEnvelope(input.hip, input.target, input.envelope);
  if (target.clamped) flags |= LEG_IK_FLAG_ENVELOPE_CLAMPED;
  let foot = target.point;

  const minDistance = Math.max(0, input.envelope?.minRadius ?? 0);
  const maxDistance = Math.min(input.envelope?.maxRadius ?? Infinity, chain * maxExtension);
  let span = distance(input.hip, foot);
  if (span > maxDistance) {
    foot = along(input.hip, foot, maxDistance);
    flags |= LEG_IK_FLAG_EXTENSION_CLAMPED;
    span = maxDistance;
  } else if (minDistance > EPS && span < minDistance) {
    foot = along(input.hip, foot, minDistance);
    flags |= LEG_IK_FLAG_MIN_REACH_CLAMPED;
    span = minDistance;
  }

  const chord = normalize(sub(foot, input.hip), { x: 1, y: 0 });
  const pole = projectPole(input.pole, chord);
  let pose = fabrikSolve(input.hip, foot, input.lengths, pole, input.iterations ?? 5);
  const poleCorrected = correctPole(input.hip, foot, pose.upper, pose.lower, pole);
  pose = poleCorrected.pose;
  if (poleCorrected.corrected) flags |= LEG_IK_FLAG_POLE_CORRECTED;

  const flex = poseFlex(input.hip, pose.upper, pose.lower, pose.foot);
  if (
    flex.upper < minFlex ||
    flex.lower < minFlex ||
    flex.upper > maxFlex ||
    flex.lower > maxFlex ||
    span >= chain * maxExtension - 0.001
  ) {
    pose = limitedPose(input.hip, foot, input.lengths, pole, minFlex, maxFlex, maxExtension);
    flags |= LEG_IK_FLAG_JOINT_LIMITED;
  }

  let angles = segmentAngles(input.hip, pose.upper, pose.lower, pose.foot);
  if (input.previous && Number.isFinite(input.limits?.maxAngularStep)) {
    const maxStep = Math.max(0.01, input.limits?.maxAngularStep ?? 0.4);
    const next = {
      upper: clampAngleStep(input.previous.upperAngle, angles.upper, maxStep),
      lower: clampAngleStep(input.previous.lowerAngle, angles.lower, maxStep),
      foot: clampAngleStep(input.previous.footAngle, angles.foot, maxStep),
    };
    const wasLimited =
      Math.abs(shortestAngleDelta(input.previous.upperAngle, angles.upper)) > maxStep ||
      Math.abs(shortestAngleDelta(input.previous.lowerAngle, angles.lower)) > maxStep ||
      Math.abs(shortestAngleDelta(input.previous.footAngle, angles.foot)) > maxStep;
    const smoothedPose = poseFromAngles(input.hip, next, input.lengths);
    const smoothedFlex = poseFlex(input.hip, smoothedPose.upper, smoothedPose.lower, smoothedPose.foot);
    const smoothedExtension = distance(input.hip, smoothedPose.foot) / chain;
    const smoothedPoleSide = signedPoleSide(input.hip, foot, smoothedPose.upper, pole);
    if (
      smoothedFlex.upper >= minFlex &&
      smoothedFlex.lower >= minFlex &&
      smoothedFlex.upper <= maxFlex &&
      smoothedFlex.lower <= maxFlex &&
      smoothedExtension <= Math.max(1.001, maxExtension + 0.08) &&
      smoothedPoleSide >= -0.001
    ) {
      if (wasLimited) flags |= LEG_IK_FLAG_ANGULAR_LIMITED;
      angles = next;
      pose = smoothedPose;
    }
  }

  const finalFlex = poseFlex(input.hip, pose.upper, pose.lower, pose.foot);
  const finalExtension = distance(input.hip, pose.foot) / chain;
  const poleSide = signedPoleSide(input.hip, foot, pose.upper, pole);
  const state: ProceduralLegIkState = {
    upperX: pose.upper.x,
    upperY: pose.upper.y,
    lowerX: pose.lower.x,
    lowerY: pose.lower.y,
    footX: pose.foot.x,
    footY: pose.foot.y,
    upperAngle: angles.upper,
    lowerAngle: angles.lower,
    footAngle: angles.foot,
    upperFlex: finalFlex.upper,
    lowerFlex: finalFlex.lower,
    extension: finalExtension,
    poleSide,
    flags,
  };
  return { upper: pose.upper, lower: pose.lower, foot: pose.foot, state };
}

function applyEnvelope(hip: Vec2, target: Vec2, envelope?: LegIkEnvelope): { point: Vec2; clamped: boolean } {
  if (!envelope) return { point: target, clamped: false };
  const basisX = normalize(envelope.basisX ?? { x: 1, y: 0 }, { x: 1, y: 0 });
  const basisY = normalize(envelope.basisY ?? { x: 0, y: -1 }, { x: 0, y: -1 });
  const rel = sub(target, hip);
  let lx = dot(rel, basisX);
  let ly = dot(rel, basisY);
  const ox = lx;
  const oy = ly;
  lx = clampOptional(lx, envelope.minX, envelope.maxX);
  ly = clampOptional(ly, envelope.minY, envelope.maxY);
  const localRadius = Math.hypot(lx, ly);
  if (envelope.maxRadius !== undefined && localRadius > envelope.maxRadius) {
    const k = envelope.maxRadius / (localRadius || 1);
    lx *= k;
    ly *= k;
  }
  if (envelope.minRadius !== undefined && localRadius < envelope.minRadius) {
    const k = envelope.minRadius / (localRadius || 1);
    lx *= k;
    ly *= k;
  }
  return {
    point: add(hip, add(scale(basisX, lx), scale(basisY, ly))),
    clamped: Math.abs(lx - ox) > 0.001 || Math.abs(ly - oy) > 0.001,
  };
}

function fabrikSolve(
  hip: Vec2,
  foot: Vec2,
  lengths: readonly [number, number, number],
  pole: Vec2,
  iterations: number,
): { upper: Vec2; lower: Vec2; foot: Vec2 } {
  const [l1, l2, l3] = lengths;
  const chord = normalize(sub(foot, hip), { x: 1, y: 0 });
  const span = distance(hip, foot);
  const chain = l1 + l2 + l3;
  const slack = Math.max(0, chain - span);
  const arch = clamp(chain * 0.1 + slack * 0.16, chain * 0.07, chain * 0.24);
  let upper = add(hip, add(scale(chord, span * 0.32), scale(pole, arch)));
  let lower = add(hip, add(scale(chord, span * 0.68), scale(pole, arch * 0.24)));
  let end = foot;

  for (let i = 0; i < iterations; i++) {
    end = foot;
    lower = add(end, scale(normalize(sub(lower, end), scale(chord, -1)), l3));
    upper = add(lower, scale(normalize(sub(upper, lower), pole), l2));
    upper = add(hip, scale(normalize(sub(upper, hip), pole), l1));
    lower = add(upper, scale(normalize(sub(lower, upper), chord), l2));
    end = add(lower, scale(normalize(sub(end, lower), chord), l3));
  }
  return { upper, lower, foot: end };
}

function limitedPose(
  hip: Vec2,
  foot: Vec2,
  lengths: readonly [number, number, number],
  pole: Vec2,
  minFlex: number,
  maxFlex: number,
  maxExtension: number,
): { upper: Vec2; lower: Vec2; foot: Vec2 } {
  const [l1, l2, l3] = lengths;
  const chain = l1 + l2 + l3;
  const chord = normalize(sub(foot, hip), { x: 1, y: 0 });
  const maxSpan = chain * maxExtension;
  const span = Math.min(distance(hip, foot), maxSpan);
  const renderFoot = along(hip, foot, span);
  let arch = clamp(chain * 0.11 + (maxSpan - span) * 0.18, chain * 0.06, chain * 0.24);
  let upper = renderFoot;
  let lower = renderFoot;
  for (let i = 0; i < 6; i++) {
    upper = add(hip, add(scale(chord, span * 0.32), scale(pole, arch)));
    lower = add(hip, add(scale(chord, span * 0.68), scale(pole, arch * 0.22)));
    const flex = poseFlex(hip, upper, lower, renderFoot);
    if (flex.upper < minFlex || flex.lower < minFlex) arch *= 1.18;
    else if (flex.upper > maxFlex || flex.lower > maxFlex) arch *= 0.82;
    else break;
    arch = clamp(arch, chain * 0.05, chain * 0.28);
  }
  return { upper, lower, foot: renderFoot };
}

function correctPole(
  hip: Vec2,
  foot: Vec2,
  upper: Vec2,
  lower: Vec2,
  pole: Vec2,
): { pose: { upper: Vec2; lower: Vec2; foot: Vec2 }; corrected: boolean } {
  const chord = normalize(sub(foot, hip), { x: 1, y: 0 });
  if (dot(sub(upper, hip), pole) >= -0.001) return { pose: { upper, lower, foot }, corrected: false };
  return {
    pose: {
      upper: reflectAcrossChord(hip, chord, upper),
      lower: reflectAcrossChord(hip, chord, lower),
      foot,
    },
    corrected: true,
  };
}

function poseFromAngles(
  hip: Vec2,
  angles: { upper: number; lower: number; foot: number },
  lengths: readonly [number, number, number],
): { upper: Vec2; lower: Vec2; foot: Vec2 } {
  const upper = add(hip, { x: Math.cos(angles.upper) * lengths[0], y: Math.sin(angles.upper) * lengths[0] });
  const lower = add(upper, { x: Math.cos(angles.lower) * lengths[1], y: Math.sin(angles.lower) * lengths[1] });
  const foot = add(lower, { x: Math.cos(angles.foot) * lengths[2], y: Math.sin(angles.foot) * lengths[2] });
  return { upper, lower, foot };
}

function poseFlex(hip: Vec2, upper: Vec2, lower: Vec2, foot: Vec2): { upper: number; lower: number } {
  return {
    upper: flexAt(hip, upper, lower),
    lower: flexAt(upper, lower, foot),
  };
}

function flexAt(a: Vec2, joint: Vec2, b: Vec2): number {
  const v0 = normalize(sub(a, joint), { x: -1, y: 0 });
  const v1 = normalize(sub(b, joint), { x: 1, y: 0 });
  const interior = Math.acos(clamp(dot(v0, v1), -1, 1));
  return Math.PI - interior;
}

function segmentAngles(hip: Vec2, upper: Vec2, lower: Vec2, foot: Vec2): { upper: number; lower: number; foot: number } {
  return {
    upper: Math.atan2(upper.y - hip.y, upper.x - hip.x),
    lower: Math.atan2(lower.y - upper.y, lower.x - upper.x),
    foot: Math.atan2(foot.y - lower.y, foot.x - lower.x),
  };
}

function projectPole(pole: Vec2, chord: Vec2): Vec2 {
  const raw = normalize(pole, { x: -chord.y, y: chord.x });
  const projected = sub(raw, scale(chord, dot(raw, chord)));
  return normalize(projected, { x: -chord.y, y: chord.x });
}

function signedPoleSide(hip: Vec2, foot: Vec2, upper: Vec2, pole: Vec2): number {
  const chord = normalize(sub(foot, hip), { x: 1, y: 0 });
  const projected = sub(sub(upper, hip), scale(chord, dot(sub(upper, hip), chord)));
  return dot(projected, pole);
}

function reflectAcrossChord(origin: Vec2, chord: Vec2, point: Vec2): Vec2 {
  const rel = sub(point, origin);
  const alongPart = scale(chord, dot(rel, chord));
  const perpPart = sub(rel, alongPart);
  return add(origin, sub(alongPart, perpPart));
}

function clampAngleStep(previous: number, target: number, maxStep: number): number {
  return previous + clamp(shortestAngleDelta(previous, target), -maxStep, maxStep);
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function clampOptional(value: number, min: number | undefined, max: number | undefined): number {
  return clamp(value, min ?? -Infinity, max ?? Infinity);
}

function along(from: Vec2, to: Vec2, dist: number): Vec2 {
  return add(from, scale(normalize(sub(to, from), { x: 1, y: 0 }), dist));
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(v: Vec2, fallback: Vec2): Vec2 {
  const d = Math.hypot(v.x, v.y);
  if (d <= EPS || !Number.isFinite(d)) return fallback;
  return { x: v.x / d, y: v.y / d };
}
