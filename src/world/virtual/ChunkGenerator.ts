import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR, packRGB } from '@/sim/colors';
import type {
  HerringboneTileDef,
  PixelSceneDef,
  PixelScenePlacementDef,
  TileAnchor,
  TileCarveInstruction,
  VirtualDressingProfile,
  VirtualBiomeDressingRecipe,
  VirtualBiomeId,
  VirtualSceneBudget,
  VirtualChunk,
  VirtualScenePlacementInstance,
  VirtualWorldDef,
} from '@/world/virtual/types';
import {
  biomeIdFromIndex,
  createDefaultDressingProfile,
  getDefaultPixelSceneLibrary,
  VIRTUAL_SCENE_KINDS,
  createDefaultVirtualGenerationParams,
} from '@/world/virtual/defaults';
import { biomeAtWorld, chunkOrigin, floorDiv } from '@/world/virtual/coords';
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
  normalizeVirtualWorldDef(def);
  return generateVirtualChunkNormalized(def, cx, cy);
}

function generateVirtualChunkNormalized(def: VirtualWorldDef, cx: number, cy: number): VirtualChunk {
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
  relaxOrganicSilhouette(def, scratch, biomeAt);
  smoothTerrain(def, scratch);
  roundCaveCorners(def, scratch, biomeAt);
  dressSurfaceTerrain(def, scratch, biomeAt);
  dressBiomeFeatures(def, scratch, biomeAt);
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

  const life = new Int16Array(size * size);
  const charge = new Uint8Array(size * size);
  const stampedScenes = stampPixelScenes({
    originX: origin.x,
    originY: origin.y,
    size,
    types,
    colors,
    life,
    charge,
  }, pixelScenePlacementsForChunk(def, origin.x, origin.y, size, biomeAt));

  const biome = biomeAt(origin.x + size / 2, origin.y + size / 2);
  const hash = fnv1aByteArrays([
    types,
    new Uint8Array(colors.buffer),
    new Uint8Array(life.buffer),
    charge,
    sceneMetadataBytes(stampedScenes.placements),
  ]);
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
      scenes: stampedScenes.scenes,
      scenePlacements: stampedScenes.placements,
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
  normalizeVirtualWorldDef(def);
  const out: VirtualChunk[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      out.push(generateVirtualChunkNormalized(def, cx, cy));
    }
  }
  return out;
}

const MIN_SCENE_PLACEMENT_REACH = 128;

function pixelScenePlacementsForChunk(
  def: VirtualWorldDef,
  originX: number,
  originY: number,
  size: number,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): PixelScenePlacementDef[] {
  const placements = new Map<string, PixelScenePlacementDef>();
  for (const placement of def.pixelScenes) placements.set(placement.id, placement);
  for (const placement of generatedPixelScenePlacements(def, originX, originY, size, biomeAt)) {
    if (!placements.has(placement.id)) placements.set(placement.id, placement);
  }
  return [...placements.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function generatedPixelScenePlacements(
  def: VirtualWorldDef,
  originX: number,
  originY: number,
  size: number,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): PixelScenePlacementDef[] {
  const density = sceneControl(def, 'density');
  const maxPerTile = Math.max(0, Math.min(6, Math.floor(sceneControl(def, 'maxPerTile'))));
  if (density <= 0 || maxPerTile <= 0) return [];
  const library = getDefaultPixelSceneLibrary();
  const reach = scenePlacementReach(def, library);
  const tiles = resolveTilesForRect(
    def.tileset,
    def.seed,
    originX - reach,
    originY - reach,
    originX + size + reach,
    originY + size + reach,
    biomeAt,
  );
  const out: PixelScenePlacementDef[] = [];
  for (const resolved of tiles) {
    const selected: Array<{ placement: PixelScenePlacementDef; order: number }> = [];
    for (let slotIndex = 0; slotIndex < resolved.tile.sceneSlots.length; slotIndex++) {
      const slot = resolved.tile.sceneSlots[slotIndex];
      const wx = Math.round(resolved.x0 + slot.x * def.tileset.tileSize);
      const wy = Math.round(resolved.y0 + slot.y * def.tileset.tileSize);
      const biome = biomeAt(wx, wy);
      const budget = sceneBudget(def, biome);
      const scene = chooseSceneForSlot(def, library, budget, slot.tags, biome, resolved.tx, resolved.ty, slotIndex);
      if (!scene?.kind) continue;
      const chance = clamp01((budget[scene.kind] ?? 0) * density * 0.55);
      if (unitHash2i(def.seed ^ 0x341d8e2b, resolved.tx * 4099 + slotIndex, resolved.ty) > chance) continue;
      const x = Math.round(wx - scene.w / 2);
      const y = Math.round(wy - scene.h / 2);
      selected.push({
        order: unitHash2i(def.seed ^ 0x7c15f2d3, resolved.tx * 4099 + slotIndex, resolved.ty),
        placement: {
          id: `tile:${resolved.tx},${resolved.ty}:${slot.id}:${scene.id}`,
          scene,
          x,
          y,
          priority: 100 + slotIndex,
        },
      });
    }
    selected.sort((a, b) => a.order - b.order || a.placement.id.localeCompare(b.placement.id));
    for (const item of selected.slice(0, maxPerTile)) out.push(item.placement);
  }
  return out;
}

function scenePlacementReach(def: VirtualWorldDef, library: readonly PixelSceneDef[]): number {
  let maxSceneExtent = 0;
  for (const scene of library) maxSceneExtent = Math.max(maxSceneExtent, scene.w, scene.h);
  for (const placement of def.pixelScenes) maxSceneExtent = Math.max(maxSceneExtent, placement.scene.w, placement.scene.h);
  let maxSlotOvershoot = 0;
  for (const tile of def.tileset.tiles) {
    for (const slot of tile.sceneSlots) {
      maxSlotOvershoot = Math.max(
        maxSlotOvershoot,
        Math.abs(slot.x - 0.5) * def.tileset.tileSize,
        Math.abs(slot.y - 0.5) * def.tileset.tileSize,
      );
    }
  }
  return Math.max(MIN_SCENE_PLACEMENT_REACH, Math.ceil(def.tileset.tileSize + maxSceneExtent + maxSlotOvershoot));
}

function chooseSceneForSlot(
  def: VirtualWorldDef,
  library: readonly PixelSceneDef[],
  budget: VirtualSceneBudget,
  slotTags: readonly string[],
  biome: VirtualBiomeId,
  tx: number,
  ty: number,
  slotIndex: number,
): PixelSceneDef | null {
  const candidates = library.filter((scene) =>
    scene.kind &&
    (budget[scene.kind] ?? 0) > 0 &&
    sceneMatchesSlot(scene, slotTags, biome),
  );
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, scene) => sum + Math.max(0.001, budget[scene.kind!]), 0);
  let roll = unitHash2i(def.seed ^ 0x5d9e4c17, tx * 4099 + slotIndex, ty) * total;
  for (const scene of candidates) {
    roll -= Math.max(0.001, budget[scene.kind!]);
    if (roll <= 0) return scene;
  }
  return candidates[candidates.length - 1] ?? null;
}

