import type { LevelRuntime } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { BLOCKS_ENTITY_LUT, LOOSE_RUBBLE_BLOCKING_CLUSTER } from '@/sim/collision';
import {
  findabilityIssues,
  PH,
  PW,
  routeSealedInput,
  type FindabilityIssue,
  type MaskInput,
} from '@/world/validate';

/**
 * The settled findability audit, a few milliseconds a frame.
 *
 * validateFindability is two full-grid floods and an erosion over 1.7 M cells:
 * 50-170 ms in one go, run seven times in the first twelve seconds of every
 * floor, and each run was a visible freeze. The audit is pure (same grid in,
 * same issues out), so it can be built in slices: take a snapshot of the cells,
 * then advance the same passes (crawler flood, loose-rubble components, body
 * erosion, wizard flood) under a time budget each frame, and judge with the very
 * same rules (validate.findabilityIssues). Because it works on its own snapshot,
 * the verdict is exactly the synchronous one for that instant, however long the
 * slicing takes.
 *
 * It is a DETECTOR. A dirty verdict hands over to the synchronous repair, which
 * re-audits the live grid before it carves (Levels.repairFindability); a clean
 * one costs the game nothing more. A cheap fingerprint of everything the audit
 * reads (cell classes + the objects it judges) lets a pass whose inputs have not
 * changed since the last clean verdict end after the hash alone.
 *
 * tests/findability-audit.test.ts proves the sliced masks and issues equal the
 * synchronous ones, at every budget down to a single iteration's worth.
 */

/** What the audit can tell one cell from another: open, solid, Metal (always blocks), see-through solid (beams). */
const CLASS_LUT = (() => {
  const lut = new Uint8Array(256);
  for (let t = 0; t < 256; t++) {
    if (!BLOCKS_ENTITY_LUT[t]) continue;
    lut[t] = t === Cell.Metal ? 2 : t === Cell.Glass || t === Cell.Ice || t === Cell.Crystal ? 3 : 1;
  }
  return lut;
})();

export interface AuditResult {
  issues: FindabilityIssue[];
  /** Everything the audit read, fingerprinted: equal prints, equal verdicts. */
  print: string;
  /** The inputs matched the last clean verdict, so no flood was run. */
  unchanged: boolean;
}

export interface AuditBuffers {
  snapshot: Uint8Array;
  seen: Uint8Array;
  wiz: Uint8Array;
  blocks: Uint8Array;
  fits: Uint8Array;
  scratch: Uint8Array;
  queue: Int32Array;
  vRun: Int32Array;
}

/** The working planes for one cascade of audits (freed with it; ~17 MB at 1600x1064). */
export function createAuditBuffers(width: number, height: number): AuditBuffers {
  const n = width * height;
  return {
    snapshot: new Uint8Array(n), seen: new Uint8Array(n), wiz: new Uint8Array(n), blocks: new Uint8Array(n),
    fits: new Uint8Array(n), scratch: new Uint8Array(n), queue: new Int32Array(n), vRun: new Int32Array(width),
  };
}

type Stage = 'hash' | 'reach' | 'rubble' | 'erodeH' | 'erodeV' | 'wiz' | 'judge' | 'done';

export class FindabilityAudit {
  private stage: Stage = 'hash';
  private readonly W: number;
  private readonly H: number;
  private readonly N: number;
  private readonly types: Uint8Array;
  private readonly view: MaskInput;
  private readonly b: AuditBuffers;
  private deadline = 0;
  // Resumable cursors shared by the stages (each stage resets what it uses).
  private i = 0;
  private head = 0;
  private tail = 0;
  private sub: 0 | 1 | 2 = 0;
  private mark = 0;
  private h1 = 2166136261;
  private h2 = 5381;
  private print = '';

