// Runtime verification for the Organic Enemy Trio:
// Root Loper writes capped soft growth, Stone Maw chews bounded safe tunnels,
// and Rillback charges only local water/blood conductors.
// Usage: node scripts/verify-organic-enemy-trio.mjs [url]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun, isBenignDevConsoleError } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log('  ok    ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? ' ' + detail : ''));
  }
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'physics-test', world: 'campaign-level', seed: 19, settleMs: 400 });

  const result = await page.evaluate(async () => {
    const { Cell } = await import('/src/sim/CellType.ts');
    const {
      bloodColor,
      glassColor,
      mossColor,
      slimeColor,
      stoneColor,
      vineColor,
      waterColor,
      metalColor,
    } = await import('/src/sim/colors.ts');
    const cellName = Object.fromEntries(Object.entries(Cell).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k]));
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const tick = (frames) => {
      for (let i = 0; i < frames; i++) window.__game.tick();
    };
    const clear = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
      }
    };
    const fill = (x0, y0, x1, y1, type, colorFn) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), type, colorFn());
      }
    };
    const countIn = (x0, y0, x1, y1, pred) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) if (w.inBounds(x, y) && pred(w.types[w.idx(x, y)], x, y)) n++;
      }
      return n;
    };
    const spawnAt = (kind, x, y) => {
      const e = ctx.enemyCtl.spawn(kind, x, y);
      if (!e) throw new Error('failed to spawn ' + kind);
      e.x = x;
      e.y = y;
      e.fx = 0;
      e.fy = 0;
      e.vx = 0;
      e.vy = 0;
      e.alerted = true;
      e.attackCd = 0;
      e.sleeping = false;
      return e;
    };

    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.fx.hitstop = 0;
    ctx.enemies.length = 0;
    ctx.player.dead = false;
    ctx.player.hp = 100;
    ctx.player.invuln = 0;

    // Root Loper arena.
    clear(340, 600, 500, 700);
    fill(340, 672, 500, 678, Cell.Stone, stoneColor);
    fill(370, 654, 450, 656, Cell.Vines, vineColor);
    fill(370, 662, 450, 663, Cell.Moss, mossColor);
    ctx.player.x = 535;
    ctx.player.y = 670;
    const root = spawnAt('rootloper', 405, 671);
    root.rootGrowthBudget = 34;
    const beforeRoot = [];
    for (let y = 635; y <= 675; y++) {
      for (let x = 350; x <= 490; x++) beforeRoot.push([x, y, w.types[w.idx(x, y)]]);
    }
    tick(180);
    let rootNewGrowth = 0;
    let rootBadWrites = 0;
    let rootOtherChanges = 0;
    const rootBadSamples = [];
    for (const [x, y, t] of beforeRoot) {
      const next = w.types[w.idx(x, y)];
      if (next === t) continue;
      if (t !== Cell.Empty) {
        rootOtherChanges++;
        continue;
      }
      if (next === Cell.Empty) continue;
      if (next === Cell.Vines || next === Cell.Moss || next === Cell.Fungus) rootNewGrowth++;
      else {
        rootBadWrites++;
        if (rootBadSamples.length < 8) rootBadSamples.push({ x, y, next, name: cellName[next] ?? String(next) });
      }
    }
    const rootPanicX = Math.floor(root.x);
    const rootPanicY = Math.floor(root.y);
    fill(rootPanicX - 18, rootPanicY - 12, rootPanicX + 18, rootPanicY + 5, Cell.Acid, () => 0x33ff33);
    root.timer = 5;
    tick(2);
    const rootAfterFire = { support: root.rootSupport ?? 0, panic: root.rootPanic ?? 0, growthBudget: root.rootGrowthBudget ?? 34 };

    // Stone Maw arena: one tick should chew one bounded brush.
    clear(540, 610, 700, 700);
    fill(540, 674, 700, 680, Cell.Stone, stoneColor);
    fill(615, 642, 642, 672, Cell.Stone, stoneColor);
    fill(624, 654, 625, 656, Cell.Metal, metalColor);
    fill(627, 654, 628, 656, Cell.Glass, glassColor);
    const beforeMaw = [];
    for (let y = 642; y <= 672; y++) {
      for (let x = 615; x <= 642; x++) beforeMaw.push([x, y, w.types[w.idx(x, y)]]);
    }
    const metalBefore = w.types[w.idx(624, 654)];
    const glassBefore = w.types[w.idx(627, 654)];
    ctx.player.x = 680;
    ctx.player.y = 670;
    const maw = spawnAt('stonemaw', 604, 672);
    maw.mawDir = 1;
    maw.mawChewCd = 0;
    tick(2);
    let mawOpened = 0;
    for (const [x, y, t] of beforeMaw) {
      if (t !== Cell.Empty && w.types[w.idx(x, y)] === Cell.Empty) mawOpened++;
    }
    const metalGlassChanged =
      (w.types[w.idx(624, 654)] !== metalBefore ? 1 : 0) + (w.types[w.idx(627, 654)] !== glassBefore ? 1 : 0);

    // Rillback arena: wet body charges local water/blood, not slime/acid.
    clear(760, 620, 900, 700);
    fill(760, 682, 900, 688, Cell.Stone, stoneColor);
    fill(800, 660, 852, 681, Cell.Water, waterColor);
    fill(824, 670, 829, 674, Cell.Blood, bloodColor);
    fill(832, 670, 837, 674, Cell.Slime, slimeColor);
    fill(840, 670, 845, 674, Cell.Acid, () => 0x33ff33);
    ctx.player.x = 870;
    ctx.player.y = 674;
    const rill = spawnAt('rillback', 824, 676);
    rill.timer = 23;
    rill.rillChargeCd = 0;
    tick(6);
    const rillWet = rill.rillWet ?? 0;
    const windupSeen = (rill.rillChargeWindup ?? 0) > 0;
    const chargedBeforePulse = countIn(800, 660, 852, 681, (t, x, y) => t === Cell.Water && w.charge[w.idx(x, y)] > 0);
    tick(15);
    const chargedWater = countIn(800, 660, 852, 681, (t, x, y) => t === Cell.Water && w.charge[w.idx(x, y)] > 0);
    const chargedBlood = countIn(824, 670, 829, 674, (t, x, y) => t === Cell.Blood && w.charge[w.idx(x, y)] > 0);
    const chargedSlime = countIn(832, 670, 837, 674, (t, x, y) => t === Cell.Slime && w.charge[w.idx(x, y)] > 0);
    const chargedAcid = countIn(840, 670, 845, 674, (t, x, y) => t === Cell.Acid && w.charge[w.idx(x, y)] > 0);
    clear(810, 650, 842, 681);
    tick(8);
    const rillDry = rill.rillWet ?? 0;

    ctx.camera.snapTo(620, 650);
    return {
      root: rootAfterFire,
      rootNewGrowth,
      rootBadWrites,
      rootOtherChanges,
      rootBadSamples,
      maw: { opened: mawOpened, metalGlassChanged, chewT: maw.mawChewT ?? 0, chewCd: maw.mawChewCd ?? 0 },
      rill: { wet: rillWet, dry: rillDry, windupSeen, chargedBeforePulse, chargedWater, chargedBlood, chargedSlime, chargedAcid, chargeCd: rill.rillChargeCd ?? 0 },
      enemyKinds: ctx.enemies.map((e) => e.kind),
    };
  });

  await page.screenshot({ path: 'verify-out/organic-enemy-trio.png', fullPage: false });

  check('Root Loper wrote new living growth', result.rootNewGrowth > 0, JSON.stringify(result.root));
  check('Root Loper wrote only allowed soft growth', result.rootBadWrites === 0, `badWrites=${result.rootBadWrites} samples=${JSON.stringify(result.rootBadSamples)}`);
  check('Root Loper stayed within lifetime growth budget', result.root.growthBudget >= 0, JSON.stringify(result.root));
  check('Root Loper spent growth budget', result.root.growthBudget < 34, JSON.stringify(result.root));
  check('Root Loper panicked after acid cut anchors', result.root.panic > 0, JSON.stringify(result.root));
  check('Stone Maw opened a bounded tunnel bite', result.maw.opened > 0 && result.maw.opened <= 7, JSON.stringify(result.maw));
  check('Stone Maw preserved Metal/Glass cells', result.maw.metalGlassChanged === 0, JSON.stringify(result.maw));
  check('Rillback reads wet body state', result.rill.wet >= 0.28, JSON.stringify(result.rill));
  check('Rillback shows a charge windup before pulse', result.rill.windupSeen && result.rill.chargedBeforePulse === 0, JSON.stringify(result.rill));
  check('Rillback becomes beached after pool clears', result.rill.dry < 0.28, JSON.stringify(result.rill));
  check('Rillback charged water or blood', result.rill.chargedWater + result.rill.chargedBlood > 0, JSON.stringify(result.rill));
  check('Rillback did not charge slime or acid', result.rill.chargedSlime === 0 && result.rill.chargedAcid === 0, JSON.stringify(result.rill));
  check('No browser page errors', pageErrors.length === 0, pageErrors.join('\n'));
  check('No unexpected console errors', consoleErrors.length === 0, consoleErrors.join('\n'));

  console.log('organic enemy trio metrics:', JSON.stringify(result));
} finally {
  await browser.close();
}

if (fail > 0) {
  console.error(`verify-organic-enemy-trio failed: ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`verify-organic-enemy-trio passed: ${pass} checks`);
