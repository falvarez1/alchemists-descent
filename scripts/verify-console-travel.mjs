// Developer console travel + help, played through the REAL overlay (docs/DEVELOPER-CONSOLE-RUN-WORKFLOW.md).
//
// What it proves, in a real run with real keys:
//   - `help`, `?`, `? goto`, `help find` print the grouped list in the overlay (columns, taint badges);
//   - `levels`, `goto d3`, `key`, `portal`, `skip` (the REAL Sanctum opens; a boon and the descend click
//     take the real stair), `boss`, `boss kill`, `goto d2b` change the level through the real
//     transition: arrival grace set, kit / phials / tier kept, curtain, findability repair converging;
//   - every campaign level is reached by `goto` and revisited, each world kept as it was left
//     (a scar painted in d2 is still there), with a timing note per trip;
//   - the run is DEBUG-TAINTED by the first travel: autosave off, the story switched to scratch memory,
//     and NOTHING is written to the meta profile, the story memory or the saved expedition;
//   - `win` ends the run as a practice descent (ledger says so, records nothing, the older checkpoint
//     stays), a finished run refuses `goto` plainly, and `run continue` afterwards still resumes the
//     REAL saved expedition, clean;
//   - `lose` runs the real death path; `goto` after a death gets the alchemist up on the new floor.
//
// Usage: node scripts/verify-console-travel.mjs [url] [outDir]   (dev server must be running)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { chooseBoonAndDoor, execConsoleCommand, waitForConsoleApi, waitForOpeningEnd, waitForRunReady } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = process.argv[3] || 'verify-out/console-travel';
mkdirSync(outDir, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !/WebSocket connection/.test(msg.text())) pageErrors.push(msg.text());
});
page.on('dialog', (d) => d.accept());

const META_KEY = 'alchemists-descent-meta';
const STORY_KEY = 'breathing-works-story';
const CARDS_KEY = 'alchemists-descent-card-discovery-v1';

/* ---------------- helpers ---------------- */

const game = (fn, arg) => page.evaluate(fn, arg);

const state = () =>
  game(() => {
    const c = window.__game.ctx;
    const s = c.levels.runStatus(c);
    return {
      level: c.levels.current?.def.id ?? null,
      transitioning: c.levels.transitioning,
      tainted: s.debugTainted,
      god: c.state.debugGodMode,
      autosave: s.autosaveEnabled,
      block: s.autosaveBlockReason,
      saved: c.levels.hasSavedExpedition(),
      revision: c.levels.persistenceStatus?.().revision ?? null,
      phials: c.run ? c.run.phials : null,
      kit: c.run ? c.run.kit : null,
      over: c.run?.over ?? false,
      difficulty: c.state.difficulty,
      dead: c.player.dead,
      frame: c.state.frameCount,
      grace: c.state.arrivalGraceUntil ?? null,
      sanctum: c.sanctum.isOpen,
      repaired: c.levels.findabilityReady,
      storyTracked: c.story?.debugSnapshot?.().tracked ?? null,
      perks: Object.keys(c.player.perks ?? {}).sort(),
      pos: { x: c.player.x, y: c.player.y },
    };
  });

const profile = () => game(([m, s, c]) => ({ meta: localStorage.getItem(m), story: localStorage.getItem(s), cards: localStorage.getItem(c) }), [META_KEY, STORY_KEY, CARDS_KEY]);

async function waitLevel(id, timeout = 60000) {
  try {
    await page.waitForFunction(
      (want) => {
        const c = window.__game.ctx;
        return c.levels.current?.def.id === want && !c.levels.transitioning;
      },
      id,
      { timeout },
    );
  } catch (err) {
    // Say where the game actually is: a timeout alone does not tell a stuck curtain from a refused command.
    const where = await state().catch(() => null);
    const tail = await page.evaluate(() => [...document.querySelectorAll('#dev-console .dev-console-log .dev-console-line')].slice(-3).map((l) => l.innerText).join(' / ')).catch(() => '');
    throw new Error(`never reached ${id}: ${JSON.stringify(where)} log: ${tail} (${String(err).split('\n')[0]})`);
  }
}

