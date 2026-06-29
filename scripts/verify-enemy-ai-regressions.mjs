// Runtime verification for shared enemy AI contracts:
// exact prefab spawns, damage wake-up, fireproof hazard reactions,
// flying collision, Powder Mage wall-chip fallback, and Spitter habitat roots.
// Usage: node scripts/verify-enemy-ai-regressions.mjs [url]
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
  await startConsoleTestRun(page, { level: 'physics-test', world: 'campaign-level', seed: 29, settleMs: 300 });

  const result = await page.evaluate(async () => {
    const { Cell } = await import('/src/sim/CellType.ts');
    const { stoneColor } = await import('/src/sim/colors.ts');
    const ctx = window.__game.ctx;
    const w = ctx.world;
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

    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.fx.hitstop = 0;
    ctx.player.dead = true;
    ctx.enemies.length = 0;
    clear(260, 560, 520, 700);

    fill(300, 650, 312, 665, Cell.Stone, stoneColor);
    const exactBefore = ctx.enemies.length;
    const exactBlocked = ctx.enemyCtl.spawn('bat', 306, 665, { exact: true }) === null && ctx.enemies.length === exactBefore;
    clear(300, 640, 320, 670);

    const bat = ctx.enemyCtl.spawn('bat', 318, 664, { exact: true });
    if (!bat) throw new Error('bat exact spawn failed');
    bat.sleeping = true;
    bat.alerted = false;
    ctx.enemyCtl.damage(bat, 1, 0, 0);
    const damageWakes = bat.sleeping === false && bat.alerted === true;

    const colossus = ctx.enemyCtl.spawn('colossus', 370, 666, { exact: true });
    if (!colossus) throw new Error('colossus exact spawn failed');
    colossus.hp = 100;
    colossus.maxHp = 100;
    fill(360, 640, 380, 666, Cell.Lava, stoneColor);
    ctx.enemyCtl.enemyEnvironmentDamage(colossus);
    const colossusFireproof = colossus.hp === 100;
    clear(350, 620, 390, 675);

    const imp = ctx.enemyCtl.spawn('imp', 434, 660, { exact: true });
    if (!imp) throw new Error('imp exact spawn failed');
    fill(440, 628, 443, 670, Cell.Stone, stoneColor);
    imp.vx = 3;
    imp.vy = 0;
    imp.fx = 0;
    imp.fy = 0;
    ctx.enemyCtl.integrateFlying(imp, ctx.enemyCtl.defs.imp, 1);
    const flyerCollides = imp.x <= 435 && imp.vx === 0;
    clear(420, 620, 455, 675);

    const mage = ctx.enemyCtl.spawn('mage', 300, 665, { exact: true });
    if (!mage) throw new Error('mage exact spawn failed');
    ctx.player.dead = false;
    ctx.player.x = 360;
    ctx.player.y = 655;
    const chipIndex = w.idx(308, 646);
    w.replaceCellAt(chipIndex, Cell.Stone, stoneColor());
    const mageChips = ctx.enemyCtl.mageVolley(mage) === true && w.types[chipIndex] === Cell.Empty;

    const spitter = ctx.enemyCtl.spawn('spitter', 470, 664, { exact: true });
    if (!spitter) throw new Error('spitter exact spawn failed');
    fill(464, 666, 476, 668, Cell.Stone, stoneColor);
    spitter.grounded = true;
    spitter.timer = 30;
    ctx.enemyCtl.spitterRootHabitat(spitter, ctx.enemyCtl.defs.spitter);
    const spitterRoots = w.types[w.idx(470, 665)] === Cell.Toxic;

    return { exactBlocked, damageWakes, colossusFireproof, flyerCollides, mageChips, spitterRoots };
  });

  check('exact spawn refuses blocked authored cells', result.exactBlocked);
  check('damage wakes dormant enemies', result.damageWakes);
  check('fireproof bosses ignore fire/lava contact damage', result.colossusFireproof);
  check('flying enemies collide with terrain', result.flyerCollides);
  check('Powder Mage chips real stone fallback ammo', result.mageChips);
  check('Spitter writes toxic rooted habitat', result.spitterRoots);
  check('no page errors', pageErrors.length === 0, pageErrors.join('\n'));
  check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.join('\n'));
} finally {
  await browser.close();
}

if (fail > 0) {
  console.error(`verify-enemy-ai-regressions failed: ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`verify-enemy-ai-regressions passed: ${pass} checks`);
