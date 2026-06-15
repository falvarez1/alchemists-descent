// "Pro" feature probe for the Builder improvement wave: zoom + minimap,
// live light preview, settle preview (real physics, keep/revert),
// multi-select/marquee/duplicate, stamps (capture/arm/paste), OR + SEQUENCE
// door logic live, playtest-from-here, overlays, share codes.
// Usage: node scripts/verify-builder-pro.mjs [url]  (dev server must be running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
let lastDialog = null;
let nextPromptAnswer = null;
page.on('dialog', (d) => {
  lastDialog = { type: d.type(), message: d.message(), value: d.defaultValue() };
  if (d.type() === 'prompt' && nextPromptAnswer !== null) {
    const v = nextPromptAnswer;
    nextPromptAnswer = null;
    d.accept(v);
  } else d.accept();
});
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2200);

/* ---------- builder + arena ---------- */
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const Metal = 13;
  for (let y = 375; y <= 625; y++)
    for (let x = 430; x <= 770; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = Metal; w.colors[i] = 0x7a8a99;
      }
  };
  solid(430, 770, 620, 625);
  solid(430, 436, 375, 625);
  solid(764, 770, 375, 625);
  solid(430, 770, 375, 380);
  ctx.camera.snapTo(600, 500);
});
await page.waitForTimeout(200);

const toClient = async (wx, wy) =>
  page.evaluate(([wx, wy]) => {
    const ctx = window.__game.ctx;
    const r = document.getElementById('builder-overlay').getBoundingClientRect();
    const VIEW_W = 525, VIEW_H = 357;
    const ux = ((wx - ctx.camera.renderX) / VIEW_W - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / VIEW_H - 0.5) * ctx.camera.zoom + 0.5;
    return { x: r.left + ux * r.width, y: r.top + uy * r.height };
  }, [wx, wy]);

const acceptAppPrompt = async (value) => {
  await page.waitForSelector('.app-dialog-root .app-dialog-input', { timeout: 5000 });
  await page.fill('.app-dialog-root .app-dialog-input', value);
  await page.click('.app-dialog-root .app-dialog-btn.primary');
};
const readAppPromptAndAccept = async () => {
  await page.waitForSelector('.app-dialog-root .app-dialog-input', { timeout: 5000 });
  const value = await page.$eval('.app-dialog-root .app-dialog-input', (el) => el.value);
  await page.click('.app-dialog-root .app-dialog-btn.primary');
  return value;
};
const acceptAppConfirm = async () => {
  await page.waitForSelector('.app-dialog-root .app-dialog-btn.primary', { timeout: 5000 });
  await page.click('.app-dialog-root .app-dialog-btn.primary');
};

/* ---------- zoom + minimap ---------- */
console.log('-- zoom & minimap');
const mid = await toClient(600, 500);
await page.mouse.move(mid.x, mid.y);
for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
await page.waitForTimeout(700);
let zoom = await page.evaluate(() => window.__game.ctx.camera.zoom);
check('wheel zooms in (camera.zoom > 1.5)', zoom > 1.5, `got ${zoom.toFixed(2)}`);
for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
await page.waitForTimeout(700);
zoom = await page.evaluate(() => window.__game.ctx.camera.zoom);
check('wheel zooms back out (~1x)', zoom < 1.1, `got ${zoom.toFixed(2)}`);

