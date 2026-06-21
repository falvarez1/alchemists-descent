import type { Ctx, Mechanism, Pickup, PickupKind } from '@/core/types';
import { MINIMAP_W, MINIMAP_H } from '@/config/constants';
import { MATERIAL_PARAMS } from '@/config/params';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import { PICKUP_COLOR, POTION_DEFS } from '@/core/pickupDefs';
import { PopoverHost, type RectLike } from '@/ui/editor/PopoverHost';
import { fillMaterialPopover } from '@/ui/materialInfo';
import { resetHeldSpellInputs } from '@/core/runtimeState';

/** Fog color for unexplored map cells (#0a0a10). */
const UNEXPLORED = packRGB(10, 10, 16);
/** Explored open air — lifted above the fog so visited caverns read on the map. */
const EXPLORED_AIR = packRGB(22, 22, 30);

/** Redraw cadence while the overlay is open (frames). */
const REDRAW_INTERVAL = 8;

/** Non-null getElementById — the minimap elements exist statically in index.html. */
function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

const POI_POPOVER_ID = 'minimap-poi-pop';

export type MinimapPoiKind =
  | 'portal'
  | 'exit'
  | 'waystone'
  | 'cauldron'
  | 'refuge'
  | 'spellLab'
  | 'vaultArch'
  | 'pickup'
  | 'mechanism'
  | 'runeVault'
  | 'player';

export interface MinimapPoi {
  id: string;
  kind: MinimapPoiKind;
  title: string;
  description: string;
  tags: string[];
  fields: Array<{ label: string; value: string }>;
  worldX: number;
  worldY: number;
  mapX: number;
  mapY: number;
  drawX: number;
  drawY: number;
  width: number;
  height: number;
  hitRadius: number;
  color: string;
  glyph: string;
  ping?: 'portal' | 'refuge';
}

export interface MinimapMaterialPoi {
  id: string;
  cell: number;
  name: string;
  worldX: number;
  worldY: number;
  mapX: number;
  mapY: number;
  color: string;
}

interface PoiInput {
  id: string;
  kind: MinimapPoiKind;
  title: string;
  description: string;
  tags?: string[];
  fields?: Array<{ label: string; value: string }>;
  worldX: number;
  worldY: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  color: string;
  glyph: string;
  ping?: 'portal' | 'refuge';
  hitRadius?: number;
}

function mapIndex(mapX: number, mapY: number): number {
  return mapX + mapY * MINIMAP_W;
}

function isExplored(level: NonNullable<Ctx['levels']['current']>, mapX: number, mapY: number): boolean {
  return mapX >= 0 && mapX < MINIMAP_W && mapY >= 0 && mapY < MINIMAP_H && level.explored[mapIndex(mapX, mapY)] > 0;
}

function coordField(x: number, y: number): { label: string; value: string } {
  return { label: 'position', value: `${Math.round(x)}, ${Math.round(y)}` };
}

function colorHex(packed: number): string {
  return `#${[unpackR(packed), unpackG(packed), unpackB(packed)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')}`;
}

function makePoi(input: PoiInput): MinimapPoi {
  const mapX = input.worldX >> 3;
  const mapY = input.worldY >> 3;
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    description: input.description,
    tags: input.tags ?? [],
    fields: [coordField(input.worldX, input.worldY), ...(input.fields ?? [])],
    worldX: input.worldX,
    worldY: input.worldY,
    mapX,
    mapY,
    drawX: mapX + input.offsetX,
    drawY: mapY + input.offsetY,
    width: input.width,
    height: input.height,
    hitRadius: input.hitRadius ?? Math.max(5, input.width + 3, input.height + 3),
    color: input.color,
    glyph: input.glyph,
    ping: input.ping,
  };
}

type PickupPoiInfo = {
  title: string;
  description: string;
  glyph: string;
};

const PICKUP_POI_INFO: Record<PickupKind, PickupPoiInfo> = {
  key: {
    title: 'Golden Key',
    description: 'Unlocks the exit portal for this depth.',
    glyph: 'K',
  },
  heart: {
    title: 'Heart Vessel',
    description: 'Expands the vessel; refill safely before pushing deeper.',
    glyph: 'H',
  },
  tome: {
    title: 'Spell Tome',
    description: 'Offers a spell-card choice for your wand collection.',
    glyph: 'T',
  },
  chest: {
    title: 'Treasure Chest',
    description: 'A discovered cache. Crack it open for gold, potions, or spell rewards.',
    glyph: '$',
  },
  potion: {
    title: 'Potion',
    description: 'A discovered instant draught. Drink it for a timed combat or traversal effect.',
    glyph: '!',
  },
  goldpile: {
    title: 'Gold Pile',
    description: 'Loose treasure already spotted on this depth.',
    glyph: 'G',
  },
};

