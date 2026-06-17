// Teach-once persistence for the HintSystem: the set of hint categories the
// player has already been shown the richer "what is this" popover for. Mirrors
// cardDiscovery — localStorage-backed, fails silent (onboarding hints must never
// throw). Clear the key to re-see every teach popover while testing.
const SEEN_KEY = 'alchemists-descent-seen-hints-v1';
const SEEN_VERSION = 1;

interface SeenHintsSave {
  version: typeof SEEN_VERSION;
  keys: string[];
}

export function getSeenHints(): string[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<SeenHintsSave>;
    if (parsed.version !== SEEN_VERSION || !Array.isArray(parsed.keys)) return [];
    return parsed.keys.filter((k): k is string => typeof k === 'string');
  } catch {
    return [];
  }
}

export function markHintSeen(key: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const keys = new Set<string>(getSeenHints());
    keys.add(key);
    const save: SeenHintsSave = { version: SEEN_VERSION, keys: [...keys] };
    storage.setItem(SEEN_KEY, JSON.stringify(save));
  } catch {
    // Onboarding breadth only; teaching must never fail because storage does.
  }
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
