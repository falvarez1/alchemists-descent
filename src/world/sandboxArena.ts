import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';

/**
 * THE WORKSHOP — the sandbox's own world.
 *
 * The sandbox used to boot into `generateCaves`, which is the CAMPAIGN terrain
 * generator. That was wrong twice over. It showed a level you never actually
 * play, so the first thing the app said about itself was misleading; and since
 * GEN_VERSION 30 that generator deliberately packs the strip below the caves
 * solid to bedrock, which is right for a descent and leaves a falling-sand
 * sandbox with almost nowhere to drop sand.
 *
 * A sandbox wants the opposite of a level: mostly EMPTY, fully enclosed so
 * material collects instead of draining off-world, and furnished with just
 * enough structure that the simulation shows you what it does. Everything here
 * is real cells — the shelves really erode, the frame really burns, the cups
 * really hold a reaction, the lamps really go dark if you mine them out —
 * because a sandbox that cheated would teach the wrong thing about the game
 * (CLAUDE.md: if the grid can't explain it, it doesn't ship).
 *
 * SIZED TO THE VIEW, deliberately. The first cut was 1220x670 against a 575x391
 * viewport, so the walls, the ceiling and every lamp mounted on them sat
 * off-screen and the workbench rendered as a black rectangle. The chamber is
 * now about 1.4 views wide and 1 view tall: enough to pan, small enough that
 * what lights it is in front of you.
 *
 * Deterministic by construction: no randomness beyond material tint, so the
 * bench you learn is the bench you get back.
 */

const FLOOR_Y = 880;
const CEIL_Y = FLOOR_Y - VIEW_H + 12; // one viewport of headroom
const CENTER_X = Math.floor(WIDTH / 2);
const HALF_W = Math.floor(VIEW_W * 0.7);
const WALL_X0 = CENTER_X - HALF_W;
const WALL_X1 = CENTER_X + HALF_W;
const SHELL = 16;

/** Where the camera sits: the whole chamber in frame, floor toward the bottom. */
export const SANDBOX_FOCUS = {
  x: CENTER_X,
  y: Math.floor((CEIL_Y + FLOOR_Y) / 2) + 14,
};