/** The findability repair runs after the swap: wait for it, and say how long it took. */
async function repairSettled(timeout = 90000) {
  const t0 = Date.now();
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady === true, null, { timeout });
  return Date.now() - t0;
}

async function openConsole() {
  if (await page.evaluate(() => document.getElementById('dev-console')?.classList.contains('open'))) return;
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('dev-console')?.classList.contains('open'));
  await page.waitForFunction(() => document.activeElement?.id === 'dev-console-input');
}

/** The input is focused when the overlay opens; on the title a click cannot reach it (the entry screen is on top), keys can. */
async function focusInput() {
  if (!(await page.evaluate(() => document.activeElement?.id === 'dev-console-input'))) await page.focus('#dev-console-input');
}

async function closeConsole() {
  if (!(await page.evaluate(() => document.getElementById('dev-console')?.classList.contains('open')))) return;
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => !document.getElementById('dev-console')?.classList.contains('open'));
}

/** Type a command into the real overlay, press Enter, and read what the log answered. */
async function typed(line, { timeout = 90000 } = {}) {
  await openConsole();
  await focusInput();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.querySelectorAll('#dev-console .dev-console-line.pending').length === 0,
    null,
    { timeout },
  );
  return page.evaluate(() => {
    // The answer is the last result or error line (toasts mirror into the log as their own lines).
    const lines = [...document.querySelectorAll('#dev-console .dev-console-log .dev-console-line')].filter((l) => l.classList.contains('result') || l.classList.contains('error'));
    const last = lines[lines.length - 1];
    return {
      ok: last?.classList.contains('result') ?? false,
      kind: last?.dataset.kind ?? '',
      text: last?.innerText ?? '',
      helpBlocks: last?.querySelectorAll('.dch-block').length ?? 0,
      taintBadges: last?.querySelectorAll('.dch-taints').length ?? 0,
      headings: [...(last?.querySelectorAll('.dch-heading .dch-title') ?? [])].map((h) => h.textContent),
      names: [...(last?.querySelectorAll('.dch-name') ?? [])].map((n) => n.textContent),
    };
  });
}

const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });

/** Keep the alchemist alive between commands: a probe judges the travel, not the floor's creatures. */
const shield = () => game(() => { window.__game.ctx.player.invuln = 1_000_000; });

/* ---------------- boot ---------------- */

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await waitForConsoleApi(page);

console.log('\nBefore a run (the title): goto says what to start');
await openConsole();
const hint = await page.evaluate(() => document.querySelector('#dev-console .dev-console-log')?.innerText ?? '');
check('the overlay opens with a one-line hint about help and ?', /help \(or \?\) lists the commands/.test(hint), hint.slice(0, 120));
const noRun = await typed('goto d3');
check('goto with no run says so plainly and names run new / run test', !noRun.ok && /needs a run in progress/.test(noRun.text) && /run new/.test(noRun.text) && /run test --level d3/.test(noRun.text), noRun.text);
check('the refusal tainted nothing', !(await state()).tainted);

console.log('\nhelp and ? in the real overlay');
const help = await typed('help');
check('help prints a grouped list: a heading per group, name and arguments per row', help.helpBlocks === 1 && ['Run & levels', 'Player', 'World & cells', 'Story', 'Debug & perf', 'Console'].every((g) => help.headings.includes(g)), JSON.stringify(help.headings));
check('help lists the old and the new commands', ['run', 'god', 'tp', 'cell', 'levels', 'goto', 'skip', 'boss', 'key', 'portal', 'win', 'lose', 'seq', 'help'].every((n) => help.names.includes(n)), help.names.join(' '));
check('help marks the commands that taint the run', help.taintBadges >= 20 && /TAINTS/i.test(help.text), `badges=${help.taintBadges}`);
await shot('help');
const q = await typed('?');
check('? alone prints the same list', q.helpBlocks === 1 && q.names.length === help.names.length, `${q.names.length} vs ${help.names.length}`);
const qGoto = await typed('? goto');
check('? goto shows usage, taint note and an example', /usage/.test(qGoto.text) && /Taints the run/.test(qGoto.text) && /goto d3/.test(qGoto.text), qGoto.text.slice(0, 200));
await shot('help-goto');
const search = await typed('help find paint');
check('help find <word> searches', search.ok && /cell/.test(search.text), search.text.slice(0, 160));
const topic = await typed('help runs');
check('help <group> lists one group', topic.ok && topic.names.includes('goto') && !topic.names.includes('cell'), topic.names.join(' '));
const bad = await typed('help nosuchthing');
check('help <nothing> says so and stays an error line', !bad.ok && /No help for "nosuchthing"/.test(bad.text), bad.text);

