import type { LevelRuntime } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';

/**
 * Findability validation: mechanism-correct is NOT player-findable.
 * BFS from the spawn over passable cells, then assert every interactive
 * thing lies in the spawn-reachable component. Used by the verify script,
 * warned in DEV on every generation, and (future) the Builder's validation
 * pass — one shared implementation, no drift.
 */

export interface FindabilityIssue {
  /** What is unreachable ("doorfront", "scale", "rune", "key", ...). */
  what: string;
  x: number;
  y: number;
  /**
   * error: must be walkable (locks, progression, checkpoints).
   * info: buried treasure — shown on the map, digging to it is the game.
   */
  severity: 'error' | 'info';
}

/** The wizard's collision box: entities/physics.ts tryMoveEntity(4, 17). */
const PW = 4;
const PH = 17;

/**
 * Positions where the full 9x17 body FITS (with the loose-rubble rule).
 * Used by the wizard mask below AND by generation (connectToCaves targets
 * fit cells so tunnels join the network where the player can actually BE,
 * not a region centroid's box-thin appendix).
 */
export function computeFits(w: { width: number; height: number; types: Uint8Array }): Uint8Array {
  return fitsOf(w);
}

function fitsOf(w: { width: number; height: number; types: Uint8Array }): Uint8Array {
  const W = w.width,
    H = w.height;
  // the LOOSE-RUBBLE rule (entities/physics.ts cellBlocks): connected solid
  // clusters of fewer than 5 cells are walk-through debris
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < solid.length; i++) solid[i] = blocksEntity(w.types[i]) ? 1 : 0;
  const comp = new Int32Array(W * H);
  const areas: number[] = [0];
  const stack: number[] = [];
  for (let i0 = 0; i0 < solid.length; i0++) {
    if (!solid[i0] || comp[i0] !== 0) continue;
    const label = areas.length;
    let area = 0;
    comp[i0] = label;
    stack.push(i0);
    while (stack.length > 0) {
      const i = stack.pop()!;
      area++;
      const x = i % W,
        y = (i - x) / W;
      if (x + 1 < W && solid[i + 1] && comp[i + 1] === 0) { comp[i + 1] = label; stack.push(i + 1); }
      if (x > 0 && solid[i - 1] && comp[i - 1] === 0) { comp[i - 1] = label; stack.push(i - 1); }
      if (y + 1 < H && solid[i + W] && comp[i + W] === 0) { comp[i + W] = label; stack.push(i + W); }
      if (y > 0 && solid[i - W] && comp[i - W] === 0) { comp[i - W] = label; stack.push(i - W); }
    }
    areas.push(area);
  }
  const blocks = (i: number): boolean => solid[i] === 1 && areas[comp[i]] >= 5;
  // separable erosion: where does a 9-wide x 17-tall clear box fit?
  const hRun = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      run = blocks(x + y * W) ? 0 : run + 1;
      if (run >= PW * 2 + 1) hRun[x - PW + y * W] = 1;
    }
  }
  const fits = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) {
      run = hRun[x + y * W] ? run + 1 : 0;
      if (run >= PH) fits[x + y * W] = 1; // feet row of a clear 9x17 column
    }
  }
  return fits;
}

/**
 * WIZARD-REACHABLE mask: positions where the full 9x17 body FITS, connected
 * from the spawn. Movement is 4-adjacency over fitting positions — the
 * wizard LEVITATES (the LEV meter), so any vertically-continuous fitting
 * airspace is traversable; what the mask really guards is GAUGE: cell
 * reachability is a crawler's view, and the player was getting WEDGED in
 * 9-tall connector tunnels that cell-BFS sailed through.
 */
export function wizardMask(runtime: LevelRuntime): Uint8Array {
  const w = runtime.world;
  const W = w.width,
    H = w.height;
  const fits = fitsOf(w);
  // BFS over fitting positions (4-adjacent; levitation handles vertical)
  const seen = new Uint8Array(W * H);
  const qx = new Int32Array(W * H);
  const qy = new Int32Array(W * H);
  let head = 0,
    tail = 0;
  const push = (x: number, y: number): void => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    const i = x + y * W;
    if (seen[i] || !fits[i]) return;
    seen[i] = 1;
    qx[tail] = x;
    qy[tail] = y;
    tail++;
  };
  // seed around the spawn (it stands in a 24-headroom chamber)
  for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      push(Math.floor(runtime.spawn.x) + dx, Math.floor(runtime.spawn.y) + dy);
    }
  }
  while (head < tail) {
    const x = qx[head],
      y = qy[head];
    head++;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return seen;
}

/** Spawn-reachable mask over the runtime's world (1 = reachable). */
export function reachableMask(runtime: LevelRuntime): Uint8Array {
  const w = runtime.world;
  const W = w.width,
    H = w.height;
  const seen = new Uint8Array(W * H);
  const qx = new Int32Array(W * H);
  const qy = new Int32Array(W * H);
  let head = 0,
    tail = 0;
  const push = (x: number, y: number): void => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    const i = x + y * W;
    if (seen[i] || blocksEntity(w.types[i])) return;
    seen[i] = 1;
    qx[tail] = x;
    qy[tail] = y;
    tail++;
  };
  push(Math.floor(runtime.spawn.x), Math.floor(runtime.spawn.y - 2));
  while (head < tail) {
    const x = qx[head],
      y = qy[head];
    head++;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return seen;
}

