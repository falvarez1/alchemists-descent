import type { LevelRuntime } from '@/core/types';
import type { World } from '@/sim/World';
import { mechanismTriggersFor } from '@/core/mechanisms';
import { blocksEntity, Cell } from '@/sim/CellType';
import { computeLooseRubbleBlockingMask } from '@/sim/collision';
import { extractRegionGraph } from '@/world/regions';

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

export interface FindabilityRepairResult {
  initial: FindabilityIssue[];
  repaired: FindabilityIssue[];
  remaining: FindabilityIssue[];
}

/** The wizard's collision box: entities/physics.ts tryMoveEntity(4, 17). */
const PW = 4;
const PH = 17;

// Reused full-grid scratch for the BFS/erosion passes. These buffers are pure
// internal workspace (NEVER returned — the masks return their own `seen`/`fits`),
// so sharing them across calls removes the fresh Int32Array(W*H)/Uint8Array(W*H)
// the gauge-rescue pass otherwise allocates on every wizardMask/reachableMask
// call (dozens per tight seed → tens of MB of GC churn behind the load curtain).
let scratchQx = new Int32Array(0);
let scratchQy = new Int32Array(0);
function bfsQueues(n: number): [Int32Array, Int32Array] {
  if (scratchQx.length < n) {
    scratchQx = new Int32Array(n);
    scratchQy = new Int32Array(n);
  }
  // Queue cells are written at `tail` before being read at `head`, so only the
  // freshly-written prefix is ever read — no reset needed between calls.
  return [scratchQx, scratchQy];
}

let scratchHRun = new Uint8Array(0);
function hRunScratch(n: number): Uint8Array {
  // hRun is written conditionally (1s only), so a reused buffer must be cleared.
  if (scratchHRun.length < n) scratchHRun = new Uint8Array(n);
  else scratchHRun.fill(0);
  return scratchHRun;
}

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
  const blocks = computeLooseRubbleBlockingMask(w);
  // separable erosion: where does a 9-wide x 17-tall clear box fit?
  const hRun = hRunScratch(W * H);
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      run = blocks[x + y * W] ? 0 : run + 1;
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
/**
 * The minimal runtime view the reachability masks actually read: the grid and
 * the spawn point. Worldgen's gauge-rescue pass fabricates one of these directly
 * (it has no full LevelRuntime yet), and a real LevelRuntime satisfies it
 * structurally — so neither caller needs an `as unknown as` cast.
 */
export interface MaskInput {
  world: World;
  spawn: { x: number; y: number };
}

export function wizardMask(runtime: MaskInput): Uint8Array {
  const w = runtime.world;
  const W = w.width,
    H = w.height;
  const fits = fitsOf(w);
  // BFS over fitting positions (4-adjacent; levitation handles vertical)
  const seen = new Uint8Array(W * H);
  const [qx, qy] = bfsQueues(W * H);
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
export function reachableMask(runtime: MaskInput): Uint8Array {
  const w = runtime.world;
  const W = w.width,
    H = w.height;
  const seen = new Uint8Array(W * H);
  const [qx, qy] = bfsQueues(W * H);
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

function clearLine(
  world: { width: number; height: number; types: Uint8Array },
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 1; i < steps; i++) {
    const x = Math.floor(fromX + (dx * i) / steps);
    const y = Math.floor(fromY + (dy * i) / steps);
    if (x <= 0 || y <= 0 || x >= world.width || y >= world.height) return false;
    if (blocksEntity(world.types[x + y * world.width])) return false;
  }
  return true;
}

function nearWithLine(
  seen: Uint8Array,
  world: { width: number; height: number; types: Uint8Array },
  x: number,
  y: number,
  r: number,
): boolean {
  const W = world.width;
  const H = world.height;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const X = tx + dx;
      const Y = ty + dy;
      if (X <= 0 || Y <= 0 || X >= W || Y >= H || !seen[X + Y * W]) continue;
      if (clearLine(world, X, Y, tx, ty)) return true;
    }
  }
  return false;
}

