import { HEIGHT, WIDTH } from '@/config/constants';
import type { Rng } from '@/core/rng';
import type { AuthoredLight, EnemyKind, Pickup } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { brineColor, coalColor, packRGB, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import { carvePocket, carveRect } from '@/world/connect';
import type { PlacementLedger } from '@/world/connect';

/**
 * The second doors' guardians' halls (wave 3), built the way the Kiln and the
 * Sump are (world/structures): a carved arena, its designed chemistry stamped
 * into real cells, a ledger reservation, flank connectors into the caves, and
 * an idempotent repair that re-asserts the parts a later carve can take.
 */

export interface WardenArena {
  boss: { x: number; y: number; kind: EnemyKind };
  /** Re-assert the hall's floor, pits and gutters (`floor: false` after the final rescue). */
  repair: (floor?: boolean) => void;
}

interface ArenaSite {
  w: World;
  rng: Rng;
  ledger: PlacementLedger;
  spawn: { x: number; y: number };
  portalX: number;
  pickups: readonly Pickup[];
  lights: AuthoredLight[];
  connect: (x: number, y: number) => void;
}

/** Ice-House geometry, relative to the hall's centre (cx, cy). */
export const ICE_HOUSE = {
  RX: 58, RY: 30,
  /** Floor surface row below the centre; the Warden stands on FLOOR - 1. */
  FLOOR: 22,
  /** Half-width of the flat floor. */
  HALF: 52,
  /** Brine gutters sunk flush into the floor at both ends (|dx| in [G0, G1]). */
  G0: 40, G1: 48,
  /** Coal pits sunk flush into the floor either side of the post (|dx| in [P0, P1]), iron-lined. */
  P0: 18, P1: 26,
  DEPTH: 3,
} as const;

/**
 * THE ICE-HOUSE (the Cold Store): the Rime Warden's hall. A long vaulted
 * cold-room over a flat stone floor, and the fight's chemistry sunk into it:
 *
 * - two COAL PITS, iron-lined, either side of the Warden's post — dark until
 *   the player lights them (a spark bolt's blast, a flame, an ember). Burning
 *   coal throws flame up out of the pit, and a Warden walked into it THAWS
 *   (creatures/bosses/rimeWarden): the heat the fight wants is the player's to
 *   light, and his to lure the Warden into;
 * - two BRINE GUTTERS at the ends. A stomp's rime wave dies at a gutter (brine
 *   never freezes), and a Warden that wades one is chilled BRITTLE — its next
 *   honest hit cracks a plate. (They chill the alchemist too.)
 * - the vault's ICICLES, which its roar into the second phase brings down.
 *
 * Nothing hangs lower than the Warden is tall: it can walk the whole floor.
 */
export function buildIceHouse(site: ArenaSite): WardenArena {
  const { w, rng, ledger, spawn, portalX, pickups, lights } = site;
  const A = ICE_HOUSE;
  const x0 = (cx: number): number => cx - A.RX - 2, x1 = (cx: number): number => cx + A.RX + 2;
  const top = (cy: number): number => cy - A.RY - 2, bot = (cy: number): number => cy + A.FLOOR + 6;
  const pick = (): { cx: number; cy: number } => ({
    cx: Math.floor(WIDTH * (0.28 + rng.next() * 0.44)),
    cy: Math.floor(HEIGHT * (0.46 + rng.next() * 0.16)),
  });
  // Nothing built before the hall may stand inside it (the Sump's GEN 54 lesson):
  // a pocket carve spares Metal, so an earlier alcove would float in the hall.
  const builtOver = (cx: number, cy: number): boolean => {
    for (const p of pickups) if (p.x >= x0(cx) && p.x <= x1(cx) && p.y >= top(cy) && p.y <= bot(cy)) return true;
    for (let Y = top(cy); Y <= bot(cy); Y += 2) {
      for (let X = x0(cx); X <= x1(cx); X += 2) if (w.inBounds(X, Y) && w.types[w.idx(X, Y)] === Cell.Metal) return true;
    }
    return false;
  };
  // Of the clear sites, the one sunk deepest in rock: the hall should be a
  // room (a vault with a ceiling for its icicles), not a ledge in a void.
  const solidity = (cx: number, cy: number): number => {
    let n = 0, all = 0;
    for (let Y = top(cy); Y <= bot(cy); Y += 4) {
      for (let X = x0(cx); X <= x1(cx); X += 4) {
        if (!w.inBounds(X, Y)) continue;
        all++;
        if (w.types[w.idx(X, Y)] !== Cell.Empty) n++;
      }
    }
    return all > 0 ? n / all : 0;
  };
  let { cx, cy } = pick();
  let best: { cx: number; cy: number; s: number } | null = null;
  for (let a = 0; a < 24; a++) {
    const clear = Math.abs(cx - spawn.x) > 220 && Math.abs(cx - portalX) > 170 &&
      !ledger.intersects(x0(cx), top(cy), x1(cx), bot(cy)) && !builtOver(cx, cy);
    if (clear) {
      const sol = solidity(cx, cy);
      if (!best || sol > best.s) best = { cx, cy, s: sol };
      if (sol > 0.8) break;
    }
    ({ cx, cy } = pick());
  }
  if (best) ({ cx, cy } = best);

  const stone = (X: number, Y: number): void => {
    if (!w.inBounds(X, Y)) return;
    const i = w.idx(X, Y);
    w.types[i] = Cell.Stone;
    w.colors[i] = stoneColor();
  };
  const set = (X: number, Y: number, t: number, c: number): void => {
    if (!w.inBounds(X, Y)) return;
    const i = w.idx(X, Y);
    w.types[i] = t;
    w.colors[i] = c;
  };
  /** The native rock's colour near (X, Y), so a filled shell reads as the cave's own. */
  const rockTint = (X: number, Y: number): number => {
    for (let r = 1; r <= 16; r++) {
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
        if (w.inBounds(X + ox, Y + oy) && w.types[w.idx(X + ox, Y + oy)] === Cell.Wall) return w.colors[w.idx(X + ox, Y + oy)];
      }
    }
    return packRGB(58, 66, 78);
  };
  const FY = cy + A.FLOOR;
  const inGutter = (dx: number): boolean => Math.abs(dx) >= A.G0 && Math.abs(dx) <= A.G1;
  const inPit = (dx: number): boolean => Math.abs(dx) >= A.P0 && Math.abs(dx) <= A.P1;

  // The vault's shell: open cave crossing the hall's crown is walled off (only
  // empty cells are filled), so the hall reads as a room and holds its
  // icicles. The flank connectors below re-open its ends into the caves.
  const SHELL = 4;
  for (let Y = cy - A.RY - SHELL; Y < FY; Y++) {
    for (let X = cx - A.RX - SHELL; X <= cx + A.RX + SHELL; X++) {
      if (!w.inBounds(X, Y) || Y >= HEIGHT - 8) continue;
      const dx = X - cx, dy = Y - cy;
      const outer = (dx * dx) / ((A.RX + SHELL) * (A.RX + SHELL)) + (dy * dy) / ((A.RY + SHELL) * (A.RY + SHELL));
      if (outer > 1) continue;
      const i = w.idx(X, Y);
      if (w.types[i] === Cell.Empty) set(X, Y, Cell.Wall, rockTint(X, Y));
    }
  }
  carvePocket(w, cx, cy, A.RX, A.RY);
  carveRect(w, cx - A.HALF, cy, cx + A.HALF, FY - 1);

  /** The floor band, the gutters and the pits: the hall's designed ground. */
  const stampFloor = (fillBand: boolean): void => {
    for (let dx = -A.HALF - 2; dx <= A.HALF + 2; dx++) {
      const X = cx + dx;
      for (let dy = 0; dy <= A.DEPTH; dy++) {
        const Y = FY + dy;
        if (!w.inBounds(X, Y)) continue;
        const i = w.idx(X, Y), t = w.types[i];
        const gutter = inGutter(dx), pit = inPit(dx);
        if (gutter && dy < A.DEPTH) {
          // Brine: the whole gutter at build; afterwards only what a carve emptied.
          if (t !== Cell.Brine && (fillBand || t === Cell.Empty || t === Cell.Water)) set(X, Y, Cell.Brine, brineColor());
        } else if (pit && dy < A.DEPTH) {
          const lining = Math.abs(dx) === A.P0 || Math.abs(dx) === A.P1;
          if (lining) { if (t !== Cell.Metal) set(X, Y, Cell.Metal, packRGB(70, 78, 88)); }
          // Coal: the whole pit at build; afterwards only an emptied cell.
          else if (t !== Cell.Coal && (fillBand || t === Cell.Empty)) set(X, Y, Cell.Coal, coalColor());
        } else if (pit && dy === A.DEPTH) {
          if (t !== Cell.Metal) set(X, Y, Cell.Metal, packRGB(70, 78, 88));
        } else if (fillBand && t !== Cell.Stone && t !== Cell.Metal) {
          // (After the final rescue the band is left as the rescue had it: a
          // tunnel that needed its way through keeps it.)
          stone(X, Y);
        }
      }
    }
  };
  stampFloor(true);
  // A deep footing: a slam's crater never drops the alchemist into a void.
  for (let dx = -A.HALF - 2; dx <= A.HALF + 2; dx++) {
    for (let dy = A.DEPTH + 1; dy <= A.DEPTH + 12; dy++) {
      const X = cx + dx, Y = FY + dy;
      if (w.inBounds(X, Y) && Y < HEIGHT - 8 && w.types[w.idx(X, Y)] === Cell.Empty) stone(X, Y);
    }
  }
  // The vault's icicles: real ice hanging from the ceiling, never lower than the Warden's head.
  for (let dx = -A.HALF + 2; dx <= A.HALF - 2; dx += 3 + Math.floor(rng.next() * 4)) {
    const X = cx + dx;
    let Y = FY - 30;
    while (Y > cy - A.RY - 4 && w.inBounds(X, Y - 1) && w.types[w.idx(X, Y - 1)] === Cell.Empty) Y--;
    if (!w.inBounds(X, Y - 1) || w.types[w.idx(X, Y - 1)] === Cell.Empty) continue;
    const len = 3 + Math.floor(rng.next() * 6);
    for (let k = 0; k < len && Y + k < FY - 28; k++) {
      if (w.types[w.idx(X, Y + k)] !== Cell.Empty) break;
      set(X, Y + k, Cell.Ice, k === len - 1 ? packRGB(226, 244, 255) : packRGB(150 + ((k * 13) % 30), 204, 240));
    }
  }
  // Cold light over the hall (it reads from the approach), dimmer at the ends.
  lights.push({ x: cx, y: cy - 6, r: 0.55, g: 0.8, b: 1.0, intensity: 0.85, radius: 64, bloom: 0.3, flicker: 0.08, flickerPhase: 0.2, falloff: 'soft', occluded: true });
  for (const s of [-1, 1]) {
    lights.push({ x: cx + s * 44, y: FY - 8, r: 0.4, g: 0.7, b: 0.9, intensity: 0.5, radius: 30, bloom: 0.2, flicker: 0.05, flickerPhase: 0.5 + s * 0.2, falloff: 'soft', occluded: true });
  }
  ledger.reserve(x0(cx), top(cy), x1(cx), bot(cy), 'warden-arena');
  // Both ends join the caves at standing height.
  site.connect(cx - A.HALF - 3, FY - 12);
  site.connect(cx + A.HALF + 3, FY - 12);
  stampFloor(true);
  return {
    boss: { x: cx, y: FY - 1, kind: 'rimewarden' },
    repair: (floor = true): void => stampFloor(floor),
  };
}
