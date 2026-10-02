// The fighter's HUD chips in the REAL game: shown only for a fighter, keyed to the player's bindings, pressable
// with a real click, a cooldown that counts down on the chip, an ultimate ring that fills and glows when ready,
// and the armor bar / kit meter. Screenshots of each state go to verify-out/fighters/.
// Usage: node scripts/verify-fighter-chips.mjs [url]
import { boot, makeChecker, shot, tick } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const t = makeChecker();
const check = t.check;
const { page, finish } = await boot(url, { fighter: null });

const chips = () => page.evaluate(() => {
  const root = document.getElementById('fighter-chips');
  if (!root) return null;
  const q = (s) => root.querySelector(s);
  const T = q('.fc-tactical'), U = q('.fc-ultimate');
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return {
    hidden: root.hidden,
    keys: [T.querySelector('.fc-key').textContent, U.querySelector('.fc-key').textContent],
    tReady: T.classList.contains('ready'), uReady: U.classList.contains('ready'), uActive: U.classList.contains('active'),
    cd: T.querySelector('.fc-cd').textContent, uText: U.querySelector('.fc-cd').textContent,
    cool: T.style.getPropertyValue('--cool'), charge: U.style.getPropertyValue('--charge'),
    names: [...root.querySelectorAll('.fc-names span')].map((s) => s.textContent),
    armorHidden: root.querySelector('.fc-armor').hidden, meterHidden: root.querySelector('.fc-meter').hidden,
    meterLabel: root.querySelector('.fc-meter span').textContent,
    tBox: box(T), uBox: box(U), accent: root.style.getPropertyValue('--fc-accent'),
  };
});
const settle = async (n = 3) => { await tick(page, 1); await page.waitForTimeout(80 * n); };

check('the classic Alchemist has no chips on screen', (await chips())?.hidden !== false);

// A stub kit: Z spends a 4 s cooldown, T lasts 3 s; a meter and an armor pool.
await page.evaluate(async () => {
  const sys = window.__fp.ctx.fighters;
  const stub = {
    id: 'ilyra-voss', tacticalCooldown: 240, ultimateDuration: 180,
    create: () => ({ tactical: () => { window.__pressed = (window.__pressed ?? 0) + 1; return true; }, ultimate: () => true, meter: () => ({ label: 'Pressure', value: 40, max: 100 }) }),
  };
  sys.kits = () => stub;
  sys.equip('ilyra-voss');
  await sys.whenReady();
  sys.setArmorMax(30, true);
  window.__fp.tick(2);
});
await settle();
let c = await chips();
check('a fighter shows both chips, named, in its accent', c && !c.hidden && c.names[0] === 'Flash Crucible' && c.names[1] === 'Phoenix Draft' && c.accent.length > 0, JSON.stringify(c?.names));
check('the keys are the player\'s bindings (Z and T)', c && c.keys[0] === 'Z' && c.keys[1] === 'T', JSON.stringify(c?.keys));
check('the tactical reads ready, the ultimate does not (the bar is empty)', c && c.tReady && !c.uReady);
check('the chips are on screen and a usable size', c && c.tBox.w >= 30 && c.tBox.h >= 30 && c.tBox.x >= 0 && c.tBox.y + c.tBox.h <= 860, JSON.stringify(c?.tBox));
check('the armor bar and the kit meter show', c && !c.armorHidden && !c.meterHidden && c.meterLabel === 'Pressure');
await shot(page, 'chips-ready');

// A REAL click on the tactical chip presses it.
await page.mouse.click(c.tBox.x + c.tBox.w / 2, c.tBox.y + c.tBox.h / 2);
await tick(page, 2);
await settle();
check('a real click on the chip fires the ability', (await page.evaluate(() => window.__pressed)) === 1);
c = await chips();
check('the chip counts the cooldown down (seconds, a wedge)', c.cd === '4' && !c.tReady && Number(c.cool) > 0.9, JSON.stringify({ cd: c.cd, cool: c.cool }));
await shot(page, 'chips-cooling');
await tick(page, 130);
await settle();
c = await chips();
check('...and it follows the clock (2 s on)', c.cd === '2', c.cd);

// The ultimate charges, fills its ring, glows when ready, and shows its time while it runs.
await page.evaluate(() => { window.__fp.ctx.fighters.addCharge(0.62); window.__fp.tick(1); });
await settle();
c = await chips();
check('the ultimate shows its charge (62%)', c.uText === '62' && Math.abs(Number(c.charge) - 0.62) < 0.02 && !c.uReady, JSON.stringify({ t: c.uText, ch: c.charge }));
await page.evaluate(() => { window.__fp.ctx.fighters.addCharge(1); window.__fp.tick(1); });
await settle();
c = await chips();
check('full, it reads ready (glow) and drops the number', c.uReady && c.uText === '', JSON.stringify(c));
await shot(page, 'chips-ultimate-ready');
await page.keyboard.press('KeyT');
await tick(page, 3);
await settle();
c = await chips();
check('while it runs the chip is active and the ring drains', c.uActive && Number(c.charge) < 1 && !c.uReady, JSON.stringify({ a: c.uActive, ch: c.charge }));
await shot(page, 'chips-ultimate-active');

// A rebound key follows through to the label.
await page.evaluate(() => { localStorage.setItem('ad-controls-v1', JSON.stringify({ tactical: 'KeyJ' })); });
const afterRebind = await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('ad-controls-v1')); return b.tactical; });
check('(bindings are stored under ad-controls-v1)', afterRebind === 'KeyJ');
await page.evaluate(() => localStorage.removeItem('ad-controls-v1'));

// Dead: no chips. Classic: none.
await page.evaluate(() => { window.__fp.ctx.player.dead = true; });
await settle();
check('the chips go away when the fighter is dead', (await chips()).hidden === true);
await page.evaluate(() => { window.__fp.ctx.player.dead = false; window.__fp.ctx.fighters.equip(null); });
await settle();
check('...and for the classic Alchemist', (await chips()).hidden === true);

const errors = await finish();
check('no page errors', errors === 0);
console.log(`\nfighter chips probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);
