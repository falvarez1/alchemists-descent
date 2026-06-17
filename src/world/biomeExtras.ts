import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type {
  BiomeId,
  Ctx,
  EnemyKind,
  ExitPortal,
  Mechanism,
  Pickup,
  RuneVault,
  Waystone,
} from '@/core/types';
import { Cell, isLiquid, isSoftGrowth, isSolid } from '@/sim/CellType';
import type { VirtualBiomeDressingRecipe } from '@/world/virtual/types';
import type { PlacementLedger } from '@/world/connect';
import {
  COLOR_FN,
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

export function goldPocketBudgetForBiome(basePockets: number, biome: BiomeId): number {
  const bonus = EXTRAS[biome]?.goldBonus ?? 1;
  return Math.max(0, Math.round(basePockets * bonus));
}

/**
 * Biome decoration passes for the new materials: fungus colonies, healing
 * springs, crystal clusters, glowshrooms, coal seams, ash piles, snow drifts.
 * All randomness flows through the passed Rng (worldgen determinism).
 */
export const CAMPAIGN_DRESSING_RECIPES: Record<BiomeId, VirtualBiomeDressingRecipe> = {
  earthen: campaignRecipe(Cell.Gold, 0.62, Cell.Coal, 0.44, Cell.Stone, 0.52, Cell.Water, 0.18, Cell.Glowshroom, 0.34, Cell.Moss, 0.92, Cell.Vines, 0.62),
  fungal: campaignRecipe(Cell.Gold, 0.35, Cell.Fungus, 1.2, Cell.Glowshroom, 0.78, Cell.Toxic, 0.34, Cell.Glowshroom, 1.25, Cell.Moss, 1.15, Cell.Vines, 1.15),
  frozen: campaignRecipe(Cell.Crystal, 0.72, Cell.Ice, 1.05, Cell.Snow, 0.9, Cell.Nitrogen, 0.18, Cell.Crystal, 0.85, Cell.Ice, 0.95, Cell.Ice, 0.38),
  flooded: campaignRecipe(Cell.Gold, 0.34, Cell.Moss, 1.1, Cell.Fungus, 0.58, Cell.Water, 1.1, Cell.Glowshroom, 0.55, Cell.Moss, 1.25, Cell.Vines, 1.4),
  timber: campaignRecipe(Cell.Coal, 0.46, Cell.Wood, 1.25, Cell.Moss, 0.8, Cell.Water, 0.2, Cell.Glowshroom, 0.38, Cell.Wood, 1.4, Cell.Vines, 1.35),
  crystal: campaignRecipe(Cell.Crystal, 1.65, Cell.Glass, 0.58, Cell.Crystal, 1.25, Cell.Water, 0.16, Cell.Crystal, 1.65, Cell.Stone, 0.5, Cell.Crystal, 1.1),
  scorched: campaignRecipe(Cell.Coal, 1.1, Cell.Ash, 0.75, Cell.Stone, 0.62, Cell.Lava, 0.24, Cell.Gold, 0.34, Cell.Ash, 1.1, Cell.Stone, 0.2),
  volcanic: campaignRecipe(Cell.Coal, 0.82, Cell.Stone, 0.72, Cell.Lava, 0.8, Cell.Lava, 0.86, Cell.Lava, 0.48, Cell.Stone, 0.7, Cell.Stone, 0.24),
  gilded: campaignRecipe(Cell.Gold, 1.6, Cell.Catalyst, 0.46, Cell.Gold, 1.1, Cell.Acid, 0.3, Cell.Gold, 0.88, Cell.Stone, 0.6, Cell.Gold, 0.28),
};

export function campaignDressingRecipeForBiome(biome: BiomeId): VirtualBiomeDressingRecipe {
  return CAMPAIGN_DRESSING_RECIPES[biome] ?? CAMPAIGN_DRESSING_RECIPES.earthen;
}

function campaignRecipe(
  ore: number,
  oreDensity: number,
  secondary: number,
  secondaryDensity: number,
  pocket: number,
  pocketDensity: number,
  liquid: number,
  liquidDensity: number,
  glow: number,
  glowDensity: number,
  rubble: number,
  rubbleDensity: number,
  hanging: number,
  hangingDensity: number,
): VirtualBiomeDressingRecipe {
  return {
    ore,
    oreDensity,
    secondary,
    secondaryDensity,
    pocket,
    pocketDensity,
    liquid,
    liquidDensity,
    glow,
    glowDensity,
    rubble,
    rubbleDensity,
    hanging,
    hangingDensity,
  };
}

interface ProtectedRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CampaignDressingAvoid {
  pickups?: readonly Pickup[];
  mechanisms?: readonly Mechanism[];
  runeVaults?: readonly RuneVault[];
  portal?: ExitPortal | null;
  waystones?: readonly Waystone[];
  cauldron?: { x: number; y: number } | null;
  fits?: Uint8Array;
}

export interface CampaignDressingStats {
  veins: number;
  pockets: number;
  accents: number;
  protectedSkips: number;
  cellsChanged: number;
}

function rect(x0: number, y0: number, x1: number, y1: number): ProtectedRect {
  return {
    x0: Math.floor(Math.min(x0, x1)),
    y0: Math.floor(Math.min(y0, y1)),
    x1: Math.ceil(Math.max(x0, x1)),
    y1: Math.ceil(Math.max(y0, y1)),
  };
}

function intersects(a: ProtectedRect, b: ProtectedRect): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

function protectedRects(ctx: Ctx, avoid: CampaignDressingAvoid): ProtectedRect[] {
  const out: ProtectedRect[] = [];
  const spawn = ctx.worldgen?.spawnHint ?? null;
  if (spawn) out.push(rect(spawn.x - 72, spawn.y - 62, spawn.x + 72, spawn.y + 62));
  for (const p of avoid.pickups ?? []) out.push(rect(p.x - 18, p.y - 18, p.x + 18, p.y + 18));
  for (const ws of avoid.waystones ?? []) out.push(rect(ws.x - 22, ws.y - 18, ws.x + 22, ws.y + 16));
  if (avoid.portal) out.push(rect(avoid.portal.x - 32, avoid.portal.y - 28, avoid.portal.x + 32, avoid.portal.y + 24));
  if (avoid.cauldron) out.push(rect(avoid.cauldron.x - 18, avoid.cauldron.y - 16, avoid.cauldron.x + 18, avoid.cauldron.y + 16));

  for (const m of avoid.mechanisms ?? []) {
    const pad = m.kind === 'door' || m.kind === 'valve' ? 14 : 10;
    out.push(rect(m.x - pad, m.y - pad, m.x + m.w + pad, m.y + m.h + pad));
    if (m.zone) out.push(rect(m.zone.x0 - 6, m.zone.y0 - 6, m.zone.x1 + 6, m.zone.y1 + 6));
    if (m.body && m.body.length > 0) {
      let x0 = WIDTH,
        y0 = HEIGHT,
        x1 = 0,
        y1 = 0;
      for (const [x, y] of m.body) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      out.push(rect(x0 - 6, y0 - 6, x1 + 6, y1 + 6));
    }
  }

  for (const rv of avoid.runeVaults ?? []) {
    out.push(rect(rv.rx - 22, rv.ry - 22, rv.rx + 22, rv.ry + 22));
    if (rv.door.length > 0) {
      let x0 = WIDTH,
        y0 = HEIGHT,
        x1 = 0,
        y1 = 0;
      for (const [x, y] of rv.door) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      out.push(rect(x0 - 8, y0 - 8, x1 + 8, y1 + 8));
    }
  }
  return out;
}

/**
 * Late campaign dressing: enriches the generated rock mass after authored
 * prefabs/structures have reserved their space. It rewrites existing wall cells,
 * adds tiny embedded liquid pockets kept away from open cave space, and hangs
 * pass-through vine tendrils from ceilings so the pass improves material
 * richness without creating surprise blockers.
 */
export function applyCampaignDressing(
  ctx: Ctx,
  rng: Rng,
  biome: BiomeId,
  ledger: PlacementLedger,
  avoid: CampaignDressingAvoid = {},
): CampaignDressingStats {
  const world = ctx.world;
  const recipe = campaignDressingRecipeForBiome(biome);
  const protections = protectedRects(ctx, avoid);
  const floorBand = HEIGHT - 52;
  const stats: CampaignDressingStats = {
    veins: 0,
    pockets: 0,
    accents: 0,
    protectedSkips: 0,
    cellsChanged: 0,
  };

  const fitsIn = (r: ProtectedRect): boolean => {
    if (!avoid.fits) return false;
    const x0 = clampInt(r.x0, 0, WIDTH - 1);
    const y0 = clampInt(r.y0, 0, HEIGHT - 1);
    const x1 = clampInt(r.x1, 0, WIDTH - 1);
    const y1 = clampInt(r.y1, 0, HEIGHT - 1);
    for (let y = y0; y <= y1; y++) {
      const row = y * WIDTH;
      for (let x = x0; x <= x1; x++) {
        if (avoid.fits[row + x]) return true;
      }
    }
    return false;
  };

  const isProtected = (r: ProtectedRect, protectFits: boolean): boolean => {
    if (r.x0 < 3 || r.y0 < 4 || r.x1 >= WIDTH - 3 || r.y1 >= floorBand) return true;
    if (ledger.intersects(r.x0 - 3, r.y0 - 3, r.x1 + 3, r.y1 + 3)) return true;
    for (const p of protections) {
      if (intersects(r, p)) return true;
    }
    return protectFits && fitsIn(rect(r.x0 - 8, r.y0 - 12, r.x1 + 8, r.y1 + 8));
  };

  const colorFor = (t: number): number => (COLOR_FN[t] ?? stoneColor)();
  const setWall = (x: number, y: number, t: number): boolean => {
    if (!world.inBounds(x, y)) return false;
    const i = world.idx(x, y);
    if (world.types[i] !== Cell.Wall) return false;
    world.types[i] = t;
    world.colors[i] = colorFor(t);
    world.life[i] = 0;
    world.charge[i] = 0;
    stats.cellsChanged++;
    return true;
  };

  const setOpenVine = (x: number, y: number): boolean => {
    if (!world.inBounds(x, y)) return false;
    const i = world.idx(x, y);
    if (world.types[i] !== Cell.Empty) return false;
    world.types[i] = Cell.Vines;
    world.colors[i] = colorFor(Cell.Vines);
    world.life[i] = -1;
    world.charge[i] = 0;
    stats.cellsChanged++;
    return true;
  };

  const hasOpenBorder = (r: ProtectedRect): boolean => {
    const x0 = clampInt(r.x0 - 1, 1, WIDTH - 2);
    const y0 = clampInt(r.y0 - 1, 1, HEIGHT - 2);
    const x1 = clampInt(r.x1 + 1, 1, WIDTH - 2);
    const y1 = clampInt(r.y1 + 1, 1, HEIGHT - 2);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x > x0 && x < x1 && y > y0 && y < y1) continue;
        if (world.types[world.idx(x, y)] === Cell.Empty) return true;
      }
    }
    return false;
  };

  const adjacentOpen = (x: number, y: number): boolean =>
    world.inBounds(x, y - 1) && world.types[world.idx(x, y - 1)] === Cell.Empty
      ? true
      : world.inBounds(x, y + 1) && world.types[world.idx(x, y + 1)] === Cell.Empty
        ? true
        : world.inBounds(x - 1, y) && world.types[world.idx(x - 1, y)] === Cell.Empty
          ? true
          : world.inBounds(x + 1, y) && world.types[world.idx(x + 1, y)] === Cell.Empty;

  const surfaceAccentMaterial = (t: number): boolean => !isLiquid(t) && isSolid(t);
  const loadBearingMaterial = (t: number): boolean => surfaceAccentMaterial(t) && !isSoftGrowth(t);
  const mustStayEmbedded = (t: number): boolean => !loadBearingMaterial(t);

  const budget = (density: number, base: number, scale: number): number =>
    density <= 0 ? 0 : Math.max(1, Math.round(base + density * scale));

  const stampVeins = (material: number, count: number, label: string): void => {
    let placed = 0;
    for (let attempt = 0; attempt < count * 34 && placed < count; attempt++) {
      let x = 8 + rng.int(WIDTH - 16);
      let y = 22 + rng.int(Math.max(1, floorBand - 34));
      if (world.types[world.idx(x, y)] !== Cell.Wall) continue;
      let angle = rng.next() * Math.PI * 2;
      const len = 12 + rng.int(22);
      const cells: number[] = [];
      let x0 = x,
        y0 = y,
        x1 = x,
        y1 = y;
      for (let step = 0; step < len; step++) {
        angle += (rng.next() - 0.5) * 0.85;
        x = clampInt(x + Math.cos(angle) * 1.25, 4, WIDTH - 5);
        y = clampInt(y + Math.sin(angle) * 0.95, 8, floorBand - 5);
        const w = rng.next() < 0.22 ? 1 : 0;
        for (let dy = -w; dy <= w; dy++) {
          const yy = y + dy;
          if (!world.inBounds(x, yy) || world.types[world.idx(x, yy)] !== Cell.Wall) continue;
          if (mustStayEmbedded(material) && adjacentOpen(x, yy)) continue;
          cells.push(world.idx(x, yy));
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, yy);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, yy);
        }
      }
      if (cells.length < 5) continue;
      const r = rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2);
      if (isProtected(r, false)) {
        stats.protectedSkips++;
        continue;
      }
      let changed = 0;
      for (const i of cells) {
        if (world.types[i] !== Cell.Wall) continue;
        world.types[i] = material;
        world.colors[i] = colorFor(material);
        world.life[i] = 0;
        world.charge[i] = 0;
        changed++;
      }
      if (changed <= 0) continue;
      stats.cellsChanged += changed;
      stats.veins++;
      placed++;
      ledger.reserve(r.x0 - 5, r.y0 - 5, r.x1 + 5, r.y1 + 5, label);
    }
  };

  const stampPockets = (material: number, count: number, label: string): void => {
    let placed = 0;
    const liquid = isLiquid(material);
    const embedded = mustStayEmbedded(material);
    for (let attempt = 0; attempt < count * 48 && placed < count; attempt++) {
      const rx = 2 + rng.int(embedded ? 4 : 6);
      const ry = 1 + rng.int(embedded ? 3 : 5);
      const cx = 8 + rng.int(WIDTH - 16);
      const cy = 18 + rng.int(Math.max(1, floorBand - 30));
      const r = rect(cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2);
      if (isProtected(r, embedded) || (embedded && hasOpenBorder(r))) {
        stats.protectedSkips++;
        continue;
      }
      const cells: Array<[number, number]> = [];
      let solidArea = 0,
        area = 0;
      for (let y = cy - ry; y <= cy + ry; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const nx = (x - cx) / Math.max(1, rx);
          const ny = (y - cy) / Math.max(1, ry);
          if (nx * nx + ny * ny > 1) continue;
          area++;
          if (world.inBounds(x, y) && world.types[world.idx(x, y)] === Cell.Wall) {
            solidArea++;
            cells.push([x, y]);
          }
        }
      }
      if (area <= 0 || solidArea / area < 0.78) continue;
      let changed = 0;
      for (const [x, y] of cells) {
        if (rng.next() < (liquid ? 0.78 : 0.9) && setWall(x, y, material)) changed++;
      }
      if (changed <= 0) continue;
      stats.pockets++;
      placed++;
      ledger.reserve(r.x0, r.y0, r.x1, r.y1, label);
    }
  };

  const surfaceMaterial = (): number => {
    if (
      recipe.glowDensity > 0 &&
      surfaceAccentMaterial(recipe.glow) &&
      rng.next() < Math.min(0.2, recipe.glowDensity * 0.08)
    ) {
      return recipe.glow;
    }
    if (recipe.hangingDensity > 0 && surfaceAccentMaterial(recipe.hanging) && rng.next() < 0.48) {
      return recipe.hanging;
    }
    return surfaceAccentMaterial(recipe.rubble) ? recipe.rubble : Cell.Stone;
  };

  const stampSurfaceAccents = (count: number): void => {
    let placed = 0;
    for (let attempt = 0; attempt < count * 42 && placed < count; attempt++) {
      const x = 8 + rng.int(WIDTH - 16);
      const y = 12 + rng.int(Math.max(1, floorBand - 24));
      if (world.types[world.idx(x, y)] !== Cell.Wall || !adjacentOpen(x, y)) continue;
      const horizontal =
        world.types[world.idx(x, y - 1)] === Cell.Empty || world.types[world.idx(x, y + 1)] === Cell.Empty;
      const len = 2 + rng.int(8);
      const material = surfaceMaterial();
      const r = horizontal ? rect(x - len, y - 1, x + len, y + 1) : rect(x - 1, y - len, x + 1, y + len);
      if (isProtected(r, false)) {
        stats.protectedSkips++;
        continue;
      }
      let changed = 0;
      for (let o = -len; o <= len; o++) {
        const px = horizontal ? x + o : x;
        const py = horizontal ? y : y + o;
        if (!world.inBounds(px, py) || world.types[world.idx(px, py)] !== Cell.Wall) continue;
        if (!adjacentOpen(px, py) || rng.next() > 0.76) continue;
        if (setWall(px, py, material)) changed++;
      }
      if (changed <= 0) continue;
      stats.accents++;
      placed++;
    }
  };

  const stampHangingVines = (count: number): void => {
    if (recipe.hanging !== Cell.Vines || count <= 0) return;
    let placed = 0;
    for (let attempt = 0; attempt < count * 64 && placed < count; attempt++) {
      let x = 8 + rng.int(WIDTH - 16);
      const y = 14 + rng.int(Math.max(1, floorBand - 34));
      if (world.types[world.idx(x, y)] !== Cell.Empty) continue;
      if (!world.inBounds(x, y - 1) || !loadBearingMaterial(world.types[world.idx(x, y - 1)])) continue;

      const lengthRoll = rng.next();
      const targetLen = 4 + rng.int(lengthRoll < 0.18 ? 20 : lengthRoll < 0.48 ? 13 : 8);
      const cells: Array<[number, number]> = [];
      let x0 = x,
        y0 = y,
        x1 = x,
        y1 = y;
      for (let d = 0; d < targetLen; d++) {
        const yy = y + d;
        if (yy >= floorBand - 1) break;
        let connectorX = -1;
        if (d > 2 && rng.next() < 0.22) {
          const nx = x + (rng.next() < 0.5 ? -1 : 1);
          if (world.inBounds(nx, yy) && world.types[world.idx(nx, yy)] === Cell.Empty) {
            connectorX = x;
            x = nx;
          }
        }
        if (!world.inBounds(x, yy) || world.types[world.idx(x, yy)] !== Cell.Empty) break;
        if (connectorX >= 0 && world.types[world.idx(connectorX, yy)] === Cell.Empty) {
          cells.push([connectorX, yy]);
          x0 = Math.min(x0, connectorX - 1);
          x1 = Math.max(x1, connectorX + 1);
        }
        cells.push([x, yy]);
        x0 = Math.min(x0, x - 1);
        y0 = Math.min(y0, yy);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, yy);
      }
      if (cells.length < 4) continue;
      const r = rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2);
      if (isProtected(r, false)) {
        stats.protectedSkips++;
        continue;
      }

      let changed = 0;
      for (let i = 0; i < cells.length; i++) {
        const [px, py] = cells[i];
        if (setOpenVine(px, py)) changed++;
        if (i <= 3 || rng.next() >= 0.14) continue;
        const side = px + (rng.next() < 0.5 ? -1 : 1);
        if (setOpenVine(side, py)) changed++;
      }
      if (changed <= 0) continue;
      stats.accents++;
      placed++;
    }
  };

  // VINE DRAPES: a vine slung wall-to-wall across a gap, sagging in the middle
  // (a catenary) with the odd sprig dangling — reads as overgrowth bridging a cleft.
  const stampVineDrapes = (count: number): void => {
    if (recipe.hanging !== Cell.Vines || count <= 0) return;
    let placed = 0;
    for (let attempt = 0; attempt < count * 90 && placed < count; attempt++) {
      const y = 26 + rng.int(Math.max(1, floorBand - 60));
      const sx = 12 + rng.int(WIDTH - 24);
      if (world.types[world.idx(sx, y)] !== Cell.Empty) continue;
      let leftX = -1, rightX = -1;
      for (let x = sx; x > sx - 46 && x > 1; x--) {
        const t = world.types[world.idx(x, y)];
        if (loadBearingMaterial(t)) { leftX = x; break; }
        if (t !== Cell.Empty) break;
      }
      for (let x = sx; x < sx + 46 && x < WIDTH - 2; x++) {
        const t = world.types[world.idx(x, y)];
        if (loadBearingMaterial(t)) { rightX = x; break; }
        if (t !== Cell.Empty) break;
      }
      if (leftX < 0 || rightX < 0) continue;
      const span = rightX - leftX;
      if (span < 9 || span > 42) continue;
      const sag = 2 + Math.floor(span * (0.18 + rng.next() * 0.14));
      const r = rect(leftX, y - 1, rightX, y + sag + 2);
      if (isProtected(r, false)) continue;
      const cells: Array<[number, number]> = [];
      let clear = true;
      for (let x = leftX + 1; x < rightX; x++) {
        const t = (x - leftX) / span;
        const dip = Math.round(sag * (1 - (2 * t - 1) * (2 * t - 1))); // 0 at the walls, deepest mid-span
        const yy = y + dip;
        if (!world.inBounds(x, yy) || world.types[world.idx(x, yy)] !== Cell.Empty) { clear = false; break; }
        cells.push([x, yy]);
      }
      if (!clear || cells.length < 6) continue;
      let changed = 0;
      for (const [px, py] of cells) {
        if (setOpenVine(px, py)) changed++;
        if (rng.next() < 0.16 && setOpenVine(px, py + 1)) { changed++; if (rng.next() < 0.4) setOpenVine(px, py + 2); } // sprig
      }
      if (changed <= 0) continue;
      stats.accents++;
      placed++;
    }
  };

  // VINE LOOPS: a tendril hangs from the ceiling and curls into a small loop at the
  // end — the lift sim leaves these (and drapes) as static cover; only thin tendrils sway.
  const stampVineLoops = (count: number): void => {
    if (recipe.hanging !== Cell.Vines || count <= 0) return;
    let placed = 0;
    for (let attempt = 0; attempt < count * 90 && placed < count; attempt++) {
      const x = 8 + rng.int(WIDTH - 16);
      const y = 14 + rng.int(Math.max(1, floorBand - 44));
      if (world.types[world.idx(x, y)] !== Cell.Empty) continue;
      if (!world.inBounds(x, y - 1) || !loadBearingMaterial(world.types[world.idx(x, y - 1)])) continue;
      const stem = 3 + rng.int(7);
      const loopR = 2 + rng.int(2);
      const totalH = stem + loopR * 2 + 2;
      if (y + totalH >= floorBand - 1) continue;
      const r = rect(x - loopR - 2, y - 2, x + loopR + 2, y + totalH + 2);
      if (isProtected(r, false)) continue;
      const cells: Array<[number, number]> = [];
      for (let d = 0; d < stem; d++) cells.push([x, y + d]);
      const lcy = y + stem + loopR;
      for (let a = 0; a < 18; a++) {
        const ang = (a / 18) * Math.PI * 2;
        cells.push([x + Math.round(Math.cos(ang) * loopR), lcy + Math.round(Math.sin(ang) * loopR)]);
      }
      let clear = true;
      for (const [px, py] of cells) {
        if (!world.inBounds(px, py)) { clear = false; break; }
        const t = world.types[world.idx(px, py)];
        if (t !== Cell.Empty && t !== Cell.Vines) { clear = false; break; }
      }
      if (!clear) continue;
      let changed = 0;
      for (const [px, py] of cells) if (setOpenVine(px, py)) changed++;
      if (changed <= 3) continue;
      stats.accents++;
      placed++;
    }
  };

  // VINE CLUSTERS: a heavy bushy thicket clinging to a rock surface — a dense,
  // irregular mass of vines (denser toward its heart) with tendrils drooping off
  // the underside. Wider than 4 cells, so the lift leaves it as static overgrowth.
  const stampVineClusters = (count: number): void => {
    if (recipe.hanging !== Cell.Vines || count <= 0) return;
    const NEIGH: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    let placed = 0;
    for (let attempt = 0; attempt < count * 100 && placed < count; attempt++) {
      const x = 8 + rng.int(WIDTH - 16);
      const y = 18 + rng.int(Math.max(1, floorBand - 44));
      if (world.types[world.idx(x, y)] !== Cell.Empty) continue;
      let onSurface = false;
      for (const [dx, dy] of NEIGH) {
        if (world.inBounds(x + dx, y + dy) && loadBearingMaterial(world.types[world.idx(x + dx, y + dy)])) { onSurface = true; break; }
      }
      if (!onSurface) continue;
      const radius = 3 + rng.int(4); // heavy: a 6–13 cell-wide thicket
      const r = rect(x - radius - 1, y - radius - 1, x + radius + 1, y + radius * 2 + 3);
      if (isProtected(r, false)) continue;
      const cells: Array<[number, number]> = [];
      // dense irregular blob — fill falls off toward the rim, biased to droop down
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > radius * radius) continue;
          const fill = (1 - d2 / (radius * radius)) * (dy >= 0 ? 1 : 0.65);
          if (rng.next() > fill * 0.92) continue;
          const px = x + dx, py = y + dy;
          if (world.inBounds(px, py) && world.types[world.idx(px, py)] === Cell.Empty) cells.push([px, py]);
        }
      }
      // tendrils drooping off the underside
      const tendrils = 2 + rng.int(3);
      for (let t = 0; t < tendrils; t++) {
        const tx = x + rng.int(radius * 2 + 1) - radius;
        const len = 2 + rng.int(radius + 2);
        for (let d = 1; d <= len; d++) {
          const py = y + radius + d;
          if (world.inBounds(tx, py) && world.types[world.idx(tx, py)] === Cell.Empty) cells.push([tx, py]);
          else break;
        }
      }
      if (cells.length < 10) continue; // require a real mass — it's a HEAVY cluster
      let changed = 0;
      for (const [px, py] of cells) if (setOpenVine(px, py)) changed++;
      if (changed < 10) continue;
      stats.accents++;
      placed++;
    }
  };

  stampVeins(recipe.ore, budget(recipe.oreDensity, 10, 22), 'campaign-ore');
  stampVeins(recipe.secondary, budget(recipe.secondaryDensity, 7, 16), 'campaign-secondary');
  stampPockets(recipe.pocket, budget(recipe.pocketDensity, 3, 8), 'campaign-pocket');
  stampPockets(recipe.liquid, budget(recipe.liquidDensity, 0, 6), 'campaign-liquid');
  stampSurfaceAccents(budget(recipe.rubbleDensity + recipe.hangingDensity + recipe.glowDensity, 48, 34));
  stampHangingVines(budget(recipe.hangingDensity, 16, 34)); // denser hanging tendrils
  stampVineDrapes(budget(recipe.hangingDensity, 6, 14));
  stampVineLoops(budget(recipe.hangingDensity, 5, 12));
  stampVineClusters(budget(recipe.hangingDensity, 6, 16)); // heavy bushy thickets

  return stats;
}

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

