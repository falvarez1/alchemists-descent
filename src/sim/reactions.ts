import type { Ctx } from '@/core/types';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';

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
  if (life !== undefined) w.life[i] = life + ((Math.random() * (life * 0.3)) | 0);
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
    const rule = REACTIONS[ruleIdx - 1];
    if (Math.random() >= rule.chance) continue;
    const selfIsA = rule.a === t;
    const ci = w.idx(x, y);
    applyProduct(ctx, ci, selfIsA ? rule.aTo : rule.bTo, selfIsA ? rule.aLife : rule.bLife);
    applyProduct(ctx, ni, selfIsA ? rule.bTo : rule.aTo, selfIsA ? rule.bLife : rule.aLife);
    if (rule.sparkColor !== undefined && Math.random() < 0.2) {
      ctx.particles.spawn(
        x,
        y - 1,
        (Math.random() - 0.5) * 0.4,
        -0.3 - Math.random() * 0.4,
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
