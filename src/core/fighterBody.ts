/**
 * A FIGHTER'S BODY (docs/arena/FIGHTER-PHYSICS.md): the multipliers that make one fighter move, fall and get hit
 * differently from another. Every field is a multiplier on the Alchemist (1 = unchanged), so `NEUTRAL_BODY`
 * reproduces today's player exactly and the classic hero never notices this file.
 *
 * Pure data and arithmetic (no Ctx, no DOM): the fighter system composes a body from a fighter's profile and its
 * running modifiers (a glide that lowers gravity while it lasts), and `entities/Player` reads the result once per
 * update. Per-fighter values live in `content/fighterBodies`; they are NEVER written into `ctx.params.player`
 * (`PLAYER_PARAMS`: shared, live-tunable and persisted).
 */
export interface BodyProfile {
  /** Knockback taken = impulse / mass: heavy fighters are launched less. */
  mass: number;
  /** x the player's maximum health (the health ratio is kept). */
  maxHp: number;
  /** x run speed and its caps. */
  run: number;
  /** x ground acceleration. */
  accel: number;
  /** Traction: x how hard a release stops you on the ground (low = slidey, high = planted). */
  friction: number;
  /** x air acceleration and glide speed. */
  airControl: number;
  /** x jump HEIGHT (independent of gravity: the launch speed is scaled to give this apex). */
  jump: number;
  /** x how hard releasing jump cuts the rise (above 1 cuts harder). */
  jumpCut: number;
  /** x air gravity (the liquid's is unchanged). */
  gravity: number;
  /** x maximum fall speed and the dive speeds. */
  fall: number;
  /** The levitation jet: x thrust, x tank (applied at equip), x burn per tick, x regen on the ground. */
  jetThrust: number;
  jetFuel: number;
  jetBurn: number;
  jetRegen: number;
  /** x coyote frames (ledge forgiveness) and x jump-buffer frames. */
  coyote: number;
  buffer: number;
  /** x wall-climb and mantle speed (composes with a kit's own `climbScale` modifier). */
  climb: number;
  /** x crawl and crouch speed. */
  crawl: number;
  /** x stagger frames after a hit, x invulnerability frames after a hit. */
  stagger: number;
  invuln: number;
  /** x damage this fighter deals (a body-level power knob). */
  dealt: number;
}

export type BodyField = keyof BodyProfile;

export const BODY_FIELDS: readonly BodyField[] = [
  'mass', 'maxHp', 'run', 'accel', 'friction', 'airControl', 'jump', 'jumpCut', 'gravity', 'fall',
  'jetThrust', 'jetFuel', 'jetBurn', 'jetRegen', 'coyote', 'buffer', 'climb', 'crawl', 'stagger', 'invuln', 'dealt',
];

export const NEUTRAL_BODY: Readonly<BodyProfile> = Object.freeze({
  mass: 1, maxHp: 1, run: 1, accel: 1, friction: 1, airControl: 1, jump: 1, jumpCut: 1, gravity: 1, fall: 1,
  jetThrust: 1, jetFuel: 1, jetBurn: 1, jetRegen: 1, coyote: 1, buffer: 1, climb: 1, crawl: 1, stagger: 1, invuln: 1, dealt: 1,
});

/** The fields a running effect (a glide, a stomp, a slide) may bend while it lasts. Multipliers, composed by product. */
export type BodyMod = Partial<Pick<BodyProfile, 'mass' | 'run' | 'accel' | 'friction' | 'airControl' | 'jump' | 'gravity' | 'fall' | 'jetThrust' | 'jetBurn'>>;

export const BODY_MOD_FIELDS: readonly (keyof BodyMod)[] = ['mass', 'run', 'accel', 'friction', 'airControl', 'jump', 'gravity', 'fall', 'jetThrust', 'jetBurn'];