/**
 * Mineral-vug fill. The cave skeleton leaves a swiss-cheese of small ENCLOSED air
 * pockets buried in the rock. This fills ~70% of them with cave-suitable material:
 * mostly solid stone/coal (denser rock to chew through), ~19% a hidden RawOre
 * cache (dark gold-flecked rock that stays dark until the wizard's light sweeps
 * it, then gleams — dig it to spill gold), and a rare crystal geode. Only SMALL
 * enclosed pockets are touched — never the main caves, tunnels, the floor strip,
 * or any reserved structure/spawn footprint — so traversal is never affected
 * (re-verified by the findability audit). Runs late in generateLevel.
 */
export function fillMineralVugs(ctx: Ctx, rng: Rng, ledger: PlacementLedger): void {
  const w = ctx.world;
  const floorBand = HEIGHT - 52;
  const visited = new Uint8Array(WIDTH * HEIGHT);
  const FILL_CHANCE = 0.7;
  const MIN_CELLS = 6; // skip 1-5 cell specks
  const MAX_CELLS = 130; // skip tunnels / caverns / the main traversable cave
  const stack: number[] = [];
  const comp: number[] = [];
  for (let sy = 3; sy < floorBand; sy++) {
    for (let sx = 2; sx < WIDTH - 2; sx++) {
      const startI = w.idx(sx, sy);
      if (visited[startI] || w.types[startI] !== Cell.Empty) continue;
      comp.length = 0;
      stack.length = 0;
      stack.push(startI);
      visited[startI] = 1;
      let count = 0;
      let tooBig = false;
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      while (stack.length) {
        const c = stack.pop() as number;
        count++;
        if (count <= MAX_CELLS) comp.push(c);
        else tooBig = true; // keep draining so the whole component is marked visited
        const cx = c % WIDTH;
        const cy = (c / WIDTH) | 0;
        if (cx < minX) minX = cx;
        else if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        else if (cy > maxY) maxY = cy;
        // 4-connected, kept above the floor strip and off the border ring
        if (cx > 1 && !visited[c - 1] && w.types[c - 1] === Cell.Empty) { visited[c - 1] = 1; stack.push(c - 1); }
        if (cx < WIDTH - 2 && !visited[c + 1] && w.types[c + 1] === Cell.Empty) { visited[c + 1] = 1; stack.push(c + 1); }
        if (cy > 1 && !visited[c - WIDTH] && w.types[c - WIDTH] === Cell.Empty) { visited[c - WIDTH] = 1; stack.push(c - WIDTH); }
        if (cy + 1 < floorBand && !visited[c + WIDTH] && w.types[c + WIDTH] === Cell.Empty) { visited[c + WIDTH] = 1; stack.push(c + WIDTH); }
      }
      if (tooBig || count < MIN_CELLS) continue;
      if (rng.next() > FILL_CHANCE) continue; // leave some pockets open for variety
      if (ledger.intersects(minX, minY, maxX, maxY)) continue; // respect reserved footprints
      // Mostly solid common rock; ~16% a hidden RawOre cache; ~4% a crystal geode.
      const roll = rng.next();
      const mat = roll < 0.58 ? Cell.Stone : roll < 0.8 ? Cell.Coal : roll < 0.96 ? Cell.RawOre : Cell.Crystal;
      const fn = COLOR_FN[mat];
      for (const c of comp) w.replaceCellAt(c, mat, fn());
    }
  }
}