  /**
   * @param previousCleanPrint the print of the last audit that found no error (or null):
   *   when this snapshot matches it, the verdict is that audit's and no flood runs.
   */
  constructor(
    private readonly runtime: LevelRuntime,
    private readonly previousCleanPrint: string | null,
    buffers?: AuditBuffers,
  ) {
    const world = runtime.world;
    this.W = world.width;
    this.H = world.height;
    this.N = this.W * this.H;
    this.b = buffers ?? createAuditBuffers(this.W, this.H);
    // Route seals (an authored plug that always burns or digs open) read as open ground, as in validateFindability.
    const sealed = routeSealedInput(runtime);
    this.b.snapshot.set(sealed.world.types);
    this.types = this.b.snapshot;
    this.view = { world: { width: this.W, height: this.H, types: this.types }, spawn: runtime.spawn };
    this.b.seen.fill(0);
    this.b.wiz.fill(0);
    this.b.blocks.fill(0);
    this.b.fits.fill(0);
    this.b.scratch.fill(0);
    this.b.vRun.fill(0);
  }

  get finished(): boolean { return this.stage === 'done'; }

  /** The raw masks once finished (tests). */
  masks(): { seen: Uint8Array; wiz: Uint8Array } { return { seen: this.b.seen, wiz: this.b.wiz }; }

  /**
   * Advance for about `budgetMs`. Returns the verdict once every stage is done, else null.
   * `Infinity` runs it to the end in one call.
   */
  step(budgetMs: number): AuditResult | null {
    this.deadline = performance.now() + budgetMs;
    for (;;) {
      switch (this.stage) {
        case 'hash':
          if (!this.runHash()) return null;
          this.print = `${this.h1}.${this.h2}|${this.objectDigest()}`;
          if (this.previousCleanPrint === this.print) {
            this.stage = 'done';
            return { issues: [], print: this.print, unchanged: true };
          }
          this.startReach();
          this.stage = 'reach';
          break;
        case 'reach':
          if (!this.runReach()) return null;
          this.i = 0; this.sub = 0; this.stage = 'rubble';
          break;
        case 'rubble':
          if (!this.runRubble()) return null;
          this.i = 0; this.stage = 'erodeH';
          break;
        case 'erodeH':
          if (!this.runErodeH()) return null;
          this.i = 0; this.stage = 'erodeV';
          break;
        case 'erodeV':
          if (!this.runErodeV()) return null;
          this.startWiz();
          this.stage = 'wiz';
          break;
        case 'wiz':
          if (!this.runWiz()) return null;
          this.stage = 'judge';
          break;
        case 'judge': {
          // The rules proper; a few milliseconds over the mechanisms and pickups.
          const issues = findabilityIssues(this.runtime, this.view, this.b.seen, this.b.wiz);
          this.stage = 'done';
          return { issues, print: this.print, unchanged: false };
        }
        case 'done':
          return null;
      }
    }
  }

  /* ---------------- fingerprint ---------------- */

  private runHash(): boolean {
    const { types, N } = this;
    let h1 = this.h1, h2 = this.h2;
    let i = this.i;
    while (i < N) {
      const end = Math.min(N, i + 32768);
      for (; i < end; i++) {
        const c = CLASS_LUT[types[i]];
        h1 = Math.imul(h1 ^ c, 16777619);
        h2 = (Math.imul(h2, 33) + c) | 0;
      }
      if (i < N && performance.now() >= this.deadline) { this.h1 = h1; this.h2 = h2; this.i = i; return false; }
    }
    this.h1 = h1 >>> 0; this.h2 = h2 >>> 0; this.i = 0;
    return true;
  }