const GENERIC_TERRAIN_CELLS = new Set<number>([Cell.Empty, Cell.Wall, Cell.Stone]);

function isObjectivePickup(kind: PickupKind): boolean {
  return kind === 'key' || kind === 'heart' || kind === 'tome';
}

function shouldShowPickupPoi(level: NonNullable<Ctx['levels']['current']>, pickup: Pickup): boolean {
  if (pickup.taken) return false;
  if (isObjectivePickup(pickup.kind)) return true;
  return isExplored(level, pickup.x >> 3, pickup.y >> 3);
}

function pickupDataFields(pickup: Pickup): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  if (pickup.data.card !== undefined) fields.push({ label: 'card', value: pickup.data.card });
  if (pickup.data.potion !== undefined) {
    fields.push({
      label: 'potion',
      value: POTION_DEFS[pickup.data.potion]?.name ?? pickup.data.potion,
    });
  }
  if (pickup.data.amount !== undefined) fields.push({ label: 'amount', value: `${pickup.data.amount} gold` });
  return fields;
}

function mechanismKindTitle(kind: Mechanism['kind']): string {
  if (kind === 'door') return 'Gate';
  if (kind === 'plate') return 'Pressure Plate';
  if (kind === 'lever') return 'Lever';
  if (kind === 'brazier') return 'Brazier';
  if (kind === 'scale') return 'Scale Pan';
  if (kind === 'buoy') return 'Buoy Sensor';
  if (kind === 'chargelatch') return 'Charge Latch';
  if (kind === 'valve') return 'Valve';
  if (kind === 'plug') return 'Breakable Plug';
  if (kind === 'sensor') return 'Sensor';
  if (kind === 'counterweight') return 'Counterweight';
  return 'Relay';
}

function mechanismStateLabel(mechanism: Mechanism): string {
  if (mechanism.kind === 'door' || mechanism.kind === 'valve') {
    return mechanism.state === 1 ? 'open' : mechanism.state > 1 ? `active ${mechanism.state}` : 'sealed';
  }
  if (mechanism.kind === 'lever') return mechanism.state === 1 ? 'on' : 'off';
  if (mechanism.kind === 'brazier') return mechanism.state === 1 ? 'lit' : 'unlit';
  if (mechanism.kind === 'chargelatch' || mechanism.kind === 'counterweight') {
    return mechanism.state === 1 ? 'latched' : 'waiting';
  }
  if (mechanism.kind === 'plug') return mechanism.state === 1 ? 'fired' : 'intact';
  if (mechanism.kind === 'relay') {
    if (mechanism.state === 1) return 'fired';
    return mechanism.fuseT !== undefined ? 'armed' : 'waiting';
  }
  if (mechanism.kind === 'plate') return mechanism.pressed || mechanism.state > 0 ? 'pressed' : 'idle';
  return mechanism.state > 0 ? 'satisfied' : 'waiting';
}

function mechanismDescription(mechanism: Mechanism): string {
  if (mechanism.kind === 'door') return 'A real-cell gate driven by linked plates, levers, braziers, or sensors.';
  if (mechanism.kind === 'plate') return 'A brass sill that reads real bodies and material weight.';
  if (mechanism.kind === 'lever') return 'A switch that flips from a pull, projectile, blast, or structure strike.';
  if (mechanism.kind === 'brazier') return 'A stone fire bowl that wants real flame cells.';
  if (mechanism.kind === 'scale') return 'A pan that opens its target when enough real material is poured in.';
  if (mechanism.kind === 'buoy') return 'A float sensor that rises when liquid fills its basin.';
  if (mechanism.kind === 'chargelatch') return 'A conductive coil that latches forever on the first spark.';
  if (mechanism.kind === 'valve') return 'A material gate in a channel, driven by linked triggers like a door.';
  if (mechanism.kind === 'plug') return 'A breakable seal that fires when enough of its real cells are destroyed.';
  if (mechanism.kind === 'sensor') return 'A tuned reader for heat, liquid, weight, charge, or material in its zone.';
  if (mechanism.kind === 'counterweight') return 'A pan that permanently latches when enough mass collects.';
  return 'A delayed one-shot node that forwards a linked mechanism signal.';
}

