// Verifies the body material layer (B1): material sets density (mass) + colour,
// and mass makes light wood fly far more than heavy metal from the same blast.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(800);

const out = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  // Materials are stored + coloured distinctly.
  ctx.state.mode = 'play';
  ctx.rigidBodies.clear();
  const wb = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, 300, 300, { material: 'wood' });
  const sb = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, 320, 300, { material: 'stone' });
  const mb = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, 340, 300, { material: 'metal' });
  const stored = {
    wood: wb.material, stone: sb.material, metal: mb.material,
    distinctColors: new Set([wb.color, sb.color, mb.color]).size === 3,
  };

  // Same blast, different material → light flies more.
  const blast = (material) => {
    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.fx.hitstop = 0;
    w.clear();
    w.simBounds.x0 = 200; w.simBounds.y0 = 420; w.simBounds.x1 = 520; w.simBounds.y1 = 560;
    ctx.player.x = 250; ctx.player.y = 460; ctx.player.dead = true;
    ctx.rigidBodies.clear();
    for (let x = 220; x <= 500; x++) for (let y = 500; y <= 508; y++) { const i = w.idx(x, y); w.types[i] = 12; w.colors[i] = 0x777777; }
    const b = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, 360, 470, { material });
    for (let f = 0; f < 110; f++) window.__game.tick();
    const x0 = b.x, y0 = b.y;
    ctx.explosions.trigger(Math.round(b.x + 8), Math.round(b.y), 30);
    for (let f = 0; f < 25; f++) window.__game.tick();
    return +Math.hypot(b.x - x0, b.y - y0).toFixed(1);
  };
  return { stored, woodDist: blast('wood'), metalDist: blast('metal') };
});

check('material is stored on the body', out.stored.wood === 'wood' && out.stored.stone === 'stone' && out.stored.metal === 'metal', JSON.stringify(out.stored));
check('materials get distinct colours', out.stored.distinctColors, JSON.stringify(out.stored));
check('light wood crate is flung by the blast', out.woodDist > 15, JSON.stringify(out));
check('heavy metal crate resists the same blast', out.metalDist < out.woodDist * 0.6, JSON.stringify(out));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nmaterials probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
