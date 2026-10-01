// Rusk Emberjaw on the REAL floor 1 (the Breathing Works' Intake): the oil-soaked, moss-caulked timber
// barricade that every other alchemist burns with a Spark Bolt. Played with real input from the spawn:
// walk up to it, press Z, and she must go through the timber - the plug (a route seal) fires, the doorway is
// open, and she is still on her feet. Asserts the consequences of ramming through caulked, oil-pocketed
// wood honestly (fire, oil, her armor and health), not just that she got through.
// Usage: node scripts/verify-fighter-rusk-works.mjs [url] [seed]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { makeChecker } from './fighter-probe.mjs';
import { execConsoleCommand, leaveTitleIfShown, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5195/';
const seed = Number(process.argv[3] ?? 777);
const tally = makeChecker();
const check = tally.check;
mkdirSync('verify-out/fighters', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
await leaveTitleIfShown(page);
await waitForConsoleApi(page);
await execConsoleCommand(page, `run test --level d1 --world campaign-level --seed ${seed} --loadout fresh`);
await waitForRunReady(page);
await page.waitForFunction(() => window.__game.ctx.enemyCtl, null, { timeout: 20000 });
await page.addStyleTag({ content: '#wave-banner, #toast-stack, .toast { display: none !important; }' });
await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.enemies.length = 0;
  ctx.fighters.equip('rusk-emberjaw');
  await ctx.fighters.whenReady();
});
// The opening's plates skip on any key: let the player have the floor.
await page.waitForFunction(() => !document.body.classList.contains('story-cinema-active'), null, { timeout: 45000 }).catch(() => undefined);
await page.waitForTimeout(2500); // the arrival grace

const ctxp = (fn, arg) => page.evaluate(fn, arg);
const px = () => ctxp(() => window.__game.ctx.player.x);

async function walkTo(x) {
  let p = await px(), last = p, still = 0;
  const key = p < x ? 'KeyD' : 'KeyA', sign = p < x ? 1 : -1;
  await page.keyboard.down(key);
  for (let i = 0; i < 120 && sign * (x - p) > 10; i++) {
    await page.waitForTimeout(100); p = await px();
    still = Math.abs(p - last) < 1 ? still + 1 : 0; last = p;
    if (still >= 3) { await page.keyboard.down('Space'); await page.waitForTimeout(380); await page.keyboard.up('Space'); still = 0; }
  }
  await page.keyboard.up(key);
  for (let i = 0; i < 30; i++) {
    p = await px();
    if (Math.abs(p - x) < 5) break;
    const k = p < x ? 'KeyD' : 'KeyA';
    await page.keyboard.down(k); await page.waitForTimeout(60); await page.keyboard.up(k); await page.waitForTimeout(80);
  }
}

// Aim at a world point with the real mouse (the cursor is the aim; she faces it).
async function pointAtWorld(worldX, worldY) {
  const target = await ctxp(({ worldX, worldY }) => {
    const ctx = window.__game.ctx;
    const canvas = document.querySelector('canvas[data-input-attached="true"]');
    const rect = canvas.getBoundingClientRect();
    const viewW = 640, viewH = 360, zoom = ctx.camera.zoom;
    const fracX = ctx.camera.x - Math.floor(ctx.camera.x), fracY = ctx.camera.y - Math.floor(ctx.camera.y);
    const scaleX = (1 + 4 / viewW) * zoom, scaleY = (1 + 4 / viewH) * zoom;
    const ndcX = -fracX * (2 / viewW) * zoom + ((worldX - ctx.camera.renderX) / viewW - .5) * 2 * scaleX;
    const ndcY = fracY * (2 / viewH) * zoom + (.5 - (worldY - ctx.camera.renderY) / viewH) * 2 * scaleY;
    return { x: rect.left + (ndcX + 1) * .5 * rect.width, y: rect.top + (1 - ndcY) * .5 * rect.height };
  }, { worldX, worldY });
  await page.mouse.move(target.x, target.y);
}

const B = { id: 8401, x0: 399, x1: 412, y0: 284, y1: 314 };
const state = () => ctxp((B) => {
  const c = window.__game.ctx, w = c.world, p = c.player, plug = c.levels.current.mechanisms.find((m) => m.id === B.id);
  let wood = 0, moss = 0, oil = 0, fire = 0, ember = 0;
  for (let y = B.y0 - 6; y <= B.y1 + 2; y++) for (let x = B.x0 - 6; x <= B.x1 + 6; x++) {
    const t = w.type(x, y);
    if (t === 4) wood++; else if (t === 34) moss++; else if (t === 6) oil++; else if (t === 5) fire++; else if (t === 20) ember++;
  }
  return { plug: plug?.state, wood, moss, oil, fire, ember, x: p.x, y: p.y, hp: +p.hp.toFixed(1), armor: +c.fighters.armor.toFixed(1), oiled: p.status.oiled, burning: p.status.burning, dead: p.dead };
}, B);

await walkTo(372);
await pointAtWorld(430, 300); // aim through the barricade: she faces right
await page.waitForTimeout(300);
const before = await state();
await page.screenshot({ path: 'verify-out/fighters/rusk-works-0-before.png' });
check('the barricade stands: the plug is armed, Wood and oil in its body', before.plug === 0 && before.wood > 250 && before.oil >= 4, JSON.stringify(before));
check('she has her full armor', before.armor === 40 && before.hp >= 99, `${before.armor} ${before.hp}`);

await page.keyboard.down('KeyZ');
await page.waitForTimeout(80);
await page.keyboard.up('KeyZ');
await page.waitForTimeout(250);
await page.screenshot({ path: 'verify-out/fighters/rusk-works-1-through.png' });
await page.waitForTimeout(700);
await page.screenshot({ path: 'verify-out/fighters/rusk-works-2-burning.png' });
const during = await state();
check('she went through the timber: clear of its east face', during.x > B.x1 + 1, `x ${during.x}`);
check('the barricade (a route seal) fired: its plug is latched', during.plug === 1, JSON.stringify(during));
check('she is alive', !during.dead && during.hp > 0, `hp ${during.hp}`);
check('the game agrees the barricade is solved (its objective moves on)', (await page.locator('#objective').innerText()) === 'Pull the engine crank.');
// Let the doorway burn out and judge the cost.
await page.waitForFunction((B) => {
  const w = window.__game.ctx.world; let f = 0;
  for (let y = B.y0 - 6; y <= B.y1 + 2; y++) for (let x = B.x0 - 6; x <= B.x1 + 8; x++) if (w.type(x, y) === 5) f++;
  return f < 6;
}, B, { timeout: 25000 }).catch(() => undefined);
const after = await state();
await page.screenshot({ path: 'verify-out/fighters/rusk-works-3-after.png' });
console.log('  measured: before', JSON.stringify(before), '\n            after ', JSON.stringify(after));
check('the doorway is open: she can walk back and forth through it', await (async () => {
  await walkTo(B.x0 - 12);
  const west = await px();
  await walkTo(B.x1 + 14);
  const east = await px();
  return west < B.x0 && east > B.x1;
})());
const cost = (before.hp - after.hp) + (before.armor - after.armor);
check('the ram did not set the oil-soaked timber alight: no fire, no health or armor lost', cost < 1 && after.fire === 0 && !after.dead, `lost ${cost.toFixed(1)} (hp ${before.hp} -> ${after.hp}, armor ${before.armor} -> ${after.armor})`);

await browser.close();
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\nrusk works probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);