function mechanismColor(mechanism: Mechanism): string {
  if (mechanism.kind === 'door' || mechanism.kind === 'valve') return mechanism.state === 1 ? '#3f6212' : '#fbbf24';
  if (mechanism.kind === 'lever') return mechanism.state === 1 ? '#22c55e' : '#fb923c';
  if (mechanism.kind === 'brazier') return mechanism.state === 1 ? '#f97316' : '#7c2d12';
  if (mechanism.kind === 'chargelatch') return mechanism.state === 1 ? '#93c5fd' : '#38bdf8';
  if (mechanism.kind === 'sensor') return mechanism.state > 0 ? '#4ade80' : '#2dd4bf';
  if (mechanism.kind === 'relay') return mechanism.state === 1 ? '#4ade80' : mechanism.fuseT !== undefined ? '#fbbf24' : '#a78bfa';
  if (mechanism.kind === 'plug') return mechanism.state === 1 ? '#78716c' : '#a16207';
  return mechanism.state > 0 ? '#4ade80' : '#f59e0b';
}

function mechanismGlyph(mechanism: Mechanism): string {
  if (mechanism.kind === 'door') return 'G';
  if (mechanism.kind === 'plate') return 'P';
  if (mechanism.kind === 'lever') return 'L';
  if (mechanism.kind === 'brazier') return 'B';
  if (mechanism.kind === 'scale') return 'S';
  if (mechanism.kind === 'buoy') return 'U';
  if (mechanism.kind === 'chargelatch') return 'C';
  if (mechanism.kind === 'valve') return 'V';
  if (mechanism.kind === 'plug') return 'X';
  if (mechanism.kind === 'sensor') return 'N';
  if (mechanism.kind === 'counterweight') return 'W';
  return 'R';
}

function mechanismFields(mechanism: Mechanism): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [
    { label: 'kind', value: mechanism.kind },
    { label: 'state', value: mechanismStateLabel(mechanism) },
    { label: 'size', value: `${mechanism.w} x ${mechanism.h}` },
    { label: 'target', value: mechanism.targetId === undefined || mechanism.targetId < 0 ? '-' : String(mechanism.targetId) },
  ];
  if (mechanism.logic !== undefined) fields.push({ label: 'logic', value: mechanism.logic });
  if (mechanism.threshold !== undefined) fields.push({ label: 'threshold', value: String(mechanism.threshold) });
  if (mechanism.reading !== undefined) fields.push({ label: 'reading', value: String(Math.round(mechanism.reading)) });
  if (mechanism.sensorType !== undefined) fields.push({ label: 'sensor', value: mechanism.sensorType });
  if (mechanism.latch !== undefined) fields.push({ label: 'latch', value: mechanism.latch });
  if (mechanism.zone !== undefined) {
    fields.push({
      label: 'zone',
      value: `${mechanism.zone.x0},${mechanism.zone.y0} -> ${mechanism.zone.x1},${mechanism.zone.y1}`,
    });
  }
  if (mechanism.outputAction !== undefined) fields.push({ label: 'output', value: mechanism.outputAction });
  if (mechanism.delayFrames !== undefined) fields.push({ label: 'delay', value: `${mechanism.delayFrames}f` });
  if (mechanism.closeT !== undefined) fields.push({ label: 'auto close', value: `${mechanism.closeT}f` });
  if (mechanism.broken !== undefined) {
    fields.push({ label: 'broken', value: mechanism.broken > 0 ? `breaking ${mechanism.broken}f` : 'forced open' });
  }
  return fields;
}

function shouldShowMechanismPoi(level: NonNullable<Ctx['levels']['current']>, mechanism: Mechanism): boolean {
  if (mechanism.kind === 'door') return true;
  return isExplored(level, mechanism.x >> 3, mechanism.y >> 3);
}

function shouldShowMaterialPoi(cell: number): boolean {
  return cell >= 0 && cell < CELL_COUNT && !GENERIC_TERRAIN_CELLS.has(cell);
}

