// Machine primitives end-to-end (docs/MACHINE-PRIMITIVES-AND-STRUCTURES-PLAN.md):
// real-browser probes that prove what unit tests cannot — the SIM driving the
// chains. Fire actually burns the wooden plug, sand actually falls onto the
// counterweight, water actually pools over the liquid sensor. Run with the
// dev server up:  node scripts/verify-machines.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

let pass = 0,
  fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.click('#mode-play-btn');
await page.waitForTimeout(2500);

/* The arena helper: carve a sealed stone test chamber near the player,
 * teleport him onto its floor (>= 24 cells of headroom), snap the camera so
 * the sim window covers the rig, and clear any probe mechanisms (id >= 9000)
 * from earlier sections. Each probe destructures window.__arena(). */
await page.evaluate(() => {
  window.__arena = () => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const rt = ctx.levels.current;
    rt.mechanisms = rt.mechanisms.filter((m) => m.id < 9000);
    const AX = Math.max(80, Math.min(1500, Math.floor(ctx.player.x)));
    const AY = 320;
    const paint = (x0, y0, x1, y1, t, life = 0) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = w.idx(x, y);
          w.types[i] = t;
          w.life[i] = life;
          w.charge[i] = 0;
          w.colors[i] =
            t === 0 ? 0
            : t === 5 ? 0xff8030
            : t === 2 ? 0x1c8ce0
            : t === 1 ? 0xd2b34c
            : t === 4 ? 0x8a5a2b
            : t === 12 ? 0x8a8a92
            : t === 13 ? 0x606c8e
            : 0x707078;
        }
      }
    };
    const count = (x0, y0, x1, y1, t) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) if (w.types[w.idx(x, y)] === t) n++;
      }
      return n;
    };
    // sealed chamber: stone shell, hollow interior 100x44
    paint(AX - 52, AY - 24, AX + 52, AY + 24, 12);
    paint(AX - 50, AY - 22, AX + 50, AY + 20, 0);
    ctx.player.x = AX - 40;
    ctx.player.y = AY + 19;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.player.hp = ctx.player.maxHp;
    ctx.camera.snapTo(AX, AY);
    return { ctx, w, rt, AX, AY, paint, count };
  };
});

console.log('— valve: lever opens it, cells retract; release closes it —');
const valveProbe = await page.evaluate(async () => {
  const { ctx, w, rt, AX, AY, paint, count } = window.__arena();
  // a metal valve slab across a channel + a lever with stone footing
  paint(AX, AY + 10, AX + 3, AY + 12, 13);
  const valve = { id: 9001, kind: 'valve', x: AX, y: AY + 10, w: 4, h: 3, state: 0, targetId: -1, material: 13 };
  paint(AX - 21, AY + 21, AX - 19, AY + 21, 12);
  const lever = { id: 9002, kind: 'lever', x: AX - 20, y: AY + 20, w: 1, h: 1, state: 0, targetId: 9001,
    body: [[AX - 21, AY + 21], [AX - 20, AY + 21], [AX - 19, AY + 21]] };
  rt.mechanisms.push(valve, lever);
  const closed = count(AX, AY + 10, AX + 3, AY + 12, 13);
  lever.state = 1;
  await new Promise((r) => setTimeout(r, 700));
  const openState = valve.state, openCells = count(AX, AY + 10, AX + 3, AY + 12, 13);
  lever.state = 0;
  await new Promise((r) => setTimeout(r, 400));
  return { closed, openState, openCells, closedAgain: valve.state, reCells: count(AX, AY + 10, AX + 3, AY + 12, 13) };
});
check('closed valve stamps its cells', valveProbe.closed === 12, `cells=${valveProbe.closed}`);
check('lever opens the valve', valveProbe.openState === 1 && valveProbe.openCells === 0, JSON.stringify(valveProbe));
check('release closes it again', valveProbe.closedAgain === 0 && valveProbe.reCells === 12);

