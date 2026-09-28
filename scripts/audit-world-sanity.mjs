// WORLD SANITY AUDIT: every authored or placed thing on every campaign floor,
// measured against the real grid AFTER the level has been walked and its
// liquids and powders have settled. Finds the "why is he under water?" class
// of bug: things SUBMERGED in liquid, FLOATING over air, BURIED in rock,
// BLOCKED (unreachable, or reachable only through lava/acid) and ABSURD
// placements (a lamp lit under water, a fern in lava, a fish in rock).
//
// Usage (dev server running):
//   node scripts/audit-world-sanity.mjs [--url=http://localhost:5173/]
//     [--levels=d1,d2,d2b,d3,d3b,d4] [--seeds=1,42,1337] [--out=DIR]
//     [--dwell=360] [--passes=2] [--shots=10] [--parallel=3]
//
// Per level and seed it writes <out>/<level>-s<seed>.json (every item with its
// metrics and flags), flat grid crops of flagged items (crop-*.png) and in-game
// camera shots of the worst ones (shot-*.png, HUD hidden). Summarize (and
// re-classify after editing audit-world-sanity-rules.mjs, no rerun needed) with
// `node scripts/audit-world-sanity-report.mjs --out=DIR` -> summary.md/json.
//
// Method: `run test --level L --seed S` (the expedition seed; a floor's seed is
// derived from it exactly as in a real run). Pickups are kept from being
// collected (their update runs with the player moved out of reach), god mode
// is on, and the player is teleported around a 3x2 grid of standable dry spots
// (the sim only runs within ~400x260 cells of the body) for `passes` rounds of
// `dwell` ticks each. The arrival state is measured too, so a settling problem
// is told apart from a placement problem.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
import { classify, scanFlags } from './audit-world-sanity-rules.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=?(.*)$/);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
const URL = args.url ?? 'http://localhost:5173/';
const LEVELS = String(args.levels ?? 'd1,d2,d2b,d3,d3b,d4').split(',');
const SEEDS = String(args.seeds ?? '1,42,1337').split(',').map(Number);
const OUT = args.out ?? 'verify-out/world-sanity';
const DWELL = Number(args.dwell ?? 360);
const PASSES = Number(args.passes ?? 2);
const SHOTS = Number(args.shots ?? 10);
const CROPS = Number(args.crops ?? 40);
const PARALLEL = Number(args.parallel ?? 3);
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ */
/* In-page instruments (installed once per level: the World is swapped). */
/* ------------------------------------------------------------------ */

