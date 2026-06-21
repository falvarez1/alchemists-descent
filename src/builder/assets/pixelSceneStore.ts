import type { PixelSceneDef } from '@/authoring/virtualWorld';
import { serializePixelScene, parsePixelScene, type PixelSceneJson } from '@/world/virtual/pixelSceneJson';

/**
 * User pixel-scene library — one localStorage key per scene (mirrors the prefab
 * library convention in src/builder/prefablib.ts). Fail-silent on private-mode /
 * quota errors so the editor never hard-breaks.
 */
const PREFIX = 'ad:pixelscene:';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function listUserScenes(): PixelSceneDef[] {
  const s = store();
  if (!s) return [];
  const out: PixelSceneDef[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const raw = s.getItem(key);
      if (raw) out.push(parsePixelScene(JSON.parse(raw) as PixelSceneJson));
    } catch {
      // skip a corrupt entry
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function saveUserScene(def: PixelSceneDef): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(PREFIX + def.id, JSON.stringify(serializePixelScene(def)));
    return true;
  } catch {
    return false;
  }
}

export function deleteUserScene(id: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(PREFIX + id);
  } catch {
    // ignore
  }
}

export function userSceneExists(id: string): boolean {
  const s = store();
  if (!s) return false;
  try {
    return s.getItem(PREFIX + id) !== null;
  } catch {
    return false;
  }
}
