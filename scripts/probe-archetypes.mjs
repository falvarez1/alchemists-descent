// Runtime probe for the two new Wave E puzzle archetypes:
//   FREEZE BRIDGE (archetype 4, frozen-biased): dig the hopper lip, nitrogen
//   rains, the trench freezes, the ice-census sensor fires, the door opens.
//   LIVE CIRCUIT (archetype 5, crystal/scorched-biased): a spark on the knob
//   with DRY slots dies at the first gap (negative test); pour water into
//   both slots and the same spark runs the rail home and latches the coil.
// Usage: node scripts/probe-archetypes.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));

let pass = 0,
  fail = 0;
const check = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  ok ? pass++ : fail++;
};

// Load a fresh expedition on a given seed and enter the given depth.
async function loadDepth(seed, id) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return await page.evaluate(
    async ({ SEED, ID }) => {
      localStorage.removeItem('noita-expedition');
      const ctx = window.__game.ctx;
      ctx.state.worldSeed = SEED;
      document.getElementById('mode-play-btn').click();
      await new Promise((r) => setTimeout(r, 1800));
      if (ID !== 'd1') {
        ctx.levels.leaveLevel();
        ctx.levels.enterLevel(ctx, ID);
        await new Promise((r) => setTimeout(r, 400));
      }
      const rt = ctx.levels.current;
      return rt ? { ok: true, id: rt.def.id } : { ok: false };
    },
    { SEED: seed, ID: id },
  );
}

// ---------------- FREEZE BRIDGE ----------------
// d3 is frozen; bias < 0.5 forces archetype 4, so ~half of all seeds carry it.
let freezeSeed = -1;
for (let seed = 1; seed <= 14 && freezeSeed < 0; seed++) {
  await loadDepth(seed, 'd3');
  const found = await page.evaluate(() => {
    const rt = window.__game.ctx.levels.current;
    const s = rt.mechanisms.find(
      (m) => m.kind === 'sensor' && m.materialFilter && m.materialFilter.includes(10), // Ice=10
    );
    return s ? { x: s.x, y: s.y } : null;
  });
  if (found) freezeSeed = seed;
}
check(freezeSeed > 0, 'freeze bridge generates on d3 within 14 seeds', `seed=${freezeSeed}`);

if (freezeSeed > 0) {
  const res = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const rt = ctx.levels.current;
    const w = ctx.world;
    const sensor = rt.mechanisms.find(
      (m) => m.kind === 'sensor' && m.materialFilter && m.materialFilter.includes(10),
    );
    const door = rt.mechanisms.find((m) => m.kind === 'door' && m.id === sensor.targetId);
    const z = sensor.zone;
    const count = (t, x0, y0, x1, y1) => {
      let n = 0;
      for (let Y = y0; Y <= y1; Y++)
        for (let X = x0; X <= x1; X++) if (w.types[w.idx(X, Y)] === t) n++;
      return n;
    };
    const px2 = sensor.x + 2, // chamber center from sensor placement
      py2 = sensor.y - 9;
    const water0 = count(2, z.x0, z.y0, z.x1, z.y1); // Water=2
    const drip = (rt.emitters ?? []).find(
      (e) => e.cell === 16 && Math.abs(e.x - (px2 - 2)) <= 2 && Math.abs(e.y - (py2 - 9)) <= 2,
    );
    // park the wizard in the chamber so the sim window covers it
    ctx.player.x = px2 + 9;
    ctx.player.y = py2 + 2;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    // NEGATIVE: with the tray intact the drops pool and evaporate — the
    // channel must stay essentially liquid
    await new Promise((r) => setTimeout(r, 5000));
    const iceTrayIntact = count(10, z.x0, z.y0, z.x1, z.y1);
    // break the catch-tray
    for (let dx = -4; dx <= 0; dx++) w.types[w.idx(px2 + dx, py2 - 6)] = 0;
    for (const dx of [-4, 0]) w.types[w.idx(px2 + dx, py2 - 7)] = 0;
    // poll up to 30s for the crust -> latch -> door retraction
    let ice = 0,
      latched = false,
      doorOpen = false;
    for (let t = 0; t < 150; t++) {
      await new Promise((r) => setTimeout(r, 200));
      ice = count(10, z.x0, z.y0, z.x1, z.y1); // Ice=10
      latched = sensor.state > 0;
      doorOpen = door.state === 1;
      if (doorOpen) break;
    }
    return {
      water0,
      hasDrip: !!drip,
      iceTrayIntact,
      ice,
      latched,
      doorOpen,
      threshold: sensor.threshold,
    };
  });
  check(res.water0 >= 20, 'trench holds open water', `water=${res.water0}`);
  check(res.hasDrip, 'nitrogen drip emitter present');
  check(
    res.iceTrayIntact < res.threshold,
    'tray intact: channel stays liquid (negative test)',
    `ice=${res.iceTrayIntact}`,
  );
  check(res.ice >= res.threshold, 'broken tray: the drip froze the channel', `ice=${res.ice}`);
  check(res.latched, 'ice sensor latched');
  check(res.doorOpen, 'freeze bridge door opened');
}