function installAudit() {
  const ctx = window.__game.ctx;
  const mk = (list) => { const a = new Uint8Array(256); for (const t of list) a[t] = 1; return a; };
  // sim/CellType predicates, as tables (ids are an ABI; see CellType.ts).
  const LIQ = mk([2, 6, 7, 11, 16, 18, 19, 21, 22, 23, 24, 25, 26, 42]);
  const BLK = mk([1, 3, 4, 8, 10, 12, 13, 17, 27, 28, 29, 31, 35, 36, 43]);
  const HAZ = mk([7, 11, 24]);
  const SOFT = mk([15, 30, 33, 34, 37, 39, 40]);
  const GAS = mk([9, 14, 38]);
  const NAME = ['empty', 'sand', 'water', 'wall', 'wood', 'fire', 'oil', 'acid', 'gunpowder', 'steam', 'ice', 'lava', 'stone',
    'metal', 'smoke', 'vines', 'nitrogen', 'gold', 'blood', 'slime', 'ember', 'elixirLife', 'elixirLevity', 'elixirStone',
    'toxic', 'healium', 'teleportium', 'snow', 'coal', 'crystal', 'fungus', 'glass', 'ash', 'glowshroom', 'moss',
    'catalyst', 'rawore', 'grass', 'marshgas', 'leaf', 'trunk', 'seed', 'brine', 'mirror'];
  const DIMS = { slime: [5, 8], imp: [5, 12], golem: [7, 20], acidslime: [5, 8], wisp: [4, 8], mage: [5, 14], bat: [3, 5],
    spitter: [5, 11], bomber: [5, 8], weaver: [9, 18], colossus: [16, 34], eggs: [4, 5], leviathan: [9, 14], rootloper: [6, 14],
    stonemaw: [8, 10], rillback: [7, 8], rimewarden: [11, 26], lenswright: [10, 20] };
  const FLYERS = new Set(['imp', 'wisp', 'bat', 'lenswright']);
  const SWIMMERS = new Set(['rillback', 'leviathan']);

  const A = {};
  A.W = () => ctx.world.width;
  A.H = () => ctx.world.height;
  A.at = (x, y) => {
    x = Math.floor(x); y = Math.floor(y);
    const w = ctx.world;
    return x < 0 || y < 0 || x >= w.width || y >= w.height ? 3 : w.types[x + y * w.width];
  };
  A.name = (t) => NAME[t] ?? String(t);
  /** Census of a rect (inclusive). */
  A.box = (x0, y0, x1, y1) => {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    let n = 0, liq = 0, blk = 0, haz = 0, soft = 0, gas = 0, fire = 0, empty = 0;
    const liqT = {}, blkT = {};
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = A.at(x, y);
      n++;
      if (LIQ[t]) { liq++; liqT[NAME[t]] = (liqT[NAME[t]] ?? 0) + 1; }
      if (BLK[t]) { blk++; blkT[NAME[t]] = (blkT[NAME[t]] ?? 0) + 1; }
      if (HAZ[t]) haz++;
      if (SOFT[t]) soft++;
      if (GAS[t]) gas++;
      if (t === 5 || t === 20) fire++;
      if (t === 0) empty++;
    }
    return { n, liq, blk, haz, soft, gas, fire, empty, liqF: n ? liq / n : 0, blkF: n ? blk / n : 0, liqT, blkT };
  };
  /** Contiguous liquid cells from row y upward in column x (the water standing on that floor cell). */
  A.depth = (x, y) => { let d = 0; while (d < 300 && LIQ[A.at(x, y - d)]) d++; return d; };
  A.maxDepth = (x0, x1, y) => { let m = 0; for (let x = Math.floor(x0); x <= x1; x++) m = Math.max(m, A.depth(x, y)); return m; };
  /** Share of a floor row that blocks. */
  A.support = (x0, x1, row) => { let s = 0, n = 0; for (let x = Math.floor(x0); x <= x1; x++) { n++; if (BLK[A.at(x, row)]) s++; } return n ? s / n : 0; };
  /** Rows of non-blocking cells below (x, y) before ground (0 = standing). */
  A.gap = (x, y) => { let g = 0; while (g < 400 && !BLK[A.at(x, y + 1 + g)]) g++; return g; };
  A.liqType = (x, y) => { const t = A.at(x, y); return LIQ[t] ? NAME[t] : null; };

  /* ---- reachability (world/validate wizardMask, re-derived: 9x17 fits, 4-adjacent flood) ---- */
  function blockingPlane(hazardsBlock) {
    const w = ctx.world, W = w.width, H = w.height, n = W * H, t = w.types;
    const blk = new Uint8Array(n);
    for (let i = 0; i < n; i++) blk[i] = BLK[t[i]] | (hazardsBlock ? HAZ[t[i]] : 0);
    // Intact route seals are ground on the way (validate.routeSealedView).
    for (const m of ctx.levels.current.mechanisms) {
      if (m.kind !== 'plug' || !m.routeSeal || m.state !== 0 || !m.body) continue;
      for (const [x, y] of m.body) if (x >= 0 && y >= 0 && x < W && y < H) blk[x + y * W] = 0;
    }
    return blk;
  }
  function fitsOf(blk) {
    const W = ctx.world.width, H = ctx.world.height;
    const h = new Uint8Array(W * H), fits = new Uint8Array(W * H), v = new Int32Array(W);
    for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x < W; x++) { run = blk[x + y * W] ? 0 : run + 1; if (run >= 9) h[x - 4 + y * W] = 1; } }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const r = h[x + y * W] ? v[x] + 1 : 0; v[x] = r; if (r >= 17) fits[x + y * W] = 1; }
    return fits;
  }
  function flood(pass, seeds) {
    const W = ctx.world.width, H = ctx.world.height, seen = new Uint8Array(W * H), q = new Int32Array(W * H);
    let head = 0, tail = 0;
    for (const i of seeds) if (pass[i] && !seen[i]) { seen[i] = 1; q[tail++] = i; }
    while (head < tail) {
      const i = q[head++], x = i % W, y = (i / W) | 0;
      if (x + 1 < W - 1 && !seen[i + 1] && pass[i + 1]) { seen[i + 1] = 1; q[tail++] = i + 1; }
      if (x - 1 >= 1 && !seen[i - 1] && pass[i - 1]) { seen[i - 1] = 1; q[tail++] = i - 1; }
      if (y + 1 < H - 1 && !seen[i + W] && pass[i + W]) { seen[i + W] = 1; q[tail++] = i + W; }
      if (y - 1 >= 1 && !seen[i - W] && pass[i - W]) { seen[i - W] = 1; q[tail++] = i - W; }
    }
    return seen;
  }
  A.masks = () => {
    const rt = ctx.levels.current, W = ctx.world.width;
    const sx = Math.floor(rt.spawn.x), sy = Math.floor(rt.spawn.y);
    const around = [];
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) around.push(sx + dx + (sy + dy) * W);
    const blk = blockingPlane(false), blkDry = blockingPlane(true);
    const fits = fitsOf(blk), fitsDry = fitsOf(blkDry);
    const walk = new Uint8Array(blk.length); for (let i = 0; i < blk.length; i++) walk[i] = blk[i] ? 0 : 1;
    const wiz = flood(fits, around), wizDry = flood(fitsDry, around);
    const crawl = flood(walk, [sx + (sy - 2) * W]);
    // Dry, liquid-free standing spots (teleport targets for the tour).
    const dryStand = new Uint8Array(blk.length);
    const t = ctx.world.types;
    const clean = new Uint8Array(blk.length); for (let i = 0; i < blk.length; i++) clean[i] = (BLK[t[i]] || LIQ[t[i]] || HAZ[t[i]]) ? 1 : 0;
    const fitsClean = fitsOf(clean);
    for (let i = W; i < blk.length - W; i++) if (fitsClean[i] && wiz[i] && BLK[t[i + W]]) dryStand[i] = 1;
    A._m = { wiz, wizDry, crawl, dryStand };
    return A._m;
  };
  A.near = (mask, x, y, r) => {
    const W = ctx.world.width, H = ctx.world.height;
    x = Math.floor(x); y = Math.floor(y);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[xx + yy * W]) return true;
    }
    return false;
  };
  /** Nearest dry standable, spawn-reachable spot to (x, y) (spiral over rings). */
  A.standNear = (x, y, minD = 0, maxR = 420) => {
    const m = A._m ?? A.masks(), W = ctx.world.width, H = ctx.world.height;
    x = Math.floor(x); y = Math.floor(y);
    for (let r = minD; r <= maxR; r += 2) {
      let best = null, bd = 1e9;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r && Math.max(Math.abs(dx), Math.abs(dy)) !== r - 1) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 8 || yy < 20 || xx >= W - 8 || yy >= H - 4) continue;
        if (!m.dryStand[xx + yy * W]) continue;
        const d = Math.hypot(dx, dy);
        if (d < minD) continue;
        if (d < bd) { bd = d; best = { x: xx, y: yy }; }
      }
      if (best) return best;
    }
    return null;
  };

  /* ---- measurement ---- */
  const reach = (x, y, r, which = 'wiz') => {
    const m = A._m;
    return { reach: A.near(m[which], x, y, r), dry: which === 'wiz' ? A.near(m.wizDry, x, y, r) : A.near(m.crawl, x, y, r) };
  };
  const R = (v) => Math.round(v * 1000) / 1000;

  A.measure = (_phase) => {
    const rt = ctx.levels.current;
    A.masks();
    const items = [];
    const push = (it) => { items.push(it); return it; };
    const story = rt.story;
    const view = ctx.story?.view;
    const _biome = rt.def.biome;

    // --- the player's arrival spot ---
    {
      const { x, y } = rt.spawn;
      const b = A.box(x - 4, y - 16, x + 4, y);
      push({ cat: 'spawn', kind: 'spawn', id: 'spawn', x, y, box: [x - 4, y - 16, x + 4, y],
        m: { liqF: R(b.liqF), liqT: b.liqT, depth: A.depth(x, y), blkF: R(b.blkF), blkT: b.blkT, support: R(A.support(x - 4, x + 4, y + 1)), gap: A.gap(x, y) } });
    }

    // --- Pell's camp and Pell ---
    if (story?.camp) {
      const c = story.camp, f = c.facing, x = c.x, y = c.floorY;
      const bx = x - f * 20, cx = x - f * 9, sx = x + f * 16, px = x + f * 9, lx = x + f * 12, ly = y - 24;
      const pell = A.box(x - 4, y - 16, x + 4, y);
      const low = A.box(x - 27, y - 7, x + 27, y);
      const props = A.box(x - 27, y - 27, x + 27, y);
      const camp = A.box(c.x0, y - 30, c.x1, y);
      const r = reach(x, y, 12);
      push({ cat: 'camp', kind: view?.pell ? 'camp+pell' : 'camp(abandoned)', id: 'camp', x, y, box: [x - 40, y - 36, x + 40, y + 2],
        m: {
          facing: f, x0: c.x0, x1: c.x1, pellPresent: !!view?.pell,
          depth: { pell: A.depth(x, y), bedroll: A.maxDepth(bx - 6, bx + 6, y), crate: A.maxDepth(cx - 3, cx + 3, y), stove: A.maxDepth(sx - 2, sx + 2, y), pole: A.depth(px, y), camp: A.maxDepth(c.x0, c.x1, y) },
          pellLiqF: R(pell.liqF), pellBlkF: R(pell.blkF), lowLiqF: R(low.liqF), liqT: low.liqT, propsBlkF: R(props.blkF), propsBlkT: props.blkT,
          lantern: A.name(A.at(lx, ly)), support: R(A.support(x - 26, x + 26, y + 1)),
          supportProps: { bedroll: R(A.support(bx - 6, bx + 6, y + 1)), crate: R(A.support(cx - 3, cx + 3, y + 1)), stove: R(A.support(sx - 2, sx + 2, y + 1)), pole: BLK[A.at(px, y + 1)] ? 1 : 0 },
          gapPell: A.gap(x, y), hazards: { haz: camp.haz, fire: camp.fire, liqT: camp.liqT }, reach: r.reach, dryReach: r.dry,
        } });
    }

    // --- the resonant valve and its echo stage ---
    if (story?.valve) {
      const v = story.valve, x = v.x, y = v.floorY, s0 = v.stageX - v.stageHalfW, s1 = v.stageX + v.stageHalfW;
      const body = A.box(x - 6, y - 20, x + 6, y - 1);
      const stage = A.box(s0, y - 16, s1, y);
      const r = reach(v.stageX, y, 14);
      push({ cat: 'valve', kind: 'valve', id: 'valve', x, y, box: [Math.min(x - 12, s0), y - 30, Math.max(x + 12, s1), y + 2],
        m: { depthWheel: A.depth(x, y), depthStage: A.maxDepth(s0, s1, y), valveLiqF: R(body.liqF), valveBlkF: R(body.blkF), valveBlkT: body.blkT,
          stageLiqF: R(stage.liqF), stageBlkF: R(stage.blkF), stageBlkT: stage.blkT, liqT: stage.liqT,
          support: R(A.support(x - 3, x + 3, y + 1)), stageSupport: R(A.support(s0, s1, y + 1)), gap: A.gap(x, y), reach: r.reach, dryReach: r.dry } });
    }

    // --- speaking-pipes ---
    for (const p of story?.pipes ?? []) {
      const x = p.x, y = p.floorY;
      const horn = A.box(x - 6, y - 30, x + 6, y - 20);
      const stand = A.box(x - 4, y - 16, x + 4, y);
      const r = reach(x, y, 10);
      push({ cat: 'pipe', kind: 'pipe', id: `pipe-${p.id}`, x, y, box: [x - 8, Math.max(p.top, y - 60), x + 8, y + 2],
        m: { depth: A.maxDepth(x - 4, x + 4, y), hornLiqF: R(horn.liqF), hornBlkF: R(horn.blkF), standLiqF: R(stand.liqF), standBlkF: R(stand.blkF), standBlkT: stand.blkT,
          liqT: stand.liqT, support: R(A.support(x - 4, x + 4, y + 1)), gap: A.gap(x, y), pipeLen: y - 30 - p.top, reach: r.reach, dryReach: r.dry } });
    }

    // --- the Kiln flue (escape) ---
    if (story?.flue) {
      const fl = story.flue, s = fl.shaft, pa = fl.passage;
      const shaft = A.box(s.x0, s.y0, s.x1, s.y1), passage = A.box(pa.x0, pa.y0, pa.x1, pa.y1);
      push({ cat: 'flue', kind: 'flue', id: 'flue', x: fl.exit.x, y: fl.exit.y, box: [s.x0 - 10, s.y0 - 10, s.x1 + 10, s.y1 + 10],
        m: { shaftBlkF: R(shaft.blkF), shaftBlkT: shaft.blkT, shaftLiqF: R(shaft.liqF), passageBlkF: R(passage.blkF), passageLiqF: R(passage.liqF),
          damper: A.box(fl.damper.x0, fl.damper.y0, fl.damper.x1, fl.damper.y1).blkT, exitStand: A.box(fl.exit.x - 4, fl.exit.y - 16, fl.exit.x + 4, fl.exit.y).blkF,
          startStand: R(A.box(fl.start.x - 4, fl.start.y - 16, fl.start.x + 4, fl.start.y).blkF), ledges: fl.ledges.map((l) => R(A.box(l.x0, l.y0, l.x1, l.y1).blkF)) } });
    }

    // --- waystones ---
    rt.waystones.forEach((w, i) => {
      const x = w.x, y = w.y;
      const bowl = A.box(x - 2, y - 4, x + 2, y);
      const stele = A.box(x - 6, y - 32, x + 6, y - 6);
      const r = reach(x, y, 10);
      push({ cat: 'waystone', kind: w.lit ? 'waystone(lit)' : 'waystone', id: `waystone-${i}`, x, y, box: [x - 8, y - 34, x + 8, y + 3],
        m: { lit: !!w.lit, bowlLiqF: R(bowl.liqF), bowlLiqT: bowl.liqT, bowlBlkF: R(bowl.blkF), bowlBlkT: bowl.blkT, depth: A.maxDepth(x - 6, x + 6, y),
          steleBlkF: R(stele.blkF), steleBlkT: stele.blkT, steleLiqF: R(stele.liqF), support: R(A.support(x - 3, x + 3, y + 1)), gap: A.gap(x, y),
          bowlStone: A.support(x - 3, x + 3, y + 1) > 0.8 && BLK[A.at(x - 3, y - 1)] && BLK[A.at(x + 3, y - 1)] ? true : false, reach: r.reach, dryReach: r.dry } });
    });

    // --- cauldron ---
    if (rt.cauldron) {
      const { x, y } = rt.cauldron;
      const around = A.box(x - 15, y - 13, x + 15, y), basin = A.box(x - 3, y - 2, x + 3, y);
      const vessel = A.box(x - 12, y - 12, x + 12, y - 3);
      const r = reach(x, y, 10);
      push({ cat: 'cauldron', kind: 'cauldron', id: 'cauldron', x, y, box: [x - 16, y - 16, x + 16, y + 5],
        m: { outsideLiq: around.liq - basin.liq, outsideLiqF: R((around.liq - basin.liq) / Math.max(1, around.n - basin.n)), liqT: around.liqT,
          depthOutside: Math.max(A.depth(x - 10, y), A.depth(x + 10, y)), vesselBlkF: R(vessel.blkF), vesselBlkT: vessel.blkT,
          support: R(A.support(x - 4, x + 4, y + 1)), reach: r.reach, dryReach: r.dry } });
    }

    // --- exit portal ---
    if (rt.portal) {
      const { x, y } = rt.portal;
      const ring = A.box(x - 5, y - 13, x + 5, y + 5);
      const r = reach(x, y + 6, 12);
      push({ cat: 'portal', kind: 'portal', id: 'portal', x, y, box: [x - 14, y - 16, x + 14, y + 11],
        m: { open: !!rt.portal.open, ringLiqF: R(ring.liqF), liqT: ring.liqT, ringBlkF: R(ring.blkF), ringBlkT: ring.blkT, floorSupport: R(A.support(x - 8, x + 8, y + 10)),
          standDepth: A.maxDepth(x - 6, x + 6, y + 9), reach: r.reach, dryReach: r.dry } });
    }

    /** Pickups.update's own rule: a spawn-reachable body within the collect radius with a clear line (3 samples). */
    const collectable = (px, py, radius) => {
      const W = ctx.world.width, m = A._m;
      for (let fy = Math.floor(py - radius + 8 - 2); fy <= py + radius + 8 + 2; fy++) for (let fx = Math.floor(px - radius - 2); fx <= px + radius + 2; fx++) {
        if (fx < 1 || fy < 1 || fx >= W - 1 || fy >= ctx.world.height - 1 || !m.wiz[fx + fy * W]) continue;
        const dx = fx - px, dy = fy - 8 - py;
        if (dx * dx + dy * dy >= radius * radius) continue;
        let clear = true;
        for (const t of [0.3, 0.55, 0.8]) if (BLK[A.at(Math.floor(px + dx * t), Math.floor(py + dy * t))]) { clear = false; break; }
        if (clear) return true;
      }
      return false;
    };

    // --- pickups ---
    rt.pickups.forEach((p, i) => {
      if (p.taken) return;
      const x = Math.round(p.x), y = Math.round(p.y);
      const glyph = A.box(x - 2, y - 5, x + 2, y);
      const wr = reach(x, y, 10), cr = reach(x, y - 2, 6, 'crawl');
      push({ cat: 'pickup', kind: p.kind, id: `pickup-${i}-${p.kind}`, x, y, box: [x - 5, y - 8, x + 5, y + 2],
        m: { vy: R(p.vy ?? 0), glyphLiqF: R(glyph.liqF), liqT: glyph.liqT, depth: A.depth(x, y), inBlk: !!BLK[A.at(x, y)], atName: A.name(A.at(x, y)),
          embed: (() => { let e = 0; while (e < 30 && BLK[A.at(x, y - e)]) e++; return e; })(),
          enclosed: (() => { for (let dy = -6; dy <= 2; dy++) for (let dx = -4; dx <= 4; dx++) if (!BLK[A.at(x + dx, y + dy)]) return false; return true; })(),
          glyphBlkF: R(glyph.blkF), below: A.name(A.at(x, y + 1)), gap: A.gap(x, y), reachWiz: wr.reach, dryWiz: wr.dry, reachCrawl: cr.reach,
          collectable: collectable(p.x, p.y, p.kind === 'tome' ? 11 : 9),
          gated: p.kind === 'key' && !!rt.living && !rt.living.tea?.completed } });
    });

    // --- mechanisms ---
    for (const m of rt.mechanisms) {
      let region = null, foot = null, reachPt = null, extra = {};
      if (m.kind === 'lever') {
        if (m.look === 'crank') { region = [m.x - 9, m.y - 13, m.x + 13, m.y + 6]; foot = [m.x - 6, m.x + 6, m.y + 8]; }
        else if (m.look === 'handwheel') { region = [m.x - 11, m.y - 25, m.x + 11, m.y + 12]; foot = [m.x - 7, m.x + 7, m.y + 14]; }
        else { region = [m.x - 3, m.y - 6, m.x + 3, m.y]; foot = [m.x - 1, m.x + 1, m.y + 1]; }
        reachPt = [m.x, m.y - 2, 6];
      } else if (m.kind === 'brazier') {
        region = [m.x - 2, m.y - 6, m.x + 2, m.y - 1]; foot = [m.x - 2, m.x + 2, m.y + 1]; reachPt = [m.x, m.y - 2, 6];
        const bowl = A.box(m.x - 1, m.y - 1, m.x + 1, m.y);
        extra = { bowlLiqF: R(bowl.liqF), bowlLiqT: bowl.liqT, bowlBlkT: bowl.blkT };
      } else if (m.kind === 'plate') {
        region = [m.x, m.y - 4, m.x + Math.max(1, m.w) - 1, m.y - 1]; reachPt = [m.x + (m.w >> 1), m.y - 2, 6];
      } else if (m.kind === 'door') {
        let metal = 0, n = 0;
        for (let yy = m.y; yy < m.y + m.h; yy++) for (let xx = m.x; xx < m.x + m.w; xx++) { n++; if (A.at(xx, yy) === 13) metal++; }
        extra = { metalF: R(n ? metal / n : 0), state: m.state, requiresCard: m.requiresCard ?? null };
        region = null;
      } else if (m.kind === 'chargelatch' || m.kind === 'scale' || m.kind === 'counterweight' || m.kind === 'buoy') {
        if (m.zone) region = [m.zone.x0, m.zone.y0, m.zone.x1, m.zone.y1];
      } else if (m.kind === 'sensor' && m.sensorType === 'light') {
        region = [m.x - 3, m.y - 3, m.x + 3, m.y + 3];
      } else if (m.kind === 'dispenser') {
        region = [m.x - 5, m.y - 5, m.x + 5, m.y];
      }
      const it = { cat: 'mechanism', kind: m.kind + (m.look ? `:${m.look}` : '') + (m.sensorType ? `:${m.sensorType}` : ''), id: `mech-${m.id}`, x: m.x, y: m.y,
        box: region ? [region[0] - 4, region[1] - 4, region[2] + 4, region[3] + 4] : [m.x - 4, m.y - 4, m.x + (m.w || 1) + 4, m.y + (m.h || 1) + 4],
        m: { state: m.state, broken: m.broken ?? null, targetId: m.targetId ?? null, bodyN: m.body?.length ?? 0,
          bodyIntact: m.body ? m.body.filter(([bx, by]) => BLK[A.at(bx, by)]).length : null, ...extra } };
      if (region) { const b = A.box(...region); Object.assign(it.m, { liqF: R(b.liqF), liqT: b.liqT, blkF: R(b.blkF), blkT: b.blkT }); }
      if (foot) { it.m.support = R(A.support(foot[0], foot[1], foot[2])); it.m.gap = A.gap(m.x, foot[2] - 1); }
      if (reachPt) { const r = reach(reachPt[0], reachPt[1], reachPt[2]); it.m.reach = r.reach; it.m.dryReach = r.dry; }
      push(it);
    }

    // --- rune vault glyphs ---
    rt.runeVaults.forEach((v, i) => {
      const g = A.box(v.rx - 1, v.ry - 1, v.rx + 1, v.ry + 2);
      const r = reach(v.rx, v.ry, 5, 'crawl');
      push({ cat: 'runevault', kind: 'rune', id: `rune-${i}`, x: v.rx, y: v.ry, box: [v.rx - 8, v.ry - 8, v.rx + 8, v.ry + 6],
        m: { active: v.active, liqF: R(g.liqF), liqT: g.liqT, blkF: R(g.blkF), blkT: g.blkT, reachCrawl: r.reach } });
    });

    // --- lumen blooms ---
    (rt.lumenBlooms ?? []).forEach((b, i) => {
      let rock = 0, liq = 0;
      for (const [px, py] of b.petals) { const t = A.at(px, py); if (BLK[t] && t !== 31) rock++; if (LIQ[t]) liq++; }
      push({ cat: 'lumen', kind: 'lumen-bloom', id: `lumen-${i}`, x: b.x, y: b.y, box: [Math.min(b.x, ...b.petals.map((p) => p[0])) - 6, b.y - 12, Math.max(b.x, ...b.petals.map((p) => p[0])) + 6, b.y + 12],
        m: { budCell: A.name(A.at(b.x, b.y)), budLiq: !!LIQ[A.at(b.x, b.y)], petals: b.petals.length, petalsInRock: rock, petalsInLiquid: liq, depthUnder: A.depth(b.x, b.y) } });
    });

    // --- weaver lair webs ---
    (rt.weaverLairWebs ?? []).forEach((w, i) => {
      const core = A.box(w.x - 4, w.y - 4, w.x + 4, w.y + 4), disc = A.box(w.x - w.radius, w.y - w.radius, w.x + w.radius, w.y + w.radius);
      push({ cat: 'web', kind: 'weaver-web', id: `web-${i}`, x: w.x, y: w.y, box: [w.x - w.radius - 4, w.y - w.radius - 4, w.x + w.radius + 4, w.y + w.radius + 4],
        m: { radius: w.radius, coreBlkF: R(core.blkF), coreLiqF: R(core.liqF), discBlkF: R(disc.blkF), discLiqF: R(disc.liqF), liqT: disc.liqT } });
    });

    // --- placed prefab rooms (lairs, puzzles, machines, flora rooms) ---
    for (const p of rt.placedPrefabs ?? []) {
      const b = A.box(p.x0, p.y0, p.x1, p.y1);
      const open = b.n - b.blk;
      push({ cat: 'prefab', kind: p.id.replace(/-\d+$/, ''), id: `prefab-${p.id}-${p.x0}-${p.y0}`, x: Math.round((p.x0 + p.x1) / 2), y: p.y1, box: [p.x0, p.y0, p.x1, p.y1],
        m: { n: b.n, open, liq: b.liq, liqOpenF: R(open ? b.liq / open : 0), liqT: b.liqT, blk: b.blk, blkT: b.blkT, haz: b.haz } });
    }

    // --- boss arena ---
    if (rt.boss) {
      const { x, y } = rt.boss, kind = rt.boss.kind ?? 'colossus', [hw, h] = DIMS[kind] ?? [12, 30];
      const body = A.box(x - hw, y - h + 1, x + hw, y);
      const live = ctx.enemies.find((e) => e.kind === kind);
      push({ cat: 'boss', kind, id: `boss-${kind}`, x, y, box: [x - hw - 30, y - h - 30, x + hw + 30, y + 12],
        m: { spawnBlkF: R(body.blkF), spawnBlkT: body.blkT, spawnLiqF: R(body.liqF), liqT: body.liqT, support: R(A.support(x - hw, x + hw, y + 1)),
          live: live ? { x: live.x, y: live.y, hp: live.hp, dead: !!live.dead } : null, reach: A.near(A._m.wiz, x, y, 12) } });
    }

    // --- enemies ---
    ctx.enemies.forEach((e, i) => {
      if (e.dead) return;
      const [hw, h] = DIMS[e.kind] ?? [5, 8];
      let x = Math.round(e.x), y = Math.round(e.y);
      const body = A.box(x - hw, y - h + 1, x + hw, y);
      const core = A.box(x - Math.max(1, hw - 2), y - h + 2, x + Math.max(1, hw - 2), y - 1);
      push({ cat: 'enemy', kind: e.kind + (e.sleeping ? '(roost)' : ''), id: `enemy-${i}-${e.kind}`, x, y, box: [x - hw - 6, y - h - 6, x + hw + 6, y + 6],
        m: { blkF: R(body.blkF), coreBlkF: R(core.blkF), blkT: body.blkT, liqF: R(body.liqF), liqT: body.liqT, support: R(A.support(x - hw, x + hw, y + 1)), gap: A.gap(x, y),
          ceiling: (() => { let g = 0; while (g < 150 && !BLK[A.at(x, y - h - g)] && !SOFT[A.at(x, y - h - g)]) g++; return g; })(), flyer: FLYERS.has(e.kind), swimmer: SWIMMERS.has(e.kind),
          sleeping: !!e.sleeping, submerged: !!e.submerged, sourceId: e.sourceId ?? null, hp: Math.round(e.hp ?? 0) } });
    });

    // --- critters and organisms ---
    (ctx.critters?.list ?? []).forEach((c, i) => {
      const x = Math.round(c.x), y = Math.round(c.y);
      const t = A.at(x, y);
      let adj = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (BLK[A.at(x + dx, y + dy)]) adj++;
      push({ cat: 'critter', kind: c.kind, id: `critter-${i}-${c.kind}`, x, y, box: [x - 8, y - 8, x + 8, y + 8],
        m: { cell: A.name(t), inBlk: !!BLK[t], inLiq: !!LIQ[t], liq: A.name(t), below: A.name(A.at(x, y + 1)), above: A.name(A.at(x, y - 1)), adjBlk: adj, dead: c.dead ?? 0,
          anchor: c.anchorX !== undefined ? A.name(A.at(c.anchorX, c.anchorY)) : null,
          anchorSurface: c.anchorX !== undefined ? (() => { for (let d = -2; d <= 2; d++) for (let e = -2; e <= 2; e++) if (BLK[A.at(c.anchorX + e, c.anchorY + d)]) return true; return false; })() : null } });
    });

    // --- authored lights (a lamp under water, a light in rock) ---
    (rt.authoredLights ?? []).forEach((l, i) => {
      const t = A.at(l.x, l.y);
      push({ cat: 'light', kind: 'light', id: `light-${i}`, x: Math.round(l.x), y: Math.round(l.y), box: [l.x - 10, l.y - 10, l.x + 10, l.y + 10],
        m: { cell: A.name(t), inLiq: !!LIQ[t], inBlk: !!BLK[t], rgb: [R(l.r), R(l.g), R(l.b)], radius: l.radius, depth: A.depth(l.x, l.y) } });
    });

    // --- D1 plant crowns (authored habitat) ---
    (rt.living?.plants ?? []).forEach((p, i) => {
      if (!p) return;
      const x = Math.round(p.x), y = Math.round(p.y);
      push({ cat: 'plant', kind: p.detached ? 'crown(detached)' : 'crown', id: `crown-${i}`, x, y, box: [x - 16, y - 24, x + 16, y + 4],
        m: { rootCell: A.name(A.at(x, y)), below: A.name(A.at(x, y + 1)), gap: A.gap(x, y), depth: A.depth(x, y), burning: !!p.burning, spent: !!p.spent } });
    });

    return items;
  };

  /** Whole-grid scans: flora in lava, floating growth, fire in water. */
  A.scan = () => {
    const w = ctx.world, W = w.width, H = w.height, t = w.types;
    const out = { floraInHazard: [], floatingGrowth: [], fireInWater: 0, grassUnderLiquid: 0, trunkInLiquid: 0 };
    const seen = new Uint8Array(W * H);
    const growth = mk([30, 33, 34, 37, 39, 40, 41]); // not vines: vines hang by design
    const q = new Int32Array(W * H);
    for (let i = W; i < W * H - W; i++) {
      const ti = t[i];
      if (ti === 5 && (t[i - 1] === 2 || t[i + 1] === 2 || t[i - W] === 2 || t[i + W] === 2)) out.fireInWater++;
      if ((ti === 37 || ti === 34 || ti === 30 || ti === 33) && LIQ[t[i - W]]) out.grassUnderLiquid++;
      if (!growth[ti] || seen[i]) continue;
      // component of growth (8-connected: stems step diagonally)
      let head = 0, tail = 0, size = 0, touchBlk = 0, touchLiq = 0, touchHaz = 0, touchVine = 0, minX = W, maxX = 0, minY = H, maxY = 0;
      const kinds = {};
      seen[i] = 1; q[tail++] = i;
      while (head < tail) {
        const j = q[head++], x = j % W, y = (j / W) | 0;
        size++; kinds[NAME[t[j]]] = (kinds[NAME[t[j]]] ?? 0) + 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (const k of [j - 1, j + 1, j - W, j + W, j - W - 1, j - W + 1, j + W - 1, j + W + 1]) {
          if (k < 0 || k >= W * H) continue;
          const tk = t[k];
          if (growth[tk]) { if (!seen[k]) { seen[k] = 1; q[tail++] = k; } continue; }
          if (BLK[tk]) touchBlk++;
          if (LIQ[tk]) touchLiq++;
          if (HAZ[tk]) touchHaz++;
          if (tk === 15) touchVine++;
        }
      }
      const rec = { x: Math.round((minX + maxX) / 2), y: maxY, size, box: [minX, minY, maxX, maxY], kinds, touchBlk, touchLiq, touchHaz, touchVine };
      if (touchHaz > 0) out.floraInHazard.push(rec);
      else if (touchBlk === 0 && touchVine === 0 && size >= 3 && touchLiq === 0) out.floatingGrowth.push(rec);
      else if (touchBlk === 0 && touchVine === 0 && size >= 3 && touchLiq > 0 && !(kinds.leaf && Object.keys(kinds).length === 1)) out.floatingGrowth.push({ ...rec, onLiquid: true });
    }
    out.floraInHazard.sort((a, b) => b.touchHaz - a.touchHaz);
    out.floatingGrowth.sort((a, b) => b.size - a.size);
    out.floraInHazard = out.floraInHazard.slice(0, 60);
    out.floatingGrowth = out.floatingGrowth.slice(0, 80);
    return out;
  };

  /** A flat 1:1 grid crop around a box (colors plane, Empty dark), scaled, with the box outlined. */
  A.crop = (box, scale = 3, pad = 30) => {
    const w = ctx.world, W = w.width, H = w.height;
    const x0 = Math.max(0, Math.floor(box[0] - pad)), y0 = Math.max(0, Math.floor(box[1] - pad));
    const x1 = Math.min(W - 1, Math.ceil(box[2] + pad)), y1 = Math.min(H - 1, Math.ceil(box[3] + pad));
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const cv = document.createElement('canvas'); cv.width = cw * scale; cv.height = ch * scale;
    const g = cv.getContext('2d');
    const img = g.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = x0 + x + (y0 + y) * W, c = w.types[i] === 0 ? 0x0a0a10 : w.colors[i], o = (x + y * cw) * 4;
      img.data[o] = (c >> 16) & 255; img.data[o + 1] = (c >> 8) & 255; img.data[o + 2] = c & 255; img.data[o + 3] = 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = cw; tmp.height = ch; tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, cw * scale, ch * scale);
    g.strokeStyle = 'rgba(255,60,200,0.95)'; g.lineWidth = 1;
    g.strokeRect((box[0] - x0) * scale + 0.5, (box[1] - y0) * scale + 0.5, (box[2] - box[0] + 1) * scale, (box[3] - box[1] + 1) * scale);
    return cv.toDataURL('image/png');
  };

  window.__audit = A;
  return true;
}

