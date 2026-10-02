import type { FighterId } from '@/content/fighters';
import type { AbilitySlot } from '@/core/fighters';
import { abilityIcon } from '@/ui/fighterIcons';

/**
 * The glyph on a HUD chip: the ability's own (`ui/fighterIcons`, `abilityIcon(id, slot)`), with a neutral bolt
 * (tactical) and star (ultimate) as the fallback for an id the set does not know. The chip asks only this one
 * function.
 */
const GLYPH: Record<AbilitySlot, string> = {
  tactical: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  ultimate: '<path d="m12 2 2.5 6.5L21 6l-2.5 6L22 17l-7-.5L12 22l-3-5.5-7 .5 3.5-5L3 6l6.5 2.5L12 2Z"/>',
};

export function chipIcon(id: FighterId, slot: AbilitySlot, size = 22): string {
  // The ability's own glyph; the neutral bolt / star stay as the fallback for an id the set does not know.
  const own = abilityIcon(id, slot, size);
  if (own) return own;
  return `<svg class="fc-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[slot]}</svg>`;
}