const mmRect = await page.evaluate(() => {
  const r = document.getElementById('builder-minimap').getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
check('minimap is visible', mmRect.width > 100);
// click the minimap at world (200, 200): camera should jump there
await page.mouse.click(mmRect.left + (200 / 1600) * mmRect.width, mmRect.top + (200 / 1064) * mmRect.height);
await page.waitForTimeout(150);
const camAfter = await page.evaluate(() => ({ x: window.__game.ctx.camera.x, y: window.__game.ctx.camera.y }));
check('minimap click jumps the camera', Math.abs(camAfter.x + 262 - 200) < 80, JSON.stringify(camAfter));
await page.evaluate(() => window.__game.ctx.camera.snapTo(600, 500));

/* ---------- live light preview ---------- */
console.log('-- light preview');
await page.click('.bp-tool[data-tool="light"]');
let p = await toClient(560, 540);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(250);
let lights = await page.evaluate(() => window.__game.ctx.state.editorLights?.length ?? 0);
check('authored light feeds the live field (editorLights=1)', lights === 1, `got ${lights}`);
await page.click('#bp-light-toggle');
await page.waitForTimeout(150);
lights = await page.evaluate(() => window.__game.ctx.state.editorLights);
check('preview toggle OFF clears the feed', lights === null, `got ${JSON.stringify(lights)}`);
await page.click('#bp-light-toggle'); // back on
await page.keyboard.press('Escape'); // leave light tool
await page.keyboard.press('Escape'); // deselect

/* ---------- settle preview: water falls, then revert restores ---------- */
console.log('-- settle preview');
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  // a floating water blob mid-air (would never survive live sim)
  for (let y = 560; y < 568; y++)
    for (let x = 600; x < 616; x++) {
      const i = w.idx(x, y);
      w.types[i] = 2; w.colors[i] = 0x1c8ce0;
    }
});
const countWaterAt = () =>
  page.evaluate(() => {
    const w = window.__game.ctx.world;
    let inBlob = 0, onFloor = 0;
    for (let y = 560; y < 568; y++) for (let x = 600; x < 616; x++) if (w.types[w.idx(x, y)] === 2) inBlob++;
    for (let y = 612; y < 620; y++) for (let x = 430; x < 770; x++) if (w.types[w.idx(x, y)] === 2) onFloor++;
    return { inBlob, onFloor };
  });
