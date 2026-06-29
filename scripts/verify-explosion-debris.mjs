// Verifies blast-isolated terrain crust turns into nonblocking ash instead of
// remaining as a floating wall the player collides with.
// Usage: node scripts/verify-explosion-debris.mjs [url]
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun, isBenignDevConsoleError } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';

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
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'physics-test', world: 'campaign-level', seed: 31, settleMs: 300 });

  const result = await page.evaluate(async () => {
    const { Cell } = await import('/src/sim/CellType.ts');
    const { stoneColor, metalColor } = await import('/src/sim/colors.ts');
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const set = (x, y, type, colorFn) => {
      const i = w.idx(x, y);
      w.replaceCellAt(i, type, colorFn());
    };
    const fill = (x0, y0, x1, y1, type, colorFn) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) if (w.inBounds(x, y)) set(x, y, type, colorFn);
      }
    };
    const count = (x0, y0, x1, y1, pred) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) if (w.inBounds(x, y) && pred(x, y, w.idx(x, y))) n++;
      }
      return n;
    };

    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.fx.hitstop = 0;
    ctx.enemies.length = 0;
    ctx.rigidBodies.clear();
    ctx.particles.clear();
    w.clear();
    w.simBounds.x0 = 300;
    w.simBounds.y0 = 390;
    w.simBounds.x1 = 430;
    w.simBounds.y1 = 475;
    ctx.player.dead = true;
    ctx.player.x = 320;
    ctx.player.y = 462;

    fill(310, 462, 420, 468, Cell.Stone, stoneColor);
    // Large detached crust: outside the blast core, inside the cleanup ring.
    fill(361, 440, 365, 445, Cell.Stone, stoneColor);
    // Anchored ledge reaches outside the cleanup ring; it must remain solid.
    fill(333, 432, 345, 434, Cell.Stone, stoneColor);
    // Engineered metal stays blocking even when isolated.
    fill(361, 452, 363, 454, Cell.Metal, metalColor);

    ctx.explosions.trigger(350, 443, 8);

    const looseTotal = count(361, 440, 365, 445, () => true);
    const looseAsh = count(361, 440, 365, 445, (_x, _y, i) => w.types[i] === Cell.Ash);
    const looseBlocking = count(361, 440, 365, 445, (x, y) => ctx.physics.cellBlocks(x, y));
    const looseLife = count(361, 440, 365, 445, (_x, _y, i) => w.life[i] > 0);
    const anchoredStone = w.types[w.idx(342, 433)] === Cell.Stone;
    const anchoredBlocks = ctx.physics.cellBlocks(342, 433);
    const metalStillMetal = count(361, 452, 363, 454, (_x, _y, i) => w.types[i] === Cell.Metal);
    const metalBlocks = ctx.physics.cellBlocks(362, 453);

    ctx.particles.clear();
    w.clear();
    w.simBounds.x0 = 340;
    w.simBounds.y0 = 410;
    w.simBounds.x1 = 440;
    w.simBounds.y1 = 470;
    ctx.player.dead = false;
    ctx.player.x = 390;
    ctx.player.y = 450;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    fill(386, 433, 394, 433, Cell.Stone, stoneColor);
    const sweepTotal = count(386, 433, 394, 433, () => true);
    const sweepWasBlocking = ctx.physics.cellBlocks(390, 433);
    const sweepMoved = ctx.physics.tryMoveEntity(ctx.player, 0, -1, 4, 17, 0);
    const sweepCleared = count(386, 433, 394, 433, (_x, _y, i) => w.types[i] === Cell.Empty);
    const sweepParticles = ctx.particles.list.length;

    ctx.particles.clear();
    w.clear();
    ctx.player.x = 390;
    ctx.player.y = 450;
    fill(350, 420, 430, 433, Cell.Stone, stoneColor);
    const anchoredMoveBlocked = !ctx.physics.tryMoveEntity(ctx.player, 0, -1, 4, 17, 0);
    const anchoredCeilingStillThere = w.types[w.idx(390, 433)] === Cell.Stone;

    ctx.particles.clear();
    w.clear();
    set(390, 435, Cell.Stone, stoneColor);
    ctx.particles.spawn(390, 433, 0, 2, Cell.Stone, stoneColor(), 20, { grav: 0, looseDebris: true });
    ctx.particles.update(ctx);
    const settledAsh = w.types[w.idx(390, 433)] === Cell.Ash;
    const settledAshNonblocking = !ctx.physics.cellBlocks(390, 433);

    return {
      looseTotal,
      looseAsh,
      looseBlocking,
      looseLife,
      anchoredStone,
      anchoredBlocks,
      metalStillMetal,
      metalBlocks,
      sweepTotal,
      sweepWasBlocking,
      sweepMoved,
      sweepCleared,
      sweepParticles,
      anchoredMoveBlocked,
      anchoredCeilingStillThere,
      settledAsh,
      settledAshNonblocking,
    };
  });

  check('detached blast crust becomes ash', result.looseAsh === result.looseTotal, JSON.stringify(result));
  check('detached blast crust is nonblocking', result.looseBlocking === 0, JSON.stringify(result));
  check('blast ash is temporary residue', result.looseLife === result.looseTotal, JSON.stringify(result));
  check('anchored terrain remains solid', result.anchoredStone && result.anchoredBlocks, JSON.stringify(result));
  check('isolated metal remains engineered terrain', result.metalStillMetal === 9 && result.metalBlocks, JSON.stringify(result));
  check(
    'player movement sweeps larger floating rubble away',
    result.sweepWasBlocking && result.sweepMoved && result.sweepCleared === result.sweepTotal && result.sweepParticles > 0,
    JSON.stringify(result),
  );
  check(
    'player movement still respects anchored ceilings',
    result.anchoredMoveBlocked && result.anchoredCeilingStillThere,
    JSON.stringify(result),
  );
  check('explosion particles settle as nonblocking ash', result.settledAsh && result.settledAshNonblocking, JSON.stringify(result));
  check('No browser page errors', pageErrors.length === 0, pageErrors.join('\n'));
  check('No unexpected console errors', consoleErrors.length === 0, consoleErrors.join('\n'));
} finally {
  await browser.close();
}

if (fail > 0) {
  console.error(`verify-explosion-debris failed: ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`verify-explosion-debris passed: ${pass} checks`);
