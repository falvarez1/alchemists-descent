import type {
  HerringboneTileDef,
  HerringboneTilesetDef,
  VirtualBiomeId,
} from '@/world/virtual/types';
import { hashCoord, unitHash } from '@/world/virtual/hash';

export interface ResolvedTile {
  tx: number;
  ty: number;
  x0: number;
  y0: number;
  tile: HerringboneTileDef;
}

export interface TilesetIssue {
  severity: 'error' | 'warning';
  message: string;
}

export function tileCoordForWorld(x: number, y: number, tileSize: number): { tx: number; ty: number } {
  return {
    tx: Math.floor(x / tileSize),
    ty: Math.floor(y / tileSize),
  };
}

export function tileOrigin(tx: number, ty: number, tileSize: number): { x: number; y: number } {
  return {
    x: tx * tileSize,
    y: ty * tileSize,
  };
}

export function orientationForTile(tx: number, ty: number): HerringboneTileDef['orientation'] {
  return (tx + ty) % 2 === 0 ? 'horizontal' : 'vertical';
}

export function resolveTile(
  tileset: HerringboneTilesetDef,
  seed: number,
  tx: number,
  ty: number,
  biome: VirtualBiomeId,
): ResolvedTile {
  const orientation = orientationForTile(tx, ty);
  let candidates = tileset.tiles.filter((tile) => tile.orientation === orientation && tile.biomeTags.includes(biome));
  if (candidates.length === 0) {
    candidates = tileset.tiles.filter((tile) => tile.orientation === orientation);
  }
  if (candidates.length === 0) {
    throw new Error(`No herringbone tile for orientation '${orientation}'`);
  }

  const edgeBias = edgeSignature(seed, tx, ty);
  const ranked = candidates.map((tile) => ({
    tile,
    matches: edgeMatchCount(tile, edgeBias),
  }));
  const bestMatches = ranked.reduce((best, item) => Math.max(best, item.matches), -1);
  const constrained = ranked.filter((item) => item.matches === bestMatches);
  const weighted = constrained.map(({ tile }) => ({
    tile,
    weight: Math.max(0.001, tile.weight) * edgeCompatibility(tile, edgeBias),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = unitHash(seed, 'virtual-tile', tx, ty) * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) {
      const origin = tileOrigin(tx, ty, tileset.tileSize);
      return { tx, ty, x0: origin.x, y0: origin.y, tile: item.tile };
    }
  }
  const origin = tileOrigin(tx, ty, tileset.tileSize);
  return { tx, ty, x0: origin.x, y0: origin.y, tile: weighted[weighted.length - 1].tile };
}

export function resolveTilesForRect(
  tileset: HerringboneTilesetDef,
  seed: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): ResolvedTile[] {
  const tx0 = Math.floor(x0 / tileset.tileSize);
  const ty0 = Math.floor(y0 / tileset.tileSize);
  const tx1 = Math.floor(x1 / tileset.tileSize);
  const ty1 = Math.floor(y1 / tileset.tileSize);
  const out: ResolvedTile[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const origin = tileOrigin(tx, ty, tileset.tileSize);
      const biome = biomeAt(origin.x + tileset.tileSize / 2, origin.y + tileset.tileSize / 2);
      out.push(resolveTile(tileset, seed, tx, ty, biome));
    }
  }
  return out;
}

export function validateTileset(tileset: HerringboneTilesetDef): TilesetIssue[] {
  const issues: TilesetIssue[] = [];
  for (const orientation of ['horizontal', 'vertical'] as const) {
    const tiles = tileset.tiles.filter((tile) => tile.orientation === orientation);
    if (tiles.length === 0) {
      issues.push({ severity: 'error', message: `Missing ${orientation} herringbone tiles` });
    }
  }
  for (const tile of tileset.tiles) {
    if (tile.weight <= 0) {
      issues.push({ severity: 'warning', message: `${tile.id} has non-positive weight` });
    }
    for (const edge of Object.values(tile.edges)) {
      if (!tileset.constraints.edgeColors.includes(edge)) {
        issues.push({ severity: 'error', message: `${tile.id} references unknown edge color '${edge}'` });
      }
    }
    for (const vertex of Object.values(tile.vertices)) {
      if (!tileset.constraints.vertexColors.includes(vertex)) {
        issues.push({ severity: 'error', message: `${tile.id} references unknown vertex color '${vertex}'` });
      }
    }
  }
  return issues;
}

function edgeSignature(seed: number, tx: number, ty: number): Record<'n' | 'e' | 's' | 'w', number> {
  return {
    n: hashCoord(seed, 'edge-h', tx, ty) % 4,
    s: hashCoord(seed, 'edge-h', tx, ty + 1) % 4,
    w: hashCoord(seed, 'edge-v', tx, ty) % 4,
    e: hashCoord(seed, 'edge-v', tx + 1, ty) % 4,
  };
}

function edgeCompatibility(tile: HerringboneTileDef, edgeBias: Record<'n' | 'e' | 's' | 'w', number>): number {
  let score = 1;
  for (const side of ['n', 'e', 's', 'w'] as const) {
    const edge = tile.edges[side];
    const wantOpen = edgeBias[side] <= 1;
    if (edge === 'open' && wantOpen) score += 0.8;
    if (edge === 'narrow' && edgeBias[side] === 2) score += 0.5;
    if (edge === 'wall' && !wantOpen) score += 0.35;
  }
  return score;
}

function edgeMatchCount(tile: HerringboneTileDef, edgeBias: Record<'n' | 'e' | 's' | 'w', number>): number {
  let matches = 0;
  for (const side of ['n', 'e', 's', 'w'] as const) {
    if (tile.edges[side] === desiredEdgeColor(edgeBias[side])) matches++;
  }
  return matches;
}

function desiredEdgeColor(edgeBias: number): string {
  if (edgeBias <= 1) return 'open';
  if (edgeBias === 2) return 'narrow';
  return 'wall';
}