/* ------------------------------------------------------------------ */
/* Node side                                                           */
/* ------------------------------------------------------------------ */

async function ticksNow(page) {
  return page.evaluate(() => window.__game.ctx.state.frameCount);
}

/** Close whatever modal paused the game (waystone prompt, card offer), and log it. */
async function unpause(page, log) {
  const info = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    if (!ctx.state.paused) return null;
    const vis = [...document.querySelectorAll('[id$="overlay"].visible, .visible[role="dialog"], .card-offer-overlay.visible, .waystone-prompt-overlay.visible')]
      .map((e) => e.id || e.className).slice(0, 4);
    return { vis };
  });
  if (!info) return;
  log.push({ pausedBy: info.vis });
  for (const sel of ['.waystone-prompt-btn:last-child', '.card-offer-card']) {
    const el = await page.$(sel);
    if (el && await el.isVisible().catch(() => false)) { await el.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(150); }
  }
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    if (!ctx.state.paused) return;
    document.querySelectorAll('.waystone-prompt-overlay.visible, .card-offer-overlay.visible').forEach((e) => e.classList.remove('visible'));
    ctx.state.paused = false;
  });
}

async function waitTicks(page, n, log, maxMs = 60000) {
  const start = await ticksNow(page), t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(250);
    await unpause(page, log);
    const now = await ticksNow(page);
    if (now - start >= n) return now - start;
    if (Date.now() - t0 > maxMs) return now - start;
  }
}

