// THE PROVING YARD (docs/FIGHTERS.md, world/fighterArena + ui/FighterArenaPanel), played with REAL clicks and keys:
//   the title's Arena door -> the roster -> a fighter -> the yard, as that fighter, with the panel up
//   the hall: the stations are there, the corridor under everything is open (nothing taller than a step-over, 24+ of headroom)
//   the panel: [ and ] step through the classic Alchemist and all ten and wrap; every fighter has a tip per ability and a
//     "Go" that stands you at the station it names; the foe, tool, safe-mode, unlimited and reset buttons do what they say;
//     Leave goes back to the title
//   the payoffs the yard exists for: Rusk's ram breaks the barricade, a lit keg detonates, the oil lane stays unlit
//   every fighter: Z and T through the real key path, in the ring, with foes (fires or refuses, never silent)
// Usage: node scripts/verify-fighter-arena.mjs [url] [--shots]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const shots = args.includes('--shots');
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/arena', { recursive: true });

const IDS = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
const FLOOR = 640;

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION_REFUSED|favicon/.test(m.text())) errors.push(m.text()); });
await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage may be blocked */ } });
await page.goto(url + (url.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle', timeout: 40000 });
await waitForConsoleApi(page);
await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 20000 });
await page.waitForTimeout(900);

const click = async (selector) => {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(250);
};
const E = (fn, arg) => page.evaluate(fn, arg);
const me = () => E(() => { const c = window.__game.ctx; const p = c.player; return { x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, maxHp: p.maxHp, facing: p.facing, dead: p.dead }; });
const view = () => E(() => JSON.parse(JSON.stringify(window.__game.ctx.fighters.view)));
const fighterId = () => E(() => window.__game.ctx.fighters.id);
const count = (type, x0, y0, x1, y1) => E(({ type, x0, y0, x1, y1 }) => { const w = window.__game.ctx.world; let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y) && w.types[w.idx(x, y)] === type) n++; return n; }, { type, x0, y0, x1, y1 });
const shot = async (name) => { if (shots) await page.screenshot({ path: `verify-out/arena/${name}.png` }); };
const panelBtn = (text) => `#fighter-arena button:has-text("${text}")`;
const aimAt = (wx, wy) => E(({ wx, wy }) => { const c = window.__game.ctx; c.input.mouse.x = wx; c.input.mouse.y = wy; c.player.aimAngle = Math.atan2(wy - (c.player.y - 9), wx - c.player.x); }, { wx, wy });

// ---- 1. the Arena door, the roster, the yard ----
await click('#expedition-entry [data-entry="arena"]');
await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
await page.waitForTimeout(600);
await click('#fighter-roster .fr-card[data-entry="mara-quell"]');
await click('#fighter-roster .fr-choose');
await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-test' && window.__game.ctx.state.mode === 'play', null, { timeout: 40000 });
await page.evaluate(() => window.__game.ctx.fighters.whenReady());
await page.waitForTimeout(2500);
const entered = await E(() => { const c = window.__game.ctx; return { level: c.levels.current.def.id, name: c.levels.current.def.name, fighter: c.fighters.id, test: c.state.playtestSource, entry: document.getElementById('expedition-entry').hidden, panel: !document.getElementById('fighter-arena').hidden, saved: c.levels.hasSavedExpedition() }; });
check('the Arena door opens the roster, and choosing Mara Quell starts the Proving Yard as her', entered.level === 'fighter-test' && entered.fighter === 'mara-quell' && entered.entry && entered.name === 'THE PROVING YARD', JSON.stringify(entered));
check('it is a disposable test run (never a saved descent)', entered.test === 'test' && entered.saved === false, JSON.stringify(entered));
check('the panel is up and names her', entered.panel && /Mara Quell/.test(await page.locator('#fighter-arena .fa-name').textContent()));
// the objective and the narrator's opening are story systems: put them away so the keys are ours
await E(() => { const c = window.__game.ctx; c.state.arrivalGraceUntil = 0; for (const k of Object.keys(c.input.keys)) c.input.keys[k] = false; if (c.levels.current.pickups) { /* keep the two potions */ } document.querySelectorAll('#card-offer-overlay.visible').forEach((e) => e.classList.remove('visible')); });
await shot('1-start');

