import type { EditorObjectKind } from '@/builder/document';
import { humanizeIdentifier } from '@/core/strings';

/** Friendly, human-facing names for every editor object kind. Used by validation
 *  prose, the outliner, runtime rows, and palette labels so raw camelCase kind
 *  identifiers (runeDoor, chargeLatch, exitPortal) never leak into the UI. */
export const KIND_LABEL: Record<EditorObjectKind, string> = {
  spawn: 'Spawn',
  enemy: 'Enemy',
  pickup: 'Pickup',
  exitPortal: 'Exit Portal',
  exitWell: 'Exit Well',
  waystone: 'Waystone',
  cauldron: 'Cauldron',
  door: 'Door',
  plate: 'Plate',
  lever: 'Lever',
  brazier: 'Brazier',
  scale: 'Scale',
  buoy: 'Buoy',
  chargeLatch: 'Charge Latch',
  runeGlyph: 'Rune Glyph',
  runeDoor: 'Rune Door',
  bossMarker: 'Boss Marker',
  terrainStamp: 'Terrain Stamp',
  vegetationStamp: 'Vegetation Stamp',
  hazardEmitter: 'Hazard Emitter',
  decor: 'Decor',
  valve: 'Valve',
  plug: 'Plug',
  sensor: 'Sensor',
  counterweight: 'Counterweight',
  relay: 'Relay',
};

/** Human-facing label for an object kind. Falls back to a humanized identifier
 *  for any kind not in the table (e.g. a future kind, or a non-editor string). */
export function kindLabel(kind: EditorObjectKind | string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? humanizeIdentifier(String(kind));
}