async function tp(page, x, y) {
  const r = await execConsoleCommand(page, `tp ${x} ${y}`, { rejectOnError: false });
  return r?.ok;
}

async function auditLevel(page, level, seed) {
  const log = [];
  const t0 = Date.now();
  await page.evaluate(() => localStorage.removeItem('noita-expedition'));
  await execConsoleCommand(page, `run test --level ${level} --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  await page.evaluate(installAudit);
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.state.debugGodMode = true;
    ctx.player.invuln = 1e9;
    // Pickups keep their physics but never see the alchemist (no magnet, no collection, no card-offer pause).
    const P = ctx.pickups;
    if (!P.__auditWrapped) {
      const orig = P.update.bind(P);
      P.update = (c) => { const px = c.player.x, py = c.player.y; c.player.x = -99999; c.player.y = -99999; try { orig(c); } finally { c.player.x = px; c.player.y = py; } };
      P.__auditWrapped = true;
    }
  });
  await waitTicks(page, 90, log);
  const meta = await page.evaluate(() => {
    const ctx = window.__game.ctx, rt = ctx.levels.current;
    return { level: rt.def.id, name: rt.def.name, biome: rt.def.biome, seed: ctx.state.worldSeed, spawn: rt.spawn, population: rt.population ?? null };
  });
  const arrival = await page.evaluate(() => window.__audit.measure('arrival'));
  const arrivalScan = await page.evaluate(() => window.__audit.scan());

  // The settle tour: a 3x2 grid of dry standable spots, `PASSES` rounds.
  const tour = [];
  for (const y of [270, 790]) for (const x of [380, 800, 1220]) tour.push([x, y]);
  for (let pass = 0; pass < PASSES; pass++) {
    const order = pass % 2 ? [...tour].reverse() : tour;
    for (const [x, y] of order) {
      const s = await page.evaluate(({ x, y }) => { window.__audit.masks(); return window.__audit.standNear(x, y); }, { x, y });
      if (!s) { log.push({ tourSkip: [x, y] }); continue; }
      await tp(page, s.x, s.y);
      await waitTicks(page, DWELL, log);
    }
  }
  // The story sites and the waystones get a visit of their own (the view the player has arriving there).
  const visits = await page.evaluate(() => {
    const rt = window.__game.ctx.levels.current, v = [];
    if (rt.story?.camp) v.push(['camp', rt.story.camp.x, rt.story.camp.floorY]);
    if (rt.story?.valve) v.push(['valve', rt.story.valve.stageX, rt.story.valve.floorY]);
    for (const w of rt.waystones) v.push(['waystone', w.x, w.y]);
    return v;
  });
  for (const [what, x, y] of visits) {
    const s = await page.evaluate(({ x, y }) => { window.__audit.masks(); return window.__audit.standNear(x, y, 40); }, { x, y });
    if (!s) { log.push({ visitSkip: what }); continue; }
    await tp(page, s.x, s.y);
    await waitTicks(page, Math.round(DWELL / 2), log);
  }
  // The settled findability repair cascade runs to 12 s of wall AND sim time after entry.
  const elapsed = Date.now() - t0;
  if (elapsed < 14000) await page.waitForTimeout(14000 - elapsed);
  const settled = await page.evaluate(() => window.__audit.measure('settled'));
  const settledScan = await page.evaluate(() => window.__audit.scan());
  const findability = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    return { ready: ctx.levels.findabilityReady ?? null };
  });
  return { meta, arrival, settled, arrivalScan, settledScan, findability, log, ticks: await ticksNow(page), wallMs: Date.now() - t0 };
}

/* ---------------- run ---------------- */

async function runSeed(browser, seed) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await waitForConsoleApi(page, { timeout: 60000 });
  const results = [];
  for (const level of LEVELS) {
    const tag = `${level}-s${seed}`;
    console.log(`[${tag}] start`);
    let res;
    try {
      res = await auditLevel(page, level, seed);
    } catch (err) {
      console.log(`[${tag}] FAILED ${err.message}`);
      results.push({ level, seed, error: String(err.message) });
      continue;
    }
    const byId = new Map(res.arrival.map((it) => [it.id, it]));
    for (const it of res.settled) it.flags = classify(it, byId.get(it.id), level);
    for (const it of res.arrival) it.flags = classify(it, null, level);
    // Scans: flora in hazards, floating growth.
    res.settled.push(...scanFlags(res.settledScan));
    // Screenshots: flat crops of flagged items, in-game shots of the worst.
    const sevRank = { P1: 0, P2: 1, P3: 2 };
    const flagged = res.settled.filter((it) => it.flags?.length && it.cat !== 'critter' && it.cat !== 'enemy' || it.flags?.some((f) => f.sev !== 'P3'))
      .sort((a, b) => Math.min(...a.flags.map((f) => sevRank[f.sev])) - Math.min(...b.flags.map((f) => sevRank[f.sev])));
    let crops = 0;
    for (const it of flagged) {
      if (crops >= CROPS) break;
      const url = await page.evaluate((box) => window.__audit.crop(box, 3, 30), it.box);
      const file = `crop-${tag}-${it.id}.png`.replace(/[^a-zA-Z0-9_.-]/g, '_');
      writeFileSync(join(OUT, file), Buffer.from(url.split(',')[1], 'base64'));
      it.crop = file;
      crops++;
    }
    // Shots: the worst of each (category, class) first, then the rest by severity.
    const seen = new Set(), firsts = [], rest = [];
    for (const it of flagged) { const k = `${it.cat}:${it.flags[0].cls}`; (seen.has(k) ? rest : firsts).push(it); seen.add(k); }
    let shots = 0;
    for (const it of [...firsts, ...rest]) {
      if (shots >= SHOTS) break;
      if (!it.flags.some((f) => f.sev !== 'P3')) continue;
      const cx = (it.box[0] + it.box[2]) / 2, cy = (it.box[1] + it.box[3]) / 2;
      const s = await page.evaluate(({ cx, cy }) => { window.__audit.masks(); return window.__audit.standNear(cx, cy, 30); }, { cx, cy });
      if (s) await tp(page, s.x, s.y);
      await page.evaluate(({ cx, cy }) => {
        const c = window.__game.ctx.camera; c.zoomLock = 1.6; c.setInspectionFocus(cx, cy, { snap: true });
        if (!document.getElementById('audit-hide-ui')) {
          const st = document.createElement('style'); st.id = 'audit-hide-ui';
          st.textContent = '#canvas-holder > *:not(canvas), body > *:not(#workbench), #workbench > *:not(#viewport-container), #viewport-container > *:not(#canvas-holder) { visibility: hidden !important; }';
          document.head.appendChild(st);
        }
      }, { cx, cy });
      await waitTicks(page, 40, res.log);
      const file = `shot-${tag}-${it.id}.png`.replace(/[^a-zA-Z0-9_.-]/g, '_');
      await page.locator('#canvas-holder > canvas').first().screenshot({ path: join(OUT, file) }).catch(() => {});
      it.shot = file;
      shots++;
    }
    await page.evaluate(() => { const c = window.__game.ctx.camera; c.clearInspectionFocus(); c.zoomLock = null; document.getElementById('audit-hide-ui')?.remove(); });
    const out = { ...res, errors: [...errors] };
    writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(out, null, 1));
    const nFlags = res.settled.reduce((s, it) => s + (it.flags?.length ?? 0), 0);
    console.log(`[${tag}] done: ${res.settled.length} items, ${nFlags} flags, ${Math.round(res.wallMs / 1000)} s, pauses ${res.log.filter((l) => l.pausedBy).length}`);
    results.push({ level, seed, file: `${tag}.json` });
    errors.length = 0;
  }
  await context.close();
  return results;
}

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const queue = [...SEEDS];
const all = [];
await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
  while (queue.length) all.push(...await runSeed(browser, queue.shift()));
}));
await browser.close();
writeFileSync(join(OUT, 'runs.json'), JSON.stringify(all, null, 1));
console.log(`wrote ${OUT}`);