/** The declared range of every field: a profile is valid inside it, and the balance tuner may move a value only inside it. */
export const BODY_RANGES: Readonly<Record<BodyField, { min: number; max: number }>> = Object.freeze({
  mass: { min: 0.6, max: 1.6 },
  maxHp: { min: 0.6, max: 1.6 },
  run: { min: 0.7, max: 1.4 },
  accel: { min: 0.4, max: 1.6 },
  friction: { min: 0.2, max: 2 },
  airControl: { min: 0.5, max: 1.4 },
  jump: { min: 0.7, max: 1.3 },
  jumpCut: { min: 0.7, max: 1.3 },
  gravity: { min: 0.6, max: 1.4 },
  fall: { min: 0.6, max: 1.5 },
  jetThrust: { min: 0.4, max: 1.8 },
  jetFuel: { min: 0.4, max: 1.8 },
  jetBurn: { min: 0.4, max: 1.8 },
  jetRegen: { min: 0.4, max: 1.8 },
  coyote: { min: 0.5, max: 2 },
  buffer: { min: 0.5, max: 2 },
  climb: { min: 0.6, max: 1.6 },
  crawl: { min: 0.6, max: 1.4 },
  stagger: { min: 0.4, max: 1.6 },
  invuln: { min: 0.5, max: 1.5 },
  // (the balance lever: a fighter's body is its feel and its health is its fantasy, so the tuner turns THIS, over a wide range)
  dealt: { min: 0.6, max: 1.6 },
});

export function cloneBody(from: Readonly<BodyProfile>): BodyProfile {
  return { ...from };
}

/** A complete profile from a partial one (missing fields are 1). */
export function makeBody(partial: Readonly<Partial<BodyProfile>> = {}): Readonly<BodyProfile> {
  return Object.freeze({ ...NEUTRAL_BODY, ...partial });
}

/**
 * A complete profile from a partial one, as plain MUTABLE data: the ten fighters' bodies are live tuning data like `config/params`
 * (the param registry writes them for a balance run; `FighterSystem` re-reads them whenever its modifiers change), so unlike
 * `NEUTRAL_BODY` they are not frozen.
 */
export function tunableBody(partial: Readonly<Partial<BodyProfile>> = {}): BodyProfile {
  return { ...NEUTRAL_BODY, ...partial };
}

/** One running effect multiplied into a body, in place. */
export function applyBodyMod(out: BodyProfile, mod: Readonly<BodyMod>): void {
  for (const f of BODY_MOD_FIELDS) {
    const k = mod[f];
    if (k !== undefined) out[f] *= k;
  }
}

/** `out = base x product(mods)`, in place (the fighter system keeps one live body and never allocates per tick). */
export function composeBody(out: BodyProfile, base: Readonly<BodyProfile>, mods: Iterable<Readonly<BodyMod>>): BodyProfile {
  for (const f of BODY_FIELDS) out[f] = base[f];
  for (const mod of mods) applyBodyMod(out, mod);
  return out;
}

/** The fields of `body` that fall outside their declared range (a test and the tuner use this). */
export function bodyViolations(body: Readonly<BodyProfile>): BodyField[] {
  return BODY_FIELDS.filter((f) => !(body[f] >= BODY_RANGES[f].min && body[f] <= BODY_RANGES[f].max));
}

/** The seven numbers a person reads off a fighter, 0..1 against the declared ranges (the panel's Body card). */
export function bodyBars(body: Readonly<BodyProfile>): Array<{ label: string; value: number; unit: number }> {
  const bar = (f: BodyField, v: number): number => (v - BODY_RANGES[f].min) / (BODY_RANGES[f].max - BODY_RANGES[f].min);
  return [
    { label: 'Weight', value: body.mass, unit: bar('mass', body.mass) },
    { label: 'Health', value: body.maxHp, unit: bar('maxHp', body.maxHp) },
    { label: 'Run', value: body.run, unit: bar('run', body.run) },
    { label: 'Traction', value: body.friction, unit: bar('friction', body.friction) },
    { label: 'Air control', value: body.airControl, unit: bar('airControl', body.airControl) },
    { label: 'Jump', value: body.jump, unit: bar('jump', body.jump) },
    { label: 'Gravity', value: body.gravity, unit: bar('gravity', body.gravity) },
    { label: 'Fall speed', value: body.fall, unit: bar('fall', body.fall) },
    { label: 'Levitation', value: body.jetFuel, unit: bar('jetFuel', body.jetFuel) },
    { label: 'Power', value: body.dealt, unit: bar('dealt', body.dealt) },
  ];
}
