// Builder Phases 4-10 end-to-end probe: shape tools paint undoable patches,
// mechanisms place + link + compile to a working AND gate, lights compile to
// authored runtime lights, procedural passes apply with history, validation
// gates the playtest, and the document survives the round trip.
// Usage: node scripts/verify-builder-suite.mjs [url]  (dev server must be running)
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
page.on('dialog', (d) => d.accept());
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2500);

/* ---------- open builder, carve a deterministic metal arena ---------- */
console.log('-- arena');
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
  solid(430, 770, 620, 625); // floor
  solid(430, 436, 375, 625); // left wall
  solid(764, 770, 375, 625); // right wall
  solid(430, 770, 375, 380); // ceiling: a sealed arena, BFS stays inside
  ctx.camera.snapTo(600, 500);
});
await page.waitForTimeout(200);

/** world cell -> client pixel (the overlay transform, computed live). */
const toClient = async (wx, wy) =>
  page.evaluate(([wx, wy]) => {
    const ctx = window.__game.ctx;
    const r = document.getElementById('builder-overlay').getBoundingClientRect();
    const VIEW_W = 525, VIEW_H = 357;
    const ux = ((wx - ctx.camera.renderX) / VIEW_W - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / VIEW_H - 0.5) * ctx.camera.zoom + 0.5;
    return { x: r.left + ux * r.width, y: r.top + uy * r.height };
  }, [wx, wy]);

const cellType = (x, y) =>
  page.evaluate(([x, y]) => window.__game.ctx.world.types[window.__game.ctx.world.idx(x, y)], [x, y]);

/* ---------- Phase 4: shape tools ---------- */
console.log('-- shape tools');
// pick STONE in the sandbox material palette
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.currentElement = 12;
  ctx.state.activeInputMode = 'element';
});
await page.click('.bp-tool[data-tool="rectFill"]');
let a = await toClient(500, 480);
let b = await toClient(540, 500);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(120);
check('filled rect stamps stone', (await cellType(520, 490)) === 12, `got ${await cellType(520, 490)}`);

await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
check('rect undoes', (await cellType(520, 490)) === 0, `got ${await cellType(520, 490)}`);
await page.keyboard.press('Control+y');
await page.waitForTimeout(120);
check('rect redoes', (await cellType(520, 490)) === 12, `got ${await cellType(520, 490)}`);

// flood fill: water into a small stone cup painted with the rect tool
await page.click('.bp-tool[data-tool="rect"]');
a = await toClient(560, 470);
b = await toClient(590, 500);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(120);
await page.evaluate(() => { window.__game.ctx.state.currentElement = 2; }); // water
await page.click('.bp-tool[data-tool="fill"]');
const inCup = await toClient(575, 485);
await page.mouse.click(inCup.x, inCup.y);
await page.waitForTimeout(120);
check('flood fill pools water inside the cup', (await cellType(575, 485)) === 2, `got ${await cellType(575, 485)}`);
check('flood fill stays inside the cup', (await cellType(545, 485)) === 0, `got ${await cellType(545, 485)}`);

/* ---------- Phase 5+6: objects, mechanisms, link tool ---------- */
console.log('-- mechanisms & links');
const placeAt = async (kind, wx, wy) => {
  await page.click(`.bp-tool[data-kind="${kind}"]`);
  const p = await toClient(wx, wy);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
};
await placeAt('spawn', 470, 616);
await placeAt('plate', 510, 619);
await placeAt('door', 651, 590); // centers a 3x13 slab -> top-left (650, 584)
// stretch the door to floor-to-ceiling via the inspector (h=60, y=560)
await page.evaluate(() => {
  const h = document.querySelector('#builder-inspector input[data-p="h"]');
  h.value = '60';
  h.dispatchEvent(new Event('change'));
});
await page.evaluate(() => {
  const y = document.querySelector('#builder-inspector input[data-f="y"]');
  y.value = '560';
  y.dispatchEvent(new Event('change'));
});
await placeAt('waystone', 700, 616);

