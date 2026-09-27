// Threat: a creature the alchemist shoots turns on him. Loads the real D1
// (THE BELLOWS), finds each authored Weaver, stands the wizard in its line of
// sight ~70-140 cells off, fires one real spark bolt into it, and asserts the
// Weaver is alerted, stops foraging (hunt/investigate with a fix on the
// shooter) and closes distance. Also checks that a close, visible alchemist
// escalates a calm creature to a hunt without a shot (perception.ts).
//
// Usage: node scripts/verify-provoke.mjs [url]   (dev server running)
import { chromium } from 'playwright-core';

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok    ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + ' ' + detail); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ctx?.console?.exec, null, { timeout: 30000 });

const results = await page.evaluate(async () => {
  localStorage.removeItem('noita-expedition');
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level d1 --cards spark');
  for (let i = 0; i < 30; i++) window.__game.tick();
  const w = ctx.world;
  const blocks = (x, y) => ctx.physics.cellBlocks(Math.floor(x), Math.floor(y));
  const sight = (x0, y0, x1, y1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 2; i < n; i++) if (blocks(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)) return false;
    return true;
  };
  // A standable spot: solid underfoot, 24 cells of headroom, clear sight to (tx, ty).
  const findStand = (tx, ty) => {
    for (const r of [80, 100, 70, 120, 140, 60]) for (const side of [-1, 1]) {
      const x = Math.round(tx + side * r);
      // Nearest floor to the Weaver's own level first (a ledge far above is a different fight).
      for (let k = 0; k < 140; k++) {
        const y = Math.round(ty) + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
        if (!w.inBounds(x, y + 1) || !blocks(x, y + 1)) continue;
        let free = true;
        for (let h = 0; h < 24 && free; h++) for (let dx = -4; dx <= 4; dx++) if (blocks(x + dx, y - h)) { free = false; break; }
        if (free && sight(x, y - 9, tx, ty - 6)) return { x, y };
      }
    }
    return null;
  };
  const out = [];
  for (const weaver of ctx.enemies.filter((e) => e.kind === 'weaver')) {
    const stand = findStand(weaver.x, weaver.y);
    if (!stand) { out.push({ id: weaver.sourceId, skipped: 'no stand' }); continue; }
    const p = ctx.player;
    Object.assign(p, { x: stand.x, y: stand.y, vx: 0, vy: 0, fx: 0, fy: 0, dead: false, hp: p.maxHp, invuln: 99999 });
    ctx.camera.snapTo?.(p.x, p.y - 8);
    for (const wd of ctx.wands.wands) { wd.mana = wd.frame.manaMax; wd.cooldown = 0; }
    // Let the camera settle and the weaver go about its business, unshot. Park
    // the wizard crouched and dark so perception alone does not provoke it first.
    weaver.alerted = false;
    if (weaver.mind) { weaver.mind.intent = 'forage'; weaver.mind.confidence = 0; weaver.mind.irritation = 0; }
    const hold = () => { p.x = stand.x; p.y = stand.y; p.vx = 0; };
    for (let f = 0; f < 5; f++) { hold(); window.__game.tick(); }
    const before = { intent: weaver.mind?.intent, alerted: !!weaver.alerted };
    const d0 = Math.hypot(weaver.x - p.x, weaver.y - p.y);
    // One real spark bolt at the Weaver's body.
    ctx.input.mouse.x = weaver.weaverLoco?.px ?? weaver.x;
    ctx.input.mouse.y = weaver.weaverLoco?.py ?? weaver.y - 7;
    hold(); window.__game.tick();
    p.firing = true; p.firePressed = true;
    hold(); window.__game.tick();
    p.firing = false;
    let hitAt = -1, intents = new Set();
    let minD = d0, attacked = false, retreated = false, retreatEndD = -1, returnMinD = Infinity;
    const hp0 = weaver.hp;
    for (let f = 0; f < 320; f++) {
      hold(); window.__game.tick();
      if (!ctx.enemies.includes(weaver)) break;
      if (hitAt < 0 && weaver.hp < hp0) hitAt = f;
      if (hitAt >= 0) intents.add(weaver.mind?.intent);
      // A Needle Step windup or a thread-spit telegraph is the Weaver answering from range.
      if (hitAt >= 0 && ((weaver.windup ?? 0) > 0 || (weaver.blink ?? 0) > 0)) attacked = true;
      const d = Math.hypot(weaver.x - p.x, weaver.y - p.y);
      minD = Math.min(minD, d);
      // A severed leg sends a Weaver back a couple of seconds (WeaverLimbs); it must come back.
      if ((weaver.weaverRetreatT ?? 0) > 0) { retreated = true; retreatEndD = d; returnMinD = Infinity; }
      else if (retreated) returnMinD = Math.min(returnMinD, d);
    }
    out.push({
      id: weaver.sourceId, d0: Math.round(d0), before, hit: hitAt >= 0, hitAt,
      alerted: !!weaver.alerted, intents: [...intents], targetX: Math.round(weaver.mind?.targetX ?? -1), px: p.x,
      closed: Math.round(d0 - minD), attacked, retreated,
      returned: retreated && Number.isFinite(returnMinD) ? Math.round(retreatEndD - returnMinD) : 0, hp: +weaver.hp.toFixed(1),
    });
  }
  return out;
});

