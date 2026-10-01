import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

// THE EXPERIMENT, PLAYED with real input on floor 1's Refuge Kettle (the d1 test run, seed 777):
//   1. the first-brew moment: walk onto the plinth, the Docent's word, siphon water from the cistern and leaves
//      off the tea shrub with E, pour both into the bowl with Q over the embers, wait the six seconds, siphon the
//      brew (E), drink it (X): Strong Tea, a chip that counts down, the Grimoire page, the 5 oz bounty.
//   2. a failed mix is an experiment: a near-miss shimmers with cold/warm/hot per reagent (the bowl panel and the
//      Grimoire's Experiments tab), a clouded mix clouds, then the discovery.
//   3. EVERY shipped recipe: build the bowl with real pours (the flask's cells are the ingredients), real heat (the
//      furnace's embers), wait for the brew, siphon and drink it, assert the status/boon it loads and its length.
//   4. the Grimoire survives a reload; the gold harvester eats a Gold ingredient (why no recipe asks for gold).
// Usage: node scripts/verify-alchemy.mjs [url] [seed] [recipeIdCsv]
const url = process.argv[2] ?? 'http://localhost:5173/';
const seed = Number(process.argv[3] ?? 777);
const only = (process.argv[4] ?? '').split(',').filter(Boolean);
const output = 'verify-out/alchemy';
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [], seed, tea: {}, experiment: {}, recipes: {}, reload: {}, harvester: {} };
page.on('pageerror', (e) => report.errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket connection/.test(m.text())) report.errors.push('console: ' + m.text()); });

const evalGame = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: `${output}/${name}.png` });

async function pointAtWorld(worldX, worldY) {
  const target = await page.evaluate(({ worldX, worldY }) => {
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
const playerX = () => page.evaluate(() => window.__game.ctx.player.x);
async function walkTo(x, slack = 6) {
  // Hold the direction like a player; hop any lip that stops us; feather the last cells.
  let px = await playerX(), last = px, still = 0;
  const key = px < x ? 'KeyD' : 'KeyA', sign = px < x ? 1 : -1;
  await page.keyboard.down(key);
  for (let i = 0; i < 160 && sign * (x - px) > slack; i++) {
    await page.waitForTimeout(50); px = await playerX();
    still = Math.abs(px - last) < 0.5 ? still + 1 : 0; last = px;
    if (still >= 3) { await page.keyboard.down('Space'); await page.waitForTimeout(380); await page.keyboard.up('Space'); still = 0; }
  }
  await page.keyboard.up(key);
  await page.waitForTimeout(250);
}
/** A cursor holds a SCREEN position: the world cell under it moves while the camera glides after a walk or a teleport. */
async function settleCamera() {
  let last = null, still = 0;
  for (let i = 0; i < 100 && still < 8; i++) {
    const p = await page.evaluate(() => { const cam = window.__game.ctx.camera; return [cam.x, cam.y]; });
    still = last && Math.abs(p[0] - last[0]) < 0.05 && Math.abs(p[1] - last[1]) < 0.05 ? still + 1 : 0;
    last = p;
    await page.waitForTimeout(60);
  }
}
const slotKey = (i) => `Digit${i + 3}`; // flask slots are 3-6 on the keyboard
const view = () => page.evaluate(() => window.__game.ctx.brewing.view());
const bowlCount = async (cell) => (await view()).reagents.find((r) => r.cell === cell)?.n ?? 0;
const flask = (i) => page.evaluate((i) => ({ ...window.__game.ctx.flask.slots[i] }), i);
const alch = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__alch)));
const panelText = () => page.evaluate(() => { const el = document.getElementById('bowl-panel'); return el && !el.hidden ? el.innerText.replace(/\s*\n+\s*/g, ' | ') : null; });

/**
 * Hold Q over the bowl until it holds `need` of `cell`. The pour is measured (a cell every four frames over a bowl) and a
 * droplet is in the air for a few frames after it leaves the flask, so: hold until one short, release, let the last land,
 * then tap Q (one droplet a tap) for the rest. A bowl holds ~14 cells: pouring one cell too many spills the next ingredient.
 */