export function findMinimapMaterialPoi(
  level: NonNullable<Ctx['levels']['current']>,
  mapX: number,
  mapY: number,
  radius = 2.25,
): MinimapMaterialPoi | null {
  const centerX = Math.floor(mapX);
  const centerY = Math.floor(mapY);
  let best: MinimapMaterialPoi | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const wholeRadius = Math.ceil(radius);
  for (let y = centerY - wholeRadius; y <= centerY + wholeRadius; y++) {
    for (let x = centerX - wholeRadius; x <= centerX + wholeRadius; x++) {
      if (!isExplored(level, x, y)) continue;
      const worldX = x * 8 + 4;
      const worldY = y * 8 + 4;
      if (worldX < 0 || worldX >= level.world.width || worldY < 0 || worldY >= level.world.height) continue;
      const idx = worldX + worldY * level.world.width;
      const cell = level.world.types[idx];
      if (!shouldShowMaterialPoi(cell)) continue;
      const dx = mapX - (x + 0.5);
      const dy = mapY - (y + 0.5);
      const dist = dx * dx + dy * dy;
      if (dist > radius * radius || dist >= bestDistance) continue;
      const color = level.world.colors[idx] || COLOR_FN[cell]?.() || EXPLORED_AIR;
      const name = MATERIAL_PARAMS[cell]?.name ?? `Cell ${cell}`;
      bestDistance = dist;
      best = {
        id: `material:${cell}:${x}:${y}`,
        cell,
        name,
        worldX,
        worldY,
        mapX: x,
        mapY: y,
        color: colorHex(color),
      };
    }
  }
  return best;
}

