import type { FighterId } from '@/content/fighters';
import { tunableBody, type BodyProfile } from '@/core/fighterBody';

/**
 * The ten fighters' bodies (docs/arena/FIGHTER-PHYSICS.md section 4, docs/arena/ROSTER-IDENTITY.md for the reasoning).
 * Multipliers on the Alchemist; a field not listed is 1. Starting numbers: the telemetry passes
 * (docs/arena/TELEMETRY-AND-BALANCE.md) move them, always inside `BODY_RANGES`.
 *
 * What each body says, in a line:
 *  Ilyra   light-ish and quick, a touch floaty: rushdown.         Brann   the heaviest, slow, planted, falls hard.
 *  Sable   average body, a better climb, a little less jet.       Mara    the floatiest: low gravity, slow fall, a big jet.
 *  Kest    the fastest and slidey (his passive climbs 1.5x).     Nox     plain on purpose; his strength is sight.
 *  Edda    light and floaty with the lowest health.               Selene  the slidiest body: momentum is the point.
 *  Rusk    second heaviest, very planted, hits hard.              Thorne  heavy, slow, rooted.
 */
/** Live tuning data (mutable on purpose, like config/params): the param registry turns these for a balance run. */
export const FIGHTER_BODIES: Readonly<Record<FighterId, BodyProfile>> = {
  'ilyra-voss': tunableBody({ mass: 0.95, run: 1.1, airControl: 1.1, jump: 1.05, maxHp: 0.95, dealt: 1.429 }),
  'brann-rook': tunableBody({
    mass: 1.45, run: 0.78, accel: 0.85, friction: 1.4, airControl: 0.75, jump: 0.85, gravity: 1.25, fall: 1.25,
    jetFuel: 0.55, jetThrust: 0.75, maxHp: 1.35, dealt: 0.467, climb: 0.8, crawl: 0.9, stagger: 0.8,
  }),
  'sable-fen': tunableBody({ mass: 0.85, run: 1.05, accel: 1.1, airControl: 1.05, jetFuel: 0.9, jetThrust: 0.95, maxHp: 0.95, climb: 1.2, crawl: 1.15, dealt: 1.356 }),
  'mara-quell': tunableBody({
    mass: 0.8, run: 0.9, accel: 0.95, friction: 0.75, airControl: 1.2, gravity: 0.8, fall: 0.75,
    jetFuel: 1.5, jetThrust: 1.1, maxHp: 0.85, dealt: 1.69, climb: 0.9,
  }),
  'kest-rel': tunableBody({
    mass: 0.85, run: 1.25, accel: 1.1, friction: 0.7, airControl: 1.15, jump: 1.1,
    jetFuel: 1.1, jetThrust: 1.05, maxHp: 0.9, coyote: 1.3, dealt: 1.317 }),
  'nox-calder': tunableBody({ friction: 1.1, airControl: 0.95, run: 0.95, jump: 0.95, dealt: 1.381 }),
  'edda-morrow': tunableBody({
    mass: 0.75, run: 0.95, airControl: 1.15, gravity: 0.85, fall: 0.85, jetFuel: 1.3, jetThrust: 1.05, maxHp: 0.75, climb: 0.9, dealt: 0.375 }),
  'selene-wraith': tunableBody({
    mass: 0.9, run: 1.15, accel: 0.85, friction: 0.3, airControl: 1.2, jump: 1.1, maxHp: 0.9, coyote: 1.2, dealt: 1.247 }),
  'rusk-emberjaw': tunableBody({
    mass: 1.3, run: 0.9, accel: 0.9, friction: 1.5, airControl: 0.8, jump: 0.85, gravity: 1.2, fall: 1.2,
    jetFuel: 0.6, jetThrust: 0.8, maxHp: 1.25, dealt: 1.475, climb: 0.9, stagger: 0.85,
  }),
  'father-thorne': tunableBody({
    mass: 1.15, run: 0.82, accel: 0.85, friction: 1.7, airControl: 0.8, jump: 0.9, jetFuel: 0.8, jetThrust: 0.9, maxHp: 1.1, dealt: 0.522 }),
};

/** The body of a fighter id (null = the classic Alchemist: every field 1). */
export function bodyFor(id: FighterId | null): Readonly<BodyProfile> {
  return id ? FIGHTER_BODIES[id] : tunableBody();
}