console.log('— plug: REAL fire burns the wood, the linked door opens —');
const plugProbe = await page.evaluate(async () => {
  const { ctx, w, rt, AX, AY, paint, count } = window.__arena();
  // wooden plug block + a door slab; fire set against the plug face
  const body = [];
  for (let y = AY + 8; y <= AY + 11; y++) for (let x = AX - 10; x <= AX - 7; x++) body.push([x, y]);
  paint(AX - 10, AY + 8, AX - 7, AY + 11, 4);
  const plug = { id: 9010, kind: 'plug', x: AX - 10, y: AY + 8, w: 4, h: 4, state: 0, targetId: 9011, material: 4 };
  plug.body = body;
  paint(AX + 20, AY + 8, AX + 22, AY + 19, 13);
  const door = { id: 9011, kind: 'door', x: AX + 20, y: AY + 8, w: 3, h: 12, state: 0, targetId: -1 };
  rt.mechanisms.push(plug, door);
  // torch it: fire cells hugging the plug's left face and top
  paint(AX - 12, AY + 7, AX - 11, AY + 12, 5, 250);
  paint(AX - 10, AY + 7, AX - 7, AY + 7, 5, 250);
  for (let t = 0; t < 50; t++) {
    await new Promise((r) => setTimeout(r, 100));
    if (plug.state === 1) break;
    // keep feeding the flame front (the sim eats fire fast in open air)
    paint(AX - 12, AY + 7, AX - 11, AY + 12, 5, 250);
  }
  return { plugFired: plug.state, doorOpen: door.state, reading: plug.reading, bodyLen: plug.body.length };
});
check('fire breaks the wooden plug', plugProbe.plugFired === 1, JSON.stringify(plugProbe));
check("the plug's door opens", plugProbe.doorOpen === 1);

console.log('— counterweight: REAL falling sand tips it permanently —');
const cwProbe = await page.evaluate(async () => {
  const { ctx, w, rt, AX, AY, paint, count } = window.__arena();
  // iron pan with lips on the arena floor (pan row + 4-tall lips)
  const body = [];
  for (let x = AX - 3; x <= AX + 3; x++) { paint(x, AY + 20, x, AY + 20, 13); body.push([x, AY + 20]); }
  for (const lx of [AX - 4, AX + 4]) for (let dy = 0; dy <= 3; dy++) { paint(lx, AY + 20 - dy, lx, AY + 20 - dy, 13); body.push([lx, AY + 20 - dy]); }
  const door = { id: 9021, kind: 'door', x: AX + 30, y: AY + 8, w: 3, h: 12, state: 0, targetId: -1 };
  paint(AX + 30, AY + 8, AX + 32, AY + 19, 13);
  const cw = { id: 9020, kind: 'counterweight', x: AX - 3, y: AY + 20, w: 7, h: 1, state: 0, targetId: 9021,
    threshold: 20, zone: { x0: AX - 3, y0: AY + 13, x1: AX + 3, y1: AY + 19 } };
  cw.body = body;
  rt.mechanisms.push(cw, door);
  // pour: a sand block in the air above the pan
  paint(AX - 2, AY + 2, AX + 2, AY + 8, 1);
  for (let t = 0; t < 40; t++) {
    await new Promise((r) => setTimeout(r, 100));
    if (cw.state === 1) break;
  }
  const latched = cw.state;
  // scoop everything back out — the latch must hold
  paint(AX - 3, AY + 10, AX + 3, AY + 19, 0);
  await new Promise((r) => setTimeout(r, 400));
  return { latched, holds: cw.state, reading: cw.reading, doorOpen: door.state };
});
check('poured sand tips the counterweight', cwProbe.latched === 1, JSON.stringify(cwProbe));
check('the latch is permanent (scooping it out does nothing)', cwProbe.holds === 1 && cwProbe.doorOpen === 1);

console.log('— sensor chain: REAL water pools over a liquid sensor, valve opens —');
const sensorProbe = await page.evaluate(async () => {
  const { ctx, w, rt, AX, AY, paint, count } = window.__arena();
  // stone cup on the floor; the sensor watches the cup interior
  paint(AX - 8, AY + 16, AX - 8, AY + 20, 12);
  paint(AX + 8, AY + 16, AX + 8, AY + 20, 12);
  paint(AX - 8, AY + 20, AX + 8, AY + 20, 12);
  const sensor = { id: 9030, kind: 'sensor', x: AX, y: AY + 20, w: 1, h: 1, state: 0, targetId: 9031,
    sensorType: 'liquid', threshold: 8, latch: 'permanent',
    zone: { x0: AX - 7, y0: AY + 14, x1: AX + 7, y1: AY + 19 } };
  paint(AX + 24, AY + 10, AX + 27, AY + 12, 13);
  const valve = { id: 9031, kind: 'valve', x: AX + 24, y: AY + 10, w: 4, h: 3, state: 0, targetId: -1, material: 13 };
  rt.mechanisms.push(sensor, valve);
  // rain a water block into the cup
  paint(AX - 3, AY + 4, AX + 3, AY + 8, 2);
  for (let t = 0; t < 40; t++) {
    await new Promise((r) => setTimeout(r, 100));
    if (valve.state === 1) break;
  }
  await new Promise((r) => setTimeout(r, 400)); // let the retraction finish
  return { sensed: sensor.state, reading: sensor.reading, valveOpen: valve.state,
    valveCells: count(AX + 24, AY + 10, AX + 27, AY + 12, 13) };
});
check('pooled water latches the liquid sensor', sensorProbe.sensed === 1, JSON.stringify(sensorProbe));
check('the sensed valve retracts its cells', sensorProbe.valveOpen === 1 && sensorProbe.valveCells === 0);

