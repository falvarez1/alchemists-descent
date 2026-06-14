import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR, packRGB } from '@/sim/colors';
import type {
  HerringboneTileDef,
  TileAnchor,
  TileCarveInstruction,
  VirtualBiomeId,
  VirtualChunk,
  VirtualWorldDef,
} from '@/world/virtual/types';
import { biomeIdFromIndex } from '@/world/virtual/defaults';
import { biomeAtWorld, chunkOrigin } from '@/world/virtual/coords';
import { fnv1aByteArrays, signedUnitHash2i, unitHash2i } from '@/world/virtual/hash';
import { resolveTilesForRect, type ResolvedTile } from '@/world/virtual/HerringboneTiles';
import { stampPixelScenes } from '@/world/virtual/PixelSceneStamper';

interface Scratch {
  size: number;
  halo: number;
  originX: number;
  originY: number;
  types: Uint8Array;
  colors: Uint32Array;
}

export function generateVirtualChunk(def: VirtualWorldDef, cx: number, cy: number): VirtualChunk {
  const t0 = now();
  const size = def.chunkSize;
  const halo = Math.max(0, Math.floor(def.generation.halo));
  const origin = chunkOrigin(cx, cy, size);
  const scratchSize = size + halo * 2;
  const scratch: Scratch = {
    size: scratchSize,
    halo,
    originX: origin.x - halo,
    originY: origin.y - halo,
    types: new Uint8Array(scratchSize * scratchSize),
    colors: new Uint32Array(scratchSize * scratchSize),
  };
  const biomeAt = (x: number, y: number): VirtualBiomeId =>
    biomeIdFromIndex(biomeAtWorld(def.map, x, y, def.biomeChunkSize));

  fillBaseTerrain(def, scratch, biomeAt);
  const tiles = resolveTilesForRect(
    def.tileset,
    def.seed,
    scratch.originX,
    scratch.originY,
    scratch.originX + scratch.size - 1,
    scratch.originY + scratch.size - 1,
    biomeAt,
  );
  carveTiles(def, scratch, tiles);
  roughenCaveEdges(def, scratch, biomeAt);
  carveOrganicPockets(def, scratch);
  carveOrganicCracks(def, scratch);
  smoothTerrain(def, scratch);
  sealOuterBorder(def, scratch);

  const types = new Uint8Array(size * size);
  const colors = new Uint32Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = y + halo;
    for (let x = 0; x < size; x++) {
      const si = x + halo + sy * scratch.size;
      const ci = x + y * size;
      types[ci] = scratch.types[si];
      colors[ci] = scratch.colors[si];
    }
  }

  const scenes = stampPixelScenes({
    originX: origin.x,
    originY: origin.y,
    size,
    types,
    colors,
  }, def.pixelScenes);

  const life = new Int16Array(size * size);
  const charge = new Uint8Array(size * size);
  const biome = biomeAt(origin.x + size / 2, origin.y + size / 2);
  const hash = fnv1aByteArrays([types, new Uint8Array(colors.buffer)]);
  return {
    cx,
    cy,
    originX: origin.x,
    originY: origin.y,
    size,
    types,
    colors,
    life,
    charge,
    meta: {
      biome,
      tileIds: [...new Set(tiles.map((tile) => tile.tile.id))],
      scenes,
      hash,
      generatedMs: now() - t0,
    },
  };
}

export function generateVirtualWindow(
  def: VirtualWorldDef,
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
): VirtualChunk[] {
  const out: VirtualChunk[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      out.push(generateVirtualChunk(def, cx, cy));
    }
  }
  return out;
}

function fillBaseTerrain(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const block = 4;
  for (let y = 0; y < scratch.size; y += block) {
    const wy = scratch.originY + y;
    for (let x = 0; x < scratch.size; x += block) {
      const wx = scratch.originX + x;
      const gx = Math.floor(wx * def.generation.noiseScale);
      const gy = Math.floor(wy * def.generation.noiseScale);
      const n = coarseNoise(def.seed, gx, gy);
      const solid = n <= def.generation.noiseThreshold;
      const biome = biomeAt(wx, wy);
      const color = solid ? terrainColor(def, biome, wx, wy, n) : EMPTY_COLOR;
      for (let oy = 0; oy < block && y + oy < scratch.size; oy++) {
        const row = (y + oy) * scratch.size;
        for (let ox = 0; ox < block && x + ox < scratch.size; ox++) {
          const i = x + ox + row;
          scratch.types[i] = solid ? Cell.Wall : Cell.Empty;
          scratch.colors[i] = color;
        }
      }
    }
  }
}

