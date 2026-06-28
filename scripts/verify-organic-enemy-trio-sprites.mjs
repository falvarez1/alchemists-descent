// Runtime render probe for the Organic Enemy Trio. It samples real canvas crops
// for Root Loper, Stone Maw, and Rillback so behavior tests cannot pass with
// blank or invisible sprites.
// Usage: node scripts/verify-organic-enemy-trio-sprites.mjs [url]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const consoleErrors = [];
const pageErrors = [];

page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
});

function check(name, ok, detail = '') {
  if (!ok) throw new Error(`${name}${detail ? ': ' + detail : ''}`);
  console.log('  ok    ' + name);
}

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'physics-test', world: 'campaign-level', seed: 23, settleMs: 400 });

  await page.evaluate(async () => {
    const { Cell } = await import('/src/sim/CellType.ts');
    const { stoneColor, waterColor, vineColor, mossColor } = await import('/src/sim/colors.ts');
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
    const spawn = (kind, x, y) => {
      const e = ctx.enemyCtl.spawn(kind, x, y);
      if (!e) throw new Error('spawn failed: ' + kind);
      e.x = x;
      e.y = y;
      e.vx = 0;
      e.vy = 0;
      e.fx = 0;
      e.fy = 0;
      e.alerted = true;
      e.sleeping = false;
      return e;
    };

    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.fx.hitstop = 0;
    ctx.enemies.length = 0;
    ctx.player.dead = false;
    ctx.player.hp = ctx.player.maxHp = 9999;
    ctx.params.global.ambient = Math.max(ctx.params.global.ambient, 0.52);

    clear(330, 610, 900, 710);
    fill(330, 682, 900, 688, Cell.Stone, stoneColor);
    fill(365, 650, 452, 652, Cell.Vines, vineColor);
    fill(365, 658, 452, 659, Cell.Moss, mossColor);
    fill(780, 660, 850, 681, Cell.Water, waterColor);

    const root = spawn('rootloper', 405, 680);
    root.rootSupport = 0.8;
    root.windup = 9;
    root.rootLashX = 462;
    root.rootLashY = 669;
    const maw = spawn('stonemaw', 610, 680);
    maw.mawDir = 1;
    maw.mawChewT = 12;
    const rill = spawn('rillback', 818, 676);
    rill.rillWet = 1;
    rill.rillChargeWindup = 12;
    rill.blink = 12;
    ctx.player.x = 860;
    ctx.player.y = 674;
    for (let i = 0; i < 8; i++) window.__game.tick();
  });

  const samples = await page.evaluate(async () => {
    const { VIEW_W, VIEW_H } = await import('/src/config/constants.ts');
    const ctx = window.__game.ctx;
    const canvas = document.querySelector('#canvas-holder > canvas');
    if (!canvas) return { error: 'missing canvas' };
    const out = [];
    for (const kind of ['rootloper', 'stonemaw', 'rillback']) {
      const e = ctx.enemies.find((candidate) => candidate.kind === kind);
      if (!e) return { error: 'missing ' + kind };
      ctx.camera.zoomLock = 1;
      ctx.camera.snapTo(e.x, e.y - 14);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scaleX = canvas.width / VIEW_W;
      const scaleY = canvas.height / VIEW_H;
      const cx = (e.x - ctx.camera.renderX) * scaleX;
      const cy = (e.y - 12 - ctx.camera.renderY) * scaleY;
      const halfW = 58 * scaleX;
      const halfH = 50 * scaleY;
      const crop = document.createElement('canvas');
      crop.width = Math.round(halfW * 2 * 3);
      crop.height = Math.round(halfH * 2 * 3);
      const g = crop.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(canvas, cx - halfW, cy - halfH, halfW * 2, halfH * 2, 0, 0, crop.width, crop.height);
      const data = g.getImageData(0, 0, crop.width, crop.height).data;
      let nonBlack = 0;
      let green = 0;
      let stone = 0;
      let cyan = 0;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const gr = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const sum = r + gr + b;
        if (sum > 45) nonBlack++;
        if (gr > 80 && gr > r * 1.35 && gr > b * 1.1) green++;
        if (r > 55 && gr > 45 && b > 35 && Math.max(r, gr, b) - Math.min(r, gr, b) < 95) stone++;
        if (gr > 85 && b > 105 && r < 95) cyan++;
        if (sum > 430) bright++;
      }
      const total = data.length / 4;
      out.push({
        kind,
        dataUrl: crop.toDataURL('image/png'),
        nonBlackPct: (nonBlack / total) * 100,
        greenPct: (green / total) * 100,
        stonePct: (stone / total) * 100,
        cyanPct: (cyan / total) * 100,
        brightPct: (bright / total) * 100,
      });
    }
    return { samples: out };
  });

  if (samples.error) throw new Error(samples.error);
  for (const sample of samples.samples) {
    writeFileSync(`${outDir}/organic-${sample.kind}-sprite.png`, Buffer.from(sample.dataUrl.split(',')[1], 'base64'));
    check(`${sample.kind} crop is nonblank`, sample.nonBlackPct > 1.4, JSON.stringify(sample));
    if (sample.kind === 'rootloper') check('Root Loper crop contains growth greens', sample.greenPct > 0.15, JSON.stringify(sample));
    if (sample.kind === 'stonemaw') check('Stone Maw crop contains stone body pixels', sample.stonePct > 0.2, JSON.stringify(sample));
    if (sample.kind === 'rillback') check('Rillback crop contains cyan charge pixels', sample.cyanPct > 0.08, JSON.stringify(sample));
  }
  check('No browser page errors', pageErrors.length === 0, pageErrors.join('\n'));
  check('No unexpected console errors', consoleErrors.length === 0, consoleErrors.join('\n'));
  console.log('organic enemy sprite samples:', JSON.stringify(samples.samples));
} finally {
  await browser.close();
}
