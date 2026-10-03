// Reproducible art review in the real renderer. Usage: node scripts/capture-fidelity.mjs [url] [label]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5182/';
const label = process.argv[3] ?? 'after';
const dir = 'verify-out/fidelity';
mkdirSync(dir, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${url}?link=off`, { waitUntil: 'networkidle', timeout: 40000 });
  await leaveTitleIfShown(page);
  await page.addStyleTag({ content: '#wave-banner, #toast-stack, .hint-teach-overlay { visibility: hidden !important; }' });
  await waitForConsoleApi(page);
  await page.evaluate(async () => {
    await window.__game.ctx.console.exec('run test --level d1 --world campaign-level --seed 1337 --loadout advanced');
  });
  await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd1');
  await page.waitForTimeout(1800);
  const manifest = [];
  for (const [name, x, y] of [['sluice', 803, 366], ['intake', 250, 307], ['garden', 420, 815]]) {
    const state = await page.evaluate(async ({ x, y }) => {
      const ctx = window.__game.ctx;
      const { VIEW_W, VIEW_H } = await import('/src/config/constants.ts');
      document.querySelectorAll('#card-offer-overlay.visible').forEach(e => e.classList.remove('visible'));
      ctx.state.paused = true;
      document.getElementById('level-curtain')?.classList.remove('visible');
      Object.assign(ctx.player, { x, y, vx: 0, vy: 0, grounded: true, invuln: 0 });
      Object.assign(ctx.input.mouse, { x: x + 70, y: y - 9 });
      ctx.state.score = 892;
      for (let i = 0; i < 6; i++) window.__game.tick(false, { forcePaused: true });
      Object.assign(ctx.camera, { x: x - VIEW_W / 2, y: y - VIEW_H * .58, renderX: Math.round(x - VIEW_W / 2), renderY: Math.round(y - VIEW_H * .58) });
      ctx.state.frameCount = 420;
      document.getElementById('wave-banner')?.classList.remove('show');
      document.getElementById('toast-stack').replaceChildren();
      ctx.events.emit('levelCurtain', { visible: false });
      return { name: ctx.levels.current.def.name, seed: ctx.state.worldSeed, camera: { x: ctx.camera.renderX, y: ctx.camera.renderY }, frame: ctx.state.frameCount, post: { ...ctx.state.postFx }, render: ctx.state.render };
    }, { x, y });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/${label}-${name}.png` });
    manifest.push({ view: name, ...state });
    if (name === 'sluice') {
      await page.evaluate(() => { window.__game.ctx.state.postFx.enabled = false; });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/${label}-${name}-no-post.png` });
      await page.evaluate(() => { window.__game.ctx.state.postFx.enabled = true; });
    }
  }
  writeFileSync(`${dir}/${label}-manifest.json`, JSON.stringify({ manifest, errors }, null, 2));
  console.log(JSON.stringify({ label, cameras: manifest.map(m => ({ view: m.view, camera: m.camera })), errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