function smoothTerrain(def: VirtualWorldDef, scratch: Scratch): void {
  const passes = Math.max(0, Math.floor(def.generation.smoothingPasses));
  if (passes === 0) return;
  let cur: Uint8Array = scratch.types;
  let next: Uint8Array = new Uint8Array(cur.length);
  for (let pass = 0; pass < passes; pass++) {
    next.fill(Cell.Wall);
    for (let y = 1; y < scratch.size - 1; y++) {
      for (let x = 1; x < scratch.size - 1; x++) {
        const i = x + y * scratch.size;
        const solid = countSolidNeighbors(cur, scratch.size, x, y);
        next[i] = solid >= 5 ? Cell.Wall : solid <= 2 ? Cell.Empty : cur[i];
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  if (cur !== scratch.types) scratch.types.set(cur);
  for (let y = 0; y < scratch.size; y++) {
    const wy = scratch.originY + y;
    for (let x = 0; x < scratch.size; x++) {
      const i = x + y * scratch.size;
      if (scratch.types[i] === Cell.Empty) {
        scratch.colors[i] = EMPTY_COLOR;
      } else if (scratch.colors[i] === EMPTY_COLOR) {
        const wx = scratch.originX + x;
        const biome = biomeIdFromIndex(biomeAtWorld(def.map, wx, wy, def.biomeChunkSize));
        scratch.colors[i] = terrainColor(def, biome, wx, wy, 0.5);
      }
    }
  }
}

function carveTiles(def: VirtualWorldDef, scratch: Scratch, tiles: readonly ResolvedTile[]): void {
  for (const resolved of tiles) {
    for (let n = 0; n < resolved.tile.carve.length; n++) {
      carveInstruction(def, scratch, resolved, resolved.tile.carve[n], n);
    }
  }
}

function roughenCaveEdges(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const roughness = clamp01(def.generation.edgeRoughness);
  if (roughness <= 0) return;
  const before = scratch.types;
  const after = new Uint8Array(before);
  for (let y = 1; y < scratch.size - 1; y += 2) {
    const wy = scratch.originY + y;
    for (let x = 1; x < scratch.size - 1; x += 2) {
      const i = x + y * scratch.size;
      const solidNeighbors = countSolidNeighbors(before, scratch.size, x, y);
      const openNeighbors = 8 - solidNeighbors;
      const wx = scratch.originX + x;
      const edge = organicNoise(def.seed ^ 0x4f1bbcdc, wx, wy);
      if (before[i] !== Cell.Empty) {
        if (openNeighbors === 0) continue;
        const erodeThreshold = 0.78 - roughness * 0.34 - Math.min(openNeighbors, 5) * 0.035;
        if (edge > erodeThreshold) paintOrganicCell(after, scratch.size, x, y, Cell.Empty, edge);
      } else if (solidNeighbors >= 5) {
        const fillThreshold = solidNeighbors >= 7 ? 0.48 - roughness * 0.12 : 0.78 - roughness * 0.18;
        if (edge < fillThreshold) paintOrganicCell(after, scratch.size, x, y, Cell.Wall, edge);
      }
    }
  }
  scratch.types.set(after);
  recolorTerrain(def, scratch, biomeAt);
}

function paintOrganicCell(types: Uint8Array, size: number, x: number, y: number, value: Cell, field: number): void {
  types[x + y * size] = value;
  const dir = Math.floor(field * 4);
  const nx = dir === 0 ? x + 1 : dir === 1 ? x - 1 : x;
  const ny = dir === 2 ? y + 1 : dir === 3 ? y - 1 : y;
  if (nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1) {
    types[nx + ny * size] = value;
  }
}

function carveOrganicPockets(def: VirtualWorldDef, scratch: Scratch): void {
  const density = clamp01(def.generation.pocketDensity);
  if (density <= 0) return;
  const spacing = 38;
  const maxRadius = 18 + Math.floor(clamp01(def.generation.edgeRoughness) * 10);
  const x0 = Math.floor((scratch.originX - maxRadius) / spacing);
  const y0 = Math.floor((scratch.originY - maxRadius) / spacing);
  const x1 = Math.ceil((scratch.originX + scratch.size + maxRadius) / spacing);
  const y1 = Math.ceil((scratch.originY + scratch.size + maxRadius) / spacing);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      if (unitHash2i(def.seed ^ 0x6ac690c5, gx, gy) > density * 0.32) continue;
      const wx = (gx + 0.5 + signedUnitHash2i(def.seed ^ 0x81d88f17, gx, gy) * 0.42) * spacing;
      const wy = (gy + 0.5 + signedUnitHash2i(def.seed ^ 0xb5297a4d, gx, gy) * 0.42) * spacing;
      const lx = Math.round(wx - scratch.originX);
      const ly = Math.round(wy - scratch.originY);
      if (!hasSurfaceNear(scratch, lx, ly, maxRadius + 8)) continue;
      const rx = 5 + unitHash2i(def.seed ^ 0xc2b2ae35, gx, gy) * maxRadius;
      const ry = 4 + unitHash2i(def.seed ^ 0x27d4eb2f, gx, gy) * Math.max(7, maxRadius * 0.72);
      carveEllipse(scratch, wx, wy, rx, ry);
    }
  }
}

function carveOrganicCracks(def: VirtualWorldDef, scratch: Scratch): void {
  const density = clamp01(def.generation.crackDensity);
  if (density <= 0) return;
  const spacing = 84;
  const maxLength = 70;
  const x0 = Math.floor((scratch.originX - maxLength) / spacing);
  const y0 = Math.floor((scratch.originY - maxLength) / spacing);
  const x1 = Math.ceil((scratch.originX + scratch.size + maxLength) / spacing);
  const y1 = Math.ceil((scratch.originY + scratch.size + maxLength) / spacing);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      if (unitHash2i(def.seed ^ 0x94d049bb, gx, gy) > density * 0.26) continue;
      const startX = (gx + 0.5 + signedUnitHash2i(def.seed ^ 0x9e3779b9, gx, gy) * 0.44) * spacing;
      const startY = (gy + 0.5 + signedUnitHash2i(def.seed ^ 0x85ebca6b, gx, gy) * 0.44) * spacing;
      const lx = Math.round(startX - scratch.originX);
      const ly = Math.round(startY - scratch.originY);
      if (lx >= 0 && ly >= 0 && lx < scratch.size && ly < scratch.size && !hasSurfaceNear(scratch, lx, ly, 26)) continue;
      const angle = unitHash2i(def.seed ^ 0x165667b1, gx, gy) * Math.PI * 2;
      const length = 28 + unitHash2i(def.seed ^ 0xd3a2646c, gx, gy) * maxLength;
      const radius = 1.5 + unitHash2i(def.seed ^ 0x51ed270b, gx, gy) * 2.5;
      const steps = Math.max(4, Math.ceil(length / 5));
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const px = -dy;
      const py = dx;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const wobble = signedUnitHash2i(def.seed ^ 0xa24baed5, gx * 4096 + s, gy) * 11 * Math.sin(t * Math.PI);
        carveDisc(scratch, startX + dx * length * t + px * wobble, startY + dy * length * t + py * wobble, radius);
      }
    }
  }
}

