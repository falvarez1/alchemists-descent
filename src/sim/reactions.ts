import type { Ctx } from '@/core/types';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';
import { fxRandom, simRandom } from '@/core/simRandom';

/**
 * ===================== THE ALCHEMY TABLE =====================
 * Data-driven cell-pair reactions: `a` touching `b` transmutes both, at a
 * per-contact chance. This is the extensible half of the sim's chemistry —
 * the bespoke pair rules that predate it (water+lava quench, fire's fuel
 * list, acid corrosion) stay where they are; entries here are checked at
 * the dispatcher BEFORE a liquid's own handler runs, so a listed pair wins
 * over generic corrosion/flow for that substep.
 *
 * Design rails:
 *  - every entry needs at least one LIQUID participant (the hook runs on
 *    liquid cells only — cheap, and true of real chemistry here anyway);
 *  - products must be existing cells (the grid explains everything);
 *  - consumables stay consumable (economy guard: catalyst burns grain by
 *    grain, exactly as finite as the dust you found).
 */
export interface CellReaction {
  a: Cell;
  b: Cell;
  /** what `a` becomes (null = unchanged) */
  aTo: Cell | null;
  /** what `b` becomes (null = unchanged; Cell.Empty = consumed) */
  bTo: Cell | null;
  /** per contact-check probability */
  chance: number;
  /** product cell lifetimes (gases need one to eventually clear) */
  aLife?: number;
  bLife?: number;
  /** feedback: an emissive fleck in this colour on reaction (throttled) */
  sparkColor?: number;
}

export const REACTIONS: readonly CellReaction[] = [
  // VITRIFY: acid boiling against molten rock etches it into glass — the
  // acid flashes off as vapor. Carving windows into a lava wall is now a
  // strategy (and a way to waste a whole flask of acid).
  {
    a: Cell.Acid,
    b: Cell.Lava,
    aTo: Cell.Steam,
    bTo: Cell.Glass,
    chance: 0.45,
    aLife: 120,
    sparkColor: packRGB(190, 255, 170),
  },
  // TRANSMUTE: the philosopher's dust turns spilled lifeblood into healing
  // mist — and is CONSUMED grain for grain (the catalyst economy guard).
  {
    a: Cell.Blood,
    b: Cell.Catalyst,
    aTo: Cell.Healium,
    bTo: Cell.Empty,
    chance: 0.3,
    sparkColor: packRGB(255, 170, 210),
  },
  // DIGEST: acid dissolves slime into toxic sludge, spending itself.
  {
    a: Cell.Slime,
    b: Cell.Acid,
    aTo: Cell.Toxic,
    bTo: Cell.Empty,
    chance: 0.25,
    sparkColor: packRGB(120, 200, 60),
  },
  // DILUTE: running water slowly cleanses toxic sludge — a big enough pool
  // is a cure, and flooding a poisoned gallery genuinely fixes it.
  {
    a: Cell.Toxic,
    b: Cell.Water,
    aTo: Cell.Water,
    bTo: null,
    chance: 0.004,
  },
];

/**
 * ============== THE SECRET WORLD REACTION (one per run) ==============
 * Every expedition seed rolls ONE hidden extra entry from this curated pool
 * into the table — the run where oil gasifies into swamp air, or ash
 * remembers blood. Deterministic from the run seed (a daily seed shares its
 * secret), discovered by accident, announced ONCE with a toast when it
 * first fires near the wizard.
 *
 * Pool rails (test-enforced): a liquid participant, products drawn from
 * loose materials only (never gold, metal, or structural rock — a secret
 * must surprise, not mint money or dissolve floors), and no pair collides
 * with the base table.
 */
export interface SecretReaction extends CellReaction {
  name: string;
}

export const SECRET_REACTION_POOL: readonly SecretReaction[] = [
  {
    name: 'THE ASH REMEMBERS BLOOD',
    a: Cell.Water,
    b: Cell.Ash,
    aTo: Cell.Blood,
    bTo: Cell.Empty,
    chance: 0.12,
    sparkColor: packRGB(200, 40, 60),
  },
  {
    name: 'OIL RISES AS SWAMP AIR',
    a: Cell.Oil,
    b: Cell.Water,
    aTo: Cell.MarshGas,
    bTo: null,
    chance: 0.03,
    sparkColor: packRGB(170, 190, 90),
  },
  {
    name: 'THE DEEP COOKS FUEL',
    a: Cell.Slime,
    b: Cell.Lava,
    aTo: Cell.Coal,
    bTo: null,
    chance: 0.2,
    sparkColor: packRGB(90, 70, 60),
  },
  {
    name: 'COAL WEEPS',
    a: Cell.Water,
    b: Cell.Coal,
    aTo: Cell.Oil,
    bTo: null,
    chance: 0.05,
    sparkColor: packRGB(70, 60, 45),
  },
  {
    name: 'FROST TAKES THE POISON',
    a: Cell.Toxic,
    b: Cell.Snow,
    aTo: Cell.Ice,
    bTo: null,
    chance: 0.15,
    sparkColor: packRGB(170, 220, 255),
  },
  {
    name: 'POISON BLOOMS PALE MERCY',
    a: Cell.Blood,
    b: Cell.Toxic,
    aTo: Cell.Healium,
    bTo: Cell.Empty,
    chance: 0.1,
    sparkColor: packRGB(255, 170, 210),
  },
  {
    name: 'THE UNSTABLE MELT',
    a: Cell.Acid,
    b: Cell.Snow,
    aTo: Cell.Teleportium,
    bTo: Cell.Empty,
    chance: 0.12,
    sparkColor: packRGB(160, 80, 240),
  },
  {
    // NOTE the pair-selection rail this slot taught us: slime+water is the
    // rillback's AUTHORED HABITAT, so any secret over that pair rewrites a
    // generated lair the moment it settles (two drafts died here — one
    // self-propagating tide that drained pools, one vine crust that ate the
    // lair's own signature). Secrets must use pairs no habitat is built from.
    name: 'THE BONES MAKE POWDER',
    a: Cell.Acid,
    b: Cell.Ash,
    aTo: Cell.Empty,
    bTo: Cell.Gunpowder,
    chance: 0.15,
    sparkColor: packRGB(200, 190, 120),
  },
];

