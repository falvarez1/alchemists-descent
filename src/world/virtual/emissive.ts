import { Cell } from '@/sim/CellType';

/**
 * Additive self-glow per emissive cell TYPE, mirroring the live Lighting seed set
 * (src/render/Lighting.ts). Shared by the worker preview RGBA (transfer.ts) and the
 * pixel-scene editor preview so both read like the lighting will actually render —
 * instead of flat terrain color. Per-cell only (no neighbour bleed), so it stays
 * seamless across chunk borders. Returns null for non-emissive types.
 */
export function emissiveGlowRgb(type: number): readonly [number, number, number] | null {
  switch (type) {
    case Cell.Lava: return [150, 40, 8];
    case Cell.Fire: return [150, 84, 22];
    case Cell.Ember: return [120, 56, 12];
    case Cell.Glowshroom: return [40, 120, 70];
    case Cell.Crystal: return [60, 150, 175];
    case Cell.Fungus: return [40, 110, 95];
    case Cell.Catalyst: return [120, 60, 20];
    case Cell.Gold: return [90, 70, 18];
    case Cell.Healium: return [90, 40, 60];
    case Cell.Toxic: return [40, 90, 30];
    case Cell.Acid: return [40, 130, 30];
    case Cell.Teleportium: return [70, 40, 130];
    case Cell.Moss: return [18, 46, 22];
    default: return null;
  }
}
