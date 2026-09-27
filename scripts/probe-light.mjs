// Light wave probe (docs/FEEL.md §10): designed darkness, eyeshine, the hooded
// lantern, creatures answering the beam, and the light puzzles — in the real
// game, real renderer. Screenshots land in verify-out/light/.
// Usage: node scripts/probe-light.mjs [url] [--scenes undertow,reveal,...] [--seed 777] [--compose gpu|cpu]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const seed = Number(opt('seed', '777'));
const scenes = opt('scenes', 'undertow').split(',');
const compose = opt('compose', 'gpu');
const out = opt('out', 'verify-out/light');
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const results = {};
let failed = false;
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function shot(name) {
  await page.waitForTimeout(60);
  await page.locator('#canvas-holder > canvas').first().screenshot({ path: `${out}/${name}.png` });
}

/**
 * Run `ticks` real game ticks (each one rendered, so the light field the
 * gameplay reads is rebuilt exactly as in play) with the player posed each
 * tick, then leave the game paused on that frame for the screenshot.
 */
async function hold(ticks, pose) {
  await page.evaluate(({ ticks, pose }) => {
    const game = window.__game, ctx = game.ctx, p = ctx.player;
    ctx.state.paused = true;
    for (let t = 0; t < ticks; t++) {
      if (pose) {
        if (pose.x !== undefined) { p.x = pose.x; p.vx = 0; }
        if (pose.y !== undefined) { p.y = pose.y; p.vy = 0; }
        if (pose.aimX !== undefined) { ctx.input.mouse.x = pose.aimX; ctx.input.mouse.y = pose.aimY; }
      }
      game.tick(true, { forcePaused: true });
    }
  }, { ticks, pose });
}
async function resume() {
  await page.evaluate(() => { window.__game.ctx.state.paused = false; });
}

async function frame(x, y, zoom = 1.6) {
  await page.evaluate(({ x, y, zoom }) => {
    const c = window.__game.ctx;
    c.camera.zoomLock = zoom;
    c.camera.actionFocus = { x, y, zoom };
  }, { x, y, zoom });
}