export function collectMinimapPois(ctx: Ctx, level: NonNullable<Ctx['levels']['current']>): MinimapPoi[] {
  const pois: MinimapPoi[] = [];

  if (level.portal) {
    pois.push(makePoi({
      id: 'portal',
      kind: 'portal',
      title: 'Exit Portal',
      description: level.keyTaken
        ? 'The key is yours. Return here to open the way down.'
        : 'Find the golden key before this gate will carry you onward.',
      tags: ['portal', level.keyTaken ? 'key held' : 'key needed', level.portal.open ? 'open' : 'sealed'],
      fields: [{ label: 'objective', value: level.keyTaken ? 'return' : 'find key' }],
      worldX: level.portal.x,
      worldY: level.portal.y,
      width: 3,
      height: 3,
      offsetX: -1,
      offsetY: -1,
      color: level.keyTaken ? '#c084fc' : '#7c3aed',
      glyph: 'P',
      ping: 'portal',
    }));
  }

  if (level.exit) {
    pois.push(makePoi({
      id: 'exit-well',
      kind: 'exit',
      title: 'Descent Well',
      description: 'A diggable fast route downward. Breaking the seal skips Sanctum pacing.',
      tags: ['well', 'diggable'],
      fields: [
        { label: 'seal row', value: String(Math.round(level.exit.sealY)) },
        { label: 'width', value: String(level.exit.halfW * 2 + 1) },
      ],
      worldX: level.exit.x,
      worldY: level.exit.sealY,
      width: 2,
      height: 2,
      offsetX: -1,
      offsetY: -1,
      color: '#a855f7',
      glyph: 'W',
    }));
  }

  level.waystones.forEach((waystone, index) => {
    if (!waystone.lit) return;
    pois.push(makePoi({
      id: `waystone:${index}`,
      kind: 'waystone',
      title: 'Lit Waystone',
      description: 'Checkpoint brazier. Death walks you back here with the world intact.',
      tags: ['checkpoint', 'lit'],
      worldX: waystone.x,
      worldY: waystone.y,
      width: 2,
      height: 2,
      offsetX: -1,
      offsetY: -1,
      color: '#ff9a3c',
      glyph: 'Y',
    }));
  });

  if (level.cauldron) {
    pois.push(makePoi({
      id: 'cauldron',
      kind: 'cauldron',
      title: 'Cauldron',
      description: 'Drop real ingredients into the basin to brew elixirs and record recipes.',
      tags: ['alchemy', 'brew'],
      worldX: level.cauldron.x,
      worldY: level.cauldron.y,
      width: 2,
      height: 2,
      offsetX: -1,
      offsetY: -1,
      color: '#4ade80',
      glyph: 'C',
    }));
  }

  if (level.refuge) {
    const rx = level.refuge.x >> 3;
    const ry = level.refuge.y >> 3;
    if (isExplored(level, rx, ry)) {
      pois.push(makePoi({
        id: 'refuge',
        kind: 'refuge',
        title: 'Refuge',
        description: 'The Wandsmith bench and offering shrine live here. Return after finding new cards.',
        tags: ['bench', 'shop', 'safe work'],
        worldX: level.refuge.x,
        worldY: level.refuge.y,
        width: 3,
        height: 3,
        offsetX: -1,
        offsetY: -1,
        color: '#38bdf8',
        glyph: 'R',
        ping: 'refuge',
      }));
    }
  }

  if (level.spellLab) {
    const lx = level.spellLab.x >> 3;
    const ly = level.spellLab.y >> 3;
    if (isExplored(level, lx, ly)) {
      pois.push(makePoi({
        id: 'spell-lab',
        kind: 'spellLab',
        title: 'Spell Lab',
        description: 'A teaching annex with real-cell stations and a spell-card reward.',
        tags: ['tutorial', 'wand practice'],
        fields: [{ label: 'reward', value: `${Math.round(level.spellLab.rewardX)}, ${Math.round(level.spellLab.rewardY)}` }],
        worldX: level.spellLab.x,
        worldY: level.spellLab.y,
        width: 3,
        height: 3,
        offsetX: -1,
        offsetY: -1,
        color: '#f472b6',
        glyph: 'L',
      }));
    }
  }

  if (level.vaultArch) {
    const discoverX = (level.vaultArch.discoverX ?? level.vaultArch.x) >> 3;
    const discoverY = (level.vaultArch.discoverY ?? level.vaultArch.y) >> 3;
    if (level.def.branch || isExplored(level, discoverX, discoverY)) {
      pois.push(makePoi({
        id: 'vault-arch',
        kind: 'vaultArch',
        title: level.def.branch ? 'Return Arch' : 'Gilded Arch',
        description: level.def.branch
          ? 'A two-way branch arch back to the host depth.'
          : 'A discovered branch entrance. The gold glint marks the way in.',
        tags: ['branch', level.def.branch ? 'return' : 'secret'],
        fields: [{ label: 'arrival', value: `${Math.round(level.vaultArch.backX)}, ${Math.round(level.vaultArch.backY)}` }],
        worldX: level.vaultArch.x,
        worldY: level.vaultArch.y,
        width: 3,
        height: 3,
        offsetX: -1,
        offsetY: -1,
        color: '#fcd34d',
        glyph: 'A',
      }));
    }
  }

  level.pickups.forEach((pickup, index) => {
    if (!shouldShowPickupPoi(level, pickup)) return;
    const info = PICKUP_POI_INFO[pickup.kind];
    pois.push(makePoi({
      id: `pickup:${index}:${pickup.kind}`,
      kind: 'pickup',
      title: info.title,
      description: info.description,
      tags: ['pickup', pickup.kind],
      fields: pickupDataFields(pickup),
      worldX: pickup.x,
      worldY: pickup.y,
      width: 2,
      height: 2,
      offsetX: 0,
      offsetY: 0,
      color: colorHex(PICKUP_COLOR[pickup.kind]),
      glyph: info.glyph,
      hitRadius: 6,
    }));
  });

  for (const mechanism of level.mechanisms) {
    if (!shouldShowMechanismPoi(level, mechanism)) continue;
    const state = mechanismStateLabel(mechanism);
    pois.push(makePoi({
      id: `mechanism:${mechanism.id}`,
      kind: 'mechanism',
      title: `${mechanismKindTitle(mechanism.kind)} #${mechanism.id}`,
      description: mechanismDescription(mechanism),
      tags: ['mechanism', mechanism.kind, state, ...(mechanism.logic ? [`logic ${mechanism.logic}`] : [])],
      fields: mechanismFields(mechanism),
      worldX: mechanism.x,
      worldY: mechanism.y,
      width: 2,
      height: 2,
      offsetX: 0,
      offsetY: 0,
      color: mechanismColor(mechanism),
      glyph: mechanismGlyph(mechanism),
      hitRadius: 6,
    }));
  }

  level.runeVaults.forEach((vault, index) => {
    pois.push(makePoi({
      id: `rune-vault:${index}`,
      kind: 'runeVault',
      title: 'Rune Glyph',
      description: 'Strike the glyph with a spell, blast, or dig beam to open its sealed strongroom.',
      tags: ['rune', vault.active ? 'opened' : 'sealed'],
      fields: [{ label: 'door cells', value: String(vault.door.length) }],
      worldX: vault.rx,
      worldY: vault.ry,
      width: 2,
      height: 2,
      offsetX: 0,
      offsetY: 0,
      color: vault.active ? '#4ade80' : '#a78bfa',
      glyph: 'U',
    }));
  });

  pois.push(makePoi({
    id: 'player',
    kind: 'player',
    title: 'You',
    description: 'Current alchemist position on the live map.',
    tags: ['player', ctx.player.dead ? 'dead' : 'alive'],
    fields: [
      { label: 'hp', value: `${Math.round(ctx.player.hp)} / ${Math.round(ctx.player.maxHp)}` },
      { label: 'depth', value: `D${level.def.depth} ${level.def.name}` },
    ],
    worldX: ctx.player.x,
    worldY: ctx.player.y,
    width: 2,
    height: 2,
    offsetX: -1,
    offsetY: -1,
    color: '#ffffff',
    glyph: '@',
  }));

  return pois;
}