// LINK: plate -> door
await page.click('.bp-tool[data-tool="link"]');
let p = await toClient(510, 619);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
p = await toClient(651, 590);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);

// light above the spawn
await page.click('.bp-tool[data-tool="light"]');
p = await toClient(560, 560);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);

let markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('five markers (4 objects + 1 light)', markers === 5, `got ${markers}`);

/* ---------- save -> document carries links + lights ---------- */
await page.click('[data-menu="document"]');
await page.click('#b-save');
await page.waitForTimeout(150);
const savedDoc = await page.evaluate(() => {
  const lib = {};
  for (let n = 0; n < localStorage.length; n++) {
    const k = localStorage.key(n);
    if (k && k.startsWith('noita-builder-doc:')) { const d = JSON.parse(localStorage.getItem(k)); lib[d.id] = d; }
  }
  return Object.values(lib)[0] ?? null;
});
check('saved doc has 4 objects', savedDoc && savedDoc.objects.length === 4, `got ${savedDoc?.objects?.length}`);
check('saved doc has the trigger link', savedDoc && savedDoc.links.length === 1 && savedDoc.links[0].kind === 'triggerDoor', JSON.stringify(savedDoc?.links));
check('saved doc has the light', savedDoc && savedDoc.lights.length === 1, `got ${savedDoc?.lights?.length}`);

/* ---------- Phase 8: procedural pass with region ---------- */
console.log('-- procedural');
await page.click('.bp-tool[data-tool="region"]');
a = await toClient(440, 600);
b = await toClient(760, 624);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(100);
await page.click('#bp-proc-btn');
await page.evaluate(() => { window.__game.ctx.state.currentElement = 17; }); // gold veins
await page.selectOption('#bp-pass', 'veins');
await page.click('#bp-preview');
await page.waitForTimeout(200);
let goldInRegion = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 600; y <= 624; y++) for (let x = 440; x <= 760; x++) if (w.types[w.idx(x, y)] === 17) n++;
  return n;
});
check('veins preview writes gold into the region', goldInRegion >= 10, `got ${goldInRegion}`);
await page.click('#bp-discard');
await page.waitForTimeout(150);
goldInRegion = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 600; y <= 624; y++) for (let x = 440; x <= 760; x++) if (w.types[w.idx(x, y)] === 17) n++;
  return n;
});
check('discard reverts the preview', goldInRegion === 0, `got ${goldInRegion}`);
await page.click('#bp-apply');
await page.waitForTimeout(200);
goldInRegion = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 600; y <= 624; y++) for (let x = 440; x <= 760; x++) if (w.types[w.idx(x, y)] === 17) n++;
  return n;
});
check('apply commits the pass', goldInRegion >= 10, `got ${goldInRegion}`);

/* ---------- Phase 10: validation passes clean ---------- */
console.log('-- validate & playtest');
await page.click('[data-menu="edit"]');
await page.click('#b-validate');
await page.waitForTimeout(400);
const errCount = await page.evaluate(() => document.querySelectorAll('#builder-issues .b-issue.error').length);
check('validation finds no errors on the wired level', errCount === 0, `got ${errCount} errors`);

/* ---------- Phase 9: playtest compiles the full document ---------- */
await page.click('#b-playtest');
await page.waitForFunction(
  () => window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning,
  { timeout: 10000 },
);
await page.waitForTimeout(600);
const rt = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const r = ctx.levels.current;
  return {
    mode: ctx.state.mode,
    mechs: r.mechanisms.map((m) => ({ kind: m.kind, target: m.targetId, state: m.state })),
    lights: r.authoredLights?.length ?? 0,
    waystones: r.waystones.length,
    doorCell: ctx.world.types[ctx.world.idx(651, 600)],
    spawn: r.spawn,
  };
});
check('playtest enters play mode', rt.mode === 'play');
check('door + plate compiled', rt.mechs.length === 2 && rt.mechs.some((m) => m.kind === 'door') && rt.mechs.some((m) => m.kind === 'plate'), JSON.stringify(rt.mechs));
check('plate is wired to the door', (() => {
  const door = rt.mechs.find((m) => m.kind === 'door');
  const plate = rt.mechs.find((m) => m.kind === 'plate');
  return door && plate && plate.target >= 0;
})(), JSON.stringify(rt.mechs));
check('door slab is real metal', rt.doorCell === 13, `got ${rt.doorCell}`);
check('authored light compiled', rt.lights === 1, `got ${rt.lights}`);
check('waystone compiled', rt.waystones === 1, `got ${rt.waystones}`);