async function pourInto(slot, cell, need, c) {
  await settleCamera();
  await page.keyboard.press(slotKey(slot));
  await pointAtWorld(c.x, c.y - 3);
  const t0 = Date.now();
  let n = await bowlCount(cell);
  if (n < need - 1) {
    await page.keyboard.down('KeyQ');
    while (n < need - 1 && Date.now() - t0 < 14000) { await pointAtWorld(c.x, c.y - 3); await page.waitForTimeout(30); n = await bowlCount(cell); }
    await page.keyboard.up('KeyQ');
    await page.waitForTimeout(450); // the droplets in the air land
    n = await bowlCount(cell);
  }
  for (let tap = 0; n < need && tap < 12; tap++) {
    await pointAtWorld(c.x, c.y - 3);
    await page.keyboard.down('KeyQ'); await page.waitForTimeout(75); await page.keyboard.up('KeyQ');
    await page.waitForTimeout(420);
    n = await bowlCount(cell);
  }
  return { n, ms: Date.now() - t0 };
}
/** Hold E over `target` until the slot holds `want` cells (or it stops growing). */
async function siphonInto(slot, tx, ty, want, timeout = 6000) {
  await settleCamera();
  await page.keyboard.press(slotKey(slot));
  await pointAtWorld(tx, ty);
  const t0 = Date.now();
  await page.keyboard.down('KeyE');
  let s = await flask(slot);
  while (s.count < want && Date.now() - t0 < timeout) { await pointAtWorld(tx, ty); await page.waitForTimeout(40); s = await flask(slot); }
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(150);
  return { ...(await flask(slot)), ms: Date.now() - t0 };
}
/** Hold X with a potion slot selected until it is swallowed (or the cup is full). */
async function drink(slot, maxMs = 5000) {
  await page.keyboard.press(slotKey(slot));
  const t0 = Date.now();
  await page.keyboard.down('KeyX');
  let s = await flask(slot);
  while (s.count > 0 && Date.now() - t0 < maxMs) { await page.waitForTimeout(60); s = await flask(slot); }
  await page.keyboard.up('KeyX');
  await page.waitForTimeout(150);
  return { ...(await flask(slot)), ms: Date.now() - t0 };
}
const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const statusOf = () => page.evaluate(() => { const st = window.__game.ctx.player.status; return { regen: st.regen, levity: st.levity, stoneskin: st.stoneskin, swift: st.swift, torch: st.torch, boons: { ...(st.boons ?? {}) } }; });
const clearStatus = () => page.evaluate(() => { const st = window.__game.ctx.player.status; st.regen = st.levity = st.stoneskin = st.swift = st.torch = 0; st.boons = {}; });
const clearBowl = (c) => page.evaluate((c) => {
  const w = window.__game.ctx.world;
  for (let dy = -5; dy <= 0; dy++) for (let dx = -3; dx <= 3; dx++) w.clearCellAt(w.idx(c.x + dx, c.y + dy));
}, c);