const REPAIR_HALF_W = PW + 3;
const REPAIR_HEADROOM = PH + 3;
const REPAIR_FOOTROOM = 2;
const REPAIR_SHELL = 2;
const REPAIR_STEP = 4;
const REPAIR_SLEEVE_COLOR = 0x596170;

function markRepairInterior(runtime: LevelRuntime, interior: Uint8Array, cx: number, cy: number): void {
  const world = runtime.world;
  const footY = Math.floor(cy);
  const x0 = Math.max(1, Math.floor(cx) - REPAIR_HALF_W);
  const x1 = Math.min(world.width - 2, Math.floor(cx) + REPAIR_HALF_W);
  const y0 = Math.max(1, footY - REPAIR_HEADROOM);
  const y1 = Math.min(world.height - 2, footY + REPAIR_FOOTROOM);
  for (let y = y0; y <= y1; y++) {
    const row = y * world.width;
    for (let x = x0; x <= x1; x++) interior[row + x] = 1;
  }
}

function markStableRepairPathInterior(runtime: LevelRuntime, interior: Uint8Array, issue: FindabilityIssue): void {
  const fromX = Math.floor(runtime.spawn.x);
  const fromY = Math.floor(runtime.spawn.y - 2);
  const toX = Math.max(2, Math.min(runtime.world.width - 3, Math.floor(issue.x)));
  const toY = Math.max(2, Math.min(runtime.world.height - 3, Math.floor(issue.y)));
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / REPAIR_STEP));
  for (let step = 0; step <= steps; step++) {
    markRepairInterior(runtime, interior, fromX + (dx * step) / steps, fromY + (dy * step) / steps);
  }
}

function carveStableRepairPaths(runtime: LevelRuntime, issues: readonly FindabilityIssue[]): void {
  const world = runtime.world;
  const interior = new Uint8Array(world.width * world.height);
  // Brace only material that was already blocking. Painting the shell into open
  // air creates permanent diagonal rails through playable space.
  const originalTypes = world.types.slice();
  for (const issue of issues) markStableRepairPathInterior(runtime, interior, issue);
  for (let i = 0; i < interior.length; i++) {
    if (interior[i]) world.clearCellAt(i);
  }

  for (let y = 1; y < world.height - 1; y++) {
    const row = y * world.width;
    for (let x = 1; x < world.width - 1; x++) {
      const i = row + x;
      if (interior[i]) continue;
      let nearInterior = false;
      for (let sy = -REPAIR_SHELL; sy <= REPAIR_SHELL && !nearInterior; sy++) {
        const yy = y + sy;
        if (yy <= 0 || yy >= world.height - 1) continue;
        const shellRow = yy * world.width;
        for (let sx = -REPAIR_SHELL; sx <= REPAIR_SHELL; sx++) {
          const xx = x + sx;
          if (xx <= 0 || xx >= world.width - 1) continue;
          if (interior[shellRow + xx]) {
            nearInterior = true;
            break;
          }
        }
      }
      if (nearInterior && blocksEntity(originalTypes[i])) world.replaceCellAt(i, Cell.Metal, REPAIR_SLEEVE_COLOR);
    }
  }
}

function regionExitAnchor(runtime: LevelRuntime): { x: number; y: number } {
  if (runtime.exit) return { x: runtime.exit.x, y: runtime.exit.sealY - 12 };
  if (runtime.portal) return { x: runtime.portal.x, y: runtime.portal.y };
  return runtime.spawn;
}

