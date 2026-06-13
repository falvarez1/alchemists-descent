// Focused wall-climbing probe.
// Usage: node scripts/verify-climbing.mjs [url]  (dev server running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1200);

const setupWallScene = async (rough = false) =>
  page.evaluate((roughWall) => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const Stone = 12;
    const stoneColor = 0x777777;
    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.state.playerSpawned = true;
    w.clear();
    w.simBounds.x0 = 70;
    w.simBounds.y0 = 70;
    w.simBounds.x1 = 150;
    w.simBounds.y1 = 190;
    for (let y = 94; y <= 178; y++) {
      for (let x = 105; x <= 110; x++) {
        const i = w.idx(x, y);
        w.types[i] = Stone;
        w.colors[i] = stoneColor;
      }
    }
    if (roughWall) {
      for (const [x, y] of [
        [104, 147],
        [104, 143],
        [104, 139],
        [104, 135],
        [104, 131],
        [103, 145],
        [103, 136],
      ]) {
        const i = w.idx(x, y);
        w.types[i] = Stone;
        w.colors[i] = stoneColor;
      }
    }
    for (let x = 74; x <= 148; x++) {
      for (let y = 181; y <= 184; y++) {
        const i = w.idx(x, y);
        w.types[i] = Stone;
        w.colors[i] = stoneColor;
      }
    }
    const p = ctx.player;
    p.x = 100;
    p.y = 150;
    p.fx = p.fy = 0;
    p.vx = 0;
    p.vy = 1.2;
    p.hp = p.maxHp;
    p.dead = false;
    p.inLiquid = false;
    p.crawling = false;
    p.climbing = false;
    p.climbT = 0;
    p.climbPhase = 0;
    p.climbMoveT = 0;
    p.wallGrabT = 0;
    p.pullT = 0;
    p.recharge = 0;
    p.firing = false;
    ctx.input.keys.left = false;
    ctx.input.keys.right = false;
    ctx.input.keys.up = false;
    ctx.input.keys.jump = false;
    ctx.input.keys.wallJump = false;
    ctx.input.keys.down = false;
    ctx.input.keys.grab = false;
    ctx.input.siphonHeld = ctx.input.pourHeld = ctx.input.drinkHeld = false;
    return { x: p.x, y: p.y };
  }, rough);

const player = () =>
  page.evaluate(() => {
    const p = window.__game.ctx.player;
    return {
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      climbing: p.climbing,
      climbDir: p.climbDir,
      climbIntentY: p.climbIntentY,
      climbPhase: p.climbPhase,
      firing: p.firing,
    };
  });

await setupWallScene();
await page.waitForTimeout(180);
check('does not auto-stick without grab', !(await player()).climbing);

await page.keyboard.down('ShiftLeft');
await page.waitForFunction(() => window.__game.ctx.player.climbing === true, { timeout: 2500 });
let p = await player();
check('Shift attaches to right wall', p.climbing && p.climbDir === 1, JSON.stringify(p));
check('climbing clears firing', p.firing === false, JSON.stringify(p));

const y0 = p.y;
await page.keyboard.down('KeyW');
await page.waitForTimeout(520);
p = await player();
check('W climbs upward', p.y < y0, `${y0} -> ${p.y}`);
check('up climb intent is exposed', p.climbIntentY === -1, JSON.stringify(p));
await page.keyboard.up('KeyW');

const y1 = p.y;
await page.keyboard.down('KeyS');
await page.waitForTimeout(430);
p = await player();
check('S climbs downward', p.y > y1, `${y1} -> ${p.y}`);
check('down climb intent is exposed', p.climbIntentY === 1, JSON.stringify(p));
await page.keyboard.up('KeyS');

await page.keyboard.up('ShiftLeft');
await page.waitForFunction(() => window.__game.ctx.player.climbing === false, { timeout: 2500 });
p = await player();
check('releasing grab drops the wall', !p.climbing, JSON.stringify(p));

await setupWallScene();
await page.keyboard.down('ShiftLeft');
await page.waitForFunction(() => window.__game.ctx.player.climbing === true, { timeout: 2500 });
await page.keyboard.down('Space');
await page.waitForTimeout(160);
await page.keyboard.up('Space');
p = await player();
check('Space wall-jumps away', !p.climbing && p.x < 100 && p.vy < 0, JSON.stringify(p));
await page.keyboard.up('ShiftLeft');

await setupWallScene(true);
await page.keyboard.down('ShiftLeft');
await page.waitForFunction(() => window.__game.ctx.player.climbing === true, { timeout: 2500 });
p = await player();
const roughY0 = p.y;
await page.keyboard.down('KeyW');
await page.waitForTimeout(760);
p = await player();
check('rough wall chips do not block upward climbing', p.climbing && p.y < roughY0 - 3, `${roughY0} -> ${p.y}`);
await page.keyboard.up('KeyW');
const roughY1 = p.y;
await page.keyboard.down('KeyS');
await page.waitForTimeout(560);
p = await player();
check('rough wall chips do not block downward climbing', p.climbing && p.y > roughY1 + 2, `${roughY1} -> ${p.y}`);
await page.keyboard.up('KeyS');
await page.keyboard.up('ShiftLeft');

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nclimbing probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