// ---------------- LIVE CIRCUIT ----------------
// d6 crystal / d7 scorched bias to archetype 5; d5 timber rolls it naturally.
// Signature: a pair of 1x3 valves on the same row exactly 5 apart, each
// driven by a lever — unique to the knife-switch rail (machine prefabs also
// carry chargelatches, so coil-sniffing alone can grab the wrong machine).
let circuit = null;
outer: for (const id of ['d6', 'd7', 'd5']) {
  for (let seed = 1; seed <= 10; seed++) {
    await loadDepth(seed, id);
    const found = await page.evaluate(() => {
      const rt = window.__game.ctx.levels.current;
      const valves = rt.mechanisms.filter((m) => m.kind === 'valve' && m.w === 1 && m.h === 3);
      for (const a of valves) {
        for (const b of valves) {
          if (b.x - a.x !== 5 || a.y !== b.y) continue;
          const la = rt.mechanisms.find((m) => m.kind === 'lever' && m.targetId === a.id);
          const lb = rt.mechanisms.find((m) => m.kind === 'lever' && m.targetId === b.id);
          if (la && lb) return { px2: a.x + 3, py2: a.y - 10 };
        }
      }
      return null;
    });
    if (found) {
      circuit = { id, seed };
      break outer;
    }
  }
}
check(!!circuit, 'live circuit generates on d5/d6/d7', circuit ? `${circuit.id} seed=${circuit.seed}` : '');

if (circuit) {
  const res = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const rt = ctx.levels.current;
    const w = ctx.world;
    // re-derive the chamber from the valve-pair signature
    let px2 = -1,
      py2 = -1;
    const allValves = rt.mechanisms.filter((m) => m.kind === 'valve' && m.w === 1 && m.h === 3);
    let valves = [];
    for (const a of allValves) {
      for (const b of allValves) {
        if (b.x - a.x !== 5 || a.y !== b.y) continue;
        const la = rt.mechanisms.find((m) => m.kind === 'lever' && m.targetId === a.id);
        const lb = rt.mechanisms.find((m) => m.kind === 'lever' && m.targetId === b.id);
        if (la && lb) {
          px2 = a.x + 3;
          py2 = a.y - 10;
          valves = [a, b];
        }
      }
    }
    if (px2 < 0) return { err: 'no valve pair' };
    const railY = py2 + 11;
    const coil = rt.mechanisms.find(
      (m) => m.kind === 'chargelatch' && Math.abs(m.x - (px2 + 7)) <= 2 && Math.abs(m.y - (py2 + 20)) <= 2,
    );
    if (!coil) return { err: 'no coil' };
    const door = rt.mechanisms.find((m) => m.kind === 'door' && m.id === coil.targetId);
    const levers = rt.mechanisms.filter(
      (m) => m.kind === 'lever' && valves.some((v) => v.id === m.targetId),
    );
    // park the wizard on the apron so the sim window covers the chamber
    ctx.player.x = px2 + 10;
    ctx.player.y = py2 + 2;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    await new Promise((r) => setTimeout(r, 1000));
    const gapMetal = () =>
      (w.types[w.idx(px2 - 3, railY)] === 13 ? 1 : 0) +
      (w.types[w.idx(px2 + 2, railY)] === 13 ? 1 : 0);
    const gapsOpenAtStart = gapMetal() === 0;
    const zapKnob = () => {
      for (const [X, Y] of [
        [px2 - 13, py2 + 6],
        [px2 - 12, py2 + 6],
        [px2 - 13, py2 + 7],
        [px2 - 12, py2 + 7],
      ]) {
        if (w.inBounds(X, Y)) w.charge[w.idx(X, Y)] = 6;
      }
    };
    // NEGATIVE: switches open — the pulse must die at the first gap
    zapKnob();
    await new Promise((r) => setTimeout(r, 2500));
    const openLatched = coil.state === 1;
    // throw both knife-switches (what the E-pull does)
    for (const l of levers) l.state = 0;
    await new Promise((r) => setTimeout(r, 1200));
    const gapsClosed = gapMetal() === 2;
    zapKnob();
    let latched = false,
      doorOpen = false;
    for (let t = 0; t < 50; t++) {
      await new Promise((r) => setTimeout(r, 200));
      latched = coil.state === 1;
      doorOpen = door.state === 1;
      if (doorOpen) break;
    }
    return {
      valves: valves.length,
      levers: levers.length,
      gapsOpenAtStart,
      openLatched,
      gapsClosed,
      latched,
      doorOpen,
    };
  });
  check(res.valves === 2 && res.levers === 2, 'two knife-switches wired', `v=${res.valves} l=${res.levers}`);
  check(res.gapsOpenAtStart, 'switch gaps start open');
  check(!res.openLatched, 'open switches: spark dies at the gap (negative test)');
  check(res.gapsClosed, 'thrown levers slam both gates into the rail');
  check(res.latched, 'closed circuit: the pulse runs home and latches');
  check(res.doorOpen, 'live circuit door opened');
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