function sceneMatchesSlot(scene: PixelSceneDef, slotTags: readonly string[], biome: VirtualBiomeId): boolean {
  if (!scene.kind) return false;
  if (slotTags.includes(scene.kind) || slotTags.includes('any')) return true;
  const sceneTags = scene.tags ?? [];
  return sceneTags.includes(biome) || sceneTags.some((tag) => slotTags.includes(tag));
}

function sceneBudget(def: VirtualWorldDef, biome: VirtualBiomeId): VirtualSceneBudget {
  return def.dressing.scenes.biomes[biome] ?? def.dressing.scenes.biomes.earthen;
}

function sceneControl(def: VirtualWorldDef, key: keyof VirtualWorldDef['dressing']['scenes']['controls']): number {
  const value = def.dressing.scenes.controls[key];
  return Math.max(0, Math.min(key === 'maxPerTile' ? 6 : 2, Number.isFinite(value) ? value : 1));
}

function fillBaseTerrain(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const block = generationInt(def.generation.baseCellSize, 2, 1, 4);
  const bx0 = floorDiv(scratch.originX, block);
  const by0 = floorDiv(scratch.originY, block);
  const bx1 = floorDiv(scratch.originX + scratch.size - 1, block);
  const by1 = floorDiv(scratch.originY + scratch.size - 1, block);
  for (let by = by0; by <= by1; by++) {
    const wy = by * block;
    const y0 = Math.max(0, wy - scratch.originY);
    const y1 = Math.min(scratch.size - 1, wy + block - 1 - scratch.originY);
    for (let bx = bx0; bx <= bx1; bx++) {
      const wx = bx * block;
      const x0 = Math.max(0, wx - scratch.originX);
      const x1 = Math.min(scratch.size - 1, wx + block - 1 - scratch.originX);
      const n = terrainNoise(def, wx, wy);
      const solid = n <= generationNumber(def.generation.noiseThreshold, 0.54);
      const biome = biomeAt(wx, wy);
      const color = solid ? terrainColor(def, biome, wx, wy, n) : EMPTY_COLOR;
      for (let y = y0; y <= y1; y++) {
        const row = y * scratch.size;
        for (let x = x0; x <= x1; x++) {
          const i = x + row;
          scratch.types[i] = solid ? Cell.Wall : Cell.Empty;
          scratch.colors[i] = color;
        }
      }
    }
  }
}

function smoothTerrain(def: VirtualWorldDef, scratch: Scratch): void {
  const passes = generationInt(def.generation.smoothingPasses, 1, 0, 4);
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
  const roughness = clamp01(generationNumber(def.generation.edgeRoughness, 0.38));
  if (roughness <= 0) return;
  const before = scratch.types;
  const after = new Uint8Array(before);
  for (let y = firstSteppedLocal(scratch.originY, 1, 2); y < scratch.size - 1; y += 2) {
    const wy = scratch.originY + y;
    for (let x = firstSteppedLocal(scratch.originX, 1, 2); x < scratch.size - 1; x += 2) {
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
  const density = clamp01(generationNumber(def.generation.pocketDensity, 0.3));
  if (density <= 0) return;
  const spacing = 38;
  const maxRadius = 18 + Math.floor(clamp01(generationNumber(def.generation.edgeRoughness, 0.38)) * 10);
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
      carveOrganicEllipse(def, scratch, wx, wy, rx, ry, 0.9);
    }
  }
}

