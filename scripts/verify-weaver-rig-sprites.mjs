// Runtime probe for the image-backed Weaver rig: verifies the atlas is requested,
// then captures a zoomed Weaver crop and checks for the new cyan/blue crystal pixels.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
let atlasRequested = false;

page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('response', (response) => {
  if (response.url().includes('weaver-crystal-silk-assassin-rig-parts-transparent')) atlasRequested = true;
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });

  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const STONE = 12;
    ctx.enemies.length = 0;
    for (let y = 470; y <= 650; y++) {
      for (let x = 470; x <= 710; x++) {
        if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y));
      }
    }
    for (let y = 610; y <= 618; y++) {
      for (let x = 500; x <= 690; x++) {
        if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
      }
    }
    ctx.enemyCtl.spawn('weaver', 595, 609);
    const w = ctx.enemies[0];
    w.x = 595;
    w.y = 609;
    w.vx = 0;
    w.vy = 0;
    w.fx = 0;
    w.fy = 0;
    w.sleeping = false;
    w.alerted = true;
    w.cranky = 120;
    w.attackCd = 9999;
    w.windup = 0;
    w.blink = 0;
    w.webPulse = 18;
    ctx.player.x = 650;
    ctx.player.y = 604;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.camera.zoomLock = 1;
    ctx.camera.snapTo(595, 570);
    ctx.params.global.ambient = Math.max(ctx.params.global.ambient, 0.48);
    ctx.params.global.maxBrightness = Math.max(ctx.params.global.maxBrightness, 2.2);
  });

  await page.waitForTimeout(2200);

  const result = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ctx = window.__game.ctx;
        const w = ctx.enemies.find((enemy) => enemy.kind === 'weaver');
        const gl = document.querySelector('#canvas-holder > canvas');
        if (!w || !gl) {
          resolve({ error: 'missing weaver or canvas' });
          return;
        }
        ctx.camera.zoomLock = 1;
        ctx.camera.snapTo(w.x, w.y - 34);
        const scaleX = gl.width / 575;
        const scaleY = gl.height / 391;
        const cx = (w.x - ctx.camera.renderX) * scaleX;
        const cy = (w.y - 34 - ctx.camera.renderY) * scaleY;
        const halfW = 98 * scaleX;
        const halfH = 74 * scaleY;
        const out = document.createElement('canvas');
        out.width = Math.round(halfW * 2 * 3);
        out.height = Math.round(halfH * 2 * 3);
        const g = out.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(gl, cx - halfW, cy - halfH, halfW * 2, halfH * 2, 0, 0, out.width, out.height);
        const data = g.getImageData(0, 0, out.width, out.height).data;
        let nonBlack = 0;
        let cyanCrystal = 0;
        let blueCrystal = 0;
        let bright = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] ?? 0;
          const gr = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          const sum = r + gr + b;
          if (sum > 42) nonBlack++;
          if (gr > 92 && b > 92 && r < 135) cyanCrystal++;
          if (b > 130 && gr > 72 && r < 155) blueCrystal++;
          if (sum > 430) bright++;
        }
        const total = data.length / 4;
        resolve({
          dataUrl: out.toDataURL('image/png'),
          sample: {
            total,
            nonBlackPct: (nonBlack / total) * 100,
            cyanCrystalPct: (cyanCrystal / total) * 100,
            blueCrystalPct: (blueCrystal / total) * 100,
            brightPct: (bright / total) * 100,
            weaver: {
              x: Math.round(w.x),
              y: Math.round(w.y),
              planted: w.weaverVisualPlanted ?? 0,
              rigLegs: Array.isArray(w.weaverLegs) ? w.weaverLegs.length : 0,
            },
          },
        });
      });
    });
  }));

  if (result.error) throw new Error(result.error);
  writeFileSync(`${outDir}/weaver-rig-sprites.png`, Buffer.from(result.dataUrl.split(',')[1], 'base64'));

  const sample = result.sample;
  console.log('WEAVER_RIG_SAMPLE:', JSON.stringify({ atlasRequested, ...sample }));
  if (!atlasRequested) throw new Error('Weaver rig atlas PNG was not requested by the runtime.');
  if (sample.weaver.rigLegs !== 8) throw new Error(`Expected 8 IK legs, got ${sample.weaver.rigLegs}.`);
  if (sample.nonBlackPct < 2) throw new Error(`Weaver crop appears blank: ${sample.nonBlackPct.toFixed(2)}% non-black.`);
  if (sample.cyanCrystalPct < 0.05 || sample.blueCrystalPct < 0.02) {
    throw new Error(
      `Weaver rig atlas colors not visible enough: cyan=${sample.cyanCrystalPct.toFixed(3)}%, ` +
        `blue=${sample.blueCrystalPct.toFixed(3)}%.`,
    );
  }
  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  console.log(`PASS - image-backed Weaver rig rendered; screenshot ${outDir}/weaver-rig-sprites.png`);
} finally {
  await browser.close();
}
