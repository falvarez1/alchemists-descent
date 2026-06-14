// Runtime probe for the two new Wave E puzzle archetypes:
//   FREEZE BRIDGE (archetype 4, frozen-biased): dig the hopper lip, nitrogen
//   rains, the trench freezes, the ice-census sensor fires, the door opens.
//   LIVE CIRCUIT (archetype 5, crystal/scorched-biased): a spark on the knob
//   with DRY slots dies at the first gap (negative test); pour water into
//   both slots and the same spark runs the rail home and latches the coil.
// Usage: node scripts/probe-archetypes.mjs [url]
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

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
  await startConsoleTestRun(page, { seed, settleMs: 400 });
  return await page.evaluate(
    async ({ ID }) => {
      const ctx = window.__game.ctx;
      let levelResult = null;
      if (ID !== 'd1') {
        levelResult = await ctx.console.exec(`level ${ID}`);
        await new Promise((r) => setTimeout(r, 400));
      }
      const rt = ctx.levels.current;
      const levelOk = ID === 'd1' || (levelResult?.ok === true && rt?.def.id === ID);
      return rt ? { ok: levelOk, id: rt.def.id, levelResult } : { ok: false, levelResult };
    },
    { ID: id },
  );
}

// ---------------- FREEZE BRIDGE ----------------
// d3 is frozen; bias < 0.5 forces archetype 4, so ~half of all seeds carry it.
let freezeSeed = -1;
let freezeLoadFailed = null;
for (let seed = 1; seed <= 14 && freezeSeed < 0; seed++) {
  const loaded = await loadDepth(seed, 'd3');
  if (!loaded.ok) {
    freezeLoadFailed = { seed, loaded };
    break;
  }
  const found = await page.evaluate(() => {
    const rt = window.__game.ctx.levels.current;
    const s = rt.mechanisms.find(
      (m) => m.kind === 'sensor' && m.materialFilter && m.materialFilter.includes(10), // Ice=10
    );
    return s ? { x: s.x, y: s.y } : null;
  });
  if (found) freezeSeed = seed;
}
check(!freezeLoadFailed, 'console level command enters d3 during freeze search', freezeLoadFailed ? JSON.stringify(freezeLoadFailed) : '');
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
    const countZone = async (material) => {
      const res = await ctx.console.exec(`count ${material} ${z.x0} ${z.y0} ${z.x1 - z.x0 + 1} ${z.y1 - z.y0 + 1}`);
      return { ok: res.ok, count: res.data?.count ?? 0, res };
    };
    const px2 = sensor.x + 2, // chamber center from sensor placement
      py2 = sensor.y - 9;
    const water0 = await countZone('water');
    const drip = (rt.emitters ?? []).find(
      (e) => e.cell === 16 && Math.abs(e.x - (px2 - 2)) <= 2 && Math.abs(e.y - (py2 - 9)) <= 2,
    );
    // resident mobs maul the parked wizard (knockback shoves him off the
    // apron and their blood pollutes the chamber) — clear them, in place
    ctx.enemies.length = 0;
    // park the wizard in the chamber so the sim window covers it
    ctx.player.x = px2 + 9;
    ctx.player.y = py2 + 2;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    // NEGATIVE: with the tray intact the drops pool and evaporate — the
    // channel must stay essentially liquid
    await new Promise((r) => setTimeout(r, 5000));
    const iceTrayIntact = await countZone('ice');
    // break the catch-tray (floor + both 2-high brim walls)
    for (let dx = -4; dx <= 0; dx++) w.types[w.idx(px2 + dx, py2 - 6)] = 0;
    for (const dx of [-4, 0]) {
      for (const dy of [-7, -8]) w.types[w.idx(px2 + dx, py2 + dy)] = 0;
    }
    // poll up to 30s for the crust -> latch -> door retraction
    let ice = 0,
      latched = false,
      doorOpen = false;
    for (let t = 0; t < 150; t++) {
      await new Promise((r) => setTimeout(r, 200));
      const iceCount = await countZone('ice');
      ice = iceCount.count;
      latched = sensor.state > 0;
      doorOpen = door.state === 1;
      if (doorOpen) break;
    }
    return {
      water0: water0.count,
      waterCountOk: water0.ok,
      hasDrip: !!drip,
      iceTrayIntact: iceTrayIntact.count,
      iceTrayCountOk: iceTrayIntact.ok,
      ice,
      latched,
      doorOpen,
      threshold: sensor.threshold,
    };
  });
  check(res.waterCountOk && res.water0 >= 20, 'trench holds open water via console count', `water=${res.water0}`);
  check(res.hasDrip, 'nitrogen drip emitter present');
  check(
    res.iceTrayCountOk && res.iceTrayIntact < res.threshold,
    'tray intact: channel stays liquid via console count (negative test)',
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
let circuitLoadFailed = null;
outer: for (const id of ['d6', 'd7', 'd5']) {
  for (let seed = 1; seed <= 10; seed++) {
    const loaded = await loadDepth(seed, id);
    if (!loaded.ok) {
      circuitLoadFailed = { id, seed, loaded };
      break outer;
    }
    const found = await page.evaluate(() => {
      const ctx = window.__game.ctx;
      const rt = ctx.levels.current;
      const w = ctx.world;
      const valves = rt.mechanisms.filter((m) => m.kind === 'valve' && m.w === 1 && m.h === 3);
      for (const a of valves) {
        for (const b of valves) {
          if (b.x - a.x !== 5 || a.y !== b.y) continue;
          const la = rt.mechanisms.find((m) => m.kind === 'lever' && m.targetId === a.id);
          const lb = rt.mechanisms.find((m) => m.kind === 'lever' && m.targetId === b.id);
          if (!la || !lb) continue;
          // a flooded chamber pre-bridges the rail (sim-honest, but it
          // invalidates the dry-gap negative test) — hunt for a dry one
          const px2 = a.x + 3,
            py2 = a.y - 10;
          let wet = 0;
          for (let X = px2 - 8; X <= px2 + 12; X++)
            for (let Y = py2 + 8; Y <= py2 + 21; Y++) {
              const t = w.types[w.idx(X, Y)];
              if (t === 2 || t === 6 || t === 18) wet++; // water/oil/blood
            }
          if (wet <= 2) return { px2, py2 };
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
check(!circuitLoadFailed, 'console level command enters searched circuit depths', circuitLoadFailed ? JSON.stringify(circuitLoadFailed) : '');
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
    // resident mobs maul the parked wizard: a golem's knockback shoved him
    // into a valve column at the close edge (the safe-close rule skips
    // body-occupied cells, permanently holing the gate) and combat blood is
    // a CONDUCTOR that bridged the open gap — clear them, in place
    ctx.enemies.length = 0;
    // park the wizard on the apron so the sim window covers the chamber
    ctx.player.x = px2 + 10;
    ctx.player.y = py2 + 2;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    await new Promise((r) => setTimeout(r, 1000));
    // scrub stray liquids out of the switch slots: the dry hunt tolerates
    // up to 2 wet cells in the window, and a conductive drop sitting in a
    // gap slot would both fake a bridge and dodge the close stamp
    for (const gx of [px2 - 3, px2 + 2]) {
      for (let Y = railY - 1; Y <= railY + 1; Y++) {
        const t = w.types[w.idx(gx, Y)];
        if (t === 2 || t === 6 || t === 18) w.types[w.idx(gx, Y)] = 0;
      }
    }
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