function carveOrganicCracks(def: VirtualWorldDef, scratch: Scratch): void {
  const density = clamp01(generationNumber(def.generation.crackDensity, 0.2));
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
        carveOrganicDisc(
          def,
          scratch,
          startX + dx * length * t + px * wobble,
          startY + dy * length * t + py * wobble,
          radius,
          0.7,
        );
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
      carveOrganicEllipse(
        def,
        scratch,
        resolved.x0 + instruction.x * def.tileset.tileSize,
        resolved.y0 + instruction.y * def.tileset.tileSize,
        instruction.rx,
        instruction.ry,
        1,
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
    carveOrganicDisc(def, scratch, wx + px * wobble, wy + py * wobble, instruction.radius, 0.75);
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
    carveOrganicDisc(def, scratch, baseX + wobble, wy, instruction.radius, 0.65);
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

function relaxOrganicSilhouette(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const strength = clamp01(generationNumber(def.generation.shapeWarp, 0.48));
  const passes = generationInt(def.generation.organicSmoothingPasses, 1, 0, 4);
  if (passes === 0 || strength <= 0) return;

  let cur: Uint8Array = scratch.types;
  let next: Uint8Array = new Uint8Array(cur.length);
  for (let pass = 0; pass < passes; pass++) {
    next.set(cur);
    for (let y = 1; y < scratch.size - 1; y++) {
      const wy = scratch.originY + y;
      for (let x = 1; x < scratch.size - 1; x++) {
        const i = x + y * scratch.size;
        const solid = countSolidNeighbors(cur, scratch.size, x, y);
        if (cur[i] !== Cell.Empty) {
          if (solid <= 2) {
            next[i] = Cell.Empty;
          } else if (solid <= 4) {
            const field = organicNoise(def.seed ^ 0x7f4a7c15 ^ pass, scratch.originX + x, wy);
            if (
              (solid === 3 && field > 0.78 - strength * 0.24) ||
              (solid === 4 && field > 0.94 - strength * 0.16)
            ) {
              next[i] = Cell.Empty;
            }
          }
        } else if (solid >= 6) {
          next[i] = Cell.Wall;
        } else if (solid >= 4) {
          const field = organicNoise(def.seed ^ 0x7f4a7c15 ^ pass, scratch.originX + x, wy);
          if ((solid === 5 && field < 0.1 + strength * 0.22) || (solid === 4 && field < strength * 0.07)) {
            next[i] = Cell.Wall;
          }
        }
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  if (cur !== scratch.types) scratch.types.set(cur);
  recolorTerrain(def, scratch, biomeAt);
}

function roundCaveCorners(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const strength = clamp01(generationNumber(def.generation.cornerRounding, 0.62));
  if (strength <= 0) return;

  const passes = strength >= 0.7 ? 2 : 1;
  let cur: Uint8Array = scratch.types;
  let next: Uint8Array = new Uint8Array(cur.length);
  for (let pass = 0; pass < passes; pass++) {
    next.set(cur);
    for (let y = 1; y < scratch.size - 1; y++) {
      const wy = scratch.originY + y;
      for (let x = 1; x < scratch.size - 1; x++) {
        const i = x + y * scratch.size;
        const up = cur[i - scratch.size] !== Cell.Empty;
        const down = cur[i + scratch.size] !== Cell.Empty;
        const left = cur[i - 1] !== Cell.Empty;
        const right = cur[i + 1] !== Cell.Empty;
        const upLeft = cur[i - scratch.size - 1] !== Cell.Empty;
        const upRight = cur[i - scratch.size + 1] !== Cell.Empty;
        const downLeft = cur[i + scratch.size - 1] !== Cell.Empty;
        const downRight = cur[i + scratch.size + 1] !== Cell.Empty;

        if (cur[i] !== Cell.Empty) {
          const convex =
            (!up && !left && !upLeft ? 1 : 0) +
            (!up && !right && !upRight ? 1 : 0) +
            (!down && !left && !downLeft ? 1 : 0) +
            (!down && !right && !downRight ? 1 : 0);
          const openCardinals = (!up ? 1 : 0) + (!down ? 1 : 0) + (!left ? 1 : 0) + (!right ? 1 : 0);
          if (convex > 0 && openCardinals >= 2) {
            const field = organicNoise(def.seed ^ 0x2f7c6d31 ^ pass, scratch.originX + x, wy);
            if (field < 0.18 + strength * 0.5 + Math.min(convex, 2) * 0.08) {
              next[i] = Cell.Empty;
            }
          }
        } else {
          const concave =
            (up && left && upLeft ? 1 : 0) +
            (up && right && upRight ? 1 : 0) +
            (down && left && downLeft ? 1 : 0) +
            (down && right && downRight ? 1 : 0);
          if (concave > 0) {
            const solid = countSolidNeighbors(cur, scratch.size, x, y);
            if (solid >= 5) {
              const field = organicNoise(def.seed ^ 0x2f7c6d31 ^ pass, scratch.originX + x, wy);
              if (field < 0.08 + strength * 0.34 + Math.min(concave, 2) * 0.05) {
                next[i] = Cell.Wall;
              }
            }
          }
        }
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  if (cur !== scratch.types) scratch.types.set(cur);
  recolorTerrain(def, scratch, biomeAt);
}

function dressSurfaceTerrain(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const cover = clamp01(generationNumber(def.generation.surfaceCover, 0.64));
  const depth = generationInt(def.generation.surfaceDepth, 2, 0, 6);
  const vegetation = clamp01(generationNumber(def.generation.vegetationDensity, 0.38));
  if (cover <= 0 || depth <= 0) return;

  for (let y = 2; y < scratch.size - depth - 1; y++) {
    const wy = scratch.originY + y;
    for (let x = 1; x < scratch.size - 1; x++) {
      const i = x + y * scratch.size;
      if (scratch.types[i] === Cell.Empty || scratch.types[i - scratch.size] !== Cell.Empty) continue;
      const wx = scratch.originX + x;
      const exposure = openAbove(scratch.types, scratch.size, x, y);
      if (exposure < 2) continue;
      const field = organicNoise(def.seed ^ 0x5c13faced, wx, wy);
      if (field > cover) continue;
      const biome = biomeAt(wx, wy);
      const capDepth = Math.min(depth + (field < vegetation * 0.28 ? 1 : 0), scratch.size - y - 1);
      for (let d = 0; d < capDepth; d++) {
        const yy = y + d;
        const ii = x + yy * scratch.size;
        if (scratch.types[ii] === Cell.Empty) break;
        scratch.types[ii] = surfaceCellForBiome(biome, d, vegetation, def.seed, wx, scratch.originY + yy);
        scratch.colors[ii] = surfaceColor(def, biome, wx, scratch.originY + yy, d, capDepth, field);
      }
    }
  }
}

function dressBiomeFeatures(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  if (!def.dressing) return;
  dressMaterialVeins(def, scratch, biomeAt);
  dressMaterialPockets(def, scratch, biomeAt);
  dressFloorDebris(def, scratch, biomeAt);
  dressHangingGrowth(def, scratch, biomeAt);
  dressLiquidBasins(def, scratch, biomeAt);
  dressGlowAccents(def, scratch, biomeAt);
}

function dressMaterialVeins(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const detail = dressingControl(def, 'detailDensity');
  const richness = dressingControl(def, 'materialRichness');
  if (detail <= 0 || richness <= 0) return;

  const spacing = 58;
  const reach = 92;
  const gx0 = Math.floor((scratch.originX - reach) / spacing);
  const gy0 = Math.floor((scratch.originY - reach) / spacing);
  const gx1 = Math.ceil((scratch.originX + scratch.size + reach) / spacing);
  const gy1 = Math.ceil((scratch.originY + scratch.size + reach) / spacing);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const wx = Math.floor((gx + 0.16 + unitHash2i(def.seed ^ 0x48bf3a17, gx, gy) * 0.68) * spacing);
      const wy = Math.floor((gy + 0.16 + unitHash2i(def.seed ^ 0x1d91e6af, gx, gy) * 0.68) * spacing);
      const biome = biomeAt(wx, wy);
      const recipe = dressingRecipe(def, biome);
      const materialRoll = unitHash2i(def.seed ^ 0xf1987a91, gx, gy);
      const useSecondary =
        recipe.secondaryDensity > 0 &&
        materialRoll < recipe.secondaryDensity / Math.max(0.001, recipe.oreDensity + recipe.secondaryDensity);
      const density = clamp01((useSecondary ? recipe.secondaryDensity : recipe.oreDensity) * richness * detail);
      if (unitHash2i(def.seed ^ 0x5d2f6d37, gx, gy) > density * 0.18) continue;
      const material = useSecondary ? recipe.secondary : recipe.ore;
      const angle = unitHash2i(def.seed ^ 0x8f4f3f47, gx, gy) * Math.PI * 2;
      const length = 22 + unitHash2i(def.seed ^ 0x9fb21c69, gx, gy) * 56;
      const radius = 1.1 + unitHash2i(def.seed ^ 0x747c15df, gx, gy) * (useSecondary ? 1.6 : 1.2);
      paintWanderingVein(def, scratch, biomeAt, wx, wy, angle, length, radius, material);
    }
  }
}

function paintWanderingVein(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
  startX: number,
  startY: number,
  angle: number,
  length: number,
  radius: number,
  material: number,
): void {
  const steps = Math.max(5, Math.ceil(length / 4));
  let x = startX;
  let y = startY;
  const seed = def.seed ^ 0xb3c41d7a ^ material;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const wobble = signedUnitHash2i(seed, Math.floor(startX / 4) + step, Math.floor(startY / 4)) * 0.72;
    const localAngle = angle + wobble + Math.sin(t * Math.PI * 2 + startX * 0.013) * 0.25;
    x += Math.cos(localAngle) * 4;
    y += Math.sin(localAngle) * 3;
    paintTerrainDisc(def, scratch, biomeAt, x, y, radius * (0.8 + Math.sin(t * Math.PI) * 0.45), material);
  }
}

function dressMaterialPockets(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const detail = dressingControl(def, 'detailDensity');
  const richness = dressingControl(def, 'materialRichness');
  if (detail <= 0 || richness <= 0) return;

  const spacing = 64;
  const reach = 28;
  const gx0 = Math.floor((scratch.originX - reach) / spacing);
  const gy0 = Math.floor((scratch.originY - reach) / spacing);
  const gx1 = Math.ceil((scratch.originX + scratch.size + reach) / spacing);
  const gy1 = Math.ceil((scratch.originY + scratch.size + reach) / spacing);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const wx = Math.floor((gx + 0.18 + unitHash2i(def.seed ^ 0xe6217d21, gx, gy) * 0.64) * spacing);
      const wy = Math.floor((gy + 0.18 + unitHash2i(def.seed ^ 0x1128a3bd, gx, gy) * 0.64) * spacing);
      const biome = biomeAt(wx, wy);
      const recipe = dressingRecipe(def, biome);
      const density = clamp01(recipe.pocketDensity * richness * detail);
      if (unitHash2i(def.seed ^ 0x66f0b67d, gx, gy) > density * 0.13) continue;
      const rx = 3 + unitHash2i(def.seed ^ 0x4cd41233, gx, gy) * 10;
      const ry = 2 + unitHash2i(def.seed ^ 0xb07a6f19, gx, gy) * 7;
      paintTerrainEllipse(def, scratch, biomeAt, wx, wy, rx, ry, recipe.pocket);
    }
  }
}

function dressFloorDebris(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const detail = dressingControl(def, 'detailDensity');
  const debris = dressingControl(def, 'floorDebris');
  if (detail <= 0 || debris <= 0) return;

  for (let y = firstSteppedLocal(scratch.originY, 2, 2); y < scratch.size - 3; y += 2) {
    const wy = scratch.originY + y;
    for (let x = firstSteppedLocal(scratch.originX, 1, 2); x < scratch.size - 1; x += 2) {
      const i = x + y * scratch.size;
      if (!isTerrainSolid(scratch.types[i]) || scratch.types[i - scratch.size] !== Cell.Empty) continue;
      const wx = scratch.originX + x;
      const biome = biomeAt(wx, wy);
      const recipe = dressingRecipe(def, biome);
      const density = clamp01(recipe.rubbleDensity * debris * detail);
      if (unitHash2i(def.seed ^ 0x72bd61d5, Math.floor(wx / 3), Math.floor(wy / 3)) > density * 0.18) continue;
      const width = 1 + Math.floor(unitHash2i(def.seed ^ 0x9a3511fd, wx, wy) * 4);
      for (let dx = -width; dx <= width; dx++) {
        const xx = x + dx;
        if (xx <= 0 || xx >= scratch.size - 1) continue;
        const ii = xx + y * scratch.size;
        if (!isTerrainSolid(scratch.types[ii]) || scratch.types[ii - scratch.size] !== Cell.Empty) continue;
        const worldX = scratch.originX + xx;
        scratch.types[ii] = recipe.rubble;
        scratch.colors[ii] = materialColor(def, biome, recipe.rubble, worldX, wy);
      }
    }
  }
}

function dressHangingGrowth(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const detail = dressingControl(def, 'detailDensity');
  const hanging = dressingControl(def, 'hangingGrowth');
  if (detail <= 0 || hanging <= 0) return;

  for (let y = firstSteppedLocal(scratch.originY, 2, 2); y < scratch.size - 8; y += 2) {
    const wy = scratch.originY + y;
    for (let x = firstSteppedLocal(scratch.originX, 1, 3); x < scratch.size - 1; x += 3) {
      const i = x + y * scratch.size;
      if (scratch.types[i] !== Cell.Empty || !isTerrainSolid(scratch.types[i - scratch.size])) continue;
      const wx = scratch.originX + x;
      const biome = biomeAt(wx, wy);
      const recipe = dressingRecipe(def, biome);
      const density = clamp01(recipe.hangingDensity * hanging * detail);
      if (unitHash2i(def.seed ^ 0xb67db631, Math.floor(wx / 3), Math.floor(wy / 3)) > density * 0.12) continue;
      const length = 2 + Math.floor(unitHash2i(def.seed ^ 0xf6249a83, wx, wy) * 6);
      for (let d = 0; d < length; d++) {
        const yy = y + d;
        const ii = x + yy * scratch.size;
        if (yy >= scratch.size - 1 || scratch.types[ii] !== Cell.Empty) break;
        const worldY = scratch.originY + yy;
        scratch.types[ii] = recipe.hanging;
        scratch.colors[ii] = materialColor(def, biome, recipe.hanging, wx, worldY);
      }
    }
  }
}

function dressLiquidBasins(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const detail = dressingControl(def, 'detailDensity');
  const liquids = dressingControl(def, 'liquidRichness');
  if (detail <= 0 || liquids <= 0) return;

  for (let y = firstSteppedLocal(scratch.originY, 3, 4); y < scratch.size - 3; y += 4) {
    const wy = scratch.originY + y;
    for (let x = firstSteppedLocal(scratch.originX, 4, 5); x < scratch.size - 4; x += 5) {
      const i = x + y * scratch.size;
      if (scratch.types[i] !== Cell.Empty || !isTerrainSolid(scratch.types[i + scratch.size])) continue;
      if (scratch.types[i - scratch.size] !== Cell.Empty) continue;
      const wx = scratch.originX + x;
      const biome = biomeAt(wx, wy);
      const recipe = dressingRecipe(def, biome);
      const density = clamp01(recipe.liquidDensity * liquids * detail);
      if (unitHash2i(def.seed ^ 0xafca7d55, Math.floor(wx / 5), Math.floor(wy / 5)) > density * 0.045) continue;
      const width = 2 + Math.floor(unitHash2i(def.seed ^ 0x49b7a42d, wx, wy) * 7);
      for (let dx = -width; dx <= width; dx++) {
        const xx = x + dx;
        const taper = Math.abs(dx) / Math.max(1, width);
        if (xx <= 0 || xx >= scratch.size - 1) continue;
        if (taper > 0.8 && unitHash2i(def.seed ^ 0x19a7b93f, wx + dx, wy) > 0.45) continue;
        const ii = xx + y * scratch.size;
        if (scratch.types[ii] !== Cell.Empty || !isTerrainSolid(scratch.types[ii + scratch.size])) continue;
        const worldX = scratch.originX + xx;
        scratch.types[ii] = recipe.liquid;
        scratch.colors[ii] = materialColor(def, biome, recipe.liquid, worldX, wy);
      }
    }
  }
}

function dressGlowAccents(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
): void {
  const detail = dressingControl(def, 'detailDensity');
  const glow = dressingControl(def, 'glowDensity');
  if (detail <= 0 || glow <= 0) return;

  for (let y = firstSteppedLocal(scratch.originY, 2, 3); y < scratch.size - 3; y += 3) {
    const wy = scratch.originY + y;
    for (let x = firstSteppedLocal(scratch.originX, 2, 3); x < scratch.size - 2; x += 3) {
      const i = x + y * scratch.size;
      if (scratch.types[i] !== Cell.Empty) continue;
      const floor = isTerrainSolid(scratch.types[i + scratch.size]);
      const wall = isTerrainSolid(scratch.types[i - 1]) || isTerrainSolid(scratch.types[i + 1]);
      const ceiling = isTerrainSolid(scratch.types[i - scratch.size]);
      if (!floor && !wall && !ceiling) continue;
      const wx = scratch.originX + x;
      const biome = biomeAt(wx, wy);
      const recipe = dressingRecipe(def, biome);
      const density = clamp01(recipe.glowDensity * glow * detail);
      const exposurePenalty = floor ? 1 : wall ? 0.62 : 0.46;
      if (unitHash2i(def.seed ^ 0xc2b24165, Math.floor(wx / 3), Math.floor(wy / 3)) > density * 0.055 * exposurePenalty) {
        continue;
      }
      scratch.types[i] = recipe.glow;
      scratch.colors[i] = materialColor(def, biome, recipe.glow, wx, wy);
    }
  }
}

function paintTerrainDisc(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
  wx: number,
  wy: number,
  radius: number,
  material: number,
): void {
  const cx = Math.round(wx - scratch.originX);
  const cy = Math.round(wy - scratch.originY);
  const r = Math.max(1, Math.ceil(radius));
  const r2 = radius * radius;
  for (let y = cy - r; y <= cy + r; y++) {
    if (y < 1 || y >= scratch.size - 1) continue;
    const worldY = scratch.originY + y;
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 1 || x >= scratch.size - 1) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = x + y * scratch.size;
      if (!isTerrainSolid(scratch.types[i])) continue;
      const worldX = scratch.originX + x;
      const biome = biomeAt(worldX, worldY);
      scratch.types[i] = material;
      scratch.colors[i] = materialColor(def, biome, material, worldX, worldY);
    }
  }
}

function paintTerrainEllipse(
  def: VirtualWorldDef,
  scratch: Scratch,
  biomeAt: (x: number, y: number) => VirtualBiomeId,
  wx: number,
  wy: number,
  rx: number,
  ry: number,
  material: number,
): void {
  const cx = Math.round(wx - scratch.originX);
  const cy = Math.round(wy - scratch.originY);
  const xRad = Math.ceil(rx);
  const yRad = Math.ceil(ry);
  for (let y = cy - yRad; y <= cy + yRad; y++) {
    if (y < 1 || y >= scratch.size - 1) continue;
    const worldY = scratch.originY + y;
    for (let x = cx - xRad; x <= cx + xRad; x++) {
      if (x < 1 || x >= scratch.size - 1) continue;
      const nx = (x - cx) / Math.max(1, rx);
      const ny = (y - cy) / Math.max(1, ry);
      if (nx * nx + ny * ny > 1) continue;
      const i = x + y * scratch.size;
      if (!isTerrainSolid(scratch.types[i])) continue;
      const worldX = scratch.originX + x;
      const biome = biomeAt(worldX, worldY);
      scratch.types[i] = material;
      scratch.colors[i] = materialColor(def, biome, material, worldX, worldY);
    }
  }
}

function isTerrainSolid(type: number): boolean {
  return (
    type === Cell.Wall ||
    type === Cell.Stone ||
    type === Cell.Ice ||
    type === Cell.Moss ||
    type === Cell.Fungus ||
    type === Cell.Glowshroom ||
    type === Cell.Crystal ||
    type === Cell.Glass ||
    type === Cell.Wood ||
    type === Cell.Metal
  );
}

function dressingRecipe(def: VirtualWorldDef, biome: VirtualBiomeId): VirtualBiomeDressingRecipe {
  return def.dressing.biomes[biome] ?? def.dressing.biomes.earthen;
}

function dressingControl(def: VirtualWorldDef, key: keyof VirtualWorldDef['dressing']['controls']): number {
  const value = def.dressing.controls[key];
  return Math.max(0, Math.min(2, Number.isFinite(value) ? value : 1));
}

function materialColor(def: VirtualWorldDef, biome: VirtualBiomeId, material: number, x: number, y: number): number {
  const grain = 0.86 + unitHash2i(def.seed ^ 0x27731d45 ^ material, x, y) * 0.24;
  let base: number;
  switch (material) {
    case Cell.Wood:
      base = packRGB(94, 62, 34);
      break;
    case Cell.Gold:
      base = packRGB(226, 176, 42);
      break;
    case Cell.Coal:
      base = packRGB(34, 34, 38);
      break;
    case Cell.Crystal:
      base = packRGB(95, 206, 232);
      break;
    case Cell.Glass:
      base = packRGB(160, 192, 212);
      break;
    case Cell.Ice:
      base = packRGB(132, 184, 222);
      break;
    case Cell.Snow:
      base = packRGB(214, 224, 232);
      break;
    case Cell.Fungus:
      base = packRGB(48, 156, 118);
      break;
    case Cell.Glowshroom:
      base = packRGB(116, 218, 138);
      break;
    case Cell.Moss:
      base = packRGB(52, 112, 48);
      break;
    case Cell.Vines:
      base = packRGB(42, 138, 58);
      break;
    case Cell.Water:
      base = packRGB(40, 110, 184);
      break;
    case Cell.Nitrogen:
      base = packRGB(182, 232, 242);
      break;
    case Cell.Toxic:
      base = packRGB(70, 126, 38);
      break;
    case Cell.Acid:
      base = packRGB(68, 210, 42);
      break;
    case Cell.Lava:
      base = packRGB(238, 66, 12);
      break;
    case Cell.Ash:
      base = packRGB(84, 80, 76);
      break;
    case Cell.Catalyst:
      base = packRGB(232, 126, 68);
      break;
    case Cell.Stone:
      base = packRGB(82, 80, 84);
      break;
    default:
      base = (def.materialProfile.palettes[biome] ?? def.materialProfile.palettes.earthen).accent;
  }
  return scaleColor(base, grain);
}

function openAbove(types: Uint8Array, size: number, x: number, y: number): number {
  let open = 0;
  for (let yy = y - 1; yy >= Math.max(0, y - 4); yy--) {
    if (types[x + yy * size] !== Cell.Empty) break;
    open++;
  }
  return open;
}

function surfaceCellForBiome(
  biome: VirtualBiomeId,
  depth: number,
  vegetation: number,
  seed: number,
  x: number,
  y: number,
): Cell {
  if (depth > 1) return Cell.Wall;
  const surfaceRoll = unitHash2i(seed ^ 0x1d872b41, x, y);
  if (biome === 'frozen') return Cell.Ice;
  if (biome === 'crystal') return surfaceRoll < vegetation * 0.36 ? Cell.Crystal : Cell.Ice;
  if (biome === 'fungal') {
    return surfaceRoll < vegetation * 0.55 ? Cell.Fungus : Cell.Moss;
  }
  if (biome === 'flooded') return surfaceRoll < vegetation * 0.18 ? Cell.Fungus : Cell.Moss;
  if (biome === 'timber') return surfaceRoll < vegetation * 0.28 ? Cell.Wood : Cell.Moss;
  if (biome === 'scorched' || biome === 'volcanic' || biome === 'gilded') return Cell.Stone;
  return Cell.Moss;
}

function surfaceColor(
  def: VirtualWorldDef,
  biome: VirtualBiomeId,
  x: number,
  y: number,
  depth: number,
  maxDepth: number,
  field: number,
): number {
  const palette = def.materialProfile.palettes[biome] ?? def.materialProfile.palettes.earthen;
  const surfaceK = Math.max(0, 1 - depth / Math.max(1, maxDepth));
  const fleck = 0.84 + unitHash2i(def.seed ^ 0x34b85a73, x, y) * 0.28;
  const base = depth === 0 || field < 0.42 ? palette.crown : palette.accent;
  return scaleColor(base, fleck * (0.86 + surfaceK * 0.2));
}

function carveOrganicDisc(
  def: VirtualWorldDef,
  scratch: Scratch,
  wx: number,
  wy: number,
  radius: number,
  strength: number,
): void {
  const cx = Math.round(wx - scratch.originX);
  const cy = Math.round(wy - scratch.originY);
  const warp = clamp01(generationNumber(def.generation.shapeWarp, 0.48)) * clamp01(strength);
  const jitter = (2.2 + radius * 0.18) * warp;
  const r = Math.ceil(radius + jitter + 1);
  const inner = Math.max(0, radius - jitter);
  const inner2 = inner * inner;
  const outer = radius + jitter;
  const outer2 = outer * outer;
  for (let y = cy - r; y <= cy + r; y++) {
    if (y < 0 || y >= scratch.size) continue;
    const worldY = scratch.originY + y;
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= scratch.size) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > outer2) continue;
      if (d2 > inner2) {
        const worldX = scratch.originX + x;
        const edge = warp > 0 ? (organicNoise(def.seed ^ 0x93d765dd, worldX, worldY) * 2 - 1) * jitter : 0;
        if (Math.sqrt(d2) > radius + edge) continue;
      }
      const i = x + y * scratch.size;
      scratch.types[i] = Cell.Empty;
      scratch.colors[i] = EMPTY_COLOR;
    }
  }
}

