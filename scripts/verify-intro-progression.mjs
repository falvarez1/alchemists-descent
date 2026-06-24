// Runtime probe for the D1 intro/progression spine. It starts a fresh
// expedition, verifies the starter kit and Spell Lab are present, then advances
// the objective through movement, wand, flask, lab, bench, and normal key-loop states.
// Usage: node scripts/verify-intro-progression.mjs [url]
import { chromium } from 'playwright-core';
import { startConsolePlayRun } from './run-helpers.mjs';

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
page.on('console', (msg) => {
  if (msg.type() === 'error') pageErrors.push(msg.text());
});
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await page.evaluate(() => {
  localStorage.removeItem('alchemists-descent-seen-hints-v1');
  window.__introProbe = { objectives: [], teaches: [], casts: [], flasks: [], toasts: [] };
  const ctx = window.__game.ctx;
  ctx.events.on('objectiveChanged', (e) => window.__introProbe.objectives.push(e.text));
  ctx.events.on('hintTeach', (e) => window.__introProbe.teaches.push(e.key));
  ctx.events.on('cardCast', (e) => window.__introProbe.casts.push(`${e.origin}:${e.id}`));
  ctx.events.on('flaskUsed', (e) => window.__introProbe.flasks.push(`${e.verb}:${e.amount}`));
  ctx.events.on('toast', (e) => window.__introProbe.toasts.push(e.text));
});

await startConsolePlayRun(page, { seed: 7, settleMs: 900 });
await page.evaluate(() => {
  window.__game.ctx.state.paused = false;
});

const boot = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  return {
    levelId: rt?.def.id ?? null,
    depth: rt?.def.depth ?? null,
    objective: document.getElementById('objective')?.textContent ?? '',
    controls: document.getElementById('controls-hint')?.textContent ?? '',
    spellLab: rt?.spellLab ?? null,
    starterFlask: { material: ctx.flask.state.material, count: ctx.flask.state.count },
    wands: ctx.wands.wands.map((w) => w.cards.slice()),
  };
});
check('fresh run starts at D1', boot.levelId === 'd1' && boot.depth === 1, JSON.stringify(boot));
check('starter kit has Spark, Dig, and water flask', boot.wands[0]?.[0] === 'spark' && boot.wands[1]?.[0] === 'dig' && boot.starterFlask.count === 300, JSON.stringify(boot));
check('D1 generated the Spell Lab annex', !!boot.spellLab, JSON.stringify(boot));
check('intro objective starts on the surface', /DESCEND INTO THE CAVE/.test(boot.objective), JSON.stringify(boot));
check('surface objective shows surface controls', /surface/.test(boot.controls) && /drop in/.test(boot.controls), JSON.stringify(boot));

const advance = async (setup) => {
  await page.evaluate((source) => {
    const ctx = window.__game.ctx;
    ctx.state.paused = false;
    new Function('ctx', source)(ctx);
    for (let i = 0; i < 10; i++) window.__game.tick();
  }, setup);
  return page.evaluate(() => ({
    objective: document.getElementById('objective')?.textContent ?? '',
    controls: document.getElementById('controls-hint')?.textContent ?? '',
  }));
};

// Drop down the cave mouth: place the wizard in the spawn chamber (well below the
// surface, but WITHOUT jumping) so the descent is detected and the intro hands
// off from the surface stage to movement — exactly as a real fall would.
const descend = await advance(`
  const rt = ctx.levels.current;
  ctx.player.x = rt.spawn.x;
  ctx.player.y = rt.spawn.y;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
`);
check('dropping into the cave mouth flips to the movement objective', /MOVE THROUGH THE CAVE/.test(descend.objective), JSON.stringify(descend));
check('movement objective shows movement controls', /A \/ D/.test(descend.controls) && /SPACE/.test(descend.controls), JSON.stringify(descend));
check('descending fires the INTO THE DEPTHS toast', (await page.evaluate(() => window.__introProbe.toasts)).some((t) => /DEPTH/i.test(t)), '');