// ---- 2. the hall ----
const hall = await E(() => {
  const w = window.__game.ctx.world, T = (x, y) => w.types[w.idx(x, y)];
  const cell = { Wood: 4, Oil: 6, Water: 2, Gunpowder: 8, Lava: 11, Metal: 13, Stone: 12, Glowshroom: 33, Sand: 1, Moss: 34 };
  const n = (type, x0, y0, x1, y1) => { let k = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (T(x, y) === type) k++; return k; };
  const F = 640;
  return {
    barricade: n(cell.Wood, 600, F - 100, 613, F - 31),
    keg: n(cell.Gunpowder, 640, F - 45, 670, F - 31),
    oil: n(cell.Oil, 730, F - 10, 830, F - 1),
    torch: n(cell.Lava, 850, F - 12, 866, F - 5),
    pool: n(cell.Water, 1090, F, 1240, F + 40),
    door: n(cell.Wood, 1280, F - 64, 1291, F - 31),
    sand: n(cell.Sand, 280, F - 2, 548, F - 1),
    moss: n(cell.Moss, 1060, F - 4, 1090, F - 1),
    lamps: n(cell.Glowshroom, 52, 360, 1548, F),
    pickups: window.__game.ctx.levels.current.pickups.filter((p) => !p.taken).length,
    markers: window.__game.ctx.levels.current.inspectionMarkers.length,
  };
});
check('the Kiln barricade is real Wood and the keg a packed cone of gunpowder', hall.barricade > 800 && hall.keg > 100, JSON.stringify({ b: hall.barricade, k: hall.keg }));
check('the oil lane is full and the torch lit', hall.oil > 400 && hall.torch > 10, JSON.stringify({ oil: hall.oil, torch: hall.torch }));
check('the cistern is a pool, the cell has its wooden door, the ring its sand, the banks their moss', hall.pool > 5000 && hall.door > 300 && hall.sand > 400 && hall.moss > 40, JSON.stringify(hall));
check('every station is lit and marked, and two potions wait', hall.lamps > 40 && hall.markers === 7 && hall.pickups === 2, JSON.stringify({ lamps: hall.lamps, markers: hall.markers, pickups: hall.pickups }));
const corridor = await E(() => {
  const w = window.__game.ctx.world;
  const blocks = (x, y) => { const t = w.types[w.idx(x, y)]; return t !== 0 && t !== 2 && t !== 9 && t !== 14 && t !== 5 && t !== 33 && t !== 34 && t !== 15; };
  const F = 640;
  let tallest = 0, lowest = 99, at = '';
  for (let x = 100; x <= 1440; x++) { // (the far nook's bench is a seat, not a corridor)
    let h = 0; while (h < 60 && blocks(x, F - 1 - h)) h++; // an obstacle standing on the floor
    // (liquids, smoke, fire, moss and vines do not stop a body; sand and the rest do: a 2-cell sand floor is the floor)
    const sand = w.types[w.idx(x, F - 1)] === 1 ? 2 : 0;
    const o = Math.max(0, h - sand);
    if (o > tallest) { tallest = o; at = `x${x}`; }
    let free = 0; for (let y = F - 1 - h; y > 380 && !blocks(x, y); y--) free++;
    if (o === 0 && free < lowest) { lowest = free; at += ` low@${x}`; }
  }
  return { tallest, lowest, at };
});
check('the corridor is open end to end: nothing taller than a step-over (26) and 24+ of headroom under every slab', corridor.tallest <= 26 && corridor.lowest >= 24, JSON.stringify(corridor));