export function hitTestMinimapPoi(pois: readonly MinimapPoi[], mapX: number, mapY: number): MinimapPoi | null {
  let best: MinimapPoi | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const poi of pois) {
    const cx = poi.drawX + poi.width / 2;
    const cy = poi.drawY + poi.height / 2;
    const dx = mapX - cx;
    const dy = mapY - cy;
    const dist = dx * dx + dy * dy;
    const radiusSq = poi.hitRadius * poi.hitRadius;
    if (dist <= radiusSq && dist <= bestDistance) {
      best = poi;
      bestDistance = dist;
    }
  }
  return best;
}

function fillMinimapPoiPopover(pop: HTMLDivElement, poi: MinimapPoi): void {
  const head = document.createElement('div');
  head.className = 'bp-pop-head';
  head.appendChild(poiPreviewCanvas(poi));
  const label = document.createElement('span');
  label.textContent = poi.title;
  head.appendChild(label);
  pop.appendChild(head);

  if (poi.tags.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'bp-pop-tags';
    tags.textContent = poi.tags.join(' · ');
    pop.appendChild(tags);
  }

  const desc = document.createElement('div');
  desc.className = 'bp-pop-desc';
  desc.textContent = poi.description;
  pop.appendChild(desc);

  for (const field of poi.fields) {
    const row = document.createElement('div');
    row.className = 'bp-pop-prop';
    const name = document.createElement('span');
    name.textContent = field.label;
    const value = document.createElement('b');
    value.textContent = field.value;
    row.append(name, value);
    pop.appendChild(row);
  }
}

function fillMinimapMaterialPopover(pop: HTMLDivElement, material: MinimapMaterialPoi): void {
  fillMaterialPopover(pop, material.cell, material.name, material.color, MATERIAL_PARAMS[material.cell]);
  const row = document.createElement('div');
  row.className = 'bp-pop-prop';
  const name = document.createElement('span');
  name.textContent = 'position';
  const value = document.createElement('b');
  value.textContent = `${material.worldX}, ${material.worldY}`;
  row.append(name, value);
  pop.appendChild(row);
}

function poiPreviewCanvas(poi: MinimapPoi): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'map-poi-thumb';
  canvas.width = 28;
  canvas.height = 28;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#070a10';
  g.fillRect(0, 0, 28, 28);
  g.strokeStyle = '#1d2733';
  g.strokeRect(2, 2, 24, 24);
  g.fillStyle = '#101822';
  g.fillRect(5, 5, 18, 18);
  g.fillStyle = poi.color;
  g.fillRect(10, 10, 8, 8);
  g.strokeStyle = poi.ping ? '#ffffff' : '#000000';
  g.strokeRect(9, 9, 10, 10);
  g.fillStyle = poi.kind === 'player' ? '#0b0e14' : '#dbeafe';
  g.font = '700 9px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(poi.glyph, 14, 14);
  return canvas;
}