async function startLevel(level) {
  await execConsoleCommand(page, `run test --level ${level} --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  await page.waitForTimeout(1200);
  await page.evaluate((compose) => {
    const ctx = window.__game.ctx;
    ctx.state.postFx.gpuCompose = compose === 'gpu';
    ctx.state.debugGodMode = true;
    ctx.player.hp = ctx.player.maxHp = 99999;
  }, compose);
  // Let the level title card clear (real-time CSS).
  await page.waitForTimeout(4800);
}

try {
  await page.goto(url);
  await waitForConsoleApi(page);

  if (scenes.includes('undertow')) {
    await startLevel('d1');
    // Stand in the Undertow, aim the beam down the trough.
    const pose = { x: 470, y: 1008, aimX: 700, aimY: 990 };
    await hold(90, pose);
    await frame(560, 960, 1.3);
    await hold(40, pose);
    await shot(`undertow-${compose}`);
    results.undertow = await page.evaluate(() => {
      const ctx = window.__game.ctx, q = ctx.lightQuery;
      return {
        dark: q?.darkness(470, 990), darkMid: q?.darkness(620, 950), darkOut: q?.darkness(200, 300),
        levelFar: q?.level(800, 990), levelNear: q?.level(480, 1000), wandNear: q?.wandLight(480, 1000), wandAim: q?.wandLight(560, 996),
      };
    });
  }

  if (scenes.includes('reveal')) {
    // THE MOMENT: a black cave, two green eyes, the beam sweeps, a Weaver
    // resolves out of the dark and flinches.
    await startLevel('d1');
    const setup = await page.evaluate(() => {
      const ctx = window.__game.ctx;
      const w = ctx.enemies.find((e) => e.kind === 'weaver' && e.y > 900);
      if (!w) return { error: 'no undertow weaver' };
      w.sleeping = false;
      return { wx: w.x, wy: w.y };
    });
    if (setup.error) throw new Error(setup.error);
    const px = setup.wx - 72, py = 1008;
    // 1) Lantern aimed away: the Weaver is only its eyes and glowing leg tips.
    await hold(70, { x: px, y: py, aimX: px - 120, aimY: py - 30 });
    await frame(px + 40, py - 24, 2.6);
    await hold(24, { x: px, y: py, aimX: px - 120, aimY: py - 30 });
    await shot(`reveal-1-eyes-${compose}`);
    results.eyes = await page.evaluate(() => {
      const ctx = window.__game.ctx, w = ctx.enemies.find((e) => e.kind === 'weaver' && e.y > 900);
      return { dark: ctx.lightQuery.darkness(w.x, w.y - 10), wand: w.lightSense?.wand, lid: w.expression?.lid };
    });
    // 2) The beam sweeps onto it: the first frames of the reveal.
    const aimW = await page.evaluate(() => { const w = window.__game.ctx.enemies.find((e) => e.kind === 'weaver' && e.y > 900); return { x: w.weaverLoco?.px ?? w.x, y: w.weaverLoco?.py ?? w.y - 10 }; });
    for (let k = 1; k <= 3; k++) {
      await hold(1, { x: px, y: py, aimX: px - 120 + (aimW.x - px + 120) * k / 3, aimY: py - 30 + (aimW.y - py + 30) * k / 3 });
    }
    await hold(2, { x: px, y: py, aimX: aimW.x, aimY: aimW.y });
    await shot(`reveal-2-beam-${compose}`);
    await hold(10, { x: px, y: py, aimX: aimW.x, aimY: aimW.y });
    await shot(`reveal-3-flinch-${compose}`);
    results.flinch = await page.evaluate(() => {
      const w = window.__game.ctx.enemies.find((e) => e.kind === 'weaver' && e.y > 900);
      return { wand: w.lightSense?.wand, beam: w.lightSense?.beam, flinchT: w.weaverFlinchT, retreatT: w.weaverRetreatT, visible: w.mind?.visible, conf: w.mind?.confidence };
    });
    await resume();
  }

  if (scenes.includes('hood')) {
    // The hooded lantern: a Weaver across the Undertow floor, lantern open
    // then hooded with a REAL key press. Sight should collapse to close range.
    await startLevel('d1');
    const px = 430, py = 1008, wx = 545;
    await page.evaluate(({ wx }) => {
      const ctx = window.__game.ctx;
      for (let i = ctx.enemies.length - 1; i >= 0; i--) { const e = ctx.enemies[i]; if (e.y > 850 && e.x < 960) ctx.enemies.splice(i, 1); }
      const w = ctx.enemyCtl.spawn('weaver', wx, 1006);
      w.sleeping = false;
    }, { wx });
    const faceWeaver = async () => page.evaluate((px) => {
      const w = window.__game.ctx.enemies.find((e) => e.kind === 'weaver' && e.y > 900 && e.x < 900);
      if (w.mind) { w.mind.facing = Math.sign(px - w.x); w.mind.confidence = 0; w.mind.visible = false; w.mind.irritation = 0; }
      w.vx = 0;
    }, px);
    const readW = async () => page.evaluate(() => {
      const ctx = window.__game.ctx, w = ctx.enemies.find((e) => e.kind === 'weaver' && e.y > 900 && e.x < 900);
      return { hooded: ctx.lightQuery.hooded, visible: w.mind?.visible, conf: +(w.mind?.confidence ?? 0).toFixed(2), dist: Math.round(Math.abs(w.x - ctx.player.x)), wand: +ctx.lightQuery.wandLight(w.x, w.y - 10).toFixed(3) };
    });
    await hold(30, { x: px, y: py, aimX: px - 60, aimY: py - 60 });
    await faceWeaver();
    await hold(8, { x: px, y: py, aimX: px - 60, aimY: py - 60 });
    await frame(px + 55, py - 30, 2.2);
    await hold(4, { x: px, y: py, aimX: px - 60, aimY: py - 60 });
    await shot(`hood-1-open-${compose}`);
    results.hoodOpen = await readW();
    await page.keyboard.press('KeyL');
    await hold(24, { x: px, y: py, aimX: px - 60, aimY: py - 60 });
    await faceWeaver();
    await hold(12, { x: px, y: py, aimX: px - 60, aimY: py - 60 });
    await shot(`hood-2-hooded-${compose}`);
    results.hooded = await readW();
    await page.keyboard.press('KeyL');
    await hold(20, { x: px, y: py, aimX: px - 60, aimY: py - 60 });
    results.unhooded = await page.evaluate(() => window.__game.ctx.lightQuery.hooded);
    if (results.hoodOpen.visible !== true || results.hooded.visible !== false || results.hooded.hooded !== true || results.unhooded !== false) failed = true;
    await resume();
  }

  if (scenes.includes('recoil')) {
    // Creatures answering the beam in the Undertow: a roost scatters, a Root
    // Loper freezes under the light and creeps in the dark, a slime follows the beam.
    await startLevel('d1');
    await page.evaluate(() => {
      const ctx = window.__game.ctx;
      // Clear the Undertow's residents so the subjects read alone.
      for (let i = ctx.enemies.length - 1; i >= 0; i--) { const e = ctx.enemies[i]; if (e.y > 850 && e.x < 960) ctx.enemies.splice(i, 1); }
    });
    const px = 470, py = 1008;
    const spawned = await page.evaluate(({ px }) => {
      const ctx = window.__game.ctx;
      const bats = [];
      for (let i = 0; i < 4; i++) {
        const b = ctx.enemyCtl.spawn('bat', px + 96 + i * 7, 900, { exact: true });
        if (b) { b.sleeping = true; b.vx = b.vy = 0; bats.push(b); }
      }
      const loper = ctx.enemyCtl.spawn('rootloper', px + 170, 1006);
      const slime = ctx.enemyCtl.spawn('slime', px + 250, 1006);
      if (slime?.mind) slime.mind.facing = 1;
      return { bats: bats.length, loper: !!loper, slime: !!slime };
    }, { px });
    results.spawned = spawned;
    // Roost in the dark first (red eyes only).
    await hold(30, { x: px, y: py, aimX: px + 40, aimY: py - 4 });
    await frame(px + 60, py - 50, 1.7);
    await hold(10, { x: px, y: py, aimX: px + 40, aimY: py - 4 });
    await shot(`recoil-1-roost-dark-${compose}`);
    // Sweep the beam up onto the roost.
    await hold(6, { x: px, y: py, aimX: px + 110, aimY: 896 });
    await shot(`recoil-2-roost-lit-${compose}`);
    await hold(18, { x: px, y: py, aimX: px + 110, aimY: 896 });
    await shot(`recoil-3-scatter-${compose}`);
    results.bats = await page.evaluate(() => window.__game.ctx.enemies.filter((e) => e.kind === 'bat' && e.y > 850)
      .map((b) => ({ sleeping: !!b.sleeping, fleeT: b.fleeT ?? 0, x: Math.round(b.x), y: Math.round(b.y) })));
    // The lurker: aim at it — frozen; aim away — it creeps.
    const loperPos = async () => page.evaluate(() => { const l = window.__game.ctx.enemies.find((e) => e.kind === 'rootloper' && e.y > 850); return l ? { x: +l.x.toFixed(1), frozen: l.lightSense?.frozen ?? 0, lid: +(l.expression?.lid ?? 0).toFixed(2), alerted: !!l.alerted } : null; });
    const l0 = await loperPos();
    await hold(90, { x: px, y: py, aimX: px + 170, aimY: py - 10 });
    const l1 = await loperPos();
    await shot(`recoil-4-lurker-frozen-${compose}`);
    await hold(90, { x: px, y: py, aimX: px - 140, aimY: py - 60 });
    const l2 = await loperPos();
    results.lurker = { start: l0, lit90: l1, dark90: l2 };
    // Phototaxis: the slime follows the beam's spot.
    const s0 = await page.evaluate(() => Math.round(window.__game.ctx.enemies.find((e) => e.kind === 'slime' && e.y > 850)?.x ?? -1));
    const calm = async () => page.evaluate(() => { const sl = window.__game.ctx.enemies.find((e) => e.kind === 'slime' && e.y > 850); if (sl?.mind) { sl.mind.confidence = 0; sl.mind.facing = 1; sl.alerted = false; } });
    for (let k = 0; k < 10; k++) { await calm(); await hold(20, { x: px, y: py, aimX: px + 380, aimY: py + 2 }); }
    const s1 = await page.evaluate(() => Math.round(window.__game.ctx.enemies.find((e) => e.kind === 'slime' && e.y > 850)?.x ?? -1));
    results.slime = { start: s0, after: s1, spot: await page.evaluate(() => window.__game.ctx.lightQuery && null) };
    await resume();
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  console.log(JSON.stringify(results, null, 1));
  if (errors.length) { console.error('PAGE ERRORS:', errors.slice(0, 8)); failed = true; }
  await browser.close();
  process.exit(failed ? 1 : 0);
}