/* ---------------- a real run ---------------- */

console.log('\nStart a real descent (run new) and read the profile');
await closeConsole();
await page.evaluate(() => localStorage.removeItem('noita-expedition'));
const started = await execConsoleCommand(page, 'run new --seed 424242');
check('run new started', started.ok, started.text);
await waitForRunReady(page);
await waitForOpeningEnd(page).catch(() => undefined);
await shield();
const s0 = await state();
const p0 = await profile();
check('the run starts clean: not tainted, autosave on, three phials, spark kit', !s0.tainted && s0.autosave && s0.phials === 3 && s0.kit === 'spark' && s0.storyTracked === true, JSON.stringify(s0));
check('a real descent wrote its profile and saved D1', p0.meta !== null && s0.saved === true, `meta=${p0.meta !== null} saved=${s0.saved}`);

const lv = await typed('levels');
check('levels lists every level, marks here, names the doors', /> d1/.test(lv.text) && ['d2', 'd2b', 'd3', 'd3b', 'd4', 'physics-test'].every((id) => lv.text.includes(id)) && /d2b\s+2 of 4\s+The Cold Store/.test(lv.text), lv.text.slice(0, 200));
check('levels taints nothing', !(await state()).tainted);
const seedLine = await typed('seed');
check('seed shows the run seed and the level seeds', /Run seed 424242/.test(seedLine.text) && /d3b/.test(seedLine.text), seedLine.text.slice(0, 160));

console.log('\ngoto d3 (floor 3, from floor 1): the real transition, the run kept');
const tGoto = Date.now();
const g3 = await typed('goto d3');
await waitLevel('d3');
const s1 = await state();
check('goto d3 answered ok and names the taint', g3.ok && /DEBUG TAINT/.test(g3.text) && /built from the run seed/.test(g3.text), g3.text);
check('the level is d3 and the arrival grace is set', s1.level === 'd3' && s1.grace !== null && s1.grace > s1.frame, JSON.stringify({ level: s1.level, grace: s1.grace, frame: s1.frame }));
check('the run is kept: phials 3, spark kit, same tier', s1.phials === 3 && s1.kit === 'spark' && s1.difficulty === s0.difficulty, JSON.stringify(s1));
check('the run is tainted: autosave off (debug-tainted), story on scratch memory', s1.tainted && !s1.autosave && s1.block === 'debug-tainted' && s1.storyTracked === false, JSON.stringify(s1));
check('god mode stays off (travel must not refill the kit)', !s1.god);
console.log(`  note  goto d3 (first build): ${Date.now() - tGoto} ms to the typed answer`);
const repairMs = await repairSettled();
console.log(`  note  findability repair settled ${repairMs} ms after the swap`);
check('the settled findability repair converges', (await state()).repaired === true);
await shield();

console.log('\nkey, portal, skip: the real Sanctum');
const key = await typed('key');
check('key takes the golden key', key.ok && (await game(() => window.__game.ctx.levels.current.keyTaken)), key.text);
const portal = await typed('portal');
const portalPos = await game(() => {
  const c = window.__game.ctx;
  const p = c.levels.current.portal;
  return { dx: Math.abs(c.player.x - p.x), dy: c.player.y - p.y, open: p.open };
});
check('portal puts the alchemist beside the gate (near, not on it)', portal.ok && portalPos.dx >= 10 && portalPos.dx <= 60 && /exit portal/.test(portal.text), JSON.stringify(portalPos));
const skip = await typed('skip');
await page.waitForFunction(() => window.__game.ctx.sanctum.isOpen === true, null, { timeout: 15000 });
check('skip opened the REAL Sanctum (between-depths pause, boons on offer)', skip.ok && (await page.locator('#sanctum-overlay.visible').count()) === 1 && (await page.locator('#perk-row .perk-card').count()) > 0, skip.text);
await shot('skip-sanctum');
await closeConsole();
await chooseBoonAndDoor(page);
const perksBefore = (await state()).perks;
await page.locator('#descend-btn').click();
await waitLevel('d4');
const s2 = await state();
check('the Sanctum descended to the Kiln Heart and a boon was struck', s2.level === 'd4' && s2.perks.length >= 1 && s2.phials === 3, JSON.stringify({ level: s2.level, perks: s2.perks, before: perksBefore }));
check('still tainted and not saved after a real Sanctum descent', s2.tainted && !s2.autosave && s2.revision === s0.revision, JSON.stringify({ rev: s2.revision, was: s0.revision }));
await repairSettled();
await shield();

