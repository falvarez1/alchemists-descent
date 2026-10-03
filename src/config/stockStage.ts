/** Foundry collision and framing. All platforms are real cells, inside the world bounds. */
export const STOCK_STAGE = {
  zone: { left: 490, right: 1110, top: 390, bottom: 730 },
  center: { x: 800, y: 560 },
  main: { x0: 620, x1: 980, y: 610, depth: 65 },
  platforms: [{ x0: 570, x1: 670, y: 530, depth: 22 }, { x0: 930, x1: 1030, y: 530, depth: 22 }],
  spawns: [{ x: 690, y: 609 }, { x: 910, y: 609 }],
  // Outer lamp positions leave the inner ascent/recovery columns clear for a full fighter body.
  lamps: [{ x: 584, y: 553 }, { x: 1016, y: 553 }, { x: 710, y: 670 }, { x: 890, y: 670 }],
} as const;