export function stampSandboxArena(ctx: Ctx): void {
  const world = ctx.world;

  const set = (x: number, y: number, type: Cell): void => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = world.idx(x, y);
    world.types[i] = type;
    world.colors[i] = COLOR_FN[type]?.() ?? EMPTY_COLOR;
    world.life[i] = 0;
    world.charge[i] = 0;
  };
  const fill = (xa: number, ya: number, xb: number, yb: number, type: Cell): void => {
    for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) {
      for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) set(x, y, type);
    }
  };
  const lamp = (x: number, y: number, r: number, type: Cell): void => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) set(x + dx, y + dy, type);
      }
    }
  };

  world.clear();

  // ---- The shell: rock, then carve the chamber out of it, so the arena is
  // genuinely enclosed rather than an island floating in void. ----
  fill(WALL_X0 - SHELL, CEIL_Y - SHELL, WALL_X1 + SHELL, FLOOR_Y + SHELL, Cell.Stone);
  fill(WALL_X0, CEIL_Y, WALL_X1, FLOOR_Y - 1, Cell.Empty);
  // A metal skin on the floor and lower walls: stone erodes under acid and
  // lightning, and a sandbox whose floor dissolves halfway through an
  // experiment is one that keeps interrupting you.
  fill(WALL_X0 - 5, FLOOR_Y, WALL_X1 + 5, FLOOR_Y + 4, Cell.Metal);
  fill(WALL_X0 - 5, FLOOR_Y - 60, WALL_X0 - 1, FLOOR_Y, Cell.Metal);
  fill(WALL_X1 + 1, FLOOR_Y - 60, WALL_X1 + 5, FLOOR_Y, Cell.Metal);

  const cx = CENTER_X;

  // ---- Left: a stepped cascade. Powder poured on the top shelf tumbles down
  // in stages — the clearest read there is on angle of repose, and on how a
  // liquid differs from a powder given the same drop. ----
  // Each step is offset by MORE than it overlaps, so material slides off one
  // edge and lands on the next instead of dropping straight through a stack of
  // near-aligned shelves — the first cut overlapped so heavily that a pour fell
  // in a column and the cascade did nothing. The bottom step overhangs the
  // catch basin, so a pour ends up somewhere worth looking at.
  // Narrow ledges, each offset by slightly LESS than its width so the spill off
  // one edge lands on the next. Wide shelves were the first mistake here: a
  // pour simply piled up in the middle and never reached an edge, so the
  // "cascade" was four tables in a stack. The bottom ledge overhangs the catch
  // basin, so a pour ends somewhere worth watching.
  for (let step = 0; step < 4; step++) {
    const y = FLOOR_Y - 152 + step * 34;
    const x0 = cx - 268 + step * 34;
    fill(x0, y, x0 + 40, y + 6, Cell.Stone);
    // A LIP on the uphill edge. Without it a pour spilled off both sides and
    // half the material dropped straight past the cascade to the floor, which
    // measured as "no cascade at all" — the ledges were catching nothing. The
    // lip makes each ledge a chute with one way out: onward and down.
    fill(x0, y - 13, x0 + 3, y, Cell.Stone);
    lamp(x0 + 1, y - 20, 4, Cell.Crystal); // each ledge carries its own light
  }

  // ---- A sunken catch basin. Liquids pool DEEP here instead of spreading one
  // cell thin across the floor, so density layering, colour and the lava/water
  // crust all become visible. ----
  const basinX0 = cx - 126;
  const basinX1 = cx - 44;
  fill(basinX0, FLOOR_Y, basinX1, FLOOR_Y + 44, Cell.Empty);
  fill(basinX0 - 5, FLOOR_Y, basinX0 - 1, FLOOR_Y + 48, Cell.Metal);
  fill(basinX1 + 1, FLOOR_Y, basinX1 + 5, FLOOR_Y + 48, Cell.Metal);
  fill(basinX0 - 5, FLOOR_Y + 44, basinX1 + 5, FLOOR_Y + 48, Cell.Metal);

  // ---- Centre: three reaction cups. Metal, open-topped, standing clear of one
  // another so two materials meet ONLY where you put them. This is the shape
  // the verification probes kept rebuilding by hand (contain the test in a
  // metal cup and poll it), so the sandbox may as well ship it. ----
  for (let cup = 0; cup < 3; cup++) {
    const x0 = cx - 6 + cup * 62;
    const x1 = x0 + 40;
    fill(x0, FLOOR_Y - 50, x0 + 3, FLOOR_Y - 1, Cell.Metal);
    fill(x1 - 3, FLOOR_Y - 50, x1, FLOOR_Y - 1, Cell.Metal);
    fill(x0, FLOOR_Y - 4, x1, FLOOR_Y - 1, Cell.Metal);
  }

  // ---- Right: a timber frame to set alight. Uprights plus crossbeams, stood
  // clear of everything else so a fire has somewhere to spread TO and,
  // importantly, somewhere to stop. ----
  const frameX = cx + 194;
  fill(frameX, FLOOR_Y - 92, frameX + 5, FLOOR_Y - 1, Cell.Wood);
  fill(frameX + 72, FLOOR_Y - 92, frameX + 77, FLOOR_Y - 1, Cell.Wood);
  fill(frameX, FLOOR_Y - 92, frameX + 77, FLOOR_Y - 87, Cell.Wood);
  fill(frameX, FLOOR_Y - 50, frameX + 77, FLOOR_Y - 45, Cell.Wood);

  // ---- Overhead: a split shelf, so a stream poured from the ceiling divides
  // around it and you can watch two piles build from one source. ----
  fill(cx - 108, CEIL_Y + 92, cx - 28, CEIL_Y + 98, Cell.Stone);
  fill(cx + 28, CEIL_Y + 92, cx + 116, CEIL_Y + 98, Cell.Stone);

  // ---- Lamps. An empty chamber of stone and metal emits nothing, and at the
  // default 0.36 ambient the first build of this rendered as a black rectangle
  // with faint edges — you could not see your own workbench.
  //
  // Lit with real EMISSIVE CELLS rather than by raising ambient, which would
  // have washed the mood out of the campaign too (one global dial). Mana
  // crystals set into the rock cast exactly the light they cast anywhere else,
  // and the glowcaps along the floor flare as the cursor passes.
  // A crystal SEAM runs the length of the ceiling rather than a row of point
  // sconces: point lamps lit their own little pools and left the middle of the
  // bench black, because unlit air is unlit air no matter how many lamps ring
  // it. A continuous emitter overhead lights the whole floor evenly, and it is
  // still just cells — chip a section out and that stretch goes dark.
  fill(WALL_X0, CEIL_Y, WALL_X1, CEIL_Y + 2, Cell.Crystal);
  for (let x = WALL_X0 + 40; x < WALL_X1 - 20; x += 78) {
    lamp(x, CEIL_Y + 4, 5, Cell.Crystal); // thicker nodes along the seam
  }
  // Light dies within about forty cells here, so one row of lamps cannot light
  // a chamber four hundred tall. Three tiers: the ceiling seam, PENDANTS hung
  // over the bench on real rods, and glowcaps down at floor level where the
  // work actually happens.
  for (let x = WALL_X0 + 62; x < WALL_X1 - 30; x += 92) {
    fill(x, CEIL_Y + 3, x + 1, FLOOR_Y - 168, Cell.Stone); // the rod
    lamp(x + 1, FLOOR_Y - 162, 6, Cell.Crystal);
  }
  for (let x = WALL_X0 + 26; x < WALL_X1 - 16; x += 52) {
    lamp(x, FLOOR_Y - 3, 3, Cell.Glowshroom); // glowcaps answer the cursor
  }
  // Light falls off within a few dozen cells, so every STATION carries its own
  // rather than relying on the ceiling seam to reach 380 cells down.
  lamp(cx - 152, FLOOR_Y - 74, 4, Cell.Crystal); // over the basin
  lamp(cx + 100, FLOOR_Y - 82, 4, Cell.Crystal); // over the cups
  lamp(cx + 274, FLOOR_Y - 70, 4, Cell.Crystal); // by the timber frame
  lamp(cx - 40, CEIL_Y + 128, 4, Cell.Crystal); // under the split shelf
  for (let y = CEIL_Y + 70; y < FLOOR_Y - 40; y += 96) {
    lamp(WALL_X0 + 4, y, 4, Cell.Crystal);
    lamp(WALL_X1 - 4, y, 4, Cell.Crystal);
  }

  // `clear()` zeroes the moved plane but not its epoch (see the determinism
  // work), so reset it here or the first substep inherits a stale wrap point.
  world.movedTick = 1;
}