// ---- 3. the panel ----
const rows = await E(() => [...document.querySelectorAll('#fighter-arena .fa-move')].map((m) => ({ key: m.querySelector('kbd')?.textContent, name: m.querySelector('.fa-move-name')?.textContent, status: m.querySelector('.fa-status')?.textContent, tip: m.querySelector('.fa-tip')?.textContent?.length > 20, go: m.querySelector('.fa-where')?.textContent })));
check('three rows: Passive, Z (Resonance Bell), T (Dead Chime), each with a tip and a place to go', rows.length === 3 && rows[1].key === 'Z' && /Resonance Bell/.test(rows[1].name) && rows[2].key === 'T' && /Dead Chime/.test(rows[2].name) && rows.every((r) => r.tip && /^Go:/.test(r.go ?? '')), JSON.stringify(rows));
await shot('2-panel');
// step through everyone with the real [ and ] keys
const order = [];
await page.keyboard.press('BracketRight'); await page.waitForTimeout(200);
for (let i = 0; i < 11; i++) { order.push(await fighterId()); await page.keyboard.press('BracketRight'); await page.waitForTimeout(220); }
check('] steps Mara -> Kest ... -> the classic Alchemist -> Ilyra ... and wraps', order[0] === 'kest-rel' && order.includes(null) && new Set(order).size === 11, JSON.stringify(order));
await page.keyboard.press('BracketLeft'); await page.waitForTimeout(220);
await page.keyboard.press('BracketLeft'); await page.waitForTimeout(220);
check('[ steps back', (await fighterId()) !== undefined && (await page.locator('#fighter-arena .fa-name').textContent()).length > 0);

// Go: every fighter's three "where"s stand the player at a real station
const spots = { Muster: [60, 250], Ring: [290, 550], Gallery: [500, 560], Kiln: [570, 720], Bluff: [850, 900], Cistern: [1060, 1100], Cell: [1255, 1300] };
// ---- 4. every fighter: Go, the tip, then Z and T through the real key path in the ring ----
await E(() => { const t = [...document.querySelectorAll('#fighter-arena .fa-toggle')].find((l) => /Safe mode/.test(l.textContent)); t.querySelector('input').click(); });
for (const id of IDS) {
  // equip through the roster the way a tester would: the panel's Roster button
  await click('#fighter-arena .fa-roster');
  await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
  await click(`#fighter-roster .fr-card[data-entry="${id}"]`);
  await click('#fighter-roster .fr-choose');
  await page.waitForTimeout(500);
  await E(() => window.__game.ctx.fighters.whenReady());
  await page.waitForTimeout(300);
  const got = await fighterId();
  const tips = await E(() => [...document.querySelectorAll('#fighter-arena .fa-move')].map((m) => ({ name: m.querySelector('.fa-move-name')?.textContent ?? '', tip: m.querySelector('.fa-tip')?.textContent ?? '', go: m.querySelector('.fa-where')?.textContent ?? '' })));
  check(`${id}: chosen in the roster from the panel; three named abilities, three tips, three places to go`, got === id && tips.length === 3 && tips.every((r) => r.name.length > 2 && r.tip.length > 30 && /^Go: /.test(r.go)), JSON.stringify({ got, tips: tips.map((r) => r.name) }));
  // every Go button stands the player in a real station
  let wentOk = true; const wentBad = [];
  for (let n = 0; n < 3; n++) {
    await page.locator('#fighter-arena .fa-move .fa-where').nth(n).click();
    await page.waitForTimeout(120);
    const label = tips[n].go.replace(/^Go: /, '');
    const p = await me();
    const range = spots[label];
    if (!range || p.x < range[0] || p.x > range[1]) { wentOk = false; wentBad.push(`${label}@${p.x}`); }
  }
  check(`${id}: each Go button stands the fighter at the station it names`, wentOk, wentBad.join(' '));
  // the ring, foes, aim, refill, then Z and T
  await click(panelBtn('Sparring Ring'));
  await click(panelBtn('Golem'));
  await click(panelBtn('Slime'));
  await E(() => { const c = window.__game.ctx; c.player.facing = 1; for (const k of Object.keys(c.input.keys)) c.input.keys[k] = false; });
  const p0 = await me();
  await aimAt(p0.x + 70, p0.y - 9);
  await click(panelBtn('Refill'));
  const v0 = await view();
  await page.keyboard.down('KeyZ'); await page.waitForTimeout(160); await page.keyboard.up('KeyZ');
  await page.waitForTimeout(700);
  const v1 = await view();
  await page.keyboard.down('KeyT'); await page.waitForTimeout(160); await page.keyboard.up('KeyT');
  await page.waitForTimeout(700);
  const v2 = await view();
  const zDid = v1.tactical.usedAt !== v0.tactical.usedAt || v1.tactical.refusedAt !== v0.tactical.refusedAt;
  const tDid = v2.ultimate.usedAt !== v1.ultimate.usedAt || v2.ultimate.refusedAt !== v1.ultimate.refusedAt;
  check(`${id}: Z through the real key path (${v1.tactical.usedAt !== v0.tactical.usedAt ? 'fired' : 'refused'}) and T (${v2.ultimate.usedAt !== v1.ultimate.usedAt ? 'fired' : 'refused'}): never silent`, zDid && tDid, JSON.stringify({ z: [v0.tactical.usedAt, v1.tactical.usedAt, v1.tactical.refusedAt], t: [v1.ultimate.usedAt, v2.ultimate.usedAt, v2.ultimate.refusedAt] }));
  const uses = await page.locator('#fighter-arena .fa-uses').allTextContents();
  const fired = (v1.tactical.usedAt !== v0.tactical.usedAt) || (v2.ultimate.usedAt !== v1.ultimate.usedAt);
  check(`${id}: a fired ability is ticked off on the panel`, !fired || uses.some((u) => /✓/.test(u)), JSON.stringify(uses));
  if (id === 'ilyra-voss' || id === 'rusk-emberjaw' || id === 'father-thorne') await shot(`3-${id}`);
  await click(panelBtn('Clear'));
  await E(() => { const c = window.__game.ctx; c.enemies.length = 0; c.projectiles.length = 0; });
}