console.log('\nboss, boss kill on the Kiln Heart');
const boss = await typed('boss');
const colossusNear = await game(() => {
  const c = window.__game.ctx;
  const b = c.enemies.find((e) => e.kind === 'colossus' && e.hp > 0);
  return b ? Math.hypot(b.x - c.player.x, b.y - c.player.y) : null;
});
check('boss teleports to the Colossus arena', boss.ok && colossusNear !== null && colossusNear < 200, `${boss.text} dist=${colossusNear}`);
const kill = await typed('boss kill');
// The Colossus dies as a sequence; the kill path (and the Kiln escape it starts) runs when it ends.
await page.waitForFunction(() => !window.__game.ctx.enemies.some((e) => e.kind === 'colossus'), null, { timeout: 45000 }).catch(() => undefined);
const colossusDown = await game(() => !window.__game.ctx.enemies.some((e) => e.kind === 'colossus'));
check('boss kill fells the Colossus through the real death sequence', kill.ok && colossusDown, kill.text);
const escape = await game(() => window.__game.ctx.story?.escapeActive === true);
console.log(`  note  the Kiln escape ${escape ? 'began (the real aftermath)' : 'did not begin'}`);

console.log('\ngoto d2b (the other door), then every campaign level and back');
await game(() => { window.__game.ctx.player.dead = false; });
const d2b = await typed('goto d2b');
await waitLevel('d2b');
check('goto d2b reaches the Cold Store, built now', d2b.ok && /built from the run seed/.test(d2b.text) && (await state()).level === 'd2b', d2b.text);
await repairSettled();
await shield();