console.log('— relay: delayed BREAK demolishes a stone plug downstream —');
const relayProbe = await page.evaluate(async () => {
  const { ctx, w, rt, AX, AY, paint, count } = window.__arena();
  const body = [];
  for (let y = AY + 10; y <= AY + 12; y++) for (let x = AX + 10; x <= AX + 12; x++) body.push([x, y]);
  paint(AX + 10, AY + 10, AX + 12, AY + 12, 12);
  const plug = { id: 9042, kind: 'plug', x: AX + 10, y: AY + 10, w: 3, h: 3, state: 0, targetId: -1, material: 12 };
  plug.body = body;
  paint(AX - 21, AY + 21, AX - 19, AY + 21, 12);
  const lever = { id: 9040, kind: 'lever', x: AX - 20, y: AY + 20, w: 1, h: 1, state: 0, targetId: 9041,
    body: [[AX - 21, AY + 21], [AX - 20, AY + 21], [AX - 19, AY + 21]] };
  paint(AX - 1, AY + 19, AX + 1, AY + 19, 12);
  const relay = { id: 9041, kind: 'relay', x: AX, y: AY + 18, w: 1, h: 1, state: 0, targetId: 9042,
    delayFrames: 45, outputAction: 'break',
    body: [[AX - 1, AY + 19], [AX, AY + 19], [AX + 1, AY + 19]] };
  rt.mechanisms.push(plug, lever, relay);
  lever.state = 1;
  await new Promise((r) => setTimeout(r, 300));
  const earlyFired = relay.state, earlyPlug = plug.state; // fuse still burning
  await new Promise((r) => setTimeout(r, 1200));
  return { earlyFired, earlyPlug, fired: relay.state, plugFired: plug.state,
    plugCells: count(AX + 10, AY + 10, AX + 12, AY + 12, 12) };
});
check('the fuse delay holds before firing', relayProbe.earlyFired === 0 && relayProbe.earlyPlug === 0, JSON.stringify(relayProbe));
check('the relay fires once and demolishes the plug', relayProbe.fired === 1 && relayProbe.plugFired === 1 && relayProbe.plugCells === 0);

console.log('— fail-open: a wrecked relay groans, then counts as fired —');
const failProbe = await page.evaluate(async () => {
  const { ctx, w, rt, AX, AY, paint, count } = window.__arena();
  paint(AX - 1, AY + 19, AX + 1, AY + 19, 12);
  const relay = { id: 9050, kind: 'relay', x: AX, y: AY + 18, w: 1, h: 1, state: 0, targetId: 9051,
    body: [[AX - 1, AY + 19], [AX, AY + 19], [AX + 1, AY + 19]] };
  paint(AX + 30, AY + 8, AX + 32, AY + 19, 13);
  const door = { id: 9051, kind: 'door', x: AX + 30, y: AY + 8, w: 3, h: 12, state: 0, targetId: -1 };
  rt.mechanisms.push(relay, door);
  // vaporize the footing — the body watch should declare it broken
  paint(AX - 1, AY + 19, AX + 1, AY + 19, 0);
  let groaned = false;
  for (let t = 0; t < 20; t++) {
    await new Promise((r) => setTimeout(r, 100));
    if (relay.broken !== undefined && relay.broken > 0) { groaned = true; break; }
  }
  // fast-forward the 30s groan timer (the probe can't wait it out)
  if (groaned) relay.broken = 1;
  await new Promise((r) => setTimeout(r, 400));
  return { groaned, broken: relay.broken, doorOpen: door.state };
});
check('destroying the footing breaks the relay', failProbe.groaned === true, JSON.stringify(failProbe));
check('a dead relay fails open: its door falls open', failProbe.broken === 0 && failProbe.doorOpen === 1);

console.log('— worldgen: machine rooms appear in generated levels —');
const genProbe = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const placed = (ctx.levels.current.placedPrefabs ?? []).map((p) => p.id);
  const kinds = new Set(ctx.levels.current.mechanisms.map((m) => m.kind));
  return { placed, machine: placed.filter((id) => id.startsWith('machine-')), kinds: [...kinds] };
});
check(
  'd1 placed a machine room (budget [1,1])',
  genProbe.machine.length >= 1,
  JSON.stringify(genProbe),
);

await page.screenshot({ path: 'verify-out/machines-final.png' });
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nmachines: ${pass} ok, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
