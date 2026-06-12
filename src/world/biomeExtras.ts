import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type { BiomeId, Ctx, EnemyKind } from '@/core/types';
import { Cell, isSolid } from '@/sim/CellType';
import {
  ashColor,
  catalystColor,
  coalColor,
  crystalColor,
  fungusColor,
  glowshroomColor,
  goldColor,
  healiumColor,
  mossColor,
  snowColor,
  stoneColor,
} from '@/sim/colors';

/**
 * Per-biome content beyond the core BiomeDef (which is frozen in types.ts):
 * weighted enemy rosters, gold richness, and decoration pass counts.
 * Ported from noita-alchemists-descent.html (biome registry + applyBiomeExtras).
 */
export interface BiomeExtras {
  /** Weighted enemy mix for placed populations. */
  foes: Partial<Record<EnemyKind, number>>;
  goldBonus: number;
  fungusPatches?: number;
  healSprings?: number;
  /** Mana crystal clusters (default 5 — every biome carries a few). */
  crystals?: number;
  /** Glowshroom patches (default 6). */
  shrooms?: number;
  coalSeams?: number;
  ashPiles?: number;
  snowDrifts?: number;
  /** Cave-moss seed patches near standing water (Wave F: damp rock greens over). */
  mossPatches?: number;
  /** Gold veins threaded through wall rock (the Gilded Vault's hoard look). */
  goldVeins?: number;
  /** Aurum Catalyst seams embedded in wall rock — mine the philosopher's dust. */
  catalystSeams?: number;
}

export const EXTRAS: Record<BiomeId, BiomeExtras> = {
  earthen: { foes: { slime: 5, bat: 3, imp: 2, golem: 1 }, goldBonus: 1, mossPatches: 22 },
  fungal: {
    foes: { slime: 4, spitter: 4, bat: 3, bomber: 1 },
    goldBonus: 1,
    fungusPatches: 160,
    healSprings: 3,
    shrooms: 26,
    mossPatches: 30,
  },
  frozen: { foes: { slime: 3, bat: 4, golem: 3, imp: 1 }, goldBonus: 1, snowDrifts: 90 },
  flooded: {
    foes: { slime: 5, spitter: 3, bat: 2, golem: 1 },
    goldBonus: 1,
    mossPatches: 48,
  },
  timber: {
    foes: { imp: 4, slime: 3, bomber: 3, bat: 2 },
    goldBonus: 1.1,
    mossPatches: 26,
  },
  crystal: {
    foes: { bat: 5, golem: 3, imp: 2, bomber: 1 },
    goldBonus: 1.6,
    crystals: 46,
    shrooms: 40,
  },
  scorched: {
    foes: { imp: 5, bomber: 3, golem: 2, bat: 2 },
    goldBonus: 1.2,
    coalSeams: 60,
    ashPiles: 50,
    shrooms: 0,
  },
  volcanic: {
    foes: { imp: 5, bomber: 4, golem: 3, bat: 1 },
    goldBonus: 1.4,
    coalSeams: 90,
    shrooms: 0,
    crystals: 2,
  },
  // The Gilded Vault: golem-patrolled treasury. Gold threads every wall,
  // catalyst seams are the real prize, braziers keep it lit (BiomeDef fires).
  gilded: {
    foes: { golem: 6, imp: 2, bat: 2 },
    goldBonus: 2.5,
    goldVeins: 90,
    catalystSeams: 16,
    crystals: 10,
    shrooms: 8,
  },
};

/**
 * Biome decoration passes for the new materials: fungus colonies, healing
 * springs, crystal clusters, glowshrooms, coal seams, ash piles, snow drifts.
 * All randomness flows through the passed Rng (worldgen determinism).
 */