try {
  await page.goto(url);
  await page.evaluate(() => { localStorage.removeItem('noita-grimoire'); localStorage.removeItem('noita-grimoire-lore'); });
  await execConsoleCommand(page, `run test --level d1 --world campaign-level --seed ${seed} --loadout fresh`, { timeout: 90000 });
  await waitForRunReady(page, { timeout: 90000 });
  await page.waitForTimeout(1200);
  const K = await evalGame(() => {
    const ctx = window.__game.ctx;
    ctx.enemies.length = 0;
    window.__alch = { brewed: [], attempts: [], discovered: [], clues: [], toasts: [], narration: [] };
    const A = window.__alch;
    ctx.events.on('recipeBrewed', (e) => A.brewed.push({ id: e.id, first: e.firstDiscovery, f: ctx.state.frameCount }));
    ctx.events.on('brewAttempt', (e) => A.attempts.push({ verdict: e.verdict, closeTo: e.closeTo, feel: e.feel, first: e.first, tries: e.tries, f: ctx.state.frameCount }));
    ctx.events.on('recipeDiscovered', (e) => A.discovered.push({ name: e.name, bounty: e.bounty }));
    ctx.events.on('clueUnlocked', (e) => A.clues.push(e.id));
    ctx.events.on('toast', (e) => A.toasts.push(e.text));
    ctx.events.on('narration', (e) => A.narration.push(e.text));
    return { cauldron: ctx.levels.current.cauldron, score: ctx.state.score };
  });
  const c = K.cauldron;
  assert.ok(c && c.x === 800 && c.y === 742, `floor 1 has its Refuge Kettle (${JSON.stringify(c)})`);
  report.cauldron = c;

  // ---------- 0. the walk: nothing stands in the way of the plinth, and the kettle's heat does not touch the walker ----------
  await evalGame(() => { const ctx = window.__game.ctx; ctx.player.x = 758; ctx.player.y = 745; ctx.player.vx = 0; ctx.player.vy = 0; ctx.state.arrivalGraceUntil = 0; });
  await page.waitForTimeout(600);
  const hp0 = await evalGame(() => window.__game.ctx.player.hp);
  await walkTo(808, 2); // (he glides on 16-40 cells: short of the Frost Shard tome at 892; the heart at 820 is +20 max HP on the way)
  await page.waitForTimeout(1600);
  const walked = await playerX();
  assert.ok(walked > 806, `the walk east from the west steps over the shrub, the cistern grate and the kettle's rim is clear (reached x=${walked})`);
  // (the walk passes the refuge's heart, +20 max HP: health may only go up)
  assert.ok((await evalGame(() => window.__game.ctx.player.hp)) >= hp0, 'crossing the kettle costs nothing: the furnace is sealed under the plinth');
  report.walk = { reachedX: walked };
  // back to the kettle's west side to work (a teleport: the walk back is the same walk)
  await evalGame(() => { const ctx = window.__game.ctx; ctx.player.x = 790; ctx.player.y = 743; ctx.player.vx = 0; ctx.player.vy = 0; });
  await settleCamera();
  await shot('01-kettle-arrival');

  report.arrival = await evalGame(async () => { const ctx = window.__game.ctx; const f0 = ctx.state.frameCount; await new Promise((r) => setTimeout(r, 500)); return { paused: ctx.state.paused, mode: ctx.state.mode, framesIn500ms: ctx.state.frameCount - f0, x: ctx.player.x, y: ctx.player.y, dead: ctx.player.dead, hp: ctx.player.hp }; });
  console.log('arrival', JSON.stringify(report.arrival));
  // ---------- 0b. the harvester eats a Gold ingredient: why no recipe asks for gold ----------
  const g0 = await evalGame((c) => {
    const ctx = window.__game.ctx; const w = ctx.world;
    for (let i = 0; i < 5; i++) { const idx = w.idx(c.x - 2 + i, c.y); w.replaceCellAt(idx, 17, 0xf5c31e); }
    return ctx.state.score;
  }, c);
  await page.waitForTimeout(900);
  const gold = await evalGame((c) => { const ctx = window.__game.ctx; const w = ctx.world; let left = 0; for (let i = 0; i < 5; i++) if (w.types[w.idx(c.x - 2 + i, c.y)] === 17) left++; return { left, score: ctx.state.score }; }, c);
  report.harvester = { goldLeft: gold.left, scoreGain: gold.score - g0 };
  assert.equal(gold.left, 0, 'the harvester banks gold dropped in the bowl within a second (so no recipe may ask for it)');
  assert.ok(gold.score > g0);
  await clearBowl(c);

  // ---------- 1. the first-brew moment ----------
  await evalGame(() => { const ctx = window.__game.ctx; ctx.flask.setSlot(0, null, 0); ctx.flask.setSlot(1, null, 0); ctx.flask.setSlot(2, null, 0); ctx.flask.setSlot(3, null, 0); });
  const score0 = await evalGame(() => window.__game.ctx.state.score);
  await page.waitForTimeout(1500);
  const panel0 = await panelText();
  assert.ok(panel0 && /FIRE|fire/.test(panel0) && !/no fire/i.test(panel0), `the bowl panel reads a lit furnace under an empty bowl (${panel0})`);
  const aside = await alch();
  report.tea.docentHeard = aside.narration.some((t) => /A kettle, lit before you arrived/.test(t));
  report.tea.narrationSeen = aside.narration.slice(0, 4);
  // water from the cistern (slot 0), leaves off the shrub (slot 1)
  const water = await siphonInto(0, 789, 747, 12);
  assert.ok(water.material === 2 && water.count >= 9, `E drew ${water.count} water out of the cistern under its grate (${water.ms} ms)`);
  const leaves = await siphonInto(1, 772, 741, 8);
  assert.ok(leaves.material === 39 && leaves.count >= 4, `E drew ${leaves.count} leaves off the tea shrub (${leaves.ms} ms)`);
  report.tea.siphon = { water: water.count, leaves: leaves.count };
  const pw = await pourInto(0, 2, 9, c);
  await shot('02-tea-water-poured');
  const pl = await pourInto(1, 39, 4, c);
  assert.ok(pw.n >= 9 && pl.n >= 4, `Q poured the bowl up to ${pw.n} water and ${pl.n} leaves`);
  report.tea.pour = { water: pw, leaves: pl };
  const sim = await panelText();
  await shot('03-tea-simmering');
  await waitFor(() => window.__alch.brewed.some((b) => b.id === 'tea'), null, 40000);
  const brewedAt = (await alch()).brewed.find((b) => b.id === 'tea');
  assert.equal(brewedAt.first, true, 'the first brew of tea is the discovery');
  report.tea.panelWhileSimmering = sim;
  await page.waitForTimeout(500);
  await shot('04-tea-brewed');
  const product = await view();
  assert.ok(product.elixir && product.elixir.cell === 44 && product.elixir.n >= 10, `the bowl holds Strong Tea (${JSON.stringify(product.elixir)})`);
  const got = await siphonInto(3, c.x, c.y - 1, product.elixir.n);
  assert.equal(got.material, 44);
  report.tea.potion = got.count;
  await clearStatus();
  const sip = await drink(3, 6000);
  await page.waitForTimeout(300);
  const st = await statusOf();
  report.tea.status = st;
  assert.ok(st.swift > 1800, `a bowl of tea is over thirty seconds of swiftness (${st.swift} frames)`);
  assert.ok((st.boons.manafont ?? 0) > 1800, `...and of a wand that refills faster (${st.boons.manafont} frames)`);
  const chip1 = await page.evaluate(() => { const el = document.querySelector('#vitals-aside .potion-chip'); return el ? el.innerText.replace(/\s+/g, ' ').trim() : null; });
  await shot('05-tea-chip');
  await page.waitForTimeout(2200);
  const chip2 = await page.evaluate(() => { const el = document.querySelector('#vitals-aside .potion-chip'); return el ? el.innerText.replace(/\s+/g, ' ').trim() : null; });
  report.tea.chips = [chip1, chip2];
  assert.ok(chip1 && /SWIFT/.test(chip1), `the HUD shows the potion (${chip1})`);
  const secs = (t) => Number((/(\d+)s/.exec(t ?? '') ?? [])[1] ?? NaN);
  assert.ok(secs(chip2) < secs(chip1), `the chip counts down (${chip1} -> ${chip2})`);
  const after = await evalGame(() => ({ score: window.__game.ctx.state.score, rec: JSON.parse(localStorage.getItem('noita-grimoire') ?? '{}') }));
  assert.equal(after.score - score0, 5, 'the first-brew bounty is a small flat 5 oz');
  assert.equal(after.rec.recipes?.tea, true, 'the Grimoire has the tea page');
  report.tea.bounty = after.score - score0;
  report.tea.drinkMs = sip.ms;

  if (only.length === 0) {
    // ---------- 2. a failed mix is an experiment: cloud, shimmer, then the discovery ----------
    await evalGame(() => { const ctx = window.__game.ctx; ctx.flask.setSlot(0, 2, 60); ctx.flask.setSlot(1, 33, 60); ctx.flask.setSlot(2, 6, 60); ctx.flask.setSlot(3, null, 0); window.__alch.brewed.length = 0; });
    await clearBowl(c);
    await page.waitForTimeout(400);
    // (a) Glowing Draught's amounts (oil 7, glowshroom 4) spoiled by three cells of water: the brew clouds
    await evalGame(() => { const ctx = window.__game.ctx; ctx.flask.setSlot(2, 6, 60); ctx.flask.setSlot(3, 33, 60); });
    await pourInto(2, 6, 7, c);
    await pourInto(3, 33, 4, c);
    await pourInto(0, 2, 3, c);
    await waitFor(() => window.__alch.attempts.some((a) => a.verdict === 'muddy'), null, 25000);
    report.experiment.muddy = await panelText();
    assert.ok(/cloud|does not belong/i.test(report.experiment.muddy), `the panel says the brew clouds (${report.experiment.muddy})`);
    await shot('06-muddy-panel');
    await clearBowl(c);
    await page.waitForTimeout(500);
    // (b) water and a little glowshroom: a near-miss of something undiscovered (judged once the bowl has stood a moment)
    const mark = (await alch()).attempts.length;
    const w8 = await pourInto(0, 2, 8, c);
    const b3 = await pourInto(1, 33, 3, c);
    report.experiment.poured = { water: w8.n, glowshroom: b3.n };
    await waitFor((from) => window.__alch.attempts.slice(from).some((a) => a.verdict === 'close' && a.closeTo === 'life'), mark, 25000);
    const near = (await alch()).attempts.slice(mark).find((a) => a.verdict === 'close' && a.closeTo === 'life');
    report.experiment.near = near;
    assert.equal(near.closeTo, 'life');
    assert.equal(near.feel['2'], 'hot'); assert.equal(near.feel['33'], 'warm');
    const shimmer = await panelText();
    report.experiment.panel = shimmer;
    assert.ok(/warm/i.test(shimmer) && /hot/i.test(shimmer), `the bowl panel shows the temperatures (${shimmer})`);
    assert.ok(!/life|mending/i.test(shimmer), 'and does not name the recipe');
    await shot('07-near-miss-panel');
    // (c) the Grimoire's Experiments tab keeps both attempts
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(500);
    await page.locator('#grimoire-overlay .grimoire-tabs button[data-tab="experiments"]').click();
    await page.waitForTimeout(400);
    const logText = await page.evaluate(() => document.getElementById('grimoire-overlay')?.innerText ?? '');
    report.experiment.logLines = logText.split('\n').filter((l) => l.trim()).slice(0, 14);
    assert.ok(/shimmer|close/i.test(logText) && /cloud|muddy/i.test(logText), 'the Experiments tab keeps the near-miss and the clouded mix');
    await shot('08-grimoire-experiments');
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(300);
    // (d) the fix: two more glowshroom, the discovery
    await pourInto(1, 33, 5, c);
    await waitFor(() => window.__alch.brewed.some((b) => b.id === 'life'), null, 40000);
    assert.equal((await alch()).brewed.find((b) => b.id === 'life').first, true, 'the corrected mix is the discovery of Life');
    await page.waitForTimeout(400);
    await shot('09-life-discovered');
    report.experiment.afterDiscovery = await panelText();
    await clearBowl(c);

  }

  // ---------- 3. every shipped recipe, with real pours, real heat, real siphon and drink ----------
  const recipes = await evalGame(async () => {
    const { RECIPES } = await import('/src/content/recipes.ts');
    const { elixirDef } = await import('/src/content/elixirs.ts');
    const { isLiquid } = await import('/src/sim/CellType.ts');
    return RECIPES.map((r) => ({ id: r.id, name: r.name, elixir: r.elixir, needs: r.needs.map((n) => ({ cell: n.cell, min: n.min, liquid: isLiquid(n.cell) })).sort((a, b) => Number(a.liquid) - Number(b.liquid)), def: (() => { const d = elixirDef(r.elixir); return { per: d.framesPerCell, effect: d.effect, also: d.also ?? null, label: d.chip.label }; })() }));
  });
  report.recipeCount = recipes.length;
  const roster = only.length ? recipes.filter((r) => only.includes(r.id)) : recipes;
  for (const r of roster) {
    await clearBowl(c);
    await clearStatus();
    await evalGame((r) => {
      const ctx = window.__game.ctx;
      ctx.flask.setSlot(3, null, 0);
      r.needs.forEach((n, i) => ctx.flask.setSlot(i, n.cell, 60));
      for (let i = r.needs.length; i < 3; i++) ctx.flask.setSlot(i, null, 0);
      window.__alch.brewed.length = 0;
      return ctx.flask.slots.map((s) => [s.material, s.count]);
    }, r);
    await page.waitForTimeout(500);
    const poured = [];
    const trace = [];
    for (const [i, n] of r.needs.entries()) {
      poured.push(await pourInto(i, n.cell, n.min, c));
      trace.push(await evalGame(() => { const ctx = window.__game.ctx; return { active: ctx.flask.activeIndex, slots: ctx.flask.slots.map((x) => x.count), bowl: ctx.brewing.view().reagents.map((x) => x.cell + 'x' + x.n).join(' ') }; }));
    }
    const t0 = Date.now();
    let brew = null;
    try { await waitFor((id) => window.__alch.brewed.some((b) => b.id === id), r.id, 35000); brew = (await alch()).brewed.find((b) => b.id === r.id); } catch { /* reported below */ }
    const panel = await panelText();
    const v = await view();
    const rec = { trace, poured: poured.map((p) => p.n), brewedAfterMs: brew ? Date.now() - t0 : null, panel, productCells: v.elixir?.n ?? 0, bowl: v.reagents.map((x) => `${x.cell}x${x.n}`).join(' ') };
    if (!brew) { await shot(`recipe-${r.id}-FAILED`); report.recipes[r.id] = { ...rec, ok: false }; continue; }
    // siphon the brew and drink it
    const sp = await siphonInto(3, c.x, c.y - 1, Math.max(1, v.elixir?.n ?? 1));
    const dr = await drink(3, 7000);
    await page.waitForTimeout(250);
    const st2 = await statusOf();
    const keyed = (fx) => (fx.kind === 'status' ? st2[fx.key] : st2.boons[fx.key] ?? 0);
    const got1 = keyed(r.def.effect);
    const expectMin = Math.floor(0.6 * r.def.per * sp.count);
    rec.siphoned = sp.count; rec.material = sp.material; rec.effect = `${r.def.effect.kind}:${r.def.effect.key}`; rec.frames = got1; rec.seconds = Math.round(got1 / 6) / 10; rec.drinkMs = dr.ms;
    rec.also = r.def.also ? keyed(r.def.also) : null;
    rec.ok = sp.material === r.elixir && got1 >= expectMin && got1 > 900 && (!r.def.also || rec.also >= expectMin);
    report.recipes[r.id] = rec;
    if (r.id === 'brimstone' || r.id === 'salamander') await shot(`recipe-${r.id}`);
    await clearBowl(c);
  }
  const failed = Object.entries(report.recipes).filter(([, x]) => !x.ok).map(([id]) => id);
  assert.deepEqual(failed, [], `every shipped recipe brews, siphons and drinks for a meaningful time: ${JSON.stringify(failed.map((id) => report.recipes[id]))}`);
  if (!only.length) {
    const rec = await evalGame(() => JSON.parse(localStorage.getItem('noita-grimoire') ?? '{}'));
    assert.equal(Object.keys(rec.recipes ?? {}).length, recipes.length, 'every recipe is in the Grimoire');
    assert.equal(rec.version, 3);
    report.grimoire = { recipes: Object.keys(rec.recipes).length, experiments: Object.keys(rec.experiments ?? {}).length, clues: Object.keys(rec.clues ?? {}).length };
    // the elixirs tab, once everything is known
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(500);
    await page.locator('#grimoire-overlay .grimoire-tabs button[data-tab="elixirs"]').click();
    await page.waitForTimeout(400);
    await shot('10-grimoire-elixirs-complete');
    await page.keyboard.press('KeyJ');

    // ---------- 4. the Grimoire survives a reload ----------
    await page.reload();
    await execConsoleCommand(page, `run test --level d1 --world campaign-level --seed ${seed} --loadout fresh`, { timeout: 90000 });
    await waitForRunReady(page, { timeout: 90000 });
    await page.waitForTimeout(800);
    const rec2 = await evalGame(() => JSON.parse(localStorage.getItem('noita-grimoire') ?? '{}'));
    assert.equal(Object.keys(rec2.recipes ?? {}).length, recipes.length, 'the recipes survive a reload');
    assert.ok(Object.keys(rec2.experiments ?? {}).length >= 1, 'and so does the experiment log');
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(500);
    const known = await page.evaluate(() => document.getElementById('grimoire-overlay')?.innerText.match(/(\d+)\s*\/\s*(\d+)\s*known/i)?.slice(1, 3) ?? null);
    report.reload = { recipes: Object.keys(rec2.recipes).length, experiments: Object.keys(rec2.experiments ?? {}).length, headerKnown: known };
    await shot('11-grimoire-after-reload');
  }
  assert.deepEqual(report.errors, [], 'no page errors');
} catch (err) {
  report.failure = String(err?.stack ?? err);
  try { report.finalView = await view(); report.finalAlch = await alch(); report.finalPanel = await panelText(); } catch { /* the page may be gone */ }
  await shot('FAILED').catch(() => undefined);
  throw err;
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
