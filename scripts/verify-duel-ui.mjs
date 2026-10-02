// THE DUEL, AS A PERSON SEES IT (docs/arena/ARENA-RULES.md 1): the title's Duel door, the roster, the Duel Stage, the panel's Duel section, real
// clicks, and the fight played in REAL TIME (rendered, not stepped): two computer fighters fight, both HP bars move, a winner is named, Rematch
// starts another bout, Remove returns the room to one fighter.
//   node scripts/verify-duel-ui.mjs [url] [--a mara-quell] [--b rusk-emberjaw] [--shots]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const A = opt('a', 'kest-rel'), B = opt('b', 'edda-morrow');
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/duel-ui', { recursive: true });

const click = async (page, selector, wait = 450) => {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 10000 });
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box for ' + selector);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(wait);
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.removeItem('alchemists-descent-meta'); localStorage.removeItem('noita-expedition'); sessionStorage.clear(); } catch { /* blocked */ } });
await page.goto(url + '?link=off', { waitUntil: 'networkidle', timeout: 40000 });
await waitForConsoleApi(page);
await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 20000 });
await page.waitForTimeout(900);

// ---- the door ----
const door = await page.evaluate(() => { const a = document.querySelector('#expedition-entry [data-entry="duel"]'); return { text: a?.textContent ?? '', visible: !!a }; });
check('the title has a Duel door that says what it is', door.visible && /Duel/.test(door.text) && /Duel Stage/.test(door.text), JSON.stringify(door.text));
await click(page, '#expedition-entry [data-entry="duel"]');
await page.waitForSelector('#fighter-roster.visible', { timeout: 5000 });
await click(page, `#fighter-roster .fr-card[data-entry="${A}"]`);
await click(page, '#fighter-roster .fr-choose', 300);
await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-duel' && window.__game.ctx.state.mode === 'play', null, { timeout: 40000 });
await page.evaluate(() => window.__game.ctx.fighters.whenReady());
await page.waitForTimeout(2500);
const stage = await page.evaluate(() => { const c = window.__game.ctx; return { id: c.fighters.id, level: c.levels.current?.def.id, panel: !!document.querySelector('#fighter-arena:not([hidden])'), duel: document.querySelector('#fighter-arena')?.dataset.level, rivals: c.arena.slotCount }; });
check('choosing a fighter at the Duel door opens the Duel Stage as them, with the panel up in duel mode', stage.id === A && stage.level === 'fighter-duel' && stage.panel && stage.duel === 'duel' && stage.rivals <= 1, JSON.stringify(stage));
check('the panel shows the Duel section (and hides the Yard\'s foes and stations)', await page.evaluate(() => { const d = document.querySelector('#fighter-arena .fa-duel'); const f = document.querySelector('#fighter-arena .fa-yard-only'); return !!d && d.offsetParent !== null && f.offsetParent === null; }));
await page.screenshot({ path: 'verify-out/duel-ui/1-stage.png' });

// ---- add a rival with real clicks ----
await page.selectOption('#fighter-arena .fa-select', B);
await click(page, '#fighter-arena .fa-duel button:text-is("Add rival")', 900);
const added = await page.evaluate(() => { const c = window.__game.ctx; return { slots: c.arena.slotCount, rival: c.arena.fighterId(1), state: c.arena.bout.state, enemies: c.enemies.length, text: document.querySelector('#fighter-arena .fa-bout')?.textContent }; });
check('Add rival puts the picked fighter in the room: two fighters, one stand-in, the bout is fighting', added.slots === 2 && added.rival === B && added.state === 'fighting' && added.enemies === 1 && /Fighting/.test(added.text), JSON.stringify(added));

// ---- a brain for each, with real clicks, skill 3 ----
const brainBtn = (panel, brain) => `#fighter-arena .fa-duel .fa-bots:nth-of-type(${panel}) button[data-brain="${brain}"]`;
await click(page, '#fighter-arena .fa-duel .fa-bots >> nth=0 >> button[data-brain="basic"]', 200);
await click(page, '#fighter-arena .fa-duel .fa-bots >> nth=1 >> button[data-brain="basic"]', 200);
void brainBtn;
const brains = await page.evaluate(async () => { const c = window.__game.ctx; const a = (await c.console.exec('ai status')).text; return { slot0: a, hasDriver1: !!document.querySelectorAll('#fighter-arena .fa-bots')[1].querySelector('button.on[data-brain="basic"]') }; });
check('both fighters have a brain (the panel shows basic lit on each; the keyboard stands down for the first)', /basic level/.test(brains.slot0) && brains.hasDriver1, JSON.stringify(brains));

