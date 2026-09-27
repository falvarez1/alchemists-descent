import type { Ctx } from '@/core/types';
import { Cell, isGas, isLiquid, isSoftGrowth, isSolid } from '@/sim/CellType';
import { ashColor, emberColor, fireColor, packRGB, steamColor, unpackB, unpackG, unpackR } from '@/sim/colors';
import { fxRandom, simRandom } from '@/core/simRandom';

/* ============================================================
 * FLORA cells (wave 2): Leaf, Trunk, Seed.
 *
 * Everything a plant does is a rule over real cells:
 *  - a LEAF holds on while it is within LEAF_REACH leaf-steps of wood or rock
 *    (its life plane stores that distance), and otherwise lets go and
 *    flutters down, rests as litter, or floats on water;
 *  - a TRUNK cell smoulders in place when lit (life = burn countdown) and
 *    chars through, which is how a fire at the foot of a tree brings it down
 *    (felling itself is game/Flora: an unsupported Trunk cluster topples);
 *  - a SEED is held on its plant until shaken loose, then a powder; a thirsty
 *    seed that touches water drinks it and sprouts a real root ladder.
 * ============================================================ */

/** Farthest (in leaf-steps) a leaf may sit from wood or rock and still hold on. */
export const LEAF_REACH = 9;
/** life code of a leaf resting on the ground, a branch, or a pool: not attached. */
export const LEAF_LITTER = -(LEAF_REACH + 3);
/** life code for an attached leaf at `d` leaf-steps from its anchor. */
export function leafAttachedLife(d: number): number {
  return -1 - Math.max(0, Math.min(LEAF_REACH, d));
}

/** Seed life codes (negative = dormant). */
export const SEED_THIRSTY_HELD = -1;
export const SEED_GLOW_HELD = -2;
export const SEED_THIRSTY_LOOSE = -3;
export const SEED_GLOW_LOOSE = -4;
/** A glowseed: held or loose. */
export function isGlowseedLife(life: number): boolean {
  return life === SEED_GLOW_HELD || life === SEED_GLOW_LOOSE;
}

/** Cap on the sprout energy (cells of ladder) one drink can buy. */
export const SPROUT_MAX_ENERGY = 120;
/** Cells of ladder per cell of water drunk at germination. */
export const SPROUT_PER_WATER = 1.6;
/** Base ladder a wet seed always manages, however little it drank. */
export const SPROUT_BASE = 22;
/** Ladder rung spacing (cells of stalk between rungs). Well inside the
 *  starting jump, so the ladder climbs by hopping rung to rung. */
export const SPROUT_RUNG_EVERY = 12;
/** Most water cells one germination drinks (a flask pour, a small puddle). */
const SPROUT_DRINK_MAX = 70;

const N8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];
const N4: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** What a leaf can hang from: wood (living or dead), vines, or load-bearing rock. */
export function leafAnchor(t: number): boolean {
  return t === Cell.Trunk || t === Cell.Wood || t === Cell.Vines || (isSolid(t) && !isSoftGrowth(t));
}

/** Open space a loose leaf or seed can drift into. */
function airy(t: number): boolean {
  return t === Cell.Empty || isGas(t);
}

/** Cells whose loss or whose presence a plant can hold on to. */
function plantPart(t: number): boolean {
  return t === Cell.Trunk || t === Cell.Leaf || t === Cell.Vines;
}

/* ---------------------------------- LEAF ---------------------------------- */