const walk = [];
async function travel(id, extra = '') {
  const t0 = Date.now();
  const res = await game(async ([line]) => window.__game.ctx.console.exec(line), [`goto ${id}${extra}`]);
  await waitLevel(id);
  const swap = res.data?.ms ?? null;
  const settle = await repairSettled();
  await shield();
  const ok = res.ok && (await state()).level === id;
  walk.push({ id, ok, generated: res.data?.generated, swapMs: swap, total: Date.now() - t0, settleMs: settle });
  return res;
}
await game(() => {
  // A scar in d2b that must still be there on return: a stone slab in the open above the spawn.
  const c = window.__game.ctx;
  const w = c.world;
  const x = Math.floor(c.player.x), y = Math.floor(c.player.y) - 40;
  for (let i = -3; i <= 3; i++) w.replaceCellAt(w.idx(x + i, y), 12, 0x808080);
  window.__scar = { x, y };
});
const scar = await game(() => window.__scar);
for (const id of ['d1', 'd2', 'd3b', 'd4']) await travel(id);
await travel('d2b');
const scarKept = await game(({ x, y }) => window.__game.ctx.world.types[window.__game.ctx.world.idx(x, y)] === 12, scar);
check('a visited level keeps its world: the scar painted before leaving is still there', scarKept);
for (const id of ['d3', 'd3b', 'd2', 'd1', 'd4']) await travel(id);
check('every campaign level was reached by goto (d1 d2 d2b d3 d3b d4) and revisited', walk.every((w) => w.ok) && ['d1', 'd2', 'd2b', 'd3', 'd3b', 'd4'].every((id) => walk.some((w) => w.id === id)), JSON.stringify(walk.filter((w) => !w.ok)));
console.log('  note  per-trip timing (swap = the generation hitch behind the curtain; settle = repair cascade):');
for (const w of walk) console.log(`        ${w.id.padEnd(4)} ${w.generated ? 'built   ' : 'restored'} swap ${String(w.swapMs).padStart(5)} ms  total ${String(w.total).padStart(5)} ms  repair +${w.settleMs} ms`);
const tripMax = Math.max(...walk.filter((w) => w.generated).map((w) => w.swapMs ?? 0));
check('no trip hung: the slowest build stayed under 15 s', tripMax < 15000, `max ${tripMax} ms`);
const sWalk = await state();
check('after the whole walk the run is still the same run: phials 3, spark kit, tier kept', sWalk.phials === 3 && sWalk.kit === 'spark' && sWalk.difficulty === s0.difficulty, JSON.stringify(sWalk));
const seedOverride = await typed('goto d3 --seed 4242');
await waitLevel('d3');
const d3seed = await game(() => window.__game.ctx.levels.levelSeed(window.__game.ctx, 'd3'));
check('goto --seed rebuilds a visited level from the chosen seed', seedOverride.ok && /rebuilt from seed 4242/.test(seedOverride.text) && d3seed === 4242, `${seedOverride.text} seed=${d3seed}`);
await repairSettled();
await shield();
const at = await typed('goto d2 --at camp');
await waitLevel('d2');
const campAt = await game(() => {
  const c = window.__game.ctx;
  const camp = c.levels.current.story?.camp;
  return camp ? Math.abs(c.player.x - camp.x) : null;
});
check('goto --at camp lands at Pell’s camp', at.ok && campAt !== null && campAt < 60, `${at.text} dx=${campAt}`);
await repairSettled();

const badGoto = await typed('goto dd9');
check('goto with a bad id lists the levels', !badGoto.ok && /d2b/.test(badGoto.text) && /physics-test/.test(badGoto.text) && /floor number/.test(badGoto.text), badGoto.text);

console.log('\nTyping in the console during play: game hotkeys and the tilde are text');
await openConsole();
await focusInput();
const allKeys = 'abcdefghijklmnopqrstuvwxyz0123456789 -;~|<>[]';
await page.keyboard.type(allKeys);
const gotKeys = await page.locator('#dev-console-input').inputValue();
check('every letter (m is the map, h the handbook), digit and the tilde types into the console', gotKeys === allKeys && (await state()).sanctum === false, `typed ${allKeys} got ${gotKeys}`);
await page.locator('#dev-console-input').fill('');
await closeConsole();

console.log('\nTab completion in the real overlay');
await openConsole();
await focusInput();
await page.keyboard.type('goto d3');
await page.keyboard.press('Tab');
const tab1 = await page.locator('#dev-console-input').inputValue();
check('Tab completes goto’s level ids', /^goto d3b? $/.test(tab1) || /^goto d3 $/.test(tab1), `value=${tab1}`);
await page.locator('#dev-console-input').fill('');
await page.keyboard.type('goto d1 --at ');
await page.keyboard.press('Tab');
const tab2 = await page.locator('#dev-console-input').inputValue();
check('Tab completes the --at spots', /^goto d1 --at (spawn|portal|boss|camp|waystone|valve|key) $/.test(tab2), `value=${tab2}`);
await page.locator('#dev-console-input').fill('');

console.log('\nNothing leaked: the profile, the story memory and the saved expedition');
const p1 = await profile();
const s3 = await state();
check('the meta profile is byte-for-byte what run new left', p1.meta === p0.meta, `before ${p0.meta?.slice(0, 120)} / after ${p1.meta?.slice(0, 120)}`);
check('the story memory is byte-for-byte what run new left', p1.story === p0.story, `before ${p0.story?.slice(0, 120)} / after ${p1.story?.slice(0, 120)}`);
await game(() => { const c = window.__game.ctx; c.wands.grantCard(c, 'bounce'); });
const p1b = await profile();
check('a card granted in a tainted run is not discovered for later runs', p1b.cards === p0.cards, `before ${p0.cards} / after ${p1b.cards}`);
check('no checkpoint was written: same revision, the old D1 save is still there', s3.revision === s0.revision && s3.saved === true, JSON.stringify({ rev: s3.revision, was: s0.revision, saved: s3.saved }));

