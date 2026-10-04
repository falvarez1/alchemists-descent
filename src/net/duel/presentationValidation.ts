import { BODY_FIELDS } from '@/core/fighterBody';
import { isFighterId } from '@/content/fighters';
import { record } from './protocol';

type Check = (value: unknown) => boolean;
const finite: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const bool: Check = (v) => typeof v === 'boolean';
const text: Check = (v) => typeof v === 'string' && v.length <= 200;
const oneOf =
  (...values: unknown[]): Check =>
  (v) =>
    values.includes(v);
const array =
  (check: Check, max: number, min = 0): Check =>
  (v) =>
    Array.isArray(v) && v.length >= min && v.length <= max && v.every(check);
const fields = (v: unknown, check: Check, keys: string): boolean =>
  record(v) && keys.split(' ').every((k) => check(v[k]));
const numbers = (v: unknown, keys: string): boolean => fields(v, finite, keys);
const optional = (v: unknown, check: Check): boolean => v === undefined || check(v);
const nullable = (v: unknown, check: Check): boolean => v === null || check(v);
const point: Check = (v) => numbers(v, 'x y');
/** A host match moment (snapshot.ts DuelMoment), re-emitted on the replica: its data must be the event's exact shape. */
const moment: Check = (v) => {
  if (!record(v) || !record(v.data)) return false;
  const d = v.data;
  switch (v.type) {
    case 'stockMatchBeat':
      return oneOf('countdown', 'fighting', 'finished')(d.state) && finite(d.count) && nullable(d.winner, finite) && nullable(d.reason, oneOf('stocks', 'timeout', 'draw'));
    case 'fighterDown':
      return numbers(d, 'slot by x y') && text(d.source);
    case 'stockUltimate':
      return finite(d.slot) && isFighterId(d.fighter) && text(d.name);
    case 'stockShieldBreak':
      return finite(d.slot);
    default:
      return false;
  }
};

const ability: Check = (v) =>
  record(v) &&
  oneOf('tactical', 'ultimate')(v.slot) &&
  text(v.name) &&
  bool(v.ready) &&
  numbers(v, 'cooldown cooldownSeconds active charge usedAt refusedAt readyAt');
const fighter: Check = (v) =>
  record(v) &&
  (v.id === null || (typeof v.id === 'string' && isFighterId(v.id))) &&
  ability(v.tactical) &&
  ability(v.ultimate) &&
  numbers(v, 'armor armorMax') &&
  record(v.technique) &&
  fields(v.technique, text, 'name state') &&
  numbers(v.technique, 'uses usedAt') &&
  nullable(v.meter, (m) => record(m) && text(m.label) && numbers(m, 'value max'));
const chain: Check = (v) =>
  record(v) &&
  finite(v.seg) &&
  array((p) => numbers(p, 'x y'), 64, 1)(v.pts) &&
  (record(v.radius) || Array.isArray(v.radius)) &&
  (v.pts as unknown[]).every((_, i) => finite((v.radius as Record<string, unknown>)[String(i)]));
const costume: Check = (v) =>
  record(v) &&
  numbers(v, 'tick vial vialV') &&
  array(chain, 2, 2)(v.tails) &&
  chain(v.mantle) &&
  chain(v.crown) &&
  record(v.skel) &&
  fields(
    v.skel,
    point,
    'hip chest neck head backKnee backFoot frontKnee frontFoot backElbow backHand frontElbow frontHand crown',
  ) &&
  numbers(v.skel, 'facing lean headTilt gazeX gazeY mouth brimAngle crouch flare lift commune') &&
  bool(v.skel.eyesShut) &&
  record(v.skel.wand) &&
  numbers(v.skel.wand, 'x y angle glow spin') &&
  bool(v.skel.wand.visible) &&
  nullable(v.skel.held, (h) => numbers(h, 'x y angle'));
const player: Check = (v) =>
  record(v) &&
  numbers(
    v,
    'x y fx fy vx vy hp maxHp mana maxMana levit maxLevit facing aimAngle invuln cooldown stridePhase landTimer blinkTimer fallPeak _px _py _svx _svy tpCool recharge pullT stunT pullDir stretchT skidT skidDir swapT recoilT kickT kickDir staggerT staggerDir fidgetT crouchT diveT crawlT crawlSlope wallGrabT wallGrabDir climbDir climbT climbPhase climbMoveT climbIntentY climbLean bloodStain',
  ) &&
  fields(v, bool, 'grounded inLiquid dead firing prevGrounded stockFastFall crawling climbing') &&
  text(v.spell) &&
  record(v.perks) &&
  numbers(v.hat, 'ox oy vx vy pvx pvy') &&
  numbers(v.robe, 'ox vx') &&
  numbers(v.status, 'wet oiled burning frozen electrified regen levity stoneskin swift torch') &&
  optional(v.costume, costume) &&
  optional(
    v.chill,
    (c) =>
      numbers(
        c,
        'level rime shell cracks cooldown moveK jumpK screen musicRate musicCutoff thawAt crackle breathAt breathX breathY breathDir breathK',
      ) && fields(c, bool, 'deep'),
  ) &&
  optional(
    v.legClub,
    (c) =>
      record(c) &&
      numbers(c, 'durability length swingT angle cooldown') &&
      optional(
        c.rig,
        (r) =>
          fields(r, point, 'hand knee hip previousHand previousKnee previousHip') &&
          numbers(r, 'wrist wristVelocity vx vy'),
      ),
  );