function carveInstruction(
  def: VirtualWorldDef,
  scratch: Scratch,
  resolved: ResolvedTile,
  instruction: TileCarveInstruction,
  instructionIndex: number,
): void {
  switch (instruction.kind) {
    case 'spline':
      carveSpline(def, scratch, resolved, instruction, instructionIndex);
      break;
    case 'chamber':
      carveEllipse(
        scratch,
        resolved.x0 + instruction.x * def.tileset.tileSize,
        resolved.y0 + instruction.y * def.tileset.tileSize,
        instruction.rx,
        instruction.ry,
      );
      break;
    case 'shaft':
      carveShaft(def, scratch, resolved, instruction, instructionIndex);
      break;
  }
}

function carveSpline(
  def: VirtualWorldDef,
  scratch: Scratch,
  resolved: ResolvedTile,
  instruction: Extract<TileCarveInstruction, { kind: 'spline' }>,
  instructionIndex: number,
): void {
  const size = def.tileset.tileSize;
  const a = edgePoint(instruction.from, size, resolved.tile);
  const b = edgePoint(instruction.to, size, resolved.tile);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len;
  const py = dx / len;
  const steps = Math.ceil(len / 4);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const wx = resolved.x0 + a.x + dx * t;
    const wy = resolved.y0 + a.y + dy * t;
    const wobble =
      Math.sin((resolved.tx * 13.17 + resolved.ty * 7.91 + instructionIndex * 3.1 + t * Math.PI * 2) * 1.7) *
        instruction.jitter *
        0.42 +
      signedUnitHash2i(def.seed ^ instructionIndex ^ 0x5bd1e995, resolved.tx * 997 + s, resolved.ty) *
        instruction.jitter *
        0.58;
    carveDisc(scratch, wx + px * wobble, wy + py * wobble, instruction.radius);
  }
}