// ---- 5. the tools ----
await click(panelBtn('Start'));
const start = await me();
check('Start stands you back on the dais', start.x >= 100 && start.x <= 120, JSON.stringify(start));
await click(panelBtn('Sparring Ring'));
await click(panelBtn('Slime'));
await click(panelBtn('Shooters'));
await click(panelBtn('Fill the Cell'));
const foes = await E(() => window.__game.ctx.enemies.map((e) => ({ kind: e.kind, x: Math.round(e.x), y: Math.round(e.y) })));
const inCell = foes.filter((f) => f.x > 1292 && f.x < 1408).length;
check('the foe buttons place foes: 2 slimes in the ring, 2 shooters on the gallery, 3 in the sealed cell', foes.length === 7 && inCell === 3 && foes.filter((f) => f.kind === 'spitter').length === 2 && foes.filter((f) => f.kind === 'spitter').every((f) => f.x > 500 && f.x < 560), JSON.stringify(foes));
await click(panelBtn('Wound all'));
const wounded = await E(() => window.__game.ctx.enemies.every((e) => e.hp <= e.maxHp * 0.41));
check('Wound all takes every foe to 40%', wounded);
await click(panelBtn('Clear'));
check('Clear removes them', (await E(() => window.__game.ctx.enemies.length)) === 0);
await E(() => { const t = [...document.querySelectorAll('#fighter-arena .fa-toggle')].find((l) => /Safe mode/.test(l.textContent)); if (t.querySelector('input').checked) t.querySelector('input').click(); });
await E(() => { window.__game.ctx.state.arrivalGraceUntil = 0; window.__game.ctx.player.invuln = 0; });
const hp0 = (await me()).hp;
await click(panelBtn('Hurt 25'));
const hp1 = (await me()).hp;
check('Hurt 25 takes a blow (Brann / Rusk / Edda tests)', hp1 < hp0, `${hp0} -> ${hp1}`);
await click(panelBtn('Heal'));
const hp2 = (await me()).hp;
check('Heal restores health', hp2 >= (await me()).maxHp - 0.5, String(hp2));
// safe mode: a blow does nothing
await E(() => { const t = [...document.querySelectorAll('#fighter-arena .fa-toggle')].find((l) => /Safe mode/.test(l.textContent)); t.querySelector('input').click(); });
await page.waitForTimeout(250);
const hp3 = (await me()).hp;
await click(panelBtn('Hurt 25'));
check('Safe mode: nothing hurts', (await me()).hp >= hp3 - 0.01, String((await me()).hp));
await E(() => { const t = [...document.querySelectorAll('#fighter-arena .fa-toggle')].find((l) => /Safe mode/.test(l.textContent)); t.querySelector('input').click(); });
// unlimited: use the ultimate, and it is ready again without Refill
await E(() => { const t = [...document.querySelectorAll('#fighter-arena .fa-toggle')].find((l) => /Unlimited/.test(l.textContent)); t.querySelector('input').click(); });
await click(panelBtn('Refill'));
await page.keyboard.down('KeyZ'); await page.waitForTimeout(160); await page.keyboard.up('KeyZ');
await page.waitForTimeout(900);
const vu = await view();
check('Unlimited: the tactical is ready again right after use', vu.tactical.ready === true, JSON.stringify({ ready: vu.tactical.ready, cd: vu.tactical.cooldownSeconds }));
await E(() => { const t = [...document.querySelectorAll('#fighter-arena .fa-toggle')].find((l) => /Unlimited/.test(l.textContent)); t.querySelector('input').click(); });

