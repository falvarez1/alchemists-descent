// Verifies the Player Physics tuning sliders in the Builder's Global Controls
// panel (Levitation + Wand Recoil) bind live to ctx.params.player, and that the
// RESET PLAYER PHYSICS action restores defaults.
// Usage: node scripts/verify-builder-player-physics.mjs [url]   (dev server running)
import { chromium } from 'playwright-core';

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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(800);

// Enter the Builder, then open Global Controls. The builder-chrome buttons are
// invoked via their real click handler (verifying MY slider wiring, not the
// builder's pointer-events layout which headless doesn't fully resolve).
await page.click('#mode-builder-btn', { timeout: 8000 });
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('b-global')?.click());
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('#bg-controls .bw-label span')].some((s) => s.textContent.trim() === 'Lift: base thrust'),
  { timeout: 8000 },
);

// Both new sections rendered with all rows.
const labels = await page.evaluate(() =>
  [...document.querySelectorAll('#bg-controls .bw-label span')].map((s) => s.textContent.trim()),
);
const expected = [
  'D1 player speed',
  'Player depth ramp',
  'D1 vertical speed',
  'Vertical depth ramp',
  'D1 enemy speed',
  'Enemy depth ramp',
  'Lift: base thrust',
  'Lift: ramp gain',
  'Lift: ramp frames',
  'Vertical drag',
  'Up-speed cap',
  'Horizontal control',
  'Air momentum (drag)',
  'Base kick',
  'Per momentum',
  'Max impulse (cap)',
  'Ground damping',
];
for (const e of expected) check(`row present: ${e}`, labels.includes(e), `have: ${labels.join(', ')}`);

// Sliders write straight into ctx.params.player.
const bind = await page.evaluate(async () => {
  const { PROGRESSION_PACING } = await import('/src/config/pacing.ts');
  const ctx = window.__game.ctx;
  const rowRange = (labelText) => {
    const span = [...document.querySelectorAll('#bg-controls .bw-label span')].find(
      (s) => s.textContent.trim() === labelText,
    );
    const row = span?.closest('.bw-row');
    return row ? row.querySelector('input[type="range"]') : null;
  };
  const drive = (labelText, value) => {
    const input = rowRange(labelText);
    if (!input) return null;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  const out = {};
  out.thrustBefore = ctx.params.player.levitThrust0;
  drive('Lift: base thrust', 0.5);
  out.thrustAfter = ctx.params.player.levitThrust0;
  out.recoilBefore = ctx.params.player.recoilBase;
  drive('Base kick', 15);
  out.recoilAfter = ctx.params.player.recoilBase;
  out.dragBefore = ctx.params.player.levitDrag;
  drive('Vertical drag', 0.85);
  out.dragAfter = ctx.params.player.levitDrag;
  out.goreBefore = ctx.params.global.bloodAmount;
  drive('Overall Gore', 9.5); // exercises the extended 0–10 range
  out.goreAfter = ctx.params.global.bloodAmount;
  drive('Red Blood', 3.5);
  out.bloodAfter = ctx.params.global.goreBlood;
  drive('Green Slime', 0);
  out.slimeAfter = ctx.params.global.goreSlime;
  drive('Glowing Ooze (acid/toxic)', 2.5);
  out.oozeAfter = ctx.params.global.goreOoze;
  out.pacingBefore = {
    playerStart: PROGRESSION_PACING.playerStart,
    enemyStart: PROGRESSION_PACING.enemyStart,
  };
  drive('D1 player speed', 0.58);
  drive('D1 enemy speed', 0.4);
  out.pacingAfter = {
    playerStart: PROGRESSION_PACING.playerStart,
    enemyStart: PROGRESSION_PACING.enemyStart,
  };
  return out;
});
check('levitThrust0 slider mutates params.player', bind.thrustAfter === 0.5 && bind.thrustBefore !== 0.5, JSON.stringify(bind));
check('recoilBase slider mutates params.player', bind.recoilAfter === 15, JSON.stringify(bind));
check('levitDrag slider mutates params.player', bind.dragAfter === 0.85, JSON.stringify(bind));
check('Overall Gore slider reaches 9.5 (0–10 range)', bind.goreAfter === 9.5, JSON.stringify(bind));
check('Red Blood channel slider mutates params.global', bind.bloodAfter === 3.5, JSON.stringify(bind));
check('Green Slime channel slider mutates params.global', bind.slimeAfter === 0, JSON.stringify(bind));
check('Glowing Ooze channel slider mutates params.global', bind.oozeAfter === 2.5, JSON.stringify(bind));
check('D1 player speed slider mutates progression pacing', bind.pacingAfter.playerStart === 0.58, JSON.stringify(bind));
check('D1 enemy speed slider mutates progression pacing', bind.pacingAfter.enemyStart === 0.4, JSON.stringify(bind));

const clickedPacingReset = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#bg-controls .bw-actions button')].find(
    (b) => b.textContent.trim() === 'RESET PACING',
  );
  if (!btn) return false;
  btn.click();
  return true;
});
check('RESET PACING button present', clickedPacingReset);
await page.waitForTimeout(200);
const afterPacingReset = await page.evaluate(async () => {
  const { PROGRESSION_PACING } = await import('/src/config/pacing.ts');
  return { playerStart: PROGRESSION_PACING.playerStart, enemyStart: PROGRESSION_PACING.enemyStart };
});
check('reset restores D1 player speed (0.74)', Math.abs(afterPacingReset.playerStart - 0.74) < 1e-6, JSON.stringify(afterPacingReset));
check('reset restores D1 enemy speed (0.55)', Math.abs(afterPacingReset.enemyStart - 0.55) < 1e-6, JSON.stringify(afterPacingReset));

// RESET PLAYER PHYSICS restores shipped defaults (invoke its real handler).
const clickedReset = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#bg-controls .bw-actions button')].find(
    (b) => b.textContent.trim() === 'RESET PLAYER PHYSICS',
  );
  if (!btn) return false;
  btn.click();
  return true;
});
check('RESET PLAYER PHYSICS button present', clickedReset);
await page.waitForTimeout(200);
const afterReset = await page.evaluate(() => {
  const p = window.__game.ctx.params.player;
  return { levitThrust0: p.levitThrust0, recoilBase: p.recoilBase, levitDrag: p.levitDrag };
});
check('reset restores levitThrust0 (0.33)', Math.abs(afterReset.levitThrust0 - 0.33) < 1e-6, JSON.stringify(afterReset));
check('reset restores recoilBase (6)', afterReset.recoilBase === 6, JSON.stringify(afterReset));
check('reset restores levitDrag (0.92)', Math.abs(afterReset.levitDrag - 0.92) < 1e-6, JSON.stringify(afterReset));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nbuilder player-physics probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
