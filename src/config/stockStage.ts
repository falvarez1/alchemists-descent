/** Foundry collision and framing. All platforms are real cells, inside the world bounds. */
export const STOCK_STAGE = {
  zone: { left: 240, right: 1360, top: 180, bottom: 940 },
  center: { x: 800, y: 570 },
  main: { x0: 560, x1: 1040, y: 640, depth: 65 },
  platforms: [{ x0: 540, x1: 700, y: 560, depth: 12 }, { x0: 900, x1: 1060, y: 560, depth: 12 }],
  spawns: [{ x: 680, y: 639 }, { x: 920, y: 639 }],
  // Outer lamp positions leave the inner ascent/recovery columns clear for a full fighter body.
  lamps: [{ x: 552, y: 576 }, { x: 1048, y: 576 }, { x: 710, y: 700 }, { x: 890, y: 700 }],
} as const;