// ===================== Minimap =====================
/**
 * The material-colored descent map (M, play mode): a 1:8 downsample of the
 * current level's live World, masked by the explored fog-of-war. Cartography
 * samples World.types directly, so your lava spill IS the map.
 *
 * The lead calls update(ctx) every frame; terrain is resampled every
 * REDRAW_INTERVAL frames while the overlay is open. Colors come from a
 * palette generated once at construction (one COLOR_FN sample per material)
 * so the map does not shimmer between redraws.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly c2d: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly popovers = new PopoverHost();
  /** Always-on corner panel (play mode), refreshed on a slower cadence. */
  private readonly corner: CanvasRenderingContext2D;
  private readonly cornerEl: HTMLCanvasElement;
  /** One representative packed 0xRRGGBB per cell type, frozen at construction. */
  private readonly palette: Uint32Array;
  private visible = false;
  /**
   * POI list cached from the most recent terrain repaint. The hover hit-test
   * reuses this instead of rebuilding the whole list per mousemove — it only
   * changes when update()/explored advances a redraw, which refreshes it.
   */
  private cachedPois: readonly MinimapPoi[] = [];
  private readonly disposers: Array<() => void> = [];
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || this.ctx.state.mode !== 'play') return;
    if (e.code === 'KeyM') {
      e.preventDefault();
      e.stopPropagation();
      this.setVisible(!this.visible);
      return;
    }
    if (e.code === 'Escape' && this.visible) {
      e.preventDefault();
      e.stopPropagation();
      this.setVisible(false);
    }
  };

  constructor(private ctx: Ctx) {
    this.canvas = el('minimap-canvas') as HTMLCanvasElement;
    this.canvas.width = MINIMAP_W;
    this.canvas.height = MINIMAP_H;
    this.c2d = this.canvas.getContext('2d')!;
    this.img = this.c2d.createImageData(MINIMAP_W, MINIMAP_H);
    this.cornerEl = el('minimap-corner') as HTMLCanvasElement;
    this.corner = this.cornerEl.getContext('2d')!;
    this.wirePoiPopovers(this.canvas);
    this.wirePoiPopovers(this.cornerEl);

    this.palette = new Uint32Array(CELL_COUNT);
    for (let t = 0; t < CELL_COUNT; t++) {
      const fn = COLOR_FN[t];
      this.palette[t] = fn ? fn() : UNEXPLORED;
    }
    this.palette[Cell.Empty] = EXPLORED_AIR;

    window.addEventListener('keydown', this.onKeyDown, true);
    this.disposers.push(() => window.removeEventListener('keydown', this.onKeyDown, true));

    // The map is a play-mode verb; leaving play always closes it.
    this.disposers.push(ctx.events.on('modeChanged', ({ mode }) => {
      if (mode !== 'play') {
        this.setVisible(false);
        this.hidePoiPopover();
      }
    }));

    // Key in hand -> the portal dot pings on the corner map for a few
    // seconds: "now go THERE."
    this.disposers.push(ctx.events.on('objectiveChanged', ({ text }) => {
      if (text === 'REACH THE PORTAL' || text === 'RETURN TO THE PORTAL') this.portalPing = 300;
    }));
    this.disposers.push(ctx.events.on('refugePing', () => {
      this.refugePing = 300;
    }));
  }

  dispose(): void {
    this.setVisible(false);
    this.hidePoiPopover();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  /** Frames left of the go-to-the-portal ping. */
  private portalPing = 0;
  /** Frames left of the go-to-the-Refuge ping. */
  private refugePing = 0;

  /** Sim pause state captured when the full map opens, restored on close. */
  private wasPaused = false;

  private setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    el('minimap-overlay').classList.toggle('visible', on);
    // The fullscreen map is a modal read — pause the world while it's up (the
    // always-on corner panel is unaffected). Restore the prior pause state so it
    // nests correctly under the pause menu.
    if (on) {
      resetHeldSpellInputs(this.ctx);
      this.wasPaused = this.ctx.state.paused;
      this.ctx.state.paused = true;
    } else {
      resetHeldSpellInputs(this.ctx);
      this.ctx.state.paused = this.wasPaused;
    }
    if (!on) this.hidePoiPopover();
    if (on) this.redraw(this.ctx);
  }

  /** Per-frame hook (lead-wired). Cheap no-op unless something needs redrawing. */
  update(ctx: Ctx): void {
    if (this.portalPing > 0) this.portalPing--;
    if (this.refugePing > 0) this.refugePing--;
    // Always-on corner panel: a slower cadence keeps it nearly free —
    // except while the portal ping flashes, which earns a fast refresh.
    const cadence = this.portalPing > 0 || this.refugePing > 0 ? 8 : 30;
    if (ctx.state.mode === 'play' && ctx.state.frameCount % cadence === 0) this.redrawCorner(ctx);
    if (!this.visible || ctx.state.frameCount % REDRAW_INTERVAL !== 0) return;
    this.redraw(ctx);
  }

  /** The compact top-right map: terrain + landmark dots, no caption. */
  private redrawCorner(ctx: Ctx): void {
    const level = ctx.levels.current;
    if (!level) return;
    this.paintTerrain(level);
    this.corner.putImageData(this.img, 0, 0);
    this.paintMarkers(this.corner, ctx, level);
  }

  private redraw(ctx: Ctx): void {
    const level = ctx.levels.current;
    if (!level) return;

    const exploredCount = this.paintTerrain(level);
    this.c2d.putImageData(this.img, 0, 0);
    this.paintMarkers(this.c2d, ctx, level);

    const pct = Math.round((exploredCount / level.explored.length) * 100);
    el('minimap-caption').textContent =
      'D' + level.def.depth + ' · ' + level.def.name + ' — ' + pct + '% explored';
  }

  private wirePoiPopovers(canvas: HTMLCanvasElement): void {
    const onMouseMove = (event: MouseEvent): void => this.showPoiPopover(canvas, event);
    const onMouseLeave = (): void => {
      canvas.style.cursor = '';
      this.hidePoiPopover();
    };
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    this.disposers.push(() => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    });
  }

  private showPoiPopover(canvas: HTMLCanvasElement, event: MouseEvent): void {
    const level = this.ctx.levels.current;
    if (this.ctx.state.mode !== 'play' || !level) {
      this.hidePoiPopover();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      this.hidePoiPopover();
      return;
    }
    const mapX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const mapY = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const poi = hitTestMinimapPoi(this.cachedPois, mapX, mapY);
    if (poi) {
      canvas.style.cursor = 'help';
      this.popovers.show({
        id: POI_POPOVER_ID,
        className: 'map-poi-pop',
        anchorRect: this.poiAnchorRect(canvas, poi),
        preferredSide: canvas === this.cornerEl ? 'left' : undefined,
        offsetY: -10,
        render: (pop) => fillMinimapPoiPopover(pop, poi),
      });
      return;
    }

    const material = findMinimapMaterialPoi(level, mapX, mapY);
    if (!material) {
      canvas.style.cursor = '';
      this.hidePoiPopover();
      return;
    }
    canvas.style.cursor = 'help';
    this.popovers.show({
      id: POI_POPOVER_ID,
      className: 'map-poi-pop',
      anchorRect: this.materialAnchorRect(canvas, material),
      preferredSide: canvas === this.cornerEl ? 'left' : undefined,
      offsetY: -10,
      render: (pop) => fillMinimapMaterialPopover(pop, material),
    });
  }

  private hidePoiPopover(): void {
    this.popovers.hide(POI_POPOVER_ID);
  }

  private poiAnchorRect(canvas: HTMLCanvasElement, poi: MinimapPoi): RectLike {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / canvas.width;
    const sy = rect.height / canvas.height;
    const left = rect.left + poi.drawX * sx;
    const top = rect.top + poi.drawY * sy;
    const width = Math.max(4, poi.width * sx);
    const height = Math.max(4, poi.height * sy);
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }

  private materialAnchorRect(canvas: HTMLCanvasElement, material: MinimapMaterialPoi): RectLike {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / canvas.width;
    const sy = rect.height / canvas.height;
    const left = rect.left + material.mapX * sx;
    const top = rect.top + material.mapY * sy;
    const width = Math.max(4, sx);
    const height = Math.max(4, sy);
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }

  /** Fill this.img from the explored mask + live world; returns explored count. */
  private paintTerrain(level: NonNullable<Ctx['levels']['current']>): number {
    const { world, explored } = level;
    const data = this.img.data;
    const palette = this.palette;
    let exploredCount = 0;

    for (let y = 0; y < MINIMAP_H; y++) {
      for (let x = 0; x < MINIMAP_W; x++) {
        const i = x + y * MINIMAP_W;
        let color = UNEXPLORED;
        if (explored[i] > 0) {
          exploredCount++;
          // Single sample at the 8x8 block center is plenty at this scale.
          const t = world.types[x * 8 + 4 + (y * 8 + 4) * world.width];
          color = palette[t];
        }
        const o = i * 4;
        data[o] = unpackR(color);
        data[o + 1] = unpackG(color);
        data[o + 2] = unpackB(color);
        data[o + 3] = 255;
      }
    }
    return exploredCount;
  }

  /** Landmark dots: portal, well, lit waystones, cauldron, key/hearts/tomes, player. */
  private paintMarkers(
    g: CanvasRenderingContext2D,
    ctx: Ctx,
    level: NonNullable<Ctx['levels']['current']>,
  ): void {
    // Rebuild + cache once per repaint; the hover hit-test reuses this list.
    const pois = collectMinimapPois(ctx, level);
    this.cachedPois = pois;
    for (const poi of pois) {
      if (poi.ping === 'portal' && this.portalPing > 0 && this.portalPing % 16 < 8) {
        g.fillStyle = '#ffffff';
        g.fillRect(poi.mapX - 3, poi.mapY - 3, 7, 7);
      }
      if (poi.ping === 'refuge' && this.refugePing > 0 && this.refugePing % 16 < 8) {
        g.fillStyle = '#ffffff';
        g.fillRect(poi.mapX - 3, poi.mapY - 3, 7, 7);
      }
      g.fillStyle = poi.color;
      g.fillRect(poi.drawX, poi.drawY, poi.width, poi.height);
    }
  }
}