/* the AND gate, live: stand on the plate, the gate retracts */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.player.x = 510;
  ctx.player.y = 617;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
});
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const door = ctx.levels.current.mechanisms.find((m) => m.kind === 'door');
  return { state: door.state, cell: ctx.world.types[ctx.world.idx(651, 600)] };
});
check('standing on the plate opens the door (AND gate live)', after.state === 1, JSON.stringify(after));
check('door cells retract to empty', after.cell === 0, `got ${after.cell}`);

/* ---------- return: the document survives the playtest ---------- */
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('document intact after playtest (5 markers)', markers === 5, `got ${markers}`);
const procCount = await page.evaluate(() => {
  const lib = {};
  for (let n = 0; n < localStorage.length; n++) {
    const k = localStorage.key(n);
    if (k && k.startsWith('noita-builder-doc:')) { const d = JSON.parse(localStorage.getItem(k)); lib[d.id] = d; }
  }
  return Object.values(lib)[0]?.proceduralHistory?.length ?? -1;
});
check('saved doc predates the pass (history persists on next save)', procCount === 0, `got ${procCount}`);
await page.click('[data-menu="document"]');
await page.click('#b-save');
await page.waitForTimeout(150);
const procCount2 = await page.evaluate(() => {
  const lib = {};
  for (let n = 0; n < localStorage.length; n++) {
    const k = localStorage.key(n);
    if (k && k.startsWith('noita-builder-doc:')) { const d = JSON.parse(localStorage.getItem(k)); lib[d.id] = d; }
  }
  return Object.values(lib)[0]?.proceduralHistory?.length ?? -1;
});
check('procedural history saved with the document', procCount2 === 1, `got ${procCount2}`);

