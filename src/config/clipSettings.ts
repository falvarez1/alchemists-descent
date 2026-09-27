/**
 * The "Record clips" preference. Neutral ground on purpose: `app/Clips.ts`
 * reads it and `ui/PlayerSettings.ts` toggles it, and neither imports the
 * other. Default ON — the rolling capture is cheap (see app/Clips.ts) and the
 * moment worth keeping is never the one you planned for.
 */
const KEY = 'ad-clip-recording-v1';
const listeners = new Set<(on: boolean) => void>();
let cached: boolean | undefined;

export function isClipRecordingEnabled(): boolean {
  if (cached === undefined) {
    cached = true;
    try {
      cached = localStorage.getItem(KEY) !== 'off';
    } catch {
      /* Restricted storage keeps the default. */
    }
  }
  return cached;
}

/** Persist and broadcast. Returns false when storage refused (the choice still holds for this session). */
export function setClipRecordingEnabled(on: boolean): boolean {
  const changed = isClipRecordingEnabled() !== on;
  cached = on;
  let stored = true;
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    stored = false;
  }
  if (changed) for (const listener of listeners) listener(on);
  return stored;
}

export function onClipRecordingChanged(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
