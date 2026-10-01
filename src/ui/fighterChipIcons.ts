import type { FighterId } from '@/content/fighters';
import type { AbilitySlot } from '@/core/fighters';

/**
 * The glyph on a HUD chip. A neutral bolt (tactical) and star (ultimate) until the per-ability set
 * (`ui/fighterIcons.ts`, `abilityIcon(id, slot)`) is wired in; the chip asks only this one function so the
 * swap is one line.
 */
const GLYPH: Record<AbilitySlot, string> = {
  tactical: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  ultimate: '<path d="m12 2 2.5 6.5L21 6l-2.5 6L22 17l-7-.5L12 22l-3-5.5-7 .5 3.5-5L3 6l6.5 2.5L12 2Z"/>',
};

export function chipIcon(_id: FighterId, slot: AbilitySlot, size = 20): string {
  return `<svg class="fc-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[slot]}</svg>`;
}