// ---- let it play in REAL time (not stepped), and watch ----
await page.evaluate(() => { window.__game.ctx.state.paused = false; });
const seen = { moved: false, hpA: [], hpB: [], won: false };
const start = await page.evaluate(() => { const c = window.__game.ctx; return { ax: c.arena.bundle(0).player.x, bx: c.arena.bundle(1).player.x }; });
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => { const c = window.__game.ctx; const a = c.arena.bundle(0).player, b = c.arena.bundle(1).player; return { ax: a.x, bx: b.x, ha: a.hp, hb: b.hp, state: c.arena.bout.state, winner: c.arena.bout.winner, text: document.querySelector('#fighter-arena .fa-bout')?.textContent, bars: [...document.querySelectorAll('#fighter-arena .fa-vs-fill')].map((e) => e.style.width) }; });
  seen.hpA.push(Math.round(s.ha)); seen.hpB.push(Math.round(s.hb));
  if (Math.abs(s.ax - start.ax) > 30 && Math.abs(s.bx - start.bx) > 30) seen.moved = true;
  if (i === 2 && args.includes('--shots')) await page.screenshot({ path: 'verify-out/duel-ui/2-fighting.png' });
  if (s.state === 'won') { seen.won = true; seen.winner = s.winner; seen.text = s.text; seen.bars = s.bars; break; }
}
await page.screenshot({ path: 'verify-out/duel-ui/3-result.png' });
check('both computer fighters walk toward each other in real time', seen.moved, JSON.stringify(seen.hpA.slice(0, 6)));
check('someone is knocked out and the bout names a winner (a result line, a "DOWN" bar)', seen.won && /wins in/.test(seen.text ?? ''), JSON.stringify({ won: seen.won, text: seen.text, bars: seen.bars }));
check('both health bars moved during the fight (blows landed on both, or at least on the loser, and the bars follow the bodies)', new Set(seen.hpA).size > 2 || new Set(seen.hpB).size > 2, JSON.stringify([seen.hpA, seen.hpB]));

// ---- rematch, then remove ----
await click(page, '#fighter-arena .fa-duel button:text-is("Rematch")', 700);
const again = await page.evaluate(() => { const c = window.__game.ctx; return { state: c.arena.bout.state, a: c.arena.bundle(0).player.hp, b: c.arena.bundle(1).player.hp, ma: c.arena.bundle(0).player.maxHp, mb: c.arena.bundle(1).player.maxHp }; });
check('Rematch starts a fresh bout: fighting, both whole again', again.state === 'fighting' && again.a >= again.ma - 1 && again.b >= again.mb - 1, JSON.stringify(again));
await click(page, '#fighter-arena .fa-duel button:text-is("Remove")', 600);
const gone = await page.evaluate(() => { const c = window.__game.ctx; return { slots: c.arena.slotCount, enemies: c.enemies.length, scoped: c.events.scoped, same: c.arena.bundle(0)?.player === c.player }; });
check('Remove takes the rival out: one fighter, nothing left in the enemies, scoping off', gone.slots === 1 && gone.enemies === 0 && !gone.scoped && gone.same, JSON.stringify(gone));
// ---- Watch: one click, two brains, a fight ----
await click(page, '#fighter-arena .fa-duel button:text-is("Watch")', 1500);
const watching = await page.evaluate(async () => { const c = window.__game.ctx; return { slots: c.arena.slotCount, ai0: (await c.console.exec('ai status')).text, state: c.arena.bout.state, lit: document.querySelectorAll('#fighter-arena .fa-duel .fa-bots button.on[data-brain="basic"]').length }; });
check('Watch puts a rival in, a computer brain on BOTH fighters, and a bout going (a one-click spectator)', watching.slots === 2 && /basic level/.test(watching.ai0) && /fighting|won/.test(watching.state) && watching.lit === 2, JSON.stringify(watching));
await page.waitForTimeout(4000);
const moving = await page.evaluate(() => { const c = window.__game.ctx; return { dist: Math.abs(c.arena.bundle(0).player.x - c.arena.bundle(1).player.x), state: c.arena.bout.state }; });
check('...and they close on each other and fight (the bout is under way or already won)', moving.state === 'won' || moving.dist < 300, JSON.stringify(moving));
await page.screenshot({ path: 'verify-out/duel-ui/4-watch.png' });
check('no page errors in the whole path', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\nduel ui probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