let objective = await advance(`
  const rt = ctx.levels.current;
  ctx.player.x = rt.spawn.x + 28;
  ctx.player.y = rt.spawn.y - 7;
  ctx.player.levit = Math.max(0, ctx.player.levit - 8);
`);
check('movement advances to Spark objective', /SPARK/.test(objective.objective), JSON.stringify(objective));
check('Spark objective shows Wand I controls', /1/.test(objective.controls) && /LMB/.test(objective.controls), JSON.stringify(objective));

objective = await advance(`
  ctx.wands.active = 0;
  ctx.input.mouse.x = ctx.player.x + 48;
  ctx.input.mouse.y = ctx.player.y - 8;
  ctx.wands.fire(ctx);
`);
check('Spark cast advances to Excavate objective', /EXCAVATE/.test(objective.objective), JSON.stringify(objective));
check('Dig objective shows Wand II controls', /2 \/ wheel/.test(objective.controls) && /LMB/.test(objective.controls), JSON.stringify(objective));

objective = await advance(`
  ctx.wands.active = 1;
  ctx.input.mouse.x = ctx.player.x + 48;
  ctx.input.mouse.y = ctx.player.y - 8;
  ctx.wands.fire(ctx);
`);
check('Dig cast advances to starter flask objective', /STARTER FLASK/.test(objective.objective), JSON.stringify(objective));
check('flask objective shows flask controls', /E/.test(objective.controls) && /Q/.test(objective.controls) && /RMB/.test(objective.controls), JSON.stringify(objective));

objective = await advance(`
  ctx.input.mouse.x = ctx.player.x + 34;
  ctx.input.mouse.y = ctx.player.y - 8;
  ctx.input.pourHeld = true;
  ctx.flask.update(ctx);
  ctx.input.pourHeld = false;
`);
check('flask use advances toward Spell Lab', /SPELL LAB/.test(objective.objective), JSON.stringify(objective));

const labHint = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.paused = false;
  const lab = ctx.levels.current.spellLab;
  ctx.player.x = lab.x + 30;
  ctx.player.y = lab.y;
  ctx.camera.snapTo(ctx.player.x, ctx.player.y);
  for (let i = 0; i < 12; i++) window.__game.tick();
  const cur = ctx.hints.current;
  const hintEl = document.getElementById('interaction-hint');
  return {
    objective: document.getElementById('objective')?.textContent ?? '',
    key: cur?.key ?? null,
    line: cur?.line ?? '',
    hudVisible: !!hintEl?.classList.contains('visible'),
    hudText: hintEl?.textContent ?? '',
  };
});
check('reaching the lab switches to dig-station objective', /EXCAVATE THE SAND/.test(labHint.objective), JSON.stringify(labHint));
check('lab proximity produces a contextual hint', labHint.hudVisible && ['spell-lab', 'carried-cells', 'chargelatch', 'burn-wood', 'dig-sand', 'flask'].includes(labHint.key), JSON.stringify(labHint));

objective = await advance(`
  const lab = ctx.levels.current.spellLab;
  ctx.player.x = lab.x + 12;
  ctx.player.y = lab.y;
  ctx.player.recharge = 0;
  ctx.player.pullT = 0;
  ctx.player.climbing = false;
  ctx.wands.active = 1;
  ctx.wands.wands[1].cooldown = 0;
  ctx.wands.wands[1].mana = ctx.wands.wands[1].frame.manaMax;
  ctx.input.mouse.x = lab.x - 18;
  ctx.input.mouse.y = lab.y;
  ctx.wands.fire(ctx);
`);
check('lab Dig advances to water-station objective', /POUR WATER/.test(objective.objective), JSON.stringify(objective));
check('lab water objective shows flask controls', /Q/.test(objective.controls) && /RMB/.test(objective.controls), JSON.stringify(objective));

objective = await advance(`
  const lab = ctx.levels.current.spellLab;
  ctx.player.x = lab.x + 5;
  ctx.player.y = lab.y;
  ctx.input.mouse.x = lab.x + 4;
  ctx.input.mouse.y = lab.y;
  ctx.input.pourHeld = true;
  ctx.flask.update(ctx);
  ctx.input.pourHeld = false;
`);
check('lab water use advances to spark-station objective', /SPARK THE COIL/.test(objective.objective), JSON.stringify(objective));