function carveOrganicEllipse(
  def: VirtualWorldDef,
  scratch: Scratch,
  wx: number,
  wy: number,
  rx: number,
  ry: number,
  strength: number,
): void {
  const cx = Math.round(wx - scratch.originX);
  const cy = Math.round(wy - scratch.originY);
  const warp = clamp01(generationNumber(def.generation.shapeWarp, 0.48)) * clamp01(strength);
  const band = 0.18 * warp;
  const pad = 2 + Math.ceil(Math.max(rx, ry) * band);
  const xRad = Math.ceil(rx) + pad;
  const yRad = Math.ceil(ry) + pad;
  for (let y = cy - yRad; y <= cy + yRad; y++) {
    if (y < 0 || y >= scratch.size) continue;
    const worldY = scratch.originY + y;
    for (let x = cx - xRad; x <= cx + xRad; x++) {
      if (x < 0 || x >= scratch.size) continue;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1 + band) continue;
      if (d > 1 - band) {
        const worldX = scratch.originX + x;
        const edge = warp > 0 ? (organicNoise(def.seed ^ 0x4cf5ad43, worldX, worldY) * 2 - 1) * band : 0;
        if (d > 1 + edge) continue;
      }
      const i = x + y * scratch.size;
      scratch.types[i] = Cell.Empty;
      scratch.colors[i] = EMPTY_COLOR;
    }
  }
}

