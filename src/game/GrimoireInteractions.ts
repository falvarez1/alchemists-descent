import type { Ctx } from '@/core/types';
import { loadDiscoveredInteractions, recordInteractionDiscovery } from '@/game/GrimoireStore';
import { Cell, isConductor } from '@/sim/CellType';

interface InteractionMatch {
  id: string;
  title: string;
  x: number;
  y: number;
}

export interface GrimoireInteractionEntry {
  id: string;
  title: string;
  body: string;
}

type InteractionMatcher = (ctx: Ctx, x: number, y: number, i: number) => boolean;

interface InteractionRule extends GrimoireInteractionEntry {
  match: InteractionMatcher;
}

// Discovery is an ambient mechanic, not frame-critical: a quarter-second cadence
// keeps it responsive while the box scan stays off the per-frame hot path.
const SCAN_PERIOD_FRAMES = 15;
const SCAN_RADIUS_X = 52;
const SCAN_RADIUS_Y = 38;
const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function hasNeighbor(ctx: Ctx, x: number, y: number, predicate: (type: number, index: number) => boolean): boolean {
  const world = ctx.world;
  for (const [dx, dy] of OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!world.inBounds(nx, ny)) continue;
    const ni = world.idx(nx, ny);
    if (predicate(world.types[ni], ni)) return true;
  }
  return false;
}

function isTransmutableSolid(type: number): boolean {
  return type === Cell.Wall || type === Cell.Wood || type === Cell.Stone;
}

function matchWaterFire(ctx: Ctx, x: number, y: number, i: number): boolean {
  if (ctx.world.types[i] !== Cell.Water) return false;
  return hasNeighbor(ctx, x, y, (neighbor) => neighbor === Cell.Fire || neighbor === Cell.Ember);
}

function matchLavaWater(ctx: Ctx, x: number, y: number, i: number): boolean {
  if (ctx.world.types[i] !== Cell.Lava) return false;
  return hasNeighbor(ctx, x, y, (neighbor) => neighbor === Cell.Water);
}

function matchNitrogenWater(ctx: Ctx, x: number, y: number, i: number): boolean {
  if (ctx.world.types[i] !== Cell.Nitrogen) return false;
  return hasNeighbor(ctx, x, y, (neighbor) => neighbor === Cell.Water);
}

function matchChargedConductor(ctx: Ctx, x: number, y: number, i: number): boolean {
  const type = ctx.world.types[i];
  if (!isConductor(type) || ctx.world.charge[i] <= 0) return false;
  return hasNeighbor(ctx, x, y, (neighbor) => isConductor(neighbor));
}

function matchAcidWaterTransmutation(ctx: Ctx, x: number, y: number, i: number): boolean {
  if (!isTransmutableSolid(ctx.world.types[i])) return false;
  const world = ctx.world;
  let acid = false;
  let water = false;
  for (const [dx, dy] of OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!world.inBounds(nx, ny)) continue;
    const neighbor = world.types[world.idx(nx, ny)];
    if (neighbor === Cell.Acid) acid = true;
    else if (neighbor === Cell.Water) water = true;
    if (acid && water) return true;
  }
  return false;
}

const RULES: readonly InteractionRule[] = [
  {
    id: 'water-quench-fire',
    title: 'Water Quenches Fire',
    body: 'Water and flame collapse into steam; carry water when wood and embers block the path.',
    match: matchWaterFire,
  },
  {
    id: 'lava-flashes-water',
    title: 'Lava Flashes Water',
    body: 'Water touching lava bursts to steam and can chill molten rock into stone crust.',
    match: matchLavaWater,
  },
  {
    id: 'nitrogen-freezes-water',
    title: 'Nitrogen Freezes Water',
    body: 'Liquid nitrogen flash-freezes nearby water into ice before it boils away.',
    match: matchNitrogenWater,
  },
  {
    id: 'charge-conductors',
    title: 'Conductive Paths',
    body: 'Charge travels through water, lava, and metal; wet metal rooms can become circuits.',
    match: matchChargedConductor,
  },
  {
    id: 'acid-water-transmutation',
    title: 'Acid Solvent Alchemy',
    body: 'Acid beside water can turn eaten rock into gold, but the reaction is rare and local.',
    match: matchAcidWaterTransmutation,
  },
];

export const GRIMOIRE_INTERACTIONS: readonly GrimoireInteractionEntry[] = RULES.map(({ id, title, body }) => ({
  id,
  title,
  body,
}));

export function scanGrimoireInteractions(ctx: Ctx, skip?: ReadonlySet<string>): InteractionMatch[] {
  const world = ctx.world;
  const cx = Math.floor(ctx.player.x);
  const cy = Math.floor(ctx.player.y - 6);
  const x0 = Math.max(0, cx - SCAN_RADIUS_X);
  const x1 = Math.min(world.width - 1, cx + SCAN_RADIUS_X);
  const y0 = Math.max(0, cy - SCAN_RADIUS_Y);
  const y1 = Math.min(world.height - 1, cy + SCAN_RADIUS_Y);
  const matches: InteractionMatch[] = [];
  // Pre-seed already-known rules so their matchers are skipped entirely.
  const seen = new Set<string>(skip);
  if (seen.size >= RULES.length) return matches;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = world.idx(x, y);
      for (const rule of RULES) {
        if (seen.has(rule.id) || !rule.match(ctx, x, y, i)) continue;
        matches.push({ id: rule.id, title: rule.title, x, y });
        seen.add(rule.id);
      }
      if (seen.size === RULES.length) return matches;
    }
  }
  return matches;
}

export class GrimoireInteractionObserver {
  private lastScanFrame = -SCAN_PERIOD_FRAMES;
  // Known rule ids, loaded from the store once then kept in sync as we record.
  // Once its size reaches RULES.length every interaction is witnessed and update()
  // early-returns — no separate latch flag needed.
  private known: Set<string> | null = null;

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.state.paused) return;
    if (ctx.state.frameCount - this.lastScanFrame < SCAN_PERIOD_FRAMES) return;
    this.lastScanFrame = ctx.state.frameCount;

    if (this.known === null) {
      const discovered = loadDiscoveredInteractions();
      this.known = new Set(RULES.filter((rule) => discovered[rule.id]).map((rule) => rule.id));
    }
    if (this.known.size >= RULES.length) return; // every interaction already witnessed

    // The scan skips already-known rules, so every match here is genuinely new.
    // Record EVERY co-occurring match this scan — a second interaction that turns
    // true in the same window must not be dropped, since its cells may be gone by
    // the next scan (e.g. steam consuming the water that triggered it).
    for (const match of scanGrimoireInteractions(ctx, this.known)) {
      if (recordInteractionDiscovery(ctx, match.id, match.title)) {
        ctx.events.emit('worldInteractionObserved', match);
        ctx.events.emit('toast', { text: `Grimoire - observed ${match.title}` });
      }
      this.known.add(match.id);
    }
  }
}