export function failOpenFindability(
  runtime: LevelRuntime,
  issues = validateFindability(runtime),
): FindabilityRepairResult {
  const repairMap = new Map<string, FindabilityIssue>();
  let remaining = issues;
  for (let pass = 0; pass < 5; pass++) {
    const errors = remaining.filter((issue) => issue.severity === 'error');
    if (errors.length === 0) break;
    for (const issue of errors) repairMap.set(`${issue.what}@${issue.x},${issue.y}`, issue);
    carveStableRepairPaths(runtime, [...repairMap.values()]);
    runtime.regions = extractRegionGraph(runtime.world, runtime.spawn, regionExitAnchor(runtime));
    remaining = validateFindability(runtime);
  }
  return {
    initial: issues,
    repaired: [...repairMap.values()],
    remaining,
  };
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
        m.x + m.w / 2,
        m.y + m.h - 2,
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
        m.x + m.w / 2,
        m.y + m.h / 2,
      );
    } else if (m.kind === 'relay') {
      // pure logic node — its INPUTS carry the reachability requirement
      // (the prefab earnability fixpoint enforces that in CI)
      continue;
    } else if (m.kind === 'plug') {
      if (mechanismTriggersFor(runtime, m.id).length > 0) continue;
      check(nearWithLine(seen, runtime.world, m.x, m.y - 2, 5), m.kind, m.x, m.y - 2);
    } else if (
      m.kind === 'sensor' ||
      m.kind === 'counterweight' ||
      m.kind === 'buoy' ||
      m.kind === 'chargelatch'
    ) {
      // machine-fed / ranged: the medium or a projectile reaches them, the
      // player's hands don't have to. Buoys latch on rising water; a
      // chargelatch latches on ANY spark in its zone (lightning bolt,
      // electrified water, a conducting enemy's blood) — like rune glyphs,
      // line of sight from open space suffices, so the cell mask judges it.
      check(nearWithLine(seen, runtime.world, m.x, m.y - 2, 5), m.kind, m.x, m.y - 2);
    } else {
      // hands-on triggers: the WIZARD must be able to stand here
      check(near(wiz, W, H, m.x, m.y - 2, 6), m.kind, m.x, m.y - 2);
    }
  }
  for (const v of runtime.runeVaults) {
    // glyphs answer to projectiles — line of sight from a standable spot is
    // looser than standing beside it, so the cell mask + radius suffices
    check(nearWithLine(seen, runtime.world, v.rx, v.ry, 5), 'rune', v.rx, v.ry);
  }
  for (const p of runtime.pickups) {
    if (p.taken) continue;
    // The key gates progression — the wizard must WALK to it. Other pickups
    // appear as minimap dots / diagnostics, so a sealed pocket is buried
    // treasure instead of a hard progression failure.
    if (p.kind === 'key') {
      check(near(wiz, W, H, p.x, p.y, 10), p.kind, p.x, p.y);
    } else if (
      p.kind === 'heart' ||
      p.kind === 'tome' ||
      p.kind === 'chest' ||
      p.kind === 'potion' ||
      p.kind === 'goldpile'
    ) {
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
  if (runtime.spellLab) {
    const lab = runtime.spellLab;
    check(near(wiz, W, H, lab.x, lab.y, 12), 'spell-lab', lab.x, lab.y);
    check(near(wiz, W, H, lab.rewardX, lab.rewardY + 4, 10), 'spell-lab-reward', lab.rewardX, lab.rewardY + 4);
  }
  if (runtime.vaultArch) {
    const a = runtime.vaultArch;
    if (runtime.def.branch) {
      // the way HOME from a branch level — the wizard must be able to walk
      // into it, or the vault is a one-way trap
      check(near(wiz, W, H, a.x, a.y - 2, 10), 'vault-arch', a.x, a.y - 2);
    } else {
      // The entrance itself is sealed by design, but its gilded gallery/tell
      // must be reachable. Otherwise the secret is not discoverable at all.
      const discoverX = a.discoverX ?? a.x;
      const discoverY = a.discoverY ?? a.y;
      check(near(wiz, W, H, discoverX, discoverY, 10), 'vault-arch', discoverX, discoverY);
    }
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
      runtime.portal.y + 6,
    );
  }
  if (runtime.boss) {
    check(near(wiz, W, H, runtime.boss.x, runtime.boss.y, 12), 'boss-arena', runtime.boss.x, runtime.boss.y);
  }
  return issues;
}