function sealOuterBorder(def: VirtualWorldDef, scratch: Scratch): void {
  const seal = generationInt(def.generation.borderSeal, 2, 0, 16);
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
  return smoothValueNoise(seed, x / 17 + 19.31, y / 17 - 7.73);
}

function terrainNoise(def: VirtualWorldDef, x: number, y: number): number {
  const scale = generationNumber(def.generation.noiseScale, 0.035);
  return (
    smoothValueNoise(def.seed ^ 0x51ed270b, x * scale, y * scale) * 0.64 +
    smoothValueNoise(def.seed ^ 0xa24baed5, x * scale * 0.43 + 17.1, y * scale * 0.43 - 9.3) * 0.36
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

function normalizeVirtualWorldDef(def: VirtualWorldDef): void {
  def.pixelScenes = normalizePixelScenePlacements(
    (def as VirtualWorldDef & { pixelScenes?: PixelScenePlacementDef[] }).pixelScenes ?? [],
  );

  const fallbackGeneration = createDefaultVirtualGenerationParams();
  const rawGeneration = (def as VirtualWorldDef & { generation?: Partial<VirtualWorldDef['generation']> }).generation ?? {};
  def.generation = {
    ...fallbackGeneration,
    ...rawGeneration,
  };
  for (const [key, fallback] of Object.entries(fallbackGeneration) as Array<
    [keyof VirtualWorldDef['generation'], number]
  >) {
    if (!Number.isFinite(def.generation[key])) def.generation[key] = fallback;
  }

  const fallbackDressing = createDefaultDressingProfile();
  const rawDressing =
    (def as VirtualWorldDef & { dressing?: Partial<VirtualDressingProfile> }).dressing ?? {};
  const rawControls = rawDressing.controls ?? {};
  const rawSceneControls = normalizeSceneControlAliases(rawDressing.scenes?.controls ?? {});
  def.dressing = {
    controls: {
      ...fallbackDressing.controls,
      ...rawControls,
    },
    biomes: { ...fallbackDressing.biomes },
    scenes: {
      controls: {
        ...fallbackDressing.scenes.controls,
        ...rawSceneControls,
      },
      biomes: { ...fallbackDressing.scenes.biomes },
    },
  };
  for (const [key, fallback] of Object.entries(fallbackDressing.controls) as Array<
    [keyof VirtualDressingProfile['controls'], number]
  >) {
    const value = def.dressing.controls[key];
    def.dressing.controls[key] = Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : fallback;
  }
  const rawBiomes = rawDressing.biomes ?? {};
  for (const [biome, fallbackRecipe] of Object.entries(fallbackDressing.biomes) as Array<
    [VirtualBiomeId, VirtualBiomeDressingRecipe]
  >) {
    const recipe = {
      ...fallbackRecipe,
      ...(rawBiomes[biome] ?? {}),
    };
    for (const [key, fallback] of Object.entries(fallbackRecipe) as Array<
      [keyof VirtualBiomeDressingRecipe, number]
    >) {
      if (!Number.isFinite(recipe[key])) recipe[key] = fallback;
    }
    def.dressing.biomes[biome] = recipe;
  }
  for (const [key, fallback] of Object.entries(fallbackDressing.scenes.controls) as Array<
    [keyof VirtualDressingProfile['scenes']['controls'], number]
  >) {
    const max = key === 'maxPerTile' ? 6 : 2;
    const value = def.dressing.scenes.controls[key];
    def.dressing.scenes.controls[key] = Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
  }
  const rawSceneBiomes = rawDressing.scenes?.biomes ?? {};
  for (const [biome, fallbackBudget] of Object.entries(fallbackDressing.scenes.biomes) as Array<
    [VirtualBiomeId, VirtualSceneBudget]
  >) {
    const rawBudget = rawSceneBiomes[biome] ?? {};
    const budget = { ...fallbackBudget, ...rawBudget };
    for (const kind of VIRTUAL_SCENE_KINDS) {
      const value = budget[kind];
      budget[kind] = Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : fallbackBudget[kind];
    }
    def.dressing.scenes.biomes[biome] = budget;
  }
}

function normalizeSceneControlAliases(
  controls: Partial<VirtualDressingProfile['scenes']['controls']> & { maxPerChunk?: number },
): Partial<VirtualDressingProfile['scenes']['controls']> {
  if (!Number.isFinite(controls.maxPerTile) && Number.isFinite(controls.maxPerChunk)) {
    return { ...controls, maxPerTile: controls.maxPerChunk };
  }
  return controls;
}

function normalizePixelScenePlacements(placements: readonly PixelScenePlacementDef[]): PixelScenePlacementDef[] {
  if (!Array.isArray(placements)) return [];
  const out: PixelScenePlacementDef[] = [];
  for (const placement of placements) {
    const scene = normalizePixelScene(placement?.scene);
    if (!scene) continue;
    const x = Number.isFinite(placement.x) ? Math.round(placement.x) : 0;
    const y = Number.isFinite(placement.y) ? Math.round(placement.y) : 0;
    const priority = Number.isFinite(placement.priority) ? placement.priority : 0;
    out.push({
      id: typeof placement.id === 'string' && placement.id.length > 0 ? placement.id : scene.id,
      scene,
      x,
      y,
      priority,
    });
  }
  return out;
}

function normalizePixelScene(scene: PixelSceneDef | undefined): PixelSceneDef | null {
  if (!scene || !(scene.material instanceof Uint8Array)) return null;
  const w = Math.max(1, Math.floor(scene.w));
  const h = Math.max(1, Math.floor(scene.h));
  if (scene.material.length < w * h) return null;
  return {
    ...scene,
    v: 1,
    id: typeof scene.id === 'string' && scene.id.length > 0 ? scene.id : 'scene',
    name: typeof scene.name === 'string' && scene.name.length > 0 ? scene.name : scene.id,
    tags: Array.isArray(scene.tags) ? scene.tags.filter((tag) => typeof tag === 'string') : [],
    w,
    h,
    mask: scene.mask instanceof Uint8Array ? scene.mask : undefined,
    colorOverrides: scene.colorOverrides instanceof Uint32Array ? scene.colorOverrides : undefined,
    life: scene.life instanceof Int16Array && scene.life.length >= w * h ? scene.life : undefined,
    charge: scene.charge instanceof Uint8Array && scene.charge.length >= w * h ? scene.charge : undefined,
    objects: Array.isArray(scene.objects) ? scene.objects : [],
    links: Array.isArray(scene.links) ? scene.links : [],
    lights: Array.isArray(scene.lights) ? scene.lights : [],
  };
}

function sceneMetadataBytes(placements: readonly VirtualScenePlacementInstance[]): Uint8Array {
  if (placements.length === 0) return new Uint8Array(0);
  const text = placements
    .map((placement) => {
      const objects = placement.objects
        .map((object) => `${object.id},${object.kind},${object.x},${object.y},${stableScalarString(object.params)}`)
        .join(';');
      const links = placement.links
        .map((link) => `${link.id},${link.kind},${link.fromId},${link.toId}`)
        .join(';');
      const lights = placement.lights
        .map((light) => `${light.id},${light.x},${light.y},${light.color},${light.intensity},${light.radius},${light.bloom ?? ''},${light.flicker ?? ''},${light.falloff ?? ''},${light.occluded ?? ''}`)
        .join(';');
      return `${placement.id}@${placement.x},${placement.y},${placement.w},${placement.h}:o(${objects})l(${links})g(${lights})`;
    })
    .join('|');
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function stableScalarString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(stableScalarString).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableScalarString((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return '';
}

function firstSteppedLocal(origin: number, minLocal: number, step: number): number {
  return Math.ceil((origin + minLocal) / step) * step - origin;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function generationNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function generationInt(value: number, fallback: number, min: number, max: number): number {
  const n = Math.round(generationNumber(value, fallback));
  return Math.max(min, Math.min(max, n));
}

function smoothValueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const a = unitHash2i(seed, x0, y0);
  const b = unitHash2i(seed, x0 + 1, y0);
  const c = unitHash2i(seed, x0, y0 + 1);
  const d = unitHash2i(seed, x0 + 1, y0 + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