  /** The objects the rules judge (the grid is hashed separately). */
  private objectDigest(): string {
    const rt = this.runtime;
    const out: Array<string | number> = [rt.spawn.x | 0, rt.spawn.y | 0];
    for (const m of rt.mechanisms) {
      out.push(m.id, m.kind, m.x | 0, m.y | 0, m.w | 0, m.h | 0, m.state === 0 ? 0 : 1, m.requiresCard ?? '');
    }
    for (const p of rt.pickups) {
      // Keys gate progression and tomes can gate an ability lock; the rest are 'info' and never drive a repair.
      if (p.kind === 'key' || p.kind === 'tome') out.push(p.kind, p.taken ? 1 : 0, p.x | 0, p.y | 0, String(p.data.card ?? ''));
    }
    out.push('w', rt.waystones.length, 'r', rt.runeVaults.length, 'l', rt.lumenBlooms?.length ?? 0);
    if (rt.boss) out.push('b', rt.boss.x | 0, rt.boss.y | 0);
    if (rt.portal) out.push('p', rt.portal.x | 0, rt.portal.y | 0);
    // A route seal opens only where its cells are still the plug's own material (raw type, not just class).
    for (const m of rt.mechanisms) {
      if (m.kind !== 'plug' || !m.routeSeal || m.state !== 0 || !m.body?.length) continue;
      const live = rt.world.types;
      let bits = 0;
      for (const [x, y] of m.body) if (live[x + y * this.W] === (m.material ?? Cell.Stone)) bits++;
      out.push('s', m.id, bits);
    }
    return out.join(',');
  }

  /* ---------------- reachableMask (the crawler's view) ---------------- */

  private startReach(): void {
    const { W, H, types } = this;
    const { seen, queue } = this.b;
    this.head = 0; this.tail = 0;
    const sx = Math.floor(this.runtime.spawn.x), sy = Math.floor(this.runtime.spawn.y - 2);
    if (sx >= 1 && sy >= 1 && sx < W - 1 && sy < H - 1 && !BLOCKS_ENTITY_LUT[types[sx + sy * W]]) {
      seen[sx + sy * W] = 1;
      queue[this.tail++] = sx + sy * W;
    }
  }

  private runReach(): boolean {
    const { W, H, types } = this;
    const { seen, queue } = this.b;
    const blocks = BLOCKS_ENTITY_LUT;
    const bottom = (H - 1) * W;
    let head = this.head, tail = this.tail;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      if (x + 1 < W - 1 && !seen[i + 1] && !blocks[types[i + 1]]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
      if (x - 1 >= 1 && !seen[i - 1] && !blocks[types[i - 1]]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
      if (i + W < bottom && !seen[i + W] && !blocks[types[i + W]]) { seen[i + W] = 1; queue[tail++] = i + W; }
      if (i - W >= W && !seen[i - W] && !blocks[types[i - W]]) { seen[i - W] = 1; queue[tail++] = i - W; }
      if ((head & 2047) === 0 && performance.now() >= this.deadline) { this.head = head; this.tail = tail; return false; }
    }
    return true;
  }

  /* ---------------- computeLooseRubbleBlockingMask ---------------- */

  private runRubble(): boolean {
    const { W, N, types } = this;
    const { scratch: visited, queue, blocks } = this.b;
    const solid = BLOCKS_ENTITY_LUT;
    const lastRow = N - W;
    for (;;) {
      if (this.sub === 0) {
        // The next solid cell no component has claimed (a call always scans at least 16384 cells: progress is guaranteed).
        let i0 = this.i, scanned = 0;
        while (i0 < N && (visited[i0] || !solid[types[i0]])) {
          i0++;
          if ((++scanned & 0x3fff) === 0 && performance.now() >= this.deadline) { this.i = i0; return false; }
        }
        this.i = i0;
        if (i0 >= N) return true;
        visited[i0] = 1; queue[0] = i0; this.head = 0; this.tail = 1; this.sub = 1;
      }
      if (this.sub === 1) {
        let head = this.head, tail = this.tail;
        while (head < tail) {
          const i = queue[head++];
          const x = i % W;
          const left = x > 0;
          const right = x < W - 1;
          if (i >= W) {
            const u = i - W;
            if (!visited[u] && solid[types[u]]) { visited[u] = 1; queue[tail++] = u; }
            if (left && !visited[u - 1] && solid[types[u - 1]]) { visited[u - 1] = 1; queue[tail++] = u - 1; }
            if (right && !visited[u + 1] && solid[types[u + 1]]) { visited[u + 1] = 1; queue[tail++] = u + 1; }
          }
          if (i < lastRow) {
            const d = i + W;
            if (!visited[d] && solid[types[d]]) { visited[d] = 1; queue[tail++] = d; }
            if (left && !visited[d - 1] && solid[types[d - 1]]) { visited[d - 1] = 1; queue[tail++] = d - 1; }
            if (right && !visited[d + 1] && solid[types[d + 1]]) { visited[d + 1] = 1; queue[tail++] = d + 1; }
          }
          if (left && !visited[i - 1] && solid[types[i - 1]]) { visited[i - 1] = 1; queue[tail++] = i - 1; }
          if (right && !visited[i + 1] && solid[types[i + 1]]) { visited[i + 1] = 1; queue[tail++] = i + 1; }
          if ((head & 1023) === 0 && performance.now() >= this.deadline) { this.head = head; this.tail = tail; return false; }
        }
        this.head = head; this.tail = tail; this.mark = 0; this.sub = 2;
      }
      // A component blocks as a whole when it is big enough; smaller ones only where they are Metal.
      const big = this.tail >= LOOSE_RUBBLE_BLOCKING_CLUSTER;
      for (let k = this.mark; k < this.tail;) {
        const end = Math.min(this.tail, k + 32768);
        if (big) for (; k < end; k++) blocks[queue[k]] = 1;
        else for (; k < end; k++) if (types[queue[k]] === Cell.Metal) blocks[queue[k]] = 1;
        if (k < this.tail && performance.now() >= this.deadline) { this.mark = k; return false; }
      }
      this.i++; this.sub = 0;
    }
  }

  /* ---------------- fitsOf: where a 9x17 body fits ---------------- */

  private runErodeH(): boolean {
    const { W, H } = this;
    const { blocks, scratch: hRun } = this.b;
    if (this.i === 0) hRun.fill(0); // the rubble pass used it as its visited plane (row 0 always completes before a return)
    for (let y = this.i; y < H; y++) {
      // Time is checked between rows, never before the first of a call: every call advances.
      if (y > this.i && performance.now() >= this.deadline) { this.i = y; return false; }
      let run = 0;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        run = blocks[x + row] ? 0 : run + 1;
        if (run >= PW * 2 + 1) hRun[x - PW + row] = 1;
      }
    }
    return true;
  }

