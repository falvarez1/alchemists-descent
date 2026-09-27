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

const clean = args.includes('--clean');
async function shot(name) {
  if (clean) {
    // Hero shots: hide every DOM overlay so only the rendered world shows.
    await page.evaluate(() => {
      const canvas = document.querySelector('#canvas-holder > canvas');
      for (const el of document.body.querySelectorAll('*')) {
        if (el === canvas || el.contains(canvas) || !(el instanceof HTMLElement)) continue;
        el.style.visibility = 'hidden';
      }
    });
  }
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
    // Unpaused while stepping (mechanisms and devices skip paused ticks); the
    // real-time loop cannot run meanwhile, and the frame is frozen after.
    ctx.state.paused = false;
    for (let t = 0; t < ticks; t++) {
      if (pose) {
        if (pose.x !== undefined) { p.x = pose.x; p.vx = 0; }
        if (pose.y !== undefined) { p.y = pose.y; p.vy = 0; }
        if (pose.aimX !== undefined) { ctx.input.mouse.x = pose.aimX; ctx.input.mouse.y = pose.aimY; }
        if (pose.faceKind) {
          // Hold a subject still and facing the alchemist (a sight test, not a chase).
          for (const e of ctx.enemies) if (e.kind === pose.faceKind && e.y > 900 && e.x < 900 && e.mind) { e.mind.facing = Math.sign(p.x - e.x) || 1; e.vx = 0; }
        }
      }
      game.tick(true, { forcePaused: true });
    }
    ctx.state.paused = true;
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
    c.camera.snapTo(x, y);
    c.camera.zoom = zoom;
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

  if (scenes.includes('readable')) {
    // Comfort: high-readability lighting keeps half the designed darkness.
    await startLevel('d1');
    await page.evaluate(() => { window.__game.ctx.state.highReadability = true; });
    const pose = { x: 470, y: 1008, aimX: 700, aimY: 990 };
    await frame(560, 962, 1.3);
    await hold(40, pose);
    await shot(`readable-undertow-${compose}`);
    await page.evaluate(() => { window.__game.ctx.state.highReadability = false; });
    await resume();
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
    await frame(px + 40, py - 24, 2.2);
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
    const still = { x: px, y: py, aimX: px - 60, aimY: py - 60, faceKind: 'weaver' };
    await frame(px + 55, py - 30, 2.2);
    await hold(30, still);
    await faceWeaver();
    await hold(12, still);
    await shot(`hood-1-open-${compose}`);
    results.hoodOpen = await readW();
    await page.keyboard.press('KeyL');
    await hold(24, still);
    await faceWeaver();
    await hold(12, still);
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

  if (scenes.includes('vault')) {
    // The Lamplighter's Lock (floor 3: twin timed lenses on one oneShot gate).
    const level = opt('vault-level', 'd3');
    await startLevel(level);
    const info = await page.evaluate(() => {
      const rt = window.__game.ctx.levels.current;
      const lenses = rt.mechanisms.filter((m) => m.sensorType === 'light');
      const gate = rt.mechanisms.find((m) => m.id === lenses[0]?.targetId);
      return { lenses: lenses.map((m) => ({ x: m.x, y: m.y, id: m.id, latch: m.latch })), gate: gate ? { x: gate.x, y: gate.y, w: gate.w, h: gate.h, id: gate.id } : null };
    });
    results.vault = info;
    if (!info.gate || info.lenses.length === 0) throw new Error('no vault');
    const floor = info.gate.y + info.gate.h - 1;
    const midX = info.lenses.length > 1 ? Math.round((info.lenses[0].x + info.lenses[1].x) / 2) : info.gate.x - 40;
    const pose = (ax, ay) => ({ x: midX, y: floor, aimX: ax, aimY: ay });
    await hold(40, pose(midX, floor - 60));
    await frame(midX, floor - 30, 1.35);
    await hold(10, pose(midX, floor - 60));
    await shot(`vault-1-dark-${compose}`);
    const [a, b] = info.lenses;
    await hold(100, pose(a.x, a.y));
    await shot(`vault-2-lens-a-${compose}`);
    results.vaultAfterA = await page.evaluate((ids) => window.__game.ctx.levels.current.mechanisms.filter((m) => ids.includes(m.id)).map((m) => ({ id: m.id, state: m.state, reading: m.reading })), [a.id, info.gate.id]);
    if (b) await hold(100, pose(b.x, b.y));
    await hold(50, pose(info.gate.x, floor - 10));
    await shot(`vault-3-open-${compose}`);
    results.vaultDone = await page.evaluate((id) => window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id)?.state, info.gate.id);
    if (results.vaultDone !== 1) failed = true;
    await resume();
  }

  if (scenes.includes('bloom')) {
    // The Bloom Crossing: light the near heart, then the far one, cross, and
    // watch the bridge furl behind.
    const level = opt('bloom-level', 'd2');
    await startLevel(level);
    const blooms = await page.evaluate(() => (window.__game.ctx.levels.current.lumenBlooms ?? []).map((b) => ({ x: b.x, y: b.y, dir: b.dir, n: b.petals.length })));
    results.blooms = blooms;
    if (blooms.length < 2) throw new Error('no blooms');
    const [near, far] = blooms;
    const standX = near.x - 14 * near.dir, standY = near.y + 2;
    const pose = (ax, ay) => ({ x: standX, y: standY, aimX: ax, aimY: ay });
    await hold(40, pose(standX - 40 * near.dir, standY - 30));
    await frame((near.x + far.x) / 2, near.y - 4, Math.min(1.8, 560 / Math.abs(far.x - near.x + 60)));
    await hold(10, pose(standX - 40 * near.dir, standY - 30));
    await shot(`bloom-1-dark-${compose}`);
    await hold(60, pose(near.x, near.y));
    await shot(`bloom-2-near-open-${compose}`);
    await hold(60, pose(far.x, far.y));
    await shot(`bloom-3-bridge-${compose}`);
    results.bloomOpen = await page.evaluate(() => window.__game.ctx.levels.current.lumenBlooms.map((b) => ({ open: +b.open.toFixed(2), shown: b.shown })));
    // Walk across with REAL input (held key), lantern kept on the far heart.
    const walked = await page.evaluate(({ far, dir }) => {
      const game = window.__game, ctx = game.ctx, p = ctx.player;
      ctx.state.paused = false;
      const key = dir > 0 ? 'right' : 'left';
      let t = 0;
      for (; t < 240; t++) {
        ctx.input.keys[key] = true;
        ctx.input.mouse.x = far.x; ctx.input.mouse.y = far.y;
        game.tick(true, { forcePaused: true });
        if ((dir > 0 && p.x > far.x + 6) || (dir < 0 && p.x < far.x - 6)) break;
      }
      ctx.input.keys[key] = false;
      ctx.state.paused = true;
      return { t, x: Math.round(p.x), y: Math.round(p.y), grounded: p.grounded };
    }, { far, dir: near.dir });
    results.walked = walked;
    await hold(6, { aimX: far.x + 60 * near.dir, aimY: far.y - 20 });
    await shot(`bloom-4-crossed-${compose}`);
    await hold(420, { aimX: far.x + 60 * near.dir, aimY: far.y - 40 });
    await shot(`bloom-5-furled-${compose}`);
    results.bloomFurled = await page.evaluate(() => window.__game.ctx.levels.current.lumenBlooms.map((b) => ({ open: +b.open.toFixed(2), shown: b.shown })));
    await resume();
  }

  if (scenes.includes('cache')) {
    // D1: the Undertow's lens-locked cache.
    await startLevel('d1');
    const c = await page.evaluate(() => {
      const rt = window.__game.ctx.levels.current;
      const lens = rt.mechanisms.find((m) => m.sensorType === 'light');
      const lid = rt.mechanisms.find((m) => m.id === lens.targetId);
      return { lens: { x: lens.x, y: lens.y }, lid: { x: lid.x, y: lid.y, w: lid.w, id: lid.id } };
    });
    results.cache = c;
    const px = c.lid.x + c.lid.w + 30, py = 1008;
    await frame((c.lens.x + px) / 2, 962, 1.9);
    await hold(30, { x: px, y: py, aimX: px + 60, aimY: py - 30 });
    await hold(8, { x: px, y: py, aimX: px + 60, aimY: py - 30 });
    await shot(`cache-1-dark-${compose}`);
    await hold(100, { x: px, y: py, aimX: c.lens.x, aimY: c.lens.y });
    await hold(40, { x: px, y: py, aimX: c.lid.x, aimY: c.lid.y + 6 });
    await shot(`cache-2-open-${compose}`);
    results.cacheOpen = await page.evaluate((id) => window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id)?.state, c.lid.id);
    if (results.cacheOpen !== 1) failed = true;
    await resume();
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  try {
    results.backend = await page.evaluate(() => { const st = window.__game?.renderer?.getBackendStatus?.(); return st ? { actual: st.actual, compose: st.webgpu?.compose?.bridge ?? null, gpuCompose: window.__game.ctx.state.postFx.gpuCompose } : null; });
  } catch { /* page closed */ }
  console.log(JSON.stringify(results, null, 1));
  if (errors.length) { console.error('PAGE ERRORS:', errors.slice(0, 8)); failed = true; }
  await browser.close();
  process.exit(failed ? 1 : 0);
}