function carveShaft(
  def: VirtualWorldDef,
  scratch: Scratch,
  resolved: ResolvedTile,
  instruction: Extract<TileCarveInstruction, { kind: 'shaft' }>,
  instructionIndex: number,
): void {
  const size = def.tileset.tileSize;
  const baseX = resolved.x0 + instruction.x * size;
  for (let y = 0; y < size; y += 4) {
    const wy = resolved.y0 + y;
    const wobble =
      Math.sin((resolved.ty * 5.2 + y * 0.045 + instructionIndex) * 2.1) * instruction.roughness * 18 +
      signedUnitHash2i(def.seed ^ instructionIndex ^ 0x27d4eb2f, resolved.tx, resolved.ty * 4096 + y) *
        instruction.roughness *
        12;
    carveDisc(scratch, baseX + wobble, wy, instruction.radius);
  }
}

function edgePoint(anchor: TileAnchor, size: number, tile: HerringboneTileDef): { x: number; y: number } {
  const edge = tile.edges[anchor];
  const inset = edge === 'narrow' ? size * 0.44 : edge === 'wall' ? size * 0.58 : size * 0.5;
  switch (anchor) {
    case 'n':
      return { x: inset, y: 0 };
    case 's':
      return { x: size - inset, y: size - 1 };
    case 'e':
      return { x: size - 1, y: inset };
    case 'w':
      return { x: 0, y: size - inset };
  }
}

function carveDisc(scratch: Scratch, wx: number, wy: number, radius: number): void {
  const cx = Math.round(wx - scratch.originX);
  const cy = Math.round(wy - scratch.originY);
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  for (let y = cy - r; y <= cy + r; y++) {
    if (y < 0 || y >= scratch.size) continue;
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= scratch.size) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = x + y * scratch.size;
      scratch.types[i] = Cell.Empty;
      scratch.colors[i] = EMPTY_COLOR;
    }
  }
}

function carveEllipse(scratch: Scratch, wx: number, wy: number, rx: number, ry: number): void {
  const cx = Math.round(wx - scratch.originX);
  const cy = Math.round(wy - scratch.originY);
  const xRad = Math.ceil(rx);
  const yRad = Math.ceil(ry);
  for (let y = cy - yRad; y <= cy + yRad; y++) {
    if (y < 0 || y >= scratch.size) continue;
    for (let x = cx - xRad; x <= cx + xRad; x++) {
      if (x < 0 || x >= scratch.size) continue;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const i = x + y * scratch.size;
      scratch.types[i] = Cell.Empty;
      scratch.colors[i] = EMPTY_COLOR;
    }
  }
}