objective = await advance(`
  const lab = ctx.levels.current.spellLab;
  ctx.player.x = lab.x + 12;
  ctx.player.y = lab.y;
  ctx.player.recharge = 0;
  ctx.player.pullT = 0;
  ctx.player.climbing = false;
  ctx.wands.active = 0;
  ctx.wands.wands[0].cooldown = 0;
  ctx.wands.wands[0].mana = ctx.wands.wands[0].frame.manaMax;
  ctx.input.mouse.x = lab.x + 18;
  ctx.input.mouse.y = lab.y;
  ctx.wands.fire(ctx);
`);
check('lab Spark advances to tome objective', /CLAIM THE TOME/.test(objective.objective), JSON.stringify(objective));

objective = await advance(`
  ctx.wands.grantCard(ctx, 'heavy');
`);
check('claiming lab reward enters the bench loop', /SLOT HEAVY|BENCH AVAILABLE/.test(objective.objective), JSON.stringify(objective));
check('bench objective shows bench controls', /B/.test(objective.controls) && /Heavy/.test(objective.controls), JSON.stringify(objective));

const benchResult = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.paused = false;
  const heavyIndex = ctx.wands.collection.indexOf('heavy');
  if (heavyIndex >= 0) ctx.wands.slotCollectionCard(heavyIndex, 0, 1);
  for (let i = 0; i < 10; i++) window.__game.tick();
  return {
    objective: document.getElementById('objective')?.textContent ?? '',
    heavySlotted: ctx.wands.wands.some((wand) => wand.cards.includes('heavy')),
    heavyInCollection: ctx.wands.collection.includes('heavy'),
  };
});
check('slotting Heavy completes the intro bench lesson', benchResult.heavySlotted && !benchResult.heavyInCollection, JSON.stringify(benchResult));

const resetAfterReward = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.paused = false;
  ctx.player.x = ctx.levels.current.spawn.x;
  ctx.player.y = ctx.levels.current.spawn.y;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.player.levit = ctx.player.maxLevit;
  ctx.input.keys.jump = false;
  ctx.input.keys.up = false;
  // Simulate a level revisit/inactive frame: the intro controller resets itself
  // when play mode is inactive, while the runtime reward state remains real.
  ctx.state.mode = 'build';
  window.__game.tick();
  ctx.state.mode = 'play';
  for (let i = 0; i < 740; i++) window.__game.tick();
  return {
    objective: document.getElementById('objective')?.textContent ?? '',
    controls: document.getElementById('controls-hint')?.textContent ?? '',
    heavySlotted: ctx.wands.wands.some((wand) => wand.cards.includes('heavy')),
  };
});
check('intro reset after slotted Heavy stays on the key loop', resetAfterReward.heavySlotted && /FIND THE GOLDEN KEY/.test(resetAfterReward.objective), JSON.stringify(resetAfterReward));

const events = await page.evaluate(() => window.__introProbe);
check('intro teach cards fired for the core stages', ['intro-surface', 'intro-movement', 'intro-spark', 'intro-dig', 'intro-flask', 'intro-spellLab', 'intro-bench'].every((key) => events.teaches.includes(key)), JSON.stringify(events.teaches));
check('intro releases to the golden-key loop after Heavy is slotted', events.objectives.includes('FIND THE GOLDEN KEY'), JSON.stringify(events.objectives));
check('lab station objectives were observed', ['SPELL LAB: EXCAVATE THE SAND', 'SPELL LAB: POUR WATER ON HEAT', 'SPELL LAB: SPARK THE COIL', 'SPELL LAB: CLAIM THE TOME'].every((text) => events.objectives.includes(text)), JSON.stringify(events.objectives));
check('wand and flask gameplay events were observed', events.casts.filter((c) => c === 'wand:spark').length >= 2 && events.casts.filter((c) => c === 'wand:dig').length >= 2 && events.flasks.some((f) => f.startsWith('pour:')), JSON.stringify(events));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nintro progression probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
