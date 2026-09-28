/** Shared cloth, leather and skin: death keeps the living alchemist's identity. */
type PaletteKey = 'HAT' | 'HAT_D' | 'BAND' | 'ROBE' | 'ROBE_D' | 'TRIM' | 'SKIN' | 'SKIN_D' | 'BOOT' | 'BOOT_L';
export const PLAYER_PALETTE: Record<PaletteKey, readonly [number, number, number]> = {
  HAT: [.83, .81, .65], HAT_D: [.35, .40, .34], BAND: [.66, .42, .22],
  ROBE: [.69, .73, .62], ROBE_D: [.26, .36, .33], TRIM: [.88, .87, .71],
  SKIN: [.95, .80, .62], SKIN_D: [.78, .62, .46], BOOT: [.10, .08, .14], BOOT_L: [.30, .24, .34],
};