export function handleLeaf(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  const life = w.life[ci];

  if (life <= 0 && life !== LEAF_LITTER) {
    // Attached (or freshly placed): recompute the distance to an anchor from
    // the 8 neighbours. A leaf beside wood/rock is 0 steps out; otherwise one
    // more than its best attached neighbour. Beyond LEAF_REACH it lets go.
    let best = LEAF_REACH + 1;
    for (let k = 0; k < 8; k++) {
      const nx = x + N8[k][0], ny = y + N8[k][1];
      if (!w.inBounds(nx, ny)) continue;
      const ni = w.idx(nx, ny);
      const t = w.types[ni];
      if (leafAnchor(t)) { best = 0; break; }
      if (t === Cell.Leaf) {
        const nl = w.life[ni];
        // An attached neighbour at distance -nl-1 puts this leaf one step further out.
        if (nl < 0 && nl !== LEAF_LITTER && -nl < best) best = -nl;
      }
    }
    if (best > LEAF_REACH) {
      // Nothing holds it: it lets go.
      w.life[ci] = 1 + Math.floor(simRandom() * 7);
      w.activity.touchIndex(ci);
      return;
    }
    const next = leafAttachedLife(best);
    if (next !== life) {
      w.life[ci] = next;
      // A changed distance must propagate: wake the neighbourhood.
      w.activity.touchIndex(ci);
    }
    return;
  }

  if (life === LEAF_LITTER) {
    // Resting litter / a floating pad: it only moves if what held it goes.
    const below = w.inBounds(x, y + 1) ? w.types[w.idx(x, y + 1)] : Cell.Wall;
    const above = w.inBounds(x, y - 1) ? w.types[w.idx(x, y - 1)] : Cell.Empty;
    if (airy(below) || isLiquid(above)) {
      w.life[ci] = 1 + Math.floor(simRandom() * 7);
      w.activity.touchIndex(ci);
    }
    return;
  }

  // Loose (life > 0): a leaf is light. It falls slowly, rocks side to side,
  // and rests on whatever catches it — or floats up out of water.
  w.life[ci] = life >= 30000 ? 1 : life + 1;
  const above = w.inBounds(x, y - 1) ? w.types[w.idx(x, y - 1)] : Cell.Wall;
  if (isLiquid(above) && above !== Cell.Lava) {
    // Submerged: bob up toward the surface.
    if (simRandom() < 0.5) w.swap(x, y, x, y - 1);
    return;
  }
  const below = w.inBounds(x, y + 1) ? w.types[w.idx(x, y + 1)] : Cell.Wall;
  if (airy(below)) {
    const roll = simRandom();
    if (roll < 0.42) {
      // The flutter: a fall that drifts, alternating with the leaf's own phase.
      const sway = ((life >> 3) & 1) === 0 ? 1 : -1;
      const drift = simRandom() < 0.45 ? sway : 0;
      const tx = x + drift;
      if (drift !== 0 && w.inBounds(tx, y + 1) && airy(w.types[w.idx(tx, y + 1)])) w.swap(x, y, tx, y + 1);
      else w.swap(x, y, x, y + 1);
    } else if (roll < 0.52) {
      const dir = simRandom() < 0.5 ? 1 : -1;
      if (w.inBounds(x + dir, y) && airy(w.types[w.idx(x + dir, y)])) w.swap(x, y, x + dir, y);
    }
    return;
  }
  if (isLiquid(below)) {
    if (below === Cell.Lava) {
      w.replaceCellAt(ci, Cell.Fire, fireColor());
      w.life[ci] = 14;
      return;
    }
    // On the surface: a floating leaf. It rests there as a pad.
    w.life[ci] = LEAF_LITTER;
    w.activity.touchIndex(ci);
    return;
  }
  // Landed. Litter piles loosely: a leaf on a leaf slides off to one side now and then.
  if (simRandom() < 0.3) {
    const dir = simRandom() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && airy(w.types[w.idx(x + dir, y + 1)]) && airy(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
  }
  w.life[ci] = LEAF_LITTER;
  w.activity.touchIndex(ci);
}

/* ---------------------------------- TRUNK ---------------------------------- */

/** Darken a bark colour toward char, with an ember cast while it is alight. */
function scorch(color: number, burning: boolean): number {
  const r = unpackR(color), g = unpackG(color), b = unpackB(color);
  if (burning) {
    const glow = fxRandom() < 0.35 ? 1 : 0;
    return packRGB(Math.min(255, Math.round(r * 0.72 + 70 + glow * 60)), Math.round(g * 0.55 + 18 + glow * 22), Math.round(b * 0.4 + 6));
  }
  return packRGB(Math.round(r * 0.8), Math.round(g * 0.74), Math.round(b * 0.7));
}

/** Light a living-wood cell: it smoulders in place for burnDuration substeps. */
export function igniteTrunk(ctx: Ctx, i: number): void {
  const w = ctx.world;
  if (w.types[i] !== Cell.Trunk || w.life[i] > 0) return;
  const P = ctx.params.materials[Cell.Trunk];
  w.life[i] = (P.burnDuration ?? 240) + Math.floor(simRandom() * 80);
  w.activity.touchIndex(i);
}

export function handleTrunk(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  const life = w.life[ci];
  if (life === 0) {
    // Freshly painted living wood is simply mature wood.
    w.life[ci] = -1;
    return;
  }
  if (life < 0) return;

  // SMOULDERING. Water puts it out (with a hiss); otherwise it licks flame into
  // the air around it, creeps into neighbouring wood, and finally chars away.
  for (let k = 0; k < 4; k++) {
    const nx = x + N4[k][0], ny = y + N4[k][1];
    if (!w.inBounds(nx, ny)) continue;
    const ni = w.idx(nx, ny);
    if (w.types[ni] === Cell.Water) {
      w.life[ci] = -1;
      w.colors[ci] = scorch(w.colors[ci], false);
      if (simRandom() < 0.35) {
        w.replaceCellAt(ni, Cell.Steam, steamColor());
        w.life[ni] = 30;
      }
      w.activity.touchIndex(ci);
      return;
    }
  }
  const remaining = life - 1;
  w.life[ci] = remaining;
  if ((remaining & 7) === 0) w.colors[ci] = scorch(w.colors[ci], true);

  // Flame licks into open air around the glowing wood (mostly upward).
  if (simRandom() < 0.22) {
    const up = simRandom() < 0.6;
    const fx = up ? x + (simRandom() < 0.5 ? 0 : simRandom() < 0.5 ? -1 : 1) : x + (simRandom() < 0.5 ? -1 : 1);
    const fy = up ? y - 1 : y;
    if (w.inBounds(fx, fy)) {
      const fi = w.idx(fx, fy);
      const ft = w.types[fi];
      if (ft === Cell.Empty || ft === Cell.Smoke) {
        w.replaceCellAt(fi, Cell.Fire, fireColor());
        w.life[fi] = 10 + Math.floor(simRandom() * 14);
      } else if (ft === Cell.Leaf) {
        w.replaceCellAt(fi, Cell.Fire, fireColor());
        w.life[fi] = 20;
      }
    }
  }
  // Creep: the burn eats into neighbouring living wood, faster upward (heat rises).
  const P = ctx.params.materials[Cell.Trunk];
  const chance = P.igniteChance ?? 0.012;
  for (let k = 0; k < 4; k++) {
    const nx = x + N4[k][0], ny = y + N4[k][1];
    if (!w.inBounds(nx, ny)) continue;
    const ni = w.idx(nx, ny);
    if (w.types[ni] !== Cell.Trunk || w.life[ni] > 0) continue;
    const bias = N4[k][1] < 0 ? 2.6 : N4[k][1] > 0 ? 0.6 : 1;
    if (simRandom() < chance * bias) igniteTrunk(ctx, ni);
  }
  if (fxRandom() < 0.006) {
    ctx.particles.spawn(x + fxRandom(), y, (fxRandom() - 0.5) * 0.4, -0.3 - fxRandom() * 0.4, null,
      packRGB(255, 140 + Math.floor(fxRandom() * 60), 40), 24, { grav: -0.01, glow: 2.2 });
  }
  if (remaining > 0) return;
  // Charred through: the cell is gone. Mostly ash that sifts down, sometimes a
  // live ember, sometimes nothing — the notch a fire leaves in a trunk.
  const roll = simRandom();
  if (roll < 0.5) {
    w.replaceCellAt(ci, Cell.Ash, ashColor());
    w.life[ci] = 90 + Math.floor(simRandom() * 70);
  } else if (roll < 0.62) {
    w.replaceCellAt(ci, Cell.Ember, emberColor());
  } else if (roll < 0.8) {
    w.replaceCellAt(ci, Cell.Fire, fireColor());
    w.life[ci] = 16 + Math.floor(simRandom() * 16);
  } else {
    w.clearCellAt(ci);
  }
}

/* ---------------------------------- SEED ---------------------------------- */

function hasPlantNeighbor(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  for (let k = 0; k < 8; k++) {
    const nx = x + N8[k][0], ny = y + N8[k][1];
    if (w.inBounds(nx, ny) && plantPart(w.types[w.idx(nx, ny)])) return true;
  }
  return false;
}

const DRINK_QX = new Int32Array(SPROUT_DRINK_MAX + 8);
const DRINK_QY = new Int32Array(SPROUT_DRINK_MAX + 8);

/** Drink the water connected to (x,y) — bounded — and return how much went down. */
function drink(ctx: Ctx, x: number, y: number): number {
  const w = ctx.world;
  let head = 0, tail = 0, drunk = 0;
  for (let k = 0; k < 4; k++) {
    const nx = x + N4[k][0], ny = y + N4[k][1];
    if (w.inBounds(nx, ny) && w.types[w.idx(nx, ny)] === Cell.Water && tail < DRINK_QX.length) {
      DRINK_QX[tail] = nx; DRINK_QY[tail] = ny; tail++;
    }
  }
  while (head < tail && drunk < SPROUT_DRINK_MAX) {
    const qx = DRINK_QX[head], qy = DRINK_QY[head];
    head++;
    if (!w.inBounds(qx, qy)) continue;
    const qi = w.idx(qx, qy);
    if (w.types[qi] !== Cell.Water) continue;
    if (Math.abs(qx - x) > 10 || Math.abs(qy - y) > 10) continue;
    w.clearCellAt(qi);
    drunk++;
    for (let k = 0; k < 4 && tail < DRINK_QX.length; k++) {
      const nx = qx + N4[k][0], ny = qy + N4[k][1];
      if (w.inBounds(nx, ny) && w.types[w.idx(nx, ny)] === Cell.Water) {
        DRINK_QX[tail] = nx; DRINK_QY[tail] = ny; tail++;
      }
    }
  }
  return drunk;
}

/** Stalk / rung / crown palette of a sprouted root ladder. */
const STALK = (): number => packRGB(98 + Math.floor(simRandom() * 18), 80 + Math.floor(simRandom() * 12), 52 + Math.floor(simRandom() * 10));
const RUNG = (top: boolean): number => top ? packRGB(142, 116, 76) : packRGB(96, 74, 48);
const SPROUT_LEAF = (): number => packRGB(84 + Math.floor(simRandom() * 26), 138 + Math.floor(simRandom() * 32), 70 + Math.floor(simRandom() * 16));

/** Room a stalk or rung may grow into: open air or soft ground cover it overgrows. */
function growable(t: number): boolean {
  return t === Cell.Empty || isGas(t) || t === Cell.Grass || t === Cell.Leaf || t === Cell.Moss || t === Cell.Ash;
}

function putGrowth(ctx: Ctx, x: number, y: number, t: Cell, color: number, life: number, override = false): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return false;
  const i = w.idx(x, y);
  if (!growable(w.types[i])) return false;
  w.replaceCellAt(i, t, color);
  w.life[i] = life;
  w.moved[i] = w.movedTick;
  if (override) w.colorOverrides.add(i);
  return true;
}