export function applyBiomeExtras(ctx: Ctx, rng: Rng, biome: BiomeId): void {
  const w = ctx.world;
  const B = EXTRAS[biome];
  const FLOOR_BAND = HEIGHT - 52;
  const spawn = ctx.worldgen.spawnHint;

  const set = (x: number, y: number, t: Cell, color: number): void => {
    const i = w.idx(x, y);
    w.types[i] = t;
    w.colors[i] = color;
  };

  // Glowcap fungus colonies clinging to cave surfaces
  if (B.fungusPatches) {
    let fp = 0;
    for (let attempt = 0; attempt < B.fungusPatches * 60 && fp < B.fungusPatches; attempt++) {
      const x = 8 + Math.floor(rng.next() * (WIDTH - 16));
      const y = 14 + Math.floor(rng.next() * (FLOOR_BAND - 20));
      if (w.types[w.idx(x, y)] !== Cell.Empty) continue;
      let nearSolid = false;
      for (const [ddx, ddy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        if (w.inBounds(x + ddx, y + ddy) && w.types[w.idx(x + ddx, y + ddy)] === Cell.Wall) {
          nearSolid = true;
          break;
        }
      }
      if (!nearSolid) continue;
      set(x, y, Cell.Fungus, fungusColor());
      w.life[w.idx(x, y)] = 0;
      fp++;
    }
  }

  // Cave-moss seeds: spores latch onto rock beside standing liquid and creep
  // out from there at the sim's own pace (handleMoss does the growing)
  if (B.mossPatches) {
    let mp = 0;
    for (let attempt = 0; attempt < B.mossPatches * 80 && mp < B.mossPatches; attempt++) {
      const x = 8 + Math.floor(rng.next() * (WIDTH - 16));
      const y = 14 + Math.floor(rng.next() * (FLOOR_BAND - 20));
      if (w.types[w.idx(x, y)] !== Cell.Empty) continue;
      let nearSolid = false,
        nearWet = false;
      for (let dy = -3; dy <= 3 && !(nearSolid && nearWet); dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (!w.inBounds(x + dx, y + dy)) continue;
          const t = w.types[w.idx(x + dx, y + dy)];
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && t === Cell.Wall) nearSolid = true;
          if (t === Cell.Water) nearWet = true;
        }
      }
      if (!nearSolid || !nearWet) continue;
      set(x, y, Cell.Moss, mossColor());
      w.life[w.idx(x, y)] = 0;
      mp++;
    }
  }

  // Healing springs: small pink pools cupped in stone basins
  if (B.healSprings) {
    let hs = 0;
    for (let attempt = 0; attempt < 4000 && hs < B.healSprings; attempt++) {
      const x = 30 + Math.floor(rng.next() * (WIDTH - 60));
      const y = 60 + Math.floor(rng.next() * (FLOOR_BAND - 90));
      if (w.types[w.idx(x, y)] !== Cell.Empty || w.types[w.idx(x, y + 1)] !== Cell.Wall) continue;
      if (spawn && Math.abs(x - spawn.x) < 60 && Math.abs(y - spawn.y) < 50) continue;
      // stone basin
      for (let dx = -5; dx <= 5; dx++) {
        if (w.inBounds(x + dx, y + 1)) set(x + dx, y + 1, Cell.Stone, stoneColor());
      }
      for (const dx of [-5, 5]) {
        for (let dy = 0; dy >= -2; dy--) {
          if (w.inBounds(x + dx, y + dy)) set(x + dx, y + dy, Cell.Stone, stoneColor());
        }
      }
      // pink pool
      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = 0; dy >= -1; dy--) {
          if (w.inBounds(x + dx, y + dy) && w.types[w.idx(x + dx, y + dy)] === Cell.Empty) {
            set(x + dx, y + dy, Cell.Healium, healiumColor());
          }
        }
      }
      hs++;
    }
  }

  // Mana crystal clusters: spiky cyan growths off cave walls (every biome
  // carries a few — the wizard's mana wells in the dark)
  const crystalCount = B.crystals !== undefined ? B.crystals : 5;
  let cPlaced = 0,
    cTries = 0;
  while (cPlaced < crystalCount && cTries < 14000) {
    cTries++;
    const x = 12 + Math.floor(rng.next() * (WIDTH - 24));
    const y = 30 + Math.floor(rng.next() * (FLOOR_BAND - 50));
    if (w.types[w.idx(x, y)] !== Cell.Empty) continue;
    // need an adjacent wall to grow from
    let anchor: [number, number] | null = null;
    for (const [ax, ay] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as Array<[number, number]>) {
      if (w.inBounds(x + ax, y + ay) && w.types[w.idx(x + ax, y + ay)] === Cell.Wall) {
        anchor = [ax, ay];
        break;
      }
    }
    if (!anchor) continue;
    // grow 2-4 spikes outward from the anchor face
    const spikes = 2 + Math.floor(rng.next() * 3);
    for (let sp2 = 0; sp2 < spikes; sp2++) {
      const sx2 = x + Math.floor((rng.next() - 0.5) * 5);
      const sy2 = y + Math.floor((rng.next() - 0.5) * 3);
      const len = 2 + Math.floor(rng.next() * 4);
      for (let l = 0; l < len; l++) {
        const px2 = sx2 - anchor[0] * l,
          py2 = sy2 - anchor[1] * l;
        if (!w.inBounds(px2, py2) || w.types[w.idx(px2, py2)] !== Cell.Empty) break;
        set(px2, py2, Cell.Crystal, crystalColor());
        if (
          l < len - 1 &&
          rng.next() < 0.5 &&
          w.inBounds(px2 + 1, py2) &&
          w.types[w.idx(px2 + 1, py2)] === Cell.Empty
        ) {
          set(px2 + 1, py2, Cell.Crystal, crystalColor());
        }
      }
    }
    cPlaced++;
  }

  // Glowshroom patches: bioluminescent caps sprouting from cave floors
  const shroomCount = B.shrooms !== undefined ? B.shrooms : 6;
  let shPlaced = 0,
    shTries = 0;
  while (shPlaced < shroomCount && shTries < 14000) {
    shTries++;
    const x = 10 + Math.floor(rng.next() * (WIDTH - 20));
    const y = 40 + Math.floor(rng.next() * (FLOOR_BAND - 60));
    if (w.types[w.idx(x, y)] !== Cell.Empty || w.types[w.idx(x, y + 1)] !== Cell.Wall) continue;
    const width = 1 + Math.floor(rng.next() * 2);
    for (let dx = -width; dx <= width; dx++) {
      if (!w.inBounds(x + dx, y + 1)) continue;
      if (
        w.types[w.idx(x + dx, y)] === Cell.Empty &&
        w.types[w.idx(x + dx, y + 1)] === Cell.Wall
      ) {
        set(x + dx, y, Cell.Glowshroom, glowshroomColor());
        if (
          Math.abs(dx) < width &&
          w.inBounds(x + dx, y - 1) &&
          w.types[w.idx(x + dx, y - 1)] === Cell.Empty &&
          rng.next() < 0.6
        ) {
          set(x + dx, y - 1, Cell.Glowshroom, glowshroomColor());
        }
      }
    }
    shPlaced++;
  }

  // Coal seams: dark veins threaded through the rock
  if (B.coalSeams) {
    let cs = 0;
    for (let attempt = 0; attempt < B.coalSeams * 40 && cs < B.coalSeams; attempt++) {
      let x = 10 + Math.floor(rng.next() * (WIDTH - 20));
      let y = 30 + Math.floor(rng.next() * (FLOOR_BAND - 50));
      if (w.types[w.idx(x, y)] !== Cell.Wall) continue;
      const len = 8 + Math.floor(rng.next() * 14);
      let a = rng.next() * Math.PI * 2;
      for (let s = 0; s < len; s++) {
        a += (rng.next() - 0.5) * 0.7;
        x = Math.round(x + Math.cos(a));
        y = Math.round(y + Math.sin(a) * 0.6);
        if (!w.inBounds(x, y)) break;
        for (let dw = -1; dw <= 1; dw++) {
          const wy = y + dw;
          if (w.inBounds(x, wy) && w.types[w.idx(x, wy)] === Cell.Wall && rng.next() < 0.8) {
            set(x, wy, Cell.Coal, coalColor());
          }
        }
      }
      cs++;
    }
  }

  // Gold veins: glittering threads wandering through the treasury's rock
  // (the coal-seam walker re-tuned — longer, thinner, brighter)
  if (B.goldVeins) {
    let gv = 0;
    for (let attempt = 0; attempt < B.goldVeins * 40 && gv < B.goldVeins; attempt++) {
      let x = 10 + Math.floor(rng.next() * (WIDTH - 20));
      let y = 30 + Math.floor(rng.next() * (FLOOR_BAND - 50));
      if (w.types[w.idx(x, y)] !== Cell.Wall) continue;
      const len = 12 + Math.floor(rng.next() * 20);
      let a = rng.next() * Math.PI * 2;
      for (let s = 0; s < len; s++) {
        a += (rng.next() - 0.5) * 0.9;
        x = Math.round(x + Math.cos(a));
        y = Math.round(y + Math.sin(a) * 0.7);
        if (!w.inBounds(x, y)) break;
        if (w.types[w.idx(x, y)] === Cell.Wall && rng.next() < 0.85) {
          set(x, y, Cell.Gold, goldColor());
        }
      }
      gv++;
    }
  }

  // Aurum Catalyst seams: small embedded pockets of the philosopher's dust.
  // Buried in wall rock on purpose — mining them out is the game, and the
  // rock cradle keeps the powder from sliding into acid pools at gen time.
  if (B.catalystSeams) {
    let cseam = 0;
    for (let attempt = 0; attempt < B.catalystSeams * 60 && cseam < B.catalystSeams; attempt++) {
      const x = 12 + Math.floor(rng.next() * (WIDTH - 24));
      const y = 30 + Math.floor(rng.next() * (FLOOR_BAND - 50));
      // demand a solid pocket: every cell of the blob must replace Wall
      let solid = true;
      for (let dy = -2; dy <= 2 && solid; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (!w.inBounds(x + dx, y + dy) || w.types[w.idx(x + dx, y + dy)] !== Cell.Wall) {
            solid = false;
            break;
          }
        }
      }
      if (!solid) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy * 3 > 5) continue;
          set(x + dx, y + dy, Cell.Catalyst, catalystColor());
        }
      }
      cseam++;
    }
  }

  // Ash piles: soft grey drifts on scorched floors
  if (B.ashPiles) {
    let ap = 0;
    for (let attempt = 0; attempt < B.ashPiles * 80 && ap < B.ashPiles; attempt++) {
      const x = 10 + Math.floor(rng.next() * (WIDTH - 20));
      const y = 50 + Math.floor(rng.next() * (FLOOR_BAND - 70));
      if (w.types[w.idx(x, y)] !== Cell.Empty || w.types[w.idx(x, y + 1)] !== Cell.Wall) continue;
      const width = 3 + Math.floor(rng.next() * 5);
      for (let dx = -width; dx <= width; dx++) {
        const h = Math.max(0, Math.round((1 - Math.abs(dx) / width) * 3));
        for (let dy = 0; dy < h; dy++) {
          if (w.inBounds(x + dx, y - dy) && w.types[w.idx(x + dx, y - dy)] === Cell.Empty) {
            set(x + dx, y - dy, Cell.Ash, ashColor());
          }
        }
      }
      ap++;
    }
  }

  // Snow drifts: white banks on frozen ledges
  if (B.snowDrifts) {
    let sd = 0;
    for (let attempt = 0; attempt < B.snowDrifts * 80 && sd < B.snowDrifts; attempt++) {
      const x = 10 + Math.floor(rng.next() * (WIDTH - 20));
      const y = 20 + Math.floor(rng.next() * (FLOOR_BAND - 40));
      if (
        w.types[w.idx(x, y)] !== Cell.Empty ||
        !w.inBounds(x, y + 1) ||
        !isSolid(w.types[w.idx(x, y + 1)])
      )
        continue;
      const width = 4 + Math.floor(rng.next() * 6);
      for (let dx = -width; dx <= width; dx++) {
        const h = Math.max(1, Math.round((1 - Math.abs(dx) / width) * 4));
        for (let dy = 0; dy < h; dy++) {
          if (w.inBounds(x + dx, y - dy) && w.types[w.idx(x + dx, y - dy)] === Cell.Empty) {
            set(x + dx, y - dy, Cell.Snow, snowColor());
          }
        }
      }
      sd++;
    }
  }
}