console.log('\nwin: a practice descent');
const win = await typed('win');
check('win ended the run as a victory', win.ok && (await state()).over === true, win.text);
await page.waitForFunction(() => document.body.classList.contains('run-summary-open'), null, { timeout: 20000 });
const ledger = await page.locator('#run-summary').innerText();
check('the ledger says it was a practice descent and the share line marks it', /practice descent/i.test(ledger) && /practice run \(debug tools\)/.test(ledger), ledger.slice(0, 300));
await shot('ledger-win');
const p2 = await profile();
check('the victory credited nothing: meta, story and card discovery unchanged', p2.meta === p0.meta && p2.story === p0.story && p2.cards === p0.cards);
const after = await state();
check('the older checkpoint was left alone by a test run ending', after.saved === true && after.revision === s0.revision, JSON.stringify(after));
await page.keyboard.press('Escape').catch(() => undefined);
const refused = await game(async () => window.__game.ctx.console.exec('goto d3'));
check('a finished run refuses goto and says what to start', !refused.ok && /The run has ended/.test(refused.text) && /run new/.test(refused.text), refused.text);

console.log('\nThe real saved expedition still resumes, clean (run continue after a reload)');
await page.reload({ waitUntil: 'networkidle' });
await waitForConsoleApi(page);
const cont = await execConsoleCommand(page, 'run continue');
await waitForRunReady(page);
const s4 = await state();
check('run continue resumed the D1 checkpoint, untainted, autosave on, story tracked again', cont.ok && s4.level === 'd1' && !s4.tainted && s4.autosave && s4.storyTracked === true && s4.phials === 3, JSON.stringify(s4));

console.log('\nlose: the real death path; goto after a death');
await waitForOpeningEnd(page).catch(() => undefined);
await execConsoleCommand(page, 'run new --seed 77');
await waitForRunReady(page);
await waitForOpeningEnd(page).catch(() => undefined);
await shield();
await typed('goto d2');
await waitLevel('d2');
await repairSettled();
await game(() => { const c = window.__game.ctx; c.player.invuln = 0; c.playerCtl.kill(); });
await page.waitForFunction(() => window.__game.ctx.player.dead === true);
const dead = await state();
check('a death with phials left costs one (practice for goto-after-death)', dead.dead && dead.phials === 2, JSON.stringify(dead));
const revive = await typed('goto d3');
await waitLevel('d3');
const s5 = await state();
check('goto after a death: the alchemist is up on the new floor, the spent phial stays spent', revive.ok && !s5.dead && s5.phials === 2 && s5.level === 'd3', JSON.stringify(s5));
await repairSettled();
const lose = await typed('lose');
await page.waitForFunction(() => window.__game.ctx.run.over === true, null, { timeout: 15000 });
const s6 = await state();
check('lose emptied the phials, killed through the real path and ended the run', lose.ok && s6.over && s6.dead && s6.phials === 0, JSON.stringify({ lose: lose.text, over: s6.over, dead: s6.dead, phials: s6.phials }));
await page.waitForTimeout(2500);
await shot('lose');
const respawnRefused = await game(async () => window.__game.ctx.console.exec('respawn'));
check('respawn after a finished run refuses', !respawnRefused.ok && /run is over/.test(respawnRefused.text), respawnRefused.text);

console.log('\nA disposable test run: goto works, win has nothing to end');
await page.evaluate(() => localStorage.removeItem('noita-expedition'));
const test = await execConsoleCommand(page, 'run test --level d2 --seed 5');
await waitForRunReady(page);
const tg = await game(async () => window.__game.ctx.console.exec('goto d3 --at spawn'));
await waitLevel('d3');
check('goto works inside a disposable test run', tg.ok && (await state()).level === 'd3', tg.text);
const tw = await game(async () => window.__game.ctx.console.exec('win'));
check('win in a test run says there is no ledger to end', !tw.ok && /test run/.test(tw.text), tw.text);
void test;

console.log('');
check('no page errors through the whole journey', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