/** Leaves the finished ladder wears at its crown. */
function crownSprout(ctx: Ctx, x: number, y: number): void {
  for (let dy = -3; dy <= 1; dy++) {
    for (let dx = -4; dx <= 5; dx++) {
      if (dx * dx * 0.6 + dy * dy * 1.4 > 10) continue;
      if (simRandom() < 0.2) continue;
      putGrowth(ctx, x + dx, y + dy, Cell.Leaf, SPROUT_LEAF(), leafAttachedLife(1));
    }
  }
}

/** One growth step of a sprouting tip at (x,y) with `energy` cells of ladder left. */
function growTip(ctx: Ctx, x: number, y: number, energy: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  // Growth pace: a cell most substeps — a tall ladder in a couple of seconds.
  if (simRandom() < 0.35) return;
  const finish = (): void => {
    w.replaceCellAt(ci, Cell.Trunk, STALK());
    w.life[ci] = -1;
    w.colorOverrides.add(ci);
    crownSprout(ctx, x, y - 1);
    ctx.audio.at(x, y, () => ctx.audio.tone(330, 520, 0.18, 'sine', 0.035));
  };
  if (energy <= 1 || !w.inBounds(x, y - 1)) { finish(); return; }
  const ai = w.idx(x, y - 1);
  let at = w.types[ai];
  let bonus = 0;
  if (at === Cell.Water) {
    // Growing up through a pool: the root drinks what it displaces.
    w.clearCellAt(ai);
    at = Cell.Empty;
    bonus = 1;
  }
  if (!growable(at)) { finish(); return; }
  // The tip climbs: this cell becomes stalk (two wide), the tip moves up.
  w.replaceCellAt(ci, Cell.Trunk, STALK());
  w.life[ci] = -1;
  w.colorOverrides.add(ci);
  w.moved[ci] = w.movedTick;
  putGrowth(ctx, x + 1, y, Cell.Trunk, STALK(), -1, true);
  w.replaceCellAt(ai, Cell.Seed, packRGB(182, 214, 116));
  w.life[ai] = Math.min(SPROUT_MAX_ENERGY, energy - 1 + bonus);
  w.moved[ai] = w.movedTick;
  // Rungs, alternating sides: real standable Wood.
  const rung = energy % SPROUT_RUNG_EVERY;
  if (rung === 0) {
    const side = Math.floor(energy / SPROUT_RUNG_EVERY) % 2 === 0 ? -1 : 1;
    const x0 = side < 0 ? x - 7 : x + 2;
    for (let dx = 0; dx < 6; dx++) {
      putGrowth(ctx, x0 + dx, y, Cell.Wood, RUNG(true), 0, true);
      putGrowth(ctx, x0 + dx, y + 1, Cell.Wood, RUNG(false), 0, true);
    }
    ctx.audio.at(x, y, () => ctx.audio.tone(170 + (energy % 5) * 20, 120, 0.06, 'triangle', 0.05));
  } else if (rung === 6 && simRandom() < 0.7) {
    const side = simRandom() < 0.5 ? -1 : 2;
    putGrowth(ctx, x + side, y, Cell.Leaf, SPROUT_LEAF(), leafAttachedLife(0));
    putGrowth(ctx, x + side + (side < 0 ? -1 : 1), y - 1, Cell.Leaf, SPROUT_LEAF(), leafAttachedLife(1));
  }
}

