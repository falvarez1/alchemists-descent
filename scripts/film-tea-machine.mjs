// Real-time film of the Bell & Tea Engine as a player plays it: the alchemist
// presses the real Use key at the crank, then an in-page autopilot walks him
// along the catwalk with the real movement keys and answers each fault with a
// real verb (Spark Bolt at the pan, a kick at the Persuader, the water flask
// through the grate). The rendered game is captured every interval.
// Usage: node scripts/film-tea-machine.mjs [url] [--seed 777] [--every 600] [--out dir] [--max 80] [--idle]
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const seed = Number(opt('seed', '777')), every = Number(opt('every', '600')), max = Number(opt('max', '80'));
const idle = args.includes('--idle');
const out = opt('out', 'verify-out/tea-film'); mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.png')) rmSync(`${out}/${f}`);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url); await waitForConsoleApi(page);
await execConsoleCommand(page, `run test --level d1 --world campaign-level --seed ${seed} --loadout fresh`);
await waitForRunReady(page);
// Start at the crank, past the Intake's barricade (burning it is
// verify-tea-machine's job; the film is about the engine).
await page.evaluate(() => { const c = window.__game.ctx; c.enemies.length = 0; c.state.debugGodMode = true;
  c.player.x = 432; c.player.y = 311; c.player.vx = 0; c.player.vy = 0; c.state.paused = false; });
await page.waitForTimeout(2600);
await page.keyboard.press('KeyE');
if (!idle) await page.evaluate(() => {
  const c = window.__game.ctx, rt = c.levels.current;
  const target = s => s <= 2 ? 505 : s <= 6 ? 738 : s <= 9 ? 1030 : s <= 11 ? 1250 : s <= 13 ? 1400 : 1478;
  let since = 0, last = -1;
  const drive = () => {
    const tea = rt.living.tea;
    if (!tea || tea.completed && tea.stageTicks > 400) { c.input.keys.right = false; c.input.keys.left = false; return; }
    if (tea.stage !== last) { last = tea.stage; since = 0; }
    since++;
    const dx = target(tea.stage) - c.player.x;
    c.input.keys.right = dx > 4; c.input.keys.left = dx < -4;
    const arrived = Math.abs(dx) <= 4;
    const aim = (x, y) => { c.input.mouse.x = x; c.input.mouse.y = y; };
    if (tea.stage === 2 && arrived && since > 40 && since < 44) { aim(523, 267); c.player.firing = true; c.player.firePressed = true; }
    else if (tea.stage === 2) c.player.firing = false;
    if (tea.stage === 6 && arrived && since > 40 && since % 30 === 0) {
      const bob = c.rigidBodies.bodies.find(b => b.tag === 'tea-persuader');
      aim(bob.x, bob.y); c.player.aimAngle = Math.atan2(bob.y - (c.player.y - 9), bob.x - c.player.x); c.playerCtl.kick(c);
    }
    if (tea.stage === 9 && arrived && since > 40) { c.flask.selectSlot(0); aim(1000, 312); c.input.pourHeld = true; }
    else c.input.pourHeld = false;
    if (tea.stage > 9 && !arrived) aim(c.player.x + 60, c.player.y - 40);
    requestAnimationFrame(drive);
  };
  requestAnimationFrame(drive);
});
const log = [];
for (let i = 0; i < max; i++) {
  await page.waitForTimeout(every);
  const s = await page.evaluate(() => { const c = window.__game.ctx, tea = c.levels.current.living.tea;
    return { stage: tea?.stage, completed: tea?.completed, stalled: tea?.stalled, px: Math.round(c.player.x),
      title: document.querySelector('#tea-view strong')?.textContent ?? '' }; });
  log.push(s);
  await page.screenshot({ path: `${out}/f${String(i).padStart(2, '0')}-s${s.stage}.png` });
  console.log(i, JSON.stringify(s));
  if (s.completed || s.stalled) { await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/final.png` }); break; }
}
await browser.close();