/* ---------- Phase 7: validation repair action smoke, isolated page ---------- */
console.log('-- validation repairs');
const repairContext = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const repairPage = await repairContext.newPage();
repairPage.on('dialog', (d) => d.accept());
repairPage.on('pageerror', (err) => pageErrors.push(String(err)));
await repairPage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await repairPage.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await repairPage.waitForTimeout(1200);
await repairPage.click('#mode-builder-btn');
await repairPage.waitForTimeout(240);
await repairPage.click('#b-playtest');
await repairPage.waitForTimeout(180);
const spawnPlaytestBlock = await repairPage.evaluate(() => ({
  mode: window.__game.ctx.state.mode,
  hasBanner: Boolean(document.querySelector('#builder-issues .bv-blocker[data-playtest-blockers="1"]')),
  hasBlockerRow: Boolean(document.querySelector('#builder-issues .b-issue[data-issue-code="builder.spawn.missing"][data-playtest-blocker="true"]')),
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'playtest shows repairable compile blocker instead of entering play',
  spawnPlaytestBlock.mode !== 'play' &&
    spawnPlaytestBlock.hasBanner &&
    spawnPlaytestBlock.hasBlockerRow &&
    spawnPlaytestBlock.status.includes('PLAYTEST BLOCKED'),
  JSON.stringify(spawnPlaytestBlock),
);
await repairPage.click('[data-menu="edit"]');
await repairPage.click('#b-validate');
await repairPage.waitForTimeout(200);
const spawnRepairBefore = await repairPage.evaluate(() => {
  const issue = document.querySelector('#builder-issues .b-issue[data-issue-code="builder.spawn.missing"]');
  return {
    hasIssue: Boolean(issue),
    hasAction: Boolean(issue?.querySelector('[data-validation-action="addSpawnAtCamera"]')),
    markers: document.querySelectorAll('.b-marker').length,
  };
});
check('validation exposes missing-spawn repair action', spawnRepairBefore.hasIssue && spawnRepairBefore.hasAction, JSON.stringify(spawnRepairBefore));
await repairPage.click('#builder-issues [data-validation-action="addSpawnAtCamera"]');
await repairPage.waitForTimeout(160);
const spawnRepairAfter = await repairPage.evaluate(() => ({
  markers: document.querySelectorAll('.b-marker').length,
  issueStillPresent: Boolean(document.querySelector('#builder-issues .b-issue[data-issue-code="builder.spawn.missing"]')),
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'missing-spawn repair adds an undoable spawn and refreshes validation',
  spawnRepairAfter.markers === spawnRepairBefore.markers + 1 &&
    !spawnRepairAfter.issueStillPresent &&
    spawnRepairAfter.status.includes('ADDED SPAWN'),
  JSON.stringify(spawnRepairAfter),
);
await repairPage.keyboard.press('Control+z');
await repairPage.waitForTimeout(120);
const spawnRepairUndo = await repairPage.evaluate(() => ({
  markers: document.querySelectorAll('.b-marker').length,
}));
check('missing-spawn repair is undoable', spawnRepairUndo.markers === spawnRepairBefore.markers, JSON.stringify(spawnRepairUndo));

await repairPage.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const Metal = 13;
  for (let y = 375; y <= 625; y++)
    for (let x = 430; x <= 770; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  for (let x = 430; x <= 770; x++) {
    const i = w.idx(x, 620);
    w.types[i] = Metal; w.colors[i] = 0x7a8a99;
  }
  ctx.camera.snapTo(600, 500);
});
await repairPage.waitForTimeout(120);
const repairToClient = async (wx, wy) =>
  repairPage.evaluate(([wx, wy]) => {
    const ctx = window.__game.ctx;
    const r = document.getElementById('builder-overlay').getBoundingClientRect();
    const VIEW_W = 525, VIEW_H = 357;
    const ux = ((wx - ctx.camera.renderX) / VIEW_W - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / VIEW_H - 0.5) * ctx.camera.zoom + 0.5;
    return { x: r.left + ux * r.width, y: r.top + uy * r.height };
  }, [wx, wy]);
const repairPlaceAt = async (kind, wx, wy) => {
  await repairPage.click(`.bp-tool[data-kind="${kind}"]`);
  const p = await repairToClient(wx, wy);
  await repairPage.mouse.click(p.x, p.y);
  await repairPage.waitForTimeout(80);
};
await repairPlaceAt('spawn', 470, 616);
await repairPage.click('[data-menu="edit"]');
await repairPage.click('#b-capture');
await repairPage.waitForTimeout(100);
await repairPage.click('[data-menu="edit"]');
await repairPage.click('#b-validate');
await repairPage.waitForTimeout(160);
await repairPage.click('#bp-link-graph-btn');
await repairPage.waitForTimeout(120);
await repairPage.evaluate(() => { window.__game.ctx.state.currentElement = 12; });
await repairPage.click('.bp-tool[data-tool="rectFill"]');
let terrainA = await repairToClient(466, 600);
let terrainB = await repairToClient(474, 616);
await repairPage.mouse.move(terrainA.x, terrainA.y);
await repairPage.mouse.down();
await repairPage.mouse.move(terrainB.x, terrainB.y, { steps: 4 });
await repairPage.mouse.up();
await repairPage.waitForTimeout(220);
const terrainRefreshAfterPaint = await repairPage.evaluate(() => ({
  hasEmbedded: Boolean(document.querySelector('#builder-issues .b-issue[data-issue-code="builder.spawn.embedded"]')),
}));
check(
  'validation panel auto-refresh captures terrain paint before validating with link graph open',
  terrainRefreshAfterPaint.hasEmbedded,
  JSON.stringify(terrainRefreshAfterPaint),
);
await repairPage.keyboard.press('Control+z');
await repairPage.waitForTimeout(220);
const terrainRefreshAfterUndo = await repairPage.evaluate(() => ({
  hasEmbedded: Boolean(document.querySelector('#builder-issues .b-issue[data-issue-code="builder.spawn.embedded"]')),
}));
check(
  'validation panel auto-refresh captures terrain undo before validating with link graph open',
  !terrainRefreshAfterUndo.hasEmbedded,
  JSON.stringify(terrainRefreshAfterUndo),
);
await repairPlaceAt('plate', 510, 619);
await repairPlaceAt('door', 651, 590);
await repairPage.click('.bp-tool[data-tool="link"]');
let linkPoint = await repairToClient(510, 619);
await repairPage.mouse.click(linkPoint.x, linkPoint.y);
await repairPage.waitForTimeout(60);
linkPoint = await repairToClient(651, 590);
await repairPage.mouse.click(linkPoint.x, linkPoint.y);
await repairPage.waitForTimeout(100);
const plateSpawnPoint = await repairToClient(510, 619);
await repairPage.mouse.move(plateSpawnPoint.x, plateSpawnPoint.y);
await repairPage.keyboard.press('t');
await repairPage.waitForTimeout(180);
const plateCursorBlock = await repairPage.evaluate(() => ({
  mode: window.__game.ctx.state.mode,
  status: document.getElementById('builder-status')?.textContent ?? '',
  inspector: document.getElementById('builder-inspector')?.textContent.toLowerCase() ?? '',
}));
check(
  'playtest-here refuses cursor spawns inside linked authored trigger footprints',
  plateCursorBlock.mode !== 'play' &&
    plateCursorBlock.status.includes('CURSOR OVERLAPS PLATE FOOTPRINT') &&
    plateCursorBlock.inspector.includes('plate'),
  JSON.stringify(plateCursorBlock),
);
const doorSpawnPoint = await repairToClient(651, 590);
await repairPage.mouse.move(doorSpawnPoint.x, doorSpawnPoint.y);
await repairPage.keyboard.press('t');
await repairPage.waitForTimeout(180);
const cursorSpawnBlock = await repairPage.evaluate(() => ({
  mode: window.__game.ctx.state.mode,
  status: document.getElementById('builder-status')?.textContent ?? '',
  inspector: document.getElementById('builder-inspector')?.textContent.toLowerCase() ?? '',
}));
check(
  'playtest-here refuses cursor spawns inside compiled structural footprints',
  cursorSpawnBlock.mode !== 'play' &&
    cursorSpawnBlock.status.includes('CURSOR OVERLAPS DOOR FOOTPRINT') &&
    cursorSpawnBlock.inspector.includes('door'),
  JSON.stringify(cursorSpawnBlock),
);
await repairPlaceAt('exitWell', 690, 560);
const wellCasingPoint = await repairToClient(706, 600);
await repairPage.mouse.move(wellCasingPoint.x, wellCasingPoint.y);
await repairPage.keyboard.press('t');
await repairPage.waitForTimeout(180);
const wellCasingBlock = await repairPage.evaluate(() => ({
  mode: window.__game.ctx.state.mode,
  status: document.getElementById('builder-status')?.textContent ?? '',
  inspector: document.getElementById('builder-inspector')?.textContent.toLowerCase() ?? '',
}));
check(
  'playtest-here refuses cursor spawns inside exit-well casing below the plug',
  wellCasingBlock.mode !== 'play' &&
    wellCasingBlock.status.includes('CURSOR OVERLAPS EXITWELL FOOTPRINT') &&
    wellCasingBlock.inspector.includes('exitwell'),
  JSON.stringify(wellCasingBlock),
);
await repairPage.click('#bp-outliner-btn');
await repairPage.waitForTimeout(120);
await repairPage.fill('#bo-search', 'plate');
await repairPage.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('plate'));
  row?.querySelector('button[data-row-toggle="hidden"]')?.click();
});
await repairPage.waitForTimeout(120);
await repairPage.click('[data-menu="edit"]');
await repairPage.click('#b-validate');
await repairPage.waitForTimeout(200);
const hiddenLinkRepairBefore = await repairPage.evaluate(() => {
  const issue = document.querySelector('#builder-issues .b-issue[data-issue-code="builder.link.hiddenEndpoint"]');
  return {
    hasIssue: Boolean(issue),
    hasAction: Boolean(issue?.querySelector('[data-validation-action="removeDeadLink"]')),
    selectedCount: document.querySelectorAll('.b-marker.sel').length,
  };
});
check(
  'validation exposes hidden-link repair action',
  hiddenLinkRepairBefore.hasIssue && hiddenLinkRepairBefore.hasAction,
  JSON.stringify(hiddenLinkRepairBefore),
);
await repairPage.click('#builder-issues [data-validation-filter="warning"]');
await repairPage.waitForTimeout(80);
const validationFilterBeforeRepair = await repairPage.evaluate(() => ({
  filter: document.getElementById('builder-issues')?.dataset.validationFilter ?? '',
  hiddenEndpointVisible: !document.querySelector('#builder-issues .b-issue[data-issue-code="builder.link.hiddenEndpoint"]')?.hidden,
}));
check(
  'validation warning filter is usable before repair',
  validationFilterBeforeRepair.filter === 'warning' && validationFilterBeforeRepair.hiddenEndpointVisible,
  JSON.stringify(validationFilterBeforeRepair),
);
await repairPage.click('#builder-issues .b-issue[data-issue-code="builder.link.hiddenEndpoint"] [data-validation-action="selectIssueTarget"]');
await repairPage.waitForTimeout(120);
const hiddenLinkSelection = await repairPage.evaluate(() => ({
  selectedCount: document.querySelectorAll('.b-marker.sel').length,
  inspector: document.getElementById('builder-inspector')?.textContent.toLowerCase() ?? '',
}));
check(
  'hidden-link validation row can select an affected endpoint',
  hiddenLinkSelection.selectedCount >= 1 && hiddenLinkSelection.inspector.includes('plate'),
  JSON.stringify(hiddenLinkSelection),
);
await repairPage.click('#builder-issues .b-issue[data-issue-code="builder.link.hiddenEndpoint"] [data-validation-action="removeDeadLink"]');
await repairPage.waitForTimeout(160);
const hiddenLinkRepairAfter = await repairPage.evaluate(() => ({
  issueStillPresent: Boolean(document.querySelector('#builder-issues .b-issue[data-issue-code="builder.link.hiddenEndpoint"]')),
  filter: document.getElementById('builder-issues')?.dataset.validationFilter ?? '',
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'hidden-link repair removes the dead link and refreshes validation',
  !hiddenLinkRepairAfter.issueStillPresent &&
    hiddenLinkRepairAfter.filter === 'warning' &&
    hiddenLinkRepairAfter.status.includes('REMOVED DEAD LINK'),
  JSON.stringify(hiddenLinkRepairAfter),
);
await repairPage.keyboard.press('Control+z');
await repairPage.waitForTimeout(120);
const hiddenLinkRepairUndo = await repairPage.evaluate(() => ({
  hasIssue: Boolean(document.querySelector('#builder-issues .b-issue[data-issue-code="builder.link.hiddenEndpoint"]')),
  filter: document.getElementById('builder-issues')?.dataset.validationFilter ?? '',
}));
check(
  'hidden-link repair undo refreshes validation without resetting the filter',
  hiddenLinkRepairUndo.hasIssue && hiddenLinkRepairUndo.filter === 'warning',
  JSON.stringify(hiddenLinkRepairUndo),
);

await repairContext.close();

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