export function handleSeed(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  let life = w.life[ci];
  if (life > 0) { growTip(ctx, x, y, life); return; }
  if (life === 0) {
    life = hasPlantNeighbor(ctx, x, y) ? SEED_THIRSTY_HELD : SEED_THIRSTY_LOOSE;
    w.life[ci] = life;
  }
  const glow = isGlowseedLife(life);
  const held = life === SEED_THIRSTY_HELD || life === SEED_GLOW_HELD;
  if (held) {
    if (hasPlantNeighbor(ctx, x, y)) return;
    life = glow ? SEED_GLOW_LOOSE : SEED_THIRSTY_LOOSE;
    w.life[ci] = life;
  }
  if (!glow) {
    // A thirsty seed that touches water drinks it and sprouts.
    for (let k = 0; k < 4; k++) {
      const nx = x + N4[k][0], ny = y + N4[k][1];
      if (!w.inBounds(nx, ny) || w.types[w.idx(nx, ny)] !== Cell.Water) continue;
      const drunk = drink(ctx, x, y);
      const energy = Math.min(SPROUT_MAX_ENERGY, Math.round(SPROUT_BASE + drunk * SPROUT_PER_WATER));
      w.life[ci] = energy;
      w.colors[ci] = packRGB(182, 214, 116);
      w.activity.touchIndex(ci);
      ctx.particles.burst(x, y - 1, 8, null, () => packRGB(150, 220, 120), 0.9, { glow: 1.4, grav: -0.02 });
      ctx.audio.at(x, y, () => { ctx.audio.bubble(); ctx.audio.tone(220, 440, 0.25, 'sine', 0.04); });
      return;
    }
  }
  // Loose: a light powder. Sinks slowly through water, piles on the ground.
  const below = w.inBounds(x, y + 1) ? w.types[w.idx(x, y + 1)] : Cell.Wall;
  if (airy(below) || (isLiquid(below) && below !== Cell.Lava && simRandom() < 0.25)) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (below === Cell.Lava) {
    w.replaceCellAt(ci, Cell.Fire, fireColor());
    w.life[ci] = 12;
    return;
  }
  if (simRandom() < (ctx.params.materials[Cell.Seed].friction ?? 0.45)) {
    const dir = simRandom() < 0.5 ? 1 : -1;
    for (const d of [dir, -dir]) {
      if (w.inBounds(x + d, y + 1) && airy(w.types[w.idx(x + d, y + 1)]) && airy(w.types[w.idx(x + d, y)])) {
        w.swap(x, y, x + d, y + 1);
        return;
      }
    }
  }
}