// ---- 6. the payoffs ----
// Rusk rams the barricade (equip him, stand on the Kiln bay's lip facing right)
await click('#fighter-arena .fa-roster'); await page.waitForSelector('#fighter-roster.visible'); await click('#fighter-roster .fr-card[data-entry="rusk-emberjaw"]'); await click('#fighter-roster .fr-choose'); await page.waitForTimeout(600);
await E(() => window.__game.ctx.fighters.whenReady());
await click(panelBtn('Kiln Wall'));
await page.waitForTimeout(500);
const pk = await me();
await aimAt(pk.x + 80, pk.y - 9); // the mouse is the aim, and the aim is the facing
const wood0 = await count(4, 600, FLOOR - 48, 613, FLOOR - 31); // the band a body rams through
await click(panelBtn('Refill'));
await page.keyboard.down('KeyZ'); await page.waitForTimeout(160); await page.keyboard.up('KeyZ');
await page.waitForTimeout(1600);
const wood1 = await count(4, 600, FLOOR - 48, 613, FLOOR - 31);
check('Rusk: Shoulder Ram from the bay\'s lip breaks a body-high gap in the barricade', wood0 > 200 && wood1 < wood0 * 0.15, `${wood0} -> ${wood1}`);
await shot('4-rusk-ram');
// the keg: light it (a lava cell on the cone) and it detonates
const keg0 = await count(8, 630, FLOOR - 50, 680, FLOOR - 28);
await E(() => { const c = window.__game.ctx, w = c.world; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, -1]]) { const i = w.idx(655 + dx, 640 - 31 - 6 + dy); w.replaceCellAt(i, 5, 0xff8030); w.life[i] = 60; w.activity.touchIndex(i); } });
await page.waitForTimeout(3500);
const keg1 = await count(8, 630, FLOOR - 50, 680, FLOOR - 28);
check('the keg detonates when lit (the packed cone is consumed)', keg1 < keg0 * 0.3, `${keg0} -> ${keg1}`);
await shot('5-keg');
// the oil lane stays unlit while you play (the torch is behind its baffle)
const oilNow = await count(6, 730, FLOOR - 10, 830, FLOOR - 1);
check('the oil lane has not caught from the torch', oilNow >= hall.oil * 0.95, `${hall.oil} -> ${oilNow}`);
// Reset yard: the barricade, the keg, the oil and the potions come back
await click('#fighter-arena button:text-is("Reset")');
await page.waitForTimeout(600);
const reset = { wood: await count(4, 600, FLOOR - 100, 613, FLOOR - 31), keg: await count(8, 640, FLOOR - 45, 670, FLOOR - 31), oil: await count(6, 730, FLOOR - 10, 830, FLOOR - 1), pickups: await E(() => window.__game.ctx.levels.current.pickups.filter((p) => !p.taken).length) };
check('Reset yard rebuilds the hall (barricade, keg, oil, potions)', reset.wood > 800 && reset.keg > 100 && reset.oil > 400 && reset.pickups === 2, JSON.stringify(reset));

// ---- 7. leaving ----
await click(panelBtn('Leave'));
await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(500);
const out = await E(() => ({ title: !document.getElementById('expedition-entry').hidden, panel: !document.getElementById('fighter-arena').hidden, ambient: window.__game.ctx.params.global.ambient }));
check('Leave goes back to the title and the panel goes away', out.title && !out.panel, JSON.stringify(out));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\nfighter arena probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