const attack: Check = (v) =>
  record(v) &&
  oneOf(null, 'opener', 'launcher', 'aerial', 'finisher')(v.kind) &&
  oneOf('idle', 'startup', 'active', 'recovery')(v.phase) &&
  bool(v.busy) &&
  numbers(v, 'facing age id') &&
  nullable(
    v.spec,
    (s) =>
      record(s) &&
      text(s.name) &&
      numbers(s, 'startup active recovery damage reach top bottom knockX knockY growth stun'),
  );
const slots: Check = (v) =>
  record(v) &&
  fields(v, bool, 'canRecover recovering grabbed launching') &&
  nullable(v.attack, attack) &&
  nullable(
    v.shield,
    (s) =>
      record(s) &&
      oneOf('idle', 'guard', 'release', 'broken')(s.phase) &&
      fields(s, bool, 'busy guarding') &&
      numbers(s, 'strength'),
  ) &&
  nullable(
    v.dodge,
    (s) =>
      record(s) &&
      oneOf('idle', 'startup', 'evade', 'recovery')(s.phase) &&
      fields(s, bool, 'busy evading airReady inAir') &&
      numbers(s, 'vx vy'),
  ) &&
  nullable(
    v.ledge,
    (s) =>
      record(s) &&
      oneOf('idle', 'hang', 'climb')(s.phase) &&
      fields(s, bool, 'busy protected airReady') &&
      numbers(s, 'x y side age'),
  ) &&
  nullable(
    v.grab,
    (s) =>
      record(s) &&
      oneOf('idle', 'startup', 'active', 'hold', 'recovery')(s.phase) &&
      bool(s.busy) &&
      numbers(s, 'age facing throwX throwY') &&
      oneOf(null, 0, 1)(s.victim),
  ) &&
  nullable(v.special, (s) => record(s) && numbers(s, 'charges progress') && bool(s.busy));
const effects: Check = (v) =>
  array(
    (e) =>
      record(e) &&
      oneOf('under', 'over')(e.layer) &&
      array(finite, 144_000)(e.pixels) &&
      (e.pixels as number[]).length % 6 === 0 &&
      (e.pixels as number[]).every((n, i) => i % 6 !== 0 || n === 0 || n === 1),
    32,
  )(v) && (v as Array<{ pixels: number[] }>).reduce((sum, e) => sum + e.pixels.length, 0) <= 144_000;

/** Validate every nested presentation collection before it touches live state.
 * Authority is still trusted for outcomes; malformed data cannot become renderer objects. */
export function validPresentation(v: Record<string, unknown>): boolean {
  if (
    !array(
      (f) =>
        record(f) &&
        player(f.player) &&
        fighter(f.fighter) &&
        numbers(f.body, BODY_FIELDS.join(' ')) &&
        finite(f.concealment) &&
        effects(f.effects),
      2,
      2,
    )(v.fighters)
  )
    return false;
  const c = v.camera,
    a = v.arena;
  if (
    !record(c) ||
    !numbers(c, 'x y tx ty zoom viewScale') ||
    (c.zoom as number) <= 0 ||
    (c.viewScale as number) < 0.1 ||
    (c.viewScale as number) > 10 ||
    !record(a)
  )
    return false;
  const m = a.match,
    b = a.bout;
  if (
    !record(m) ||
    !oneOf('idle', 'countdown', 'fighting', 'finished')(m.state) ||
    !numbers(m, 'remainingTicks countdown') ||
    !oneOf(null, 0, 1)(m.winner) ||
    !oneOf(null, 'stocks', 'timeout', 'draw')(m.reason) ||
    !numbers(m.zone, 'left right top bottom') ||
    !array((f) => numbers(f, 'stocks volatility respawn protection'), 2, 2)(m.fighters) ||
    !record(b) ||
    !oneOf('idle', 'fighting', 'won')(b.state) ||
    !oneOf(null, 0, 1)(b.winner) ||
    !numbers(b, 'startedAt endedAt') ||
    !Array.isArray(b.downs) ||
    b.downs.length > 100 ||
    !array(slots, 2, 2)(a.slots)
  )
    return false;
  return (
    numbers(v, 'bloom shake') &&
    array(
      (p) => record(p) && numbers(p, 'x y vx vy life age') && text(p.type) && fields(p, bool, 'charging hostile'),
      4096,
    )(v.projectiles) &&
    array(
      (p) =>
        record(p) &&
        numbers(p, 'x y vx vy color life grav glow value hostileDmg') &&
        fields(p, bool, 'homing looseDebris deposit') &&
        nullable(p.type, finite),
      10000,
    )(v.particles) &&
    array((a) => record(a) && numbers(a, 'life intensity') && array(point, 2048)(a.pts), 1024)(v.arcs) &&
    array(
      (l) =>
        record(l) &&
        numbers(l, 'x y r g b intensity radius bloom flicker flickerPhase') &&
        oneOf('soft', 'linear', 'sharp')(l.falloff) &&
        bool(l.occluded),
      1024,
    )(v.lights) &&
    array(
      (s) =>
        record(s) &&
        text(s.id) &&
        ['x', 'y', 'gain', 'pitch', 'rate', 'delay'].every((k) => optional(s[k], finite)),
      64,
    )(v.sounds) &&
    optional(v.moments, array(moment, 32))
  );
}