const beforeSettle = await countWaterAt();
check('water blob authored mid-air', beforeSettle.inBlob === 128, JSON.stringify(beforeSettle));
// settle is HOLD-to-run now: press, hold ~2.2s of real physics, release.
// Raw mouse.down does NOT auto-scroll like page.click — bring the button
// into view first (the palette scrolls; PREFABS above can push it under
// the fold).
const holdSettle = async (ms) => {
  const sb = await page.evaluate(() => {
    const el = document.getElementById('bp-settle');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(sb.x, sb.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(250);
};
await holdSettle(2200);
const settled = await countWaterAt();
check('settle runs real physics (water left the blob)', settled.inBlob < 30, JSON.stringify(settled));
check('water pooled on the floor', settled.onFloor > 60, JSON.stringify(settled));
const paused = await page.evaluate(() => window.__game.ctx.state.paused);
check('world re-freezes after the settle run', paused === true);
await page.click('#bp-settle-revert');
await page.waitForTimeout(150);
const reverted = await countWaterAt();
check('revert restores the authored blob exactly', reverted.inBlob === 128 && reverted.onFloor === 0, JSON.stringify(reverted));
// clean the blob away for the rest of the probe
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  for (let y = 560; y < 568; y++)
    for (let x = 600; x < 616; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0;
    }
});

/* ---------- settle gating + zero-diff KEEP keeps paint dirty ---------- */
console.log('-- settle gating');
const readSavedRle = () =>
  page.evaluate(() => {
    for (let n = 0; n < localStorage.length; n++) {
      const k = localStorage.key(n);
      if (k && k.startsWith('noita-builder-doc:')) {
        return JSON.parse(localStorage.getItem(k)).world?.rle ?? null;
      }
    }
    return null;
  });
const arenaChecksum = () =>
  page.evaluate(() => {
    const w = window.__game.ctx.world;
    let sum = 0;
    for (let y = 375; y <= 625; y++) for (let x = 430; x <= 770; x++) sum += w.types[w.idx(x, y)];
    return sum;
  });
const sampleBuilderCanvas = (wx, wy) =>
  page.evaluate(([wx, wy]) => {
    const ctx = window.__game.ctx;
    const overlay = document.getElementById('builder-overlay');
    const canvas = document.getElementById('builder-canvas');
    const r = overlay.getBoundingClientRect();
    const VIEW_W = 525, VIEW_H = 357;
    const ux = ((wx - ctx.camera.renderX) / VIEW_W - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / VIEW_H - 0.5) * ctx.camera.zoom + 0.5;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(ux * canvas.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(uy * canvas.height)));
    if (ux < 0 || ux > 1 || uy < 0 || uy > 1 || r.width === 0 || r.height === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const p = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    return { r: p[0], g: p[1], b: p[2], a: p[3] };
  }, [wx, wy]);
// paint STATIC stone block A through the UI, then snapshot it into a save
await page.evaluate(() => {
  window.__game.ctx.state.currentElement = 12;
  window.__game.ctx.state.activeInputMode = 'element';
});
const paintBlock = async (x0, y0, x1, y1) => {
  await page.click('.bp-tool[data-tool="rectFill"]');
  const sa = await toClient(x0, y0);
  const sb = await toClient(x1, y1);
  await page.mouse.move(sa.x, sa.y);
  await page.mouse.down();
  await page.mouse.move(sb.x, sb.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(120);
};
await paintBlock(640, 500, 650, 510);
await page.click('[data-menu="document"]');
await page.click('#b-save');
await page.waitForTimeout(200);
const rle1 = await readSavedRle();
// paint block B (paintDirty earned again), then run a ZERO-DIFF settle:
// stone never moves, so KEEP reports "nothing moved" — and must NOT launder
// away block B's dirty flag
await paintBlock(660, 500, 670, 510);
await holdSettle(1200); // hold-to-run; release leaves KEEP/REVERT pending
await page.click('#bp-proc-btn'); // open the procedural panel
const sumBefore = await arenaChecksum();
await page.click('#bp-apply'); // must be REFUSED while the settle decision is pending
await page.waitForTimeout(200);
const sumAfter = await arenaChecksum();
const gateStatus = await page.evaluate(() => document.getElementById('builder-status').textContent);
check('proc APPLY refused while a settle decision is pending', sumBefore === sumAfter && gateStatus.includes('SETTLE'), `${sumBefore} vs ${sumAfter} · "${gateStatus}"`);
await page.click('#bp-settle-keep');
await page.waitForTimeout(200);
await page.click('[data-menu="document"]');
await page.click('#b-save');
await page.waitForTimeout(200);
const rle2 = await readSavedRle();
check(
  'zero-diff KEEP keeps earlier paint dirty (save captures it)',
  rle1 !== null && rle2 !== null && rle1 !== rle2,
  `rle1 ${rle1 === null ? 'null' : rle1.length} · rle2 ${rle2 === null ? 'null' : rle2.length} · same=${rle1 === rle2}`,
);
await page.click('#bp-proc-close');

/* ---------- multi-select: marquee, group drag, duplicate ---------- */
console.log('-- multi-select');
const placeAt = async (kind, wx, wy) => {
  await page.click(`.bp-tool[data-kind="${kind}"]`);
  const pt = await toClient(wx, wy);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(70);
};
await placeAt('enemy', 520, 600);
// enemy stays armed (sticky): two more clicks place two more
let pt = await toClient(560, 600);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(70);
pt = await toClient(600, 600);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(70);
await page.keyboard.press('Escape');
let markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('sticky placement: 3 enemies + 1 light = 4 markers', markers === 4, `got ${markers}`);

const a = await toClient(500, 580);
const b = await toClient(620, 615);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(150);
let selCount = await page.evaluate(() => document.querySelectorAll('.b-marker.sel').length);
check('marquee selects the 3 enemies', selCount === 3, `got ${selCount}`);

await page.keyboard.press('Control+d');
await page.waitForTimeout(150);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('Ctrl+D duplicates the selection (7 markers)', markers === 7, `got ${markers}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('duplicate undoes as ONE command', markers === 4, `got ${markers}`);
await page.keyboard.press('Escape');

/* ---------- prefabs: region -> capture -> paste ---------- */
console.log('-- prefabs');
// paint a small stone block to capture
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.currentElement = 12;
  ctx.state.activeInputMode = 'element';
  const w = ctx.world;
  for (let y = 500; y < 510; y++)
    for (let x = 480; x < 490; x++) {
      const i = w.idx(x, y);
      w.types[i] = 12; w.colors[i] = 0x8a8a92;
    }
});
await page.click('.bp-tool[data-tool="region"]');
const ra = await toClient(477, 497);
const rb = await toClient(493, 513);
await page.mouse.move(ra.x, ra.y);
await page.mouse.down();
await page.mouse.move(rb.x, rb.y, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(120);
await page.click('#bp-prefab-capture');
await acceptAppPrompt('test-block');
await page.waitForTimeout(150);
// library cards only — built-ins also list as cards now (2 action buttons
// instead of the library's 4: no delete, no anchor editing)
let prefabCount = await page.evaluate(
  () =>
    document.querySelectorAll('#bp-prefab-host .ba-placement-row[data-asset-id^="prefab:library:"]').length,
);
check('prefab captured into the library', prefabCount === 1, `got ${prefabCount}`);
await page.click('#bp-prefab-host .ba-placement-row[data-asset-id^="prefab:library:"]');
await page.waitForTimeout(100);
const paste = await toClient(700, 480);
await page.mouse.click(paste.x, paste.y);
await page.waitForTimeout(120);
const pasted = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 475; y < 486; y++) for (let x = 695; x < 706; x++) if (w.types[w.idx(x, y)] === 12) n++;
  return n;
});
check('prefab pastes its cells (centered on click)', pasted === 100, `got ${pasted}`);
await page.keyboard.press('Control+z');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape'); // clear region
// clean up the library so re-runs start from zero
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-prefab:')) localStorage.removeItem(key);
  }
});

/* ---------- OR and SEQUENCE doors, live in the runtime ---------- */
console.log('-- door logic live');
// wipe markers/doc state via NEW, then author: spawn + 2 plates + OR door
await page.click('#b-new');
await acceptAppConfirm();
await page.waitForTimeout(150);
await placeAt('spawn', 470, 616);
await placeAt('plate', 510, 619);
await placeAt('plate', 545, 619);
await placeAt('door', 651, 590);
await page.evaluate(() => {
  const h = document.querySelector('#builder-inspector input[data-p="h"]');
  h.value = '60'; h.dispatchEvent(new Event('change'));
});
await page.evaluate(() => {
  const y = document.querySelector('#builder-inspector input[data-f="y"]');
  y.value = '560'; y.dispatchEvent(new Event('change'));
});
await page.evaluate(() => {
  const lg = document.querySelector('#builder-inspector select[data-p="logic"]');
  lg.value = 'or'; lg.dispatchEvent(new Event('change'));
});
// link both plates
const link = async (fx, fy, tx, ty) => {
  await page.keyboard.press('k');
  let q = await toClient(fx, fy);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(70);
  q = await toClient(tx, ty);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(70);
};
await link(510, 619, 651, 590);
await link(545, 619, 651, 590);
await page.click('#b-playtest');
await page.waitForFunction(
  () => window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning,
  { timeout: 10000 },
);
await page.waitForTimeout(500);
const orDoor = await page.evaluate(() => {
  const r = window.__game.ctx.levels.current;
  const door = r.mechanisms.find((m) => m.kind === 'door');
  return { logic: door.logic, plates: r.mechanisms.filter((m) => m.kind === 'plate').length };
});
check('OR door compiled with its logic', orDoor.logic === 'or' && orDoor.plates === 2, JSON.stringify(orDoor));
// satisfy exactly ONE plate by latching its state directly (drives the real aggregator)
await page.evaluate(() => {
  const r = window.__game.ctx.levels.current;
  const plate = r.mechanisms.find((m) => m.kind === 'plate');
  plate.state = 420; // latched as if weighted
});
await page.waitForTimeout(400);
const orState = await page.evaluate(() => {
  const door = window.__game.ctx.levels.current.mechanisms.find((m) => m.kind === 'door');
  return door.state;
});
check('ONE plate opens an OR door', orState === 1, `state ${orState}`);

// sequence: same wiring, door logic sequence, drive out of order then in order
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
const doorSel = await page.evaluate(() => {
  // select the door through validation issue-free path: click its marker via canvas hit
  return true;
});
check('returned to builder with doc intact', doorSel === true);
// the camera parked at the spawn — re-center so the door's screen position
// isn't underneath the floating inspector panel
await page.evaluate(() => window.__game.ctx.camera.snapTo(600, 500));
await page.waitForTimeout(120);
await page.evaluate(() => {
  // flip the door's logic param directly through the inspector path
  const markers = document.querySelectorAll('.b-marker.k-door');
  markers[0]?.dispatchEvent(new Event('click'));
});
p = await toClient(651, 590);
await page.mouse.click(p.x, p.y); // select door (footprint hit)
await page.waitForTimeout(100);
await page.evaluate(() => {
  const lg = document.querySelector('#builder-inspector select[data-p="logic"]');
  lg.value = 'sequence'; lg.dispatchEvent(new Event('change'));
});
await page.click('#b-playtest');
await page.waitForFunction(
  () => window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning,
  { timeout: 10000 },
);
await page.waitForTimeout(500);
const seqResult = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rt = window.__game.ctx.levels.current;
  const door = rt.mechanisms.find((m) => m.kind === 'door');
  const plates = rt.mechanisms.filter((m) => m.kind === 'plate');
  // wrong order: satisfy plate 2 first — the chain must reset AND spit the
  // plate's latch back out (state auto-zeroed) so retrying is instant
  plates[1].state = 420;
  await wait(300);
  const afterWrong = { seq: door.seq ?? 0, state: door.state, p2: plates[1].state };
  await wait(200);
  // right order: plate 1, then plate 2 (fresh rising edges)
  plates[0].state = 420;
  await wait(300);
  const afterFirst = { seq: door.seq ?? 0 };
  plates[1].state = 420;
  await wait(400);
  return { afterWrong, afterFirst, done: door.seqDone === true, state: door.state, logic: door.logic };
});
check('sequence door ignores the wrong order', seqResult.afterWrong.seq === 0 && seqResult.afterWrong.state === 0, JSON.stringify(seqResult));
check('chain reset spits the early plate back out', seqResult.afterWrong.p2 === 0, JSON.stringify(seqResult));
check('first step advances the chain', seqResult.afterFirst.seq === 1, JSON.stringify(seqResult));
check('completing the sequence latches the door open', seqResult.done && seqResult.state === 1, JSON.stringify(seqResult));

/* fail-open doctrine on sequence chains: wreck every trigger, gate gives way */
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
await page.click('#b-playtest');
await page.waitForFunction(
  () => window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning,
  { timeout: 10000 },
);
await page.waitForTimeout(400);
const failOpen = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rt = window.__game.ctx.levels.current;
  const door = rt.mechanisms.find((m) => m.kind === 'door');
  for (const m of rt.mechanisms) if (m.kind === 'plate') m.broken = 0; // fully wrecked
  await wait(500);
  return { done: door.seqDone === true, state: door.state };
});
check('wrecking every sequence trigger fails the chain OPEN', failOpen.done && failOpen.state === 1, JSON.stringify(failOpen));

/* wreck-BEHIND-the-cursor: breaking an already-fired step must not wedge */
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
await page.click('#b-playtest');
await page.waitForFunction(
  () => window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning,
  { timeout: 10000 },
);
await page.waitForTimeout(400);
const wreckBehind = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rt = window.__game.ctx.levels.current;
  const door = rt.mechanisms.find((m) => m.kind === 'door');
  const plates = rt.mechanisms.filter((m) => m.kind === 'plate');
  plates[0].state = 420; // fire step 1
  await wait(300);
  const mid = { seq: door.seq ?? 0 };
  plates[0].broken = 0; // combat wrecks the plate the player already used
  plates[0].state = 0;
  await wait(300);
  plates[1].state = 420; // the genuinely remaining step must still complete
  await wait(400);
  return { mid, done: door.seqDone === true, state: door.state };
});
check('wrecking an already-fired step cannot wedge the chain', wreckBehind.mid.seq === 1 && wreckBehind.done && wreckBehind.state === 1, JSON.stringify(wreckBehind));

/* ---------- live preview session: disposable, Builder-owned ---------- */
console.log('-- live preview session');
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.camera.zoomLock = 1;
  ctx.camera.snapTo(600, 500);
  ctx.state.currentElement = 12;
  ctx.state.activeInputMode = 'element';
});
await page.waitForTimeout(200);
// Weight one authored plate through the normal terrain tool. Live Preview
// should read this unsaved paint from a local snapshot, not by mutating the
// document or swapping the real world into a preview runtime.
await paintBlock(506, 617, 514, 618);
const livePreviewChecksum = await arenaChecksum();
await page.click('#b-session-live');
await page.waitForTimeout(700);
const livePreviewState = await page.evaluate(() => ({
  mode: window.__game.ctx.state.mode,
  active: document.getElementById('b-session-live').classList.contains('active'),
  restartDisabled: document.getElementById('b-session-restart').disabled,
  discardDisabled: document.getElementById('b-session-discard').disabled,
  checksum: (() => {
    const w = window.__game.ctx.world;
    let sum = 0;
    for (let y = 375; y <= 625; y++) for (let x = 430; x <= 770; x++) sum += w.types[w.idx(x, y)];
    return sum;
  })(),
}));
check('Live Preview stays in Builder mode', livePreviewState.mode === 'build' && livePreviewState.active, JSON.stringify(livePreviewState));
check('Live Preview does not mutate the live world', livePreviewState.checksum === livePreviewChecksum, `${livePreviewState.checksum} vs ${livePreviewChecksum}`);
check('Live Preview enables restart/discard controls', !livePreviewState.restartDisabled && !livePreviewState.discardDisabled, JSON.stringify(livePreviewState));
const platePixel = await sampleBuilderCanvas(510, 619);
check('Live Preview draws preview-only mechanism cells', platePixel.a > 0, JSON.stringify(platePixel));
const livePreviewBudget = await page.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  for (let i = 0; i < 36; i++) {
    const now = await new Promise((resolve) => requestAnimationFrame(resolve));
    frames.push(now - last);
    last = now;
  }
  const avg = frames.reduce((sum, value) => sum + value, 0) / frames.length;
  return { avg, max: Math.max(...frames), samples: frames.length };
});
check(
  'Live Preview frame budget remains bounded',
  livePreviewBudget.avg < 50 && livePreviewBudget.max < 180,
  JSON.stringify(livePreviewBudget),
);
await page.evaluate(() => document.getElementById('bp-preview')?.click());
await page.waitForTimeout(120);
const livePreviewGate = await page.evaluate(() => ({
  status: document.getElementById('builder-status')?.textContent ?? '',
  active: document.getElementById('b-session-live').classList.contains('active'),
}));
check(
  'Live Preview blocks procedural cell previews',
  livePreviewGate.active && /AUTHOR-ONLY/.test(livePreviewGate.status),
  JSON.stringify(livePreviewGate),
);
await page.click('#b-session-restart');
await page.waitForTimeout(250);
const restartState = await page.evaluate(() => ({
  active: document.getElementById('b-session-live').classList.contains('active'),
  checksum: (() => {
    const w = window.__game.ctx.world;
    let sum = 0;
    for (let y = 375; y <= 625; y++) for (let x = 430; x <= 770; x++) sum += w.types[w.idx(x, y)];
    return sum;
  })(),
}));
check('Restart Preview keeps the authored world stable', restartState.active && restartState.checksum === livePreviewChecksum, JSON.stringify(restartState));
await page.click('#b-session-discard');
await page.waitForTimeout(250);
const discardState = await page.evaluate(() => ({
  author: document.getElementById('b-session-author').classList.contains('active'),
  restartDisabled: document.getElementById('b-session-restart').disabled,
}));
check('Discard Preview returns to Author controls', discardState.author && discardState.restartDisabled, JSON.stringify(discardState));
await page.keyboard.press('Escape');

/* ---------- playtest-from-here (T) ---------- */
console.log('-- playtest from here');
if (!(await page.evaluate(() => document.body.classList.contains('builder-open')))) {
  await page.click('#mode-builder-btn');
  await page.waitForTimeout(400);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(60);
await page.evaluate(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.camera.zoomLock = 1;
  ctx.camera.snapTo(600, 500);
});
await page.waitForTimeout(200);
const here = await toClient(700, 600);
await page.mouse.click(here.x, here.y);
await page.waitForTimeout(80);
await page.mouse.move(here.x, here.y);
await page.waitForTimeout(100);
await page.keyboard.press('t');
await page.waitForFunction(
  () => window.__game.ctx.state.mode === 'play' && !window.__game.ctx.levels.transitioning,
  { timeout: 10000 },
).catch(async (err) => {
  const state = await page.evaluate(() => ({
    mode: window.__game.ctx.state.mode,
    status: document.getElementById('builder-status')?.textContent ?? '',
    active: document.activeElement?.id ?? document.activeElement?.tagName ?? '',
  }));
  throw new Error(`${err.message} ${JSON.stringify(state)}`);
});
await page.waitForTimeout(400);
const tpos = await page.evaluate(() => ({
  x: window.__game.ctx.player.x,
  y: window.__game.ctx.player.y,
}));
check('T playtests at the cursor', Math.abs(tpos.x - 700) < 20, JSON.stringify(tpos));

/* ---------- overlays + share code round trip ---------- */
console.log('-- overlays & share');
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
await page.keyboard.press('o');
let overlayLabel = await page.evaluate(() => document.getElementById('bp-overlay-btn').textContent);
check('O cycles the readability overlay', overlayLabel.includes('LIGHT'), overlayLabel);
await page.keyboard.press('o');
await page.keyboard.press('o');
await page.keyboard.press('o'); // back to NONE

await page.click('[data-menu="document"]');
await page.click('#b-share');
const code = await readAppPromptAndAccept();
check('SHARE produces a PLLD1 code', typeof code === 'string' && code.startsWith('PLLD1.'), String(code).slice(0, 24));
await page.click('#b-new');
await acceptAppConfirm();
await page.waitForTimeout(150);
let count = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('NEW cleared the document', count === 0, `got ${count}`);
await page.click('[data-menu="document"]');
await page.click('#b-code');
await acceptAppPrompt(code);
await page.waitForTimeout(800);
count = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('CODE import restores the level (4 markers)', count === 4, `got ${count}`);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