  private runErodeV(): boolean {
    const { W, H } = this;
    const { scratch: hRun, fits, vRun } = this.b;
    for (let y = this.i; y < H; y++) {
      if (y > this.i && performance.now() >= this.deadline) { this.i = y; return false; }
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const run = hRun[row + x] ? vRun[x] + 1 : 0;
        vRun[x] = run;
        if (run >= PH) fits[row + x] = 1;
      }
    }
    return true;
  }

  /* ---------------- wizardMask: the body's flood over the fitting positions ---------------- */

  private startWiz(): void {
    const { W, H } = this;
    const { wiz, fits, queue } = this.b;
    this.head = 0; this.tail = 0;
    const sx = Math.floor(this.runtime.spawn.x), sy = Math.floor(this.runtime.spawn.y);
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = x + y * W;
        if (wiz[i] || !fits[i]) continue;
        wiz[i] = 1;
        queue[this.tail++] = i;
      }
    }
  }

  private runWiz(): boolean {
    const { W, H } = this;
    const { wiz: seen, fits, queue } = this.b;
    const bottom = (H - 1) * W;
    let head = this.head, tail = this.tail;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      if (x + 1 < W - 1 && !seen[i + 1] && fits[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
      if (x - 1 >= 1 && !seen[i - 1] && fits[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
      if (i + W < bottom && !seen[i + W] && fits[i + W]) { seen[i + W] = 1; queue[tail++] = i + W; }
      if (i - W >= W && !seen[i - W] && fits[i - W]) { seen[i - W] = 1; queue[tail++] = i - W; }
      if ((head & 2047) === 0 && performance.now() >= this.deadline) { this.head = head; this.tail = tail; return false; }
    }
    return true;
  }
}
