import type { Ctx, Enemy, EnemyKind } from '@/core/types';
import type { CreatureRig } from '@/creatures/rig/types';
import { buildLizard, stepLizard } from './lizard';
import { buildEggs, buildGel, stepEggs, stepGel } from './gel';
import { buildBat, stepBat } from './bat';
import { buildImp, stepImp } from './imp';
import { buildWisp, stepWisp } from './wisp';
import { buildBrute, stepBrute } from './brute';
import { buildMage, stepMage } from './mage';
import { makeRig } from '@/creatures/rig/types';
import { impulse } from '@/creatures/rig/physics';
import { softImpulse } from '@/creatures/rig/softbody';
import { touchWorld } from '@/creatures/worldTouch';
import { applyIdleToRig } from '@/creatures/idle';
import { buildEel, buildLeviathan, stepEel, stepLeviathan } from './serpents';
import { buildRootLoper, stepRootLoper } from './rootloper';

/**
 * Species registry: which body plan each enemy kind wears. The rig is built
 * lazily from the gameplay body (spawns, loads, Builder fakes) and stepped at
 * tick rate by tickCreaturePose; renderers only read it.
 */
export interface SpeciesRig {
  id: string;
  build(e: Enemy): CreatureRig;
  step(ctx: Ctx, e: Enemy, rig: CreatureRig): void;
}

const LIZARD: SpeciesRig = { id: 'lizard', build: e => buildLizard(e), step: (ctx, e, rig) => stepLizard(ctx, e, rig) };

const GEL: SpeciesRig = { id: 'gel', build: buildGel, step: stepGel };
const EGGS: SpeciesRig = { id: 'eggs', build: buildEggs, step: stepEggs };
const BATS: SpeciesRig = { id: 'bat', build: buildBat, step: stepBat };
const IMPS: SpeciesRig = { id: 'imp', build: buildImp, step: stepImp };
const WISPS: SpeciesRig = { id: 'wisp', build: buildWisp, step: stepWisp };
const BRUTE: SpeciesRig = { id: 'brute', build: buildBrute, step: stepBrute };
const MAGE: SpeciesRig = { id: 'mage', build: buildMage, step: stepMage };
/** The Weaver's body is its surface-crawler locomotion (entities/weaverLocomotion); the rig is only a stub. */
const EEL: SpeciesRig = { id: 'eel', build: buildEel, step: stepEel };
const LEVIATHAN: SpeciesRig = { id: 'leviathan', build: buildLeviathan, step: stepLeviathan };
const ROOTLOPER: SpeciesRig = { id: 'rootloper', build: buildRootLoper, step: stepRootLoper };
const WEAVER: SpeciesRig = { id: 'weaver', build: () => makeRig('weaver', 4), step: () => undefined };

const REGISTRY: Partial<Record<EnemyKind, SpeciesRig>> = {
  spitter: LIZARD,
  slime: GEL,
  acidslime: GEL,
  bomber: GEL,
  eggs: EGGS,
  bat: BATS,
  imp: IMPS,
  wisp: WISPS,
  golem: BRUTE,
  colossus: BRUTE,
  rimewarden: BRUTE,
  mage: MAGE,
  weaver: WEAVER,
  rillback: EEL,
  stonemaw: EEL,
  leviathan: LEVIATHAN,
  rootloper: ROOTLOPER,
};

export function speciesFor(kind: EnemyKind): SpeciesRig | undefined {
  return REGISTRY[kind];
}

/** The enemy's rig, building it on first use (or after a species change). */
export function ensureRig(e: Enemy): CreatureRig | null {
  const s = REGISTRY[e.kind];
  if (!s) return null;
  if (!e.rig || e.rig.species !== s.id) e.rig = s.build(e);
  return e.rig;
}

/**
 * A blow lands on the body, not on a sprite: every chunk takes the impulse
 * (the head snaps back, the torso lurches), chains whip from the root, soft
 * bodies dent. Heavier bodies (more points) take a smaller share each.
 */
function answerHit(e: Enemy, rig: CreatureRig): void {
  if (e.hitAt === undefined || e.hitAt <= rig.hitSeen) return;
  rig.hitSeen = e.hitAt;
  let kx = e.hitKx ?? 0, ky = e.hitKy ?? 0;
  const mag = Math.hypot(kx, ky);
  if (mag < 0.05) { kx = 0; ky = -0.4; } else { kx /= mag; ky /= mag; }
  const heavy = e.kind === 'colossus' || e.kind === 'leviathan' || e.kind === 'rimewarden' ? 0.25 : e.kind === 'golem' ? 0.5 : 1;
  const k = Math.min(1.4, 0.35 + (e.hitAmount ?? 8) / 22) * heavy;
  rig.pts.forEach((p, i) => impulse(p, kx * k * (i === 0 ? 1.2 : 0.8), ky * k * 0.8 - k * 0.25));
  for (const c of rig.chains) {
    for (let i = 1; i < c.pts.length; i++) {
      const w = 1 - i / c.pts.length;
      impulse(c.pts[i], kx * k * 1.4 * w, ky * k * 1.2 * w - k * 0.2 * w);
    }
  }
  if (rig.soft) softImpulse(rig.soft, kx * k * 0.9, ky * k * 0.7 - 0.2, 0.3 * k);
  // Chain-bodied hunters (creatures/body): the blow whips down the spine.
  const nodes = e.body?.nodes;
  if (nodes) for (let i = 1; i < nodes.length; i++) {
    const w = 0.6 * (1 - i / nodes.length) * k;
    nodes[i].previousX -= kx * w; nodes[i].previousY -= ky * w;
  }
}

/** The rig point a sniff or a groom dips (the head), per body plan; -1 = no head to dip. */
const IDLE_HEAD: Record<string, number> = { bat: 1, lizard: 0, brute: 2, imp: 1, mage: 2 };

/** Advance the rig one simulation tick. */
export function tickRig(ctx: Ctx, e: Enemy): void {
  const s = REGISTRY[e.kind];
  if (!s) return;
  const rig = ensureRig(e);
  if (!rig || rig.tick === ctx.state.frameCount) return;
  answerHit(e, rig);
  s.step(ctx, e, rig);
  applyIdleToRig(e, rig, IDLE_HEAD[s.id] ?? -1);
  touchWorld(ctx, e, rig);
  rig.tick = ctx.state.frameCount;
}
