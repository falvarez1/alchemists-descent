import type { BiomeId, GeneratedScenePlacement } from '@/core/types';
import { createEmptyDocument } from '@/builder/document';
import type {
  EditorDocument,
  EditorLight,
  EditorLink,
  EditorObjectKind,
} from '@/builder/document';

/** Generated scene-object kinds that map 1:1 onto authorable Builder objects. */
export const GENERATED_SCENE_OBJECT_KINDS: ReadonlySet<EditorObjectKind> = new Set<EditorObjectKind>([
  'enemy',
  'pickup',
  'exitPortal',
  'waystone',
  'exitWell',
  'cauldron',
  'door',
  'plate',
  'lever',
  'brazier',
  'scale',
  'buoy',
  'chargeLatch',
  'runeGlyph',
  'runeDoor',
  'bossMarker',
  'terrainStamp',
  'vegetationStamp',
  'hazardEmitter',
  'decor',
  'valve',
  'plug',
  'sensor',
  'counterweight',
  'relay',
]);

/** Generated scene-link kinds that map 1:1 onto authorable Builder links. */
export const GENERATED_SCENE_LINK_KINDS: ReadonlySet<EditorLink['kind']> = new Set<EditorLink['kind']>([
  'triggerDoor',
  'runeDoor',
  'keyPortal',
  'bossGate',
  'logic',
]);

export interface GeneratedSceneCaptureResult {
  doc: EditorDocument;
  skippedObjects: number;
  skippedLinks: number;
}

function objectKind(kind: string): EditorObjectKind | null {
  return GENERATED_SCENE_OBJECT_KINDS.has(kind as EditorObjectKind) ? (kind as EditorObjectKind) : null;
}

function linkKind(kind: string): EditorLink['kind'] | null {
  return GENERATED_SCENE_LINK_KINDS.has(kind as EditorLink['kind']) ? (kind as EditorLink['kind']) : null;
}

function editorLight(sceneLight: GeneratedScenePlacement['lights'][number], n: number): EditorLight {
  return {
    id: sceneLight.id || `generated-light-${n}`,
    x: sceneLight.x,
    y: sceneLight.y,
    color: sceneLight.color,
    intensity: sceneLight.intensity,
    radius: sceneLight.radius,
    bloom: sceneLight.bloom ?? 0.8,
    flicker: sceneLight.flicker ?? 0,
    falloff: sceneLight.falloff ?? 'soft',
    occluded: sceneLight.occluded ?? true,
    locked: false,
    hidden: false,
  };
}

/**
 * Convert a read-only generated pixel-scene placement into an editable Builder document.
 *
 * Keeps only the objects/lights/links that fall inside the scene bounds and whose kinds map
 * to authorable Builder content; remaps generated `gold` pickups to authored `goldpile`; and
 * reports how many objects/links were dropped so the UI can warn. The terrain cells inside the
 * bounds are captured separately by `capturePrefab`, which is why this returns only metadata.
 */
export function generatedSceneCaptureDocument(
  scene: GeneratedScenePlacement,
  biome: BiomeId,
): GeneratedSceneCaptureResult {
  const doc = createEmptyDocument(`${scene.label} generated capture`, biome);
  let skippedObjects = 0;
  const objectIds = new Set<string>();
  for (const object of scene.objects) {
    const kind = objectKind(object.kind);
    if (!kind || object.x < scene.x0 || object.x > scene.x1 || object.y < scene.y0 || object.y > scene.y1) {
      skippedObjects++;
      continue;
    }
    const params = structuredClone(object.params) as Record<string, unknown>;
    if (kind === 'pickup' && params.kind === 'gold') params.kind = 'goldpile';
    doc.objects.push({
      id: object.id,
      kind,
      x: object.x,
      y: object.y,
      rotation: 0,
      locked: false,
      hidden: false,
      params,
    });
    objectIds.add(object.id);
  }
  let skippedLinks = 0;
  for (const link of scene.links) {
    const kind = linkKind(link.kind);
    if (!kind || !objectIds.has(link.fromId) || !objectIds.has(link.toId)) {
      skippedLinks++;
      continue;
    }
    doc.links.push({ id: link.id, fromId: link.fromId, toId: link.toId, kind });
  }
  doc.lights = scene.lights
    .filter((light) => light.x >= scene.x0 && light.x <= scene.x1 && light.y >= scene.y0 && light.y <= scene.y1)
    .map((light, n) => editorLight(light, n));
  return { doc, skippedObjects, skippedLinks };
}