function sealOuterBorder(def: VirtualWorldDef, scratch: Scratch): void {
  const seal = Math.max(0, Math.floor(def.generation.borderSeal));
  if (seal === 0) return;
  for (let y = 0; y < scratch.size; y++) {
    const wy = scratch.originY + y;
    for (let x = 0; x < scratch.size; x++) {
      const wx = scratch.originX + x;
      if (x >= seal && y >= seal && x < scratch.size - seal && y < scratch.size - seal) continue;
      const biome = biomeIdFromIndex(biomeAtWorld(def.map, wx, wy, def.biomeChunkSize));
      const i = x + y * scratch.size;
      scratch.types[i] = Cell.Wall;
      scratch.colors[i] = terrainColor(def, biome, wx, wy, 0.3);
    }
  }
}

function recolorTerrain(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  for (let y = 0; y < scratch.size; y++) {
    const wy = scratch.originY + y;
    for (let x = 0; x < scratch.size; x++) {
      const i = x + y * scratch.size;
      if (scratch.types[i] === Cell.Empty) {
        scratch.colors[i] = EMPTY_COLOR;
      } else if (scratch.colors[i] === EMPTY_COLOR) {
        const wx = scratch.originX + x;
        scratch.colors[i] = terrainColor(def, biomeAt(wx, wy), wx, wy, 0.5);
      }
    }
  }
}

function countSolidNeighbors(types: Uint8Array, size: number, x: number, y: number): number {
  const i = x + y * size;
  let solid = 0;
  if (types[i - size - 1] !== Cell.Empty) solid++;
  if (types[i - size] !== Cell.Empty) solid++;
  if (types[i - size + 1] !== Cell.Empty) solid++;
  if (types[i - 1] !== Cell.Empty) solid++;
  if (types[i + 1] !== Cell.Empty) solid++;
  if (types[i + size - 1] !== Cell.Empty) solid++;
  if (types[i + size] !== Cell.Empty) solid++;
  if (types[i + size + 1] !== Cell.Empty) solid++;
  return solid;
}

function hasSurfaceNear(scratch: Scratch, cx: number, cy: number, radius: number): boolean {
  const r = Math.ceil(radius);
  const x0 = Math.max(1, cx - r);
  const y0 = Math.max(1, cy - r);
  const x1 = Math.min(scratch.size - 2, cx + r);
  const y1 = Math.min(scratch.size - 2, cy + r);
  if (x0 > x1 || y0 > y1) return false;
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y += 3) {
    for (let x = x0; x <= x1; x += 3) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const solid = countSolidNeighbors(scratch.types, scratch.size, x, y);
      if (solid > 0 && solid < 8) return true;
    }
  }
  return false;
}

function organicNoise(seed: number, x: number, y: number): number {
  return (
    unitHash2i(seed, Math.floor(x / 7), Math.floor(y / 7)) * 0.62 +
    unitHash2i(seed ^ 0x27d4eb2f, Math.floor(x / 23), Math.floor(y / 23)) * 0.38
  );
}

function terrainColor(def: VirtualWorldDef, biome: VirtualBiomeId, x: number, y: number, n: number): number {
  const palette = def.materialProfile.palettes[biome] ?? def.materialProfile.palettes.earthen;
  const grain = 0.82 + unitHash2i(def.seed ^ 0x9e3779b9, x, y) * 0.26;
  const depth = 0.72 + Math.max(0, Math.min(1, n)) * 0.42;
  const useAccent = unitHash2i(def.seed ^ 0x85ebca6b, Math.floor(x / 8), Math.floor(y / 8)) > 0.72;
  const base = useAccent ? palette.accent : palette.wall;
  return scaleColor(base, grain * depth);
}

function scaleColor(color: number, k: number): number {
  const r = Math.max(0, Math.min(255, Math.floor(((color >> 16) & 0xff) * k)));
  const g = Math.max(0, Math.min(255, Math.floor(((color >> 8) & 0xff) * k)));
  const b = Math.max(0, Math.min(255, Math.floor((color & 0xff) * k)));
  return packRGB(r, g, b);
}

function coarseNoise(seed: number, gx: number, gy: number): number {
  return (
    unitHash2i(seed ^ 0x51ed270b, gx, gy) * 0.54 +
    unitHash2i(seed ^ 0xa24baed5, Math.floor(gx / 2), Math.floor(gy / 2)) * 0.3 +
    unitHash2i(seed ^ 0x9fb21c65, Math.floor(gx / 4), Math.floor(gy / 4)) * 0.16
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
