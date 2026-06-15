import type { CardId } from '@/core/types';
import { CARD_DEFS } from './cards';

const DISCOVERY_KEY = 'alchemists-descent-card-discovery-v1';
const DISCOVERY_VERSION = 1;

interface CardDiscoverySave {
  version: typeof DISCOVERY_VERSION;
  cards: CardId[];
}

export function getDiscoveredCards(): CardId[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(DISCOVERY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CardDiscoverySave>;
    if (parsed.version !== DISCOVERY_VERSION || !Array.isArray(parsed.cards)) return [];
    return parsed.cards.filter(isCardId);
  } catch {
    return [];
  }
}

export function markCardDiscovered(id: CardId): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const cards = new Set<CardId>(getDiscoveredCards());
    cards.add(id);
    const save: CardDiscoverySave = { version: DISCOVERY_VERSION, cards: [...cards] };
    storage.setItem(DISCOVERY_KEY, JSON.stringify(save));
  } catch {
    // Card discovery is metaprogression breadth only; card grants must never fail because storage does.
  }
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isCardId(value: unknown): value is CardId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CARD_DEFS, value);
}