for (const r of results) {
  if (r.skipped) { console.log(`  skip  ${r.id}: ${r.skipped}`); continue; }
  check(`${r.id}: the spark lands`, r.hit, JSON.stringify(r));
  if (!r.hit) continue;
  check(`${r.id}: shot -> alerted`, r.alerted);
  check(`${r.id}: shot -> hunts/investigates, never keeps foraging`, r.intents.length > 0 && r.intents.every((i) => i === 'hunt' || i === 'investigate' || i === 'retreat'), JSON.stringify(r.intents));
  check(`${r.id}: its fix is on the shooter`, Math.abs(r.targetX - r.px) < 40, `targetX ${r.targetX} vs player ${r.px}`);
  // A leg severed by the bolt sends a Weaver back ~2 s (WeaverLimbs): that flinch is its answer too.
  check(`${r.id}: it answers: closes, winds up an attack, or flinches back from a severed leg`,
    r.closed > 12 || r.attacked || r.retreated,
    `closed ${r.closed} of ${r.d0}, telegraph ${r.attacked}, retreated ${r.retreated}, came back ${r.returned}`);
}

// Perception: a calm creature that can SEE the alchemist up close escalates to a hunt.
const esc = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let i = 0; i < 20; i++) window.__game.tick();
  const w = ctx.world, F = 690;
  for (let y = 600; y <= F + 6; y++) for (let x = 300; x <= 800; x++) {
    const i = w.idx(x, y);
    if (y >= F) w.replaceCellAt(i, 12, 0x77736c); else w.clearCellAt(i);
  }
  ctx.enemies.length = 0;
  const p = ctx.player;
  Object.assign(p, { x: 500, y: F - 1, vx: 0, vy: 0, dead: false, invuln: 99999 });
  const e = ctx.enemyCtl.spawn('rootloper', 560, F - 1, { exact: true });
  e.attackCd = 9999;
  const mind = e.mind ?? null;
  window.__game.tick();
  if (e.mind) e.mind.facing = -1; // facing the alchemist (a creature facing away honestly cannot see him)
  let huntAt = -1;
  for (let f = 0; f < 240; f++) {
    p.x = 500; p.y = F - 1; p.vx = 0;
    window.__game.tick();
    if (huntAt < 0 && e.mind?.intent === 'hunt') huntAt = f;
  }
  return { huntAt, intent: e.mind?.intent, irritation: +(e.mind?.irritation ?? 0).toFixed(2), hadMind: !!mind };
});
check('a Root Loper that sees the alchemist 60 cells off commits to the hunt within ~2 s', esc.huntAt >= 0 && esc.huntAt < 150, JSON.stringify(esc));

console.log(`\n${pass} passed, ${fail} failed`);
if (errs.length) console.log('page errors:', errs.slice(0, 5));
await browser.close();
process.exit(fail > 0 || errs.length > 0 ? 1 : 0);