function near(
  seen: Uint8Array,
  W: number,
  H: number,
  x: number,
  y: number,
  r: number,
): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const X = Math.floor(x) + dx,
        Y = Math.floor(y) + dy;
      if (X > 0 && Y > 0 && X < W && Y < H && seen[X + Y * W]) return true;
    }
  }
  return false;
}

export function validateFindability(runtime: LevelRuntime): FindabilityIssue[] {
  const seen = reachableMask(runtime); // the crawler's view (media, treasure)
  const wiz = wizardMask(runtime); // the PLAYER's view (9x17, walk + jump)
  const W = runtime.world.width,
    H = runtime.world.height;
  const issues: FindabilityIssue[] = [];
  const check = (
    ok: boolean,
    what: string,
    x: number,
    y: number,
    severity: 'error' | 'info' = 'error',
  ): void => {
    if (!ok) issues.push({ what, x: Math.floor(x), y: Math.floor(y), severity });
  };

  for (const m of runtime.mechanisms) {
    if (m.kind === 'door') {
      check(
        near(wiz, W, H, m.x - 2, m.y + m.h - 2, 8) ||
          near(wiz, W, H, m.x + m.w + 1, m.y + m.h - 2, 8),
        'doorfront',
        m.x,
        m.y,
      );
    } else if (m.kind === 'valve') {
      // A valve is a gate, not a hand-trigger: it needs an approachable
      // FRONT on any of its four sides — but the approach can be the
      // MEDIUM's (water falls through reservoir valves the player never
      // stands beside), so the cell mask judges it.
      check(
        near(seen, W, H, m.x - 2, m.y + m.h / 2, 4) ||
          near(seen, W, H, m.x + m.w + 1, m.y + m.h / 2, 4) ||
          near(seen, W, H, m.x + m.w / 2, m.y - 2, 4) ||
          near(seen, W, H, m.x + m.w / 2, m.y + m.h + 1, 4),
        'valvefront',
        m.x,
        m.y,
      );
    } else if (m.kind === 'relay') {
      // pure logic node — its INPUTS carry the reachability requirement
      // (the prefab earnability fixpoint enforces that in CI)
      continue;
    } else if (
      m.kind === 'sensor' ||
      m.kind === 'counterweight' ||
      m.kind === 'plug' ||
      m.kind === 'buoy' ||
      m.kind === 'chargelatch'
    ) {
      // machine-fed / ranged: the medium or a projectile reaches them, the
      // player's hands don't have to. Buoys latch on rising water; a
      // chargelatch latches on ANY spark in its zone (lightning bolt,
      // electrified water, a conducting enemy's blood) — like rune glyphs,
      // line of sight from open space suffices, so the cell mask judges it.
      check(near(seen, W, H, m.x, m.y - 2, 5), m.kind, m.x, m.y);
    } else {
      // hands-on triggers: the WIZARD must be able to stand here
      check(near(wiz, W, H, m.x, m.y - 2, 6), m.kind, m.x, m.y);
    }
  }
  for (const v of runtime.runeVaults) {
    // glyphs answer to projectiles — line of sight from a standable spot is
    // looser than standing beside it, so the cell mask + radius suffices
    check(near(seen, W, H, v.rx, v.ry, 5), 'rune', v.rx, v.ry);
  }
  for (const p of runtime.pickups) {
    if (p.taken) continue;
    // The key gates progression — the wizard must WALK to it. Hearts/tomes
    // appear as minimap dots, so a sealed pocket is buried treasure.
    if (p.kind === 'key') {
      check(near(wiz, W, H, p.x, p.y, 10), p.kind, p.x, p.y);
    } else if (p.kind === 'heart' || p.kind === 'tome') {
      check(near(seen, W, H, p.x, p.y - 2, 6), p.kind, p.x, p.y, 'info');
    }
  }
  for (const ws of runtime.waystones) {
    check(near(wiz, W, H, ws.x, ws.y, 10), 'waystone', ws.x, ws.y);
  }
  if (runtime.refuge) {
    // shelter, not progression: surfaced for diagnostics, never a gate
    check(near(wiz, W, H, runtime.refuge.x, runtime.refuge.y, 10), 'refuge', runtime.refuge.x, runtime.refuge.y, 'info');
  }
  if (runtime.cauldron) {
    check(
      near(wiz, W, H, runtime.cauldron.x, runtime.cauldron.y, 10),
      'cauldron',
      runtime.cauldron.x,
      runtime.cauldron.y,
    );
  }
  if (runtime.portal) {
    check(
      near(wiz, W, H, runtime.portal.x, runtime.portal.y + 6, 12),
      'portal',
      runtime.portal.x,
      runtime.portal.y,
    );
  }
  if (runtime.boss) {
    check(near(wiz, W, H, runtime.boss.x, runtime.boss.y, 12), 'boss-arena', runtime.boss.x, runtime.boss.y);
  }
  return issues;
}
