// Eyeball probe for the Intake's Bell & Tea Engine presentation: the crank
// with the alchemist beside it, the sluice handwheel framed in the right
// quarter and the bottom of a zoom-1 view (regression for the pop-in that
// culled it from the camera's corner instead of the view), and each bay.
// Usage: node scripts/shot-intake-machine.mjs [url] [outDir] [--run]
//   --run  pulls the crank with the real Use key, films the pull, then
//          captures every act of the chain reaction.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const url = args[0] ?? 'http://localhost:5199/';
const out = args[1] ?? 'verify-out/intake-machine';
const run = process.argv.includes('--run');
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const report = { url, errors, shots: [] };
const shot = async (name) => {
  const holder = await page.$('#canvas-holder');
  const b = await holder.boundingBox();
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: b.x, y: b.y, width: b.width, height: b.height } });
};
try {
  await page.goto(url);
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);

  const frame = async (fx, fy, zoom, name, ticks = 30) => {
    await page.evaluate(({ fx, fy, zoom, ticks }) => {
      const ctx = window.__game.ctx;
      ctx.camera.zoomLock = zoom;
      ctx.camera.setInspectionFocus(fx, fy, { snap: true });
      for (let f = 0; f < ticks; f++) window.__game.tick();
    }, { fx, fy, zoom, ticks });
    await page.waitForTimeout(120);
    await shot(name);
    const cam = await page.evaluate(() => ({ x: window.__game.ctx.camera.x, y: window.__game.ctx.camera.y, zoom: window.__game.ctx.camera.zoom }));
    report.shots.push({ name, focus: [fx, fy], zoom, camera: cam });
  };

  // The alchemist beside the crank on the inspection balcony.
  await page.evaluate(() => { const p = window.__game.ctx.player; p.x = 421; p.y = 311; p.vx = 0; p.vy = 0; p.facing = 1; });
  await frame(432, 298, 3, 'crank-and-player');
  await frame(428, 302, 4, 'player-closeup');
  // The handwheel in the right quarter, then at the bottom, of a zoom-1 view.
  await frame(350, 350, 1, 'handwheel-right-of-view');
  await frame(700, 208, 1, 'handwheel-bottom-of-view'); // clear of the HUD caption
  await frame(524, 360, 3.5, 'handwheel-closeup');
  // Machine bays at rest.
  await frame(560, 110, 1.6, 'bay-fuse-pendulum');
  await frame(780, 160, 1.6, 'bay-dominoes-spring');
  await frame(960, 170, 1.6, 'bay-duck-acid');
  await frame(1200, 140, 1.6, 'bay-sugar-kettle');
  await frame(1420, 150, 1.6, 'bay-finale');
  // The crank half-way through a pull (the sweep is simulated by setting the
  // pull timer the Use key would have started). Last, because the live loop
  // finishes the pull and starts the engine — the --run pass presses E itself.
  if (!run) {
    await page.evaluate(() => {
      const ctx = window.__game.ctx, m = ctx.levels.current.mechanisms.find(m => m.look === 'crank');
      m.pullT = 14; ctx.player.pullT = 14; ctx.player.pullDir = 1;
    });
    await frame(432, 298, 3, 'crank-midpull', 1);
  }

  if (run) {
    // Film the pull with the camera held on the crank, then release it to
    // the director for the acts.
    await page.evaluate(() => { const ctx = window.__game.ctx; ctx.camera.zoomLock = 2.5; ctx.camera.setInspectionFocus(432, 298, { snap: true }); });
    await page.keyboard.press('KeyE');
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(70); await shot(`pull-${String(i).padStart(2, '0')}`); }
    await page.evaluate(() => { const ctx = window.__game.ctx; ctx.camera.clearInspectionFocus(); ctx.camera.zoomLock = null; });
    await page.waitForFunction(() => window.__game.ctx.contraption.watching, null, { timeout: 10000 });
    let previous = -1;
    for (let i = 0; i < 160; i++) {
      const s = await page.evaluate(() => { const t = window.__game.ctx.levels.current.living.tea; return { stage: t.stage, completed: t.completed, stalled: t.stalled }; });
      if (s.stage !== previous) {
        previous = s.stage;
        await page.waitForTimeout(450);
        await shot(`act-${String(s.stage).padStart(2, '0')}`);
        report.shots.push({ name: `act-${s.stage}` });
      }
      if (s.completed || s.stalled) break;
      await page.waitForTimeout(500);
    }
    report.final = await page.evaluate(() => window.__game.ctx.levels.current.living.tea);
  }
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ shots: report.shots.length, errors, final: report.final?.stage }));