const SECRET_SENTINEL = 255;
let secretRule: SecretReaction | null = null;
let secretSeed: number | null = null;
let secretDiscovered = false;

/** Derive the pool index for a run seed (exported for tests/probes). */
export function secretIndexForSeed(seed: number): number {
  const h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 13;
  return h % SECRET_REACTION_POOL.length;
}

/**
 * Re-derive the run's secret from ctx.state.worldSeed. Called once per frame
 * from the simulation (a single integer compare when nothing changed), so
 * every mode — new run, resume, playtest, sandbox — picks it up without
 * touching any of the run-start code paths.
 */
export function refreshSecretReaction(ctx: Ctx): void {
  const seed = ctx.state.worldSeed >>> 0;
  if (seed === secretSeed) return;
  if (secretRule) {
    RULE[secretRule.a * CELL_COUNT + secretRule.b] = 0;
    RULE[secretRule.b * CELL_COUNT + secretRule.a] = 0;
  }
  secretSeed = seed;
  secretDiscovered = false;
  secretRule = SECRET_REACTION_POOL[secretIndexForSeed(seed)];
  RULE[secretRule.a * CELL_COUNT + secretRule.b] = SECRET_SENTINEL;
  RULE[secretRule.b * CELL_COUNT + secretRule.a] = SECRET_SENTINEL;
  // surfaced for probes/inspector; the toast below is the player's reveal
  ctx.state.secretReaction = { a: secretRule.a, b: secretRule.b, name: secretRule.name };
}

/** rule index + 1 per ordered (self, neighbor) pair; 0 = no rule */
const RULE = new Uint8Array(CELL_COUNT * CELL_COUNT);
for (let i = 0; i < REACTIONS.length; i++) {
  const r = REACTIONS[i];
  RULE[r.a * CELL_COUNT + r.b] = i + 1;
  RULE[r.b * CELL_COUNT + r.a] = i + 1; // symmetric: either side may be "self"
}

const CARDINALS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
] as const;

function applyProduct(ctx: Ctx, i: number, to: Cell | null, life: number | undefined): void {
  if (to === null) return;
  const w = ctx.world;
  if (to === Cell.Empty) {
    w.clearCellAt(i);
    return;
  }
  w.replaceCellAt(i, to, (COLOR_FN[to] ?? (() => packRGB(200, 200, 200)))());
  if (life !== undefined) w.life[i] = life + ((simRandom() * (life * 0.3)) | 0);
}

/**
 * Check the four neighbours of a LIQUID cell against the alchemy table and
 * apply the first rule that rolls. Returns true when a reaction consumed
 * this cell's substep (the dispatcher then skips its normal handler).
 */
export function maybeReact(ctx: Ctx, x: number, y: number, t: number): boolean {
  const w = ctx.world;
  const base = t * CELL_COUNT;
  for (let k = 0; k < CARDINALS.length; k++) {
    const nx = x + CARDINALS[k][0];
    const ny = y + CARDINALS[k][1];
    if (!w.inBounds(nx, ny)) continue;
    const ni = w.idx(nx, ny);
    const n = w.types[ni];
    const ruleIdx = RULE[base + n];
    if (ruleIdx === 0) continue;
    const isSecret = ruleIdx === SECRET_SENTINEL;
    const rule = isSecret ? (secretRule as CellReaction) : REACTIONS[ruleIdx - 1];
    if (simRandom() >= rule.chance) continue;
    const selfIsA = rule.a === t;
    const ci = w.idx(x, y);
    applyProduct(ctx, ci, selfIsA ? rule.aTo : rule.bTo, selfIsA ? rule.aLife : rule.bLife);
    applyProduct(ctx, ni, selfIsA ? rule.bTo : rule.aTo, selfIsA ? rule.bLife : rule.aLife);
    if (isSecret && !secretDiscovered) {
      // the reveal: only when the wizard could plausibly have SEEN it happen
      const p = ctx.player;
      if (p && Math.abs(p.x - x) < 90 && Math.abs(p.y - y) < 70) {
        secretDiscovered = true;
        ctx.events.emit('toast', { text: `SECRET ALCHEMY — ${(secretRule as SecretReaction).name}` });
        ctx.audio.learn();
      }
    }
    if (rule.sparkColor !== undefined && fxRandom() < 0.2) {
      ctx.particles.spawn(
        x,
        y - 1,
        (fxRandom() - 0.5) * 0.4,
        -0.3 - fxRandom() * 0.4,
        null,
        rule.sparkColor,
        12,
        { grav: -0.01, glow: 1.8 },
      );
    }
    return true;
  }
  return false;
}
