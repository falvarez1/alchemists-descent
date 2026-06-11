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
  const seen = reachableMask(runtime);
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
        near(seen, W, H, m.x - 2, m.y + m.h / 2, 4) ||
          near(seen, W, H, m.x + m.w + 1, m.y + m.h / 2, 4),
        'doorfront',
        m.x,
        m.y,
      );
    } else {
      check(near(seen, W, H, m.x, m.y - 2, 4), m.kind, m.x, m.y);
    }
  }
  for (const v of runtime.runeVaults) {
    check(near(seen, W, H, v.rx, v.ry, 5), 'rune', v.rx, v.ry);
  }
  for (const p of runtime.pickups) {
    if (p.taken) continue;
    // The key gates progression — hard requirement. Hearts/tomes appear as
    // minimap dots, so a sealed pocket is buried treasure, not a bug.
    if (p.kind === 'key') {
      check(near(seen, W, H, p.x, p.y - 2, 6), p.kind, p.x, p.y);
    } else if (p.kind === 'heart' || p.kind === 'tome') {
      check(near(seen, W, H, p.x, p.y - 2, 6), p.kind, p.x, p.y, 'info');
    }
  }
  for (const ws of runtime.waystones) {
    check(near(seen, W, H, ws.x, ws.y - 3, 6), 'waystone', ws.x, ws.y);
  }
  if (runtime.cauldron) {
    check(
      near(seen, W, H, runtime.cauldron.x, runtime.cauldron.y - 3, 6),
      'cauldron',
      runtime.cauldron.x,
      runtime.cauldron.y,
    );
  }
  if (runtime.portal) {
    check(
      near(seen, W, H, runtime.portal.x, runtime.portal.y - 2, 6),
      'portal',
      runtime.portal.x,
      runtime.portal.y,
    );
  }
  if (runtime.boss) {
    check(near(seen, W, H, runtime.boss.x, runtime.boss.y - 4, 6), 'boss-arena', runtime.boss.x, runtime.boss.y);
  }
  return issues;
}
