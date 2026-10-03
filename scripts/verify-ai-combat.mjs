// Real Arena/Duel inputs, physics and spell damage. Usage: node scripts/verify-ai-combat.mjs [dev URL]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://127.0.0.1:5194/';
const check = makeChecker();
mkdirSync('verify-out/ai-combat', { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const freshStage = async () => {
    await page.goto(`${url}?link=off`, { waitUntil: 'networkidle', timeout: 60000 });
    await leaveTitleIfShown(page);
    await waitForConsoleApi(page);
    await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-duel --world campaign-level'); });
    await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-duel' && window.__game.ctx.state.mode === 'play', null, { timeout: 40000 });
    await page.waitForTimeout(1500);
  };
  const run = async (ids, seed, ticks = 3600) => {
    await freshStage();
    return page.evaluate(async ({ ids, seed, ticks }) => {
    const ctx = window.__game.ctx;
    ctx.state.paused = true;
    await ctx.console.exec('ai off');
    await ctx.console.exec('arena remove');
    ctx.fighters.equip(ids[0]); await ctx.fighters.whenReady();
    await ctx.console.exec(`arena add ${ids[1]} 1020 639`);
    ctx.arena.reset();
    ctx.state.arrivalGraceUntil = 0;
    document.querySelectorAll('#card-offer-overlay.visible').forEach((e) => e.classList.remove('visible'));
    const a = ctx.arena.bundle(0), b = ctx.arena.bundle(1);
    ctx.state.worldSeed = seed;
    await ctx.console.exec('arena bot 0 basic 4');
    await ctx.console.exec('arena bot 1 basic 4');
    const statuses = async () => (await ctx.console.exec('arena status')).data.bots;
    const startHp = [a.player.hp, b.player.hp];
    let moves = 0, fired = 0;
    const samples = [];
    for (let t = 0; t < ticks && ctx.arena.bout.state !== 'won'; t++) {
      window.__game.tick(false, { forcePaused: true });
      if (a.input.keys.left || a.input.keys.right) moves++;
      if (a.player.firing) fired++;
      if (t % 300 === 0) samples.push({ t, x: [a.player.x, b.player.x].map(Math.round), hp: [a.player.hp, b.player.hp].map(Math.round), intents: (await statuses()).map(s => s.intent) });
    }
    const final = await statuses();
    return { ids, seed, startHp, endHp: [a.player.hp, b.player.hp], moves, fired, bout: { ...ctx.arena.bout }, stats: final.map(s => ({ ...s.stats })), final, samples };
    }, { ids, seed, ticks });
  };
  const pairs = [['ilyra-voss', 'brann-rook'], ['sable-fen', 'mara-quell'], ['kest-rel', 'nox-calder'], ['edda-morrow', 'selene-wraith'], ['rusk-emberjaw', 'father-thorne']];
  const rows = [];
  const seedIndex = process.argv.indexOf('--seeds');
  const seeds = seedIndex >= 0 ? Math.max(1, Math.min(10, Number(process.argv[seedIndex + 1]) || 1)) : 1;
  for (const [index, pair] of pairs.entries()) for (let seedRun = 0; seedRun < seeds; seedRun++) {
    if (process.argv.includes('--scenarios')) continue;
    if (process.argv.includes('--rusk') && index !== 4) continue;
    const row = await run(pair, 7301 + index * 41 + seedRun * 997);
    rows.push(row);
    console.log(JSON.stringify({ ids: row.ids, ticks: row.bout.endedAt - row.bout.startedAt, endHp: row.endHp, stats: row.stats }));
    check.check(`${pair.join(' vs ')}: fights resolve inside 60 seconds`, row.bout.state === 'won');
    check.check(`${pair.join(' vs ')}: both fighters take part`, row.stats.every(s => s.shots > 0 && s.z > 0) && row.moves > 0);
    check.check(`${pair.join(' vs ')}: no five-second stretch without action`, row.stats.every(s => s.idleMax < 300));
  }
  await freshStage();
  const scenarios = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    ctx.state.paused = true;
    ctx.fighters.equip('ilyra-voss'); await ctx.fighters.whenReady();
    await ctx.console.exec('arena add brann-rook 740 639');
    const a = ctx.arena.bundle(0), b = ctx.arena.bundle(1);
    await ctx.console.exec('ai off'); await ctx.console.exec('arena bot 1 off');
    ctx.arena.reset();
    for (const [bundle, x] of [[a, 640], [b, 740]]) Object.assign(bundle.player, { x, y: 639, vx: 0, vy: 0, grounded: true, invuln: 0 });
    // Use spark to isolate an incoming Duel projectile, with all native damage/physics still enabled.
    a.wands.loadLoadout({ active: 0, collection: ['spark'], wands: [{ frameId: 'oak', cards: ['spark', null, null], mana: 90 }, { frameId: 'bone', cards: ['spark', null, null, null], mana: 120 }] });
    ctx.state.worldSeed = 8001;
    await ctx.console.exec('ai basic 5');
    const status = async () => (await ctx.console.exec('ai status')).data.status;
    const step = n => { for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true }); };
    step(8);
    const beforeDodge = (await status()).stats.dodges;
    ctx.projectiles.push({ x: a.player.x + 100, y: a.player.y - 9, vx: -5, vy: 0, type: 'bolt', life: 100, age: 0, hostile: false, charging: false, owner: 1 });
    const dodgeTrace = [];
    for (let i = 0; i < 15; i++) {
      step(1);
      dodgeTrace.push({ tick: ctx.state.frameCount, body: { x: a.player.x, y: a.player.y, vx: a.player.vx, vy: a.player.vy, grounded: a.player.grounded }, shots: ctx.projectiles.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life })), threat: (await status()).threat, action: (await status()).action, dodges: (await status()).stats.dodges });
    }
    const dodged = (await status()).stats.dodges > beforeDodge;
    ctx.projectiles.length = 0;
    const wand = a.wands.wands[a.wands.active];
    wand.mana = 0;
    step(24);
    const lowMana = { intent: (await status()).intent, firing: a.player.firing, range: (await status()).range };
    // Live controller legality: no candidate attack while stunned, and no shoot while the wand cycles.
    const attacksBefore = (await status()).stats.attacks ?? 0;
    a.player.stunT = 30; a.player.firePressed = false;
    step(5);
    const stunned = (await status()).scores.every(row => row.action === 'wait') && ((await status()).stats.attacks ?? 0) === attacksBefore;
    a.player.stunT = 0; wand.mana = wand.frame.manaMax; wand.cooldown = 100;
    step(16);
    const cooling = !(await status()).scores.some(row => row.action === 'shoot') && !a.player.firing;
    wand.cooldown = 0;
    const profile = await ctx.console.exec('ai personality ranger');
    await ctx.console.exec('ai level easy');
    const changed = (await ctx.console.exec('ai status')).data;
    const independent = profile.ok && changed.personality === 'ranger' && changed.level === 1;
    step(40);
    ctx.arena.reset();
    const cleared = await status();
    const resetClean = cleared.target === '-' && cleared.memory.opponents === 0 && cleared.action === 'wait' && !a.player.firePressed && !a.input.queuedJump;
    const tuned = await ctx.console.exec('ai behavior strafeDistance 28');
    const applied = (await ctx.console.exec('ai behavior')).data.behavior.strafeDistance;
    await ctx.console.exec('ai behavior reset');
    await ctx.console.exec('ai off');
    const released = !a.player.firing && !a.input.keys.left && !a.input.keys.right && !a.input.keys.jump;
    // The rival stands on the left platform. The bot must rise beside the lip, then land on it.
    ctx.arena.reset();
    Object.assign(a.player, { x: 670, y: 639, vx: 0, vy: 0, grounded: true, invuln: 99999 });
    Object.assign(b.player, { x: 620, y: 567, vx: 0, vy: 0, grounded: true, invuln: 99999 });
    await ctx.console.exec('ai basic 5');
    let climbed = false;
    for (let tick = 0; tick < 360; tick++) {
      step(1);
      if (a.player.grounded && a.player.y <= 567 && a.player.x >= 580 && a.player.x <= 650) { climbed = true; break; }
    }
    const navigation = { climbed, edges: (await status()).stats.edges, x: a.player.x, y: a.player.y };
    await ctx.console.exec('ai off');
    ctx.arena.reset();
    Object.assign(a.player, { x: 640, y: 639, vx: 0, vy: 0, grounded: true, invuln: 99999 });
    Object.assign(b.player, { x: 770, y: 639, vx: 0, vy: 0, grounded: true, invuln: 99999 });
    const { Cell } = await import('/src/sim/CellType.ts');
    // A broad acid patch has no safe forward landing inside the short hop.
    // The clear ground behind us must be used before the three-second stuck timer.
    for (let y = 633; y <= 639; y++) for (let x = 654; x <= 728; x++) ctx.world.replaceCellAt(ctx.world.idx(x, y), Cell.Acid, 0x76b63c);
    const hazardBot = await ctx.console.exec('ai basic 5');
    let minX = a.player.x;
    const hazardTrace = [];
    for (let i = 0; i < 60; i++) {
      step(1); minX = Math.min(minX, a.player.x);
      if (i % 10 === 0) hazardTrace.push({ tick: ctx.state.frameCount, mode: ctx.state.mode, bout: { ...ctx.arena.bout },
        a: { x: a.player.x, y: a.player.y, dead: a.player.dead, hp: a.player.hp, stun: a.player.stunT },
        b: { x: b.player.x, y: b.player.y, dead: b.player.dead, hp: b.player.hp }, status: JSON.parse(JSON.stringify(await status())) });
    }
    const hazardReposition = { minX, stats: { ...(await status()).stats }, bot: hazardBot, trace: hazardTrace };
    await ctx.console.exec('ai off');
    // Repeated large explosions must not punch a route through the Duel enclosure.
    for (let i = 0; i < 3; i++) {
      ctx.explosions.trigger(800, 663, 76);
      ctx.explosions.trigger(530, 620, 76);
    }
    const cell = (x, y) => ctx.world.types[ctx.world.idx(x, y)];
    const shellIntact = cell(800, 690) === 13 && cell(501, 620) === 13;
    return { dodged, dodgeTrace, lowMana, stunned, cooling, independent, resetClean, tuned: tuned.ok && applied === 28, released, navigation, hazardReposition, shellIntact };
  });
  check.check('dodges a rival-owned, non-hostile projectile through normal jump input', scenarios.dodged);
  check.check('low mana preserves combat distance and releases the trigger', scenarios.lowMana.intent === 'recover' && !scenarios.lowMana.firing && scenarios.lowMana.range > 30, JSON.stringify(scenarios.lowMana));
  check.check('behavior console retunes the live table', scenarios.tuned);
  check.check('stun and weapon cooldown exclude unavailable attacks in the actual controller', scenarios.stunned && scenarios.cooling);
  check.check('personality and difficulty change independently through the console', scenarios.independent);
  check.check('rematch clears targets, observations, commitments and pending input', scenarios.resetClean);
  check.check('switching the bot off releases its inputs', scenarios.released);
  check.check('reaches a rival on the Duel platform through normal movement', scenarios.navigation.climbed && scenarios.navigation.edges > 0, JSON.stringify(scenarios.navigation));
  check.check('a broad hazard triggers safe backward footwork within one second', scenarios.hazardReposition.minX < 632 && scenarios.hazardReposition.stats.hazardRepositions > 0, JSON.stringify(scenarios.hazardReposition));
  check.check('repeated bomb-sized blasts cannot open the Duel shell', scenarios.shellIntact);
  // Also observe the normal fixed clock and real render loop. The fast batch
  // above must agree with visible play, rather than only a forced-tick harness.
  await freshStage();
  const liveStart = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    await ctx.console.exec('arena remove');
    ctx.fighters.equip('kest-rel'); await ctx.fighters.whenReady();
    await ctx.console.exec('arena add nox-calder 1020 639');
    ctx.arena.reset(); ctx.state.arrivalGraceUntil = 0; ctx.state.worldSeed = 8298;
    await ctx.console.exec('arena bot 0 basic 4');
    await ctx.console.exec('arena bot 1 basic 4');
    ctx.state.paused = false;
    const canvas = document.querySelector('#canvas-holder > canvas');
    const stream = canvas.captureStream(24), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 3500000 });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.start(); window.__aiMotion = { recorder, stream, chunks };
    return { frame: ctx.state.frameCount, hp: [ctx.arena.bundle(0).player.hp, ctx.arena.bundle(1).player.hp] };
  });
  const liveSamples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1000);
    liveSamples.push(await page.evaluate(async () => {
      const ctx = window.__game.ctx;
      const bots = (await ctx.console.exec('arena status')).data.bots;
      return { frame: ctx.state.frameCount, bout: ctx.arena.bout.state,
        bodies: [0, 1].map(s => { const p = ctx.arena.bundle(s).player; return { x: p.x, y: p.y, hp: p.hp }; }),
        bots: bots.map(b => ({ intent: b.intent, stats: { ...b.stats } })) };
    }));
  }
  const clip = await page.evaluate(() => new Promise(resolve => {
    const { recorder, stream, chunks } = window.__aiMotion;
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const bytes = new Uint8Array(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      resolve(btoa(binary));
    };
    recorder.stop();
  }));
  writeFileSync('verify-out/ai-combat/live-duel.webm', Buffer.from(clip, 'base64'));
  const liveEnd = liveSamples.at(-1);
  check.check('normal-speed play advances the real clock and both opponents deal damage',
    liveEnd.frame - liveStart.frame >= 100 && liveEnd.bodies.every((p, i) => p.hp < liveStart.hp[i]), JSON.stringify({ liveStart, liveEnd }));
  await page.screenshot({ path: 'verify-out/ai-combat/live-duel.png' });
  await page.evaluate(() => { window.__game.ctx.state.paused = true; });
  // Exercise the visible controls, not just their console equivalents.
  const personality = page.locator('select[aria-label="Slot 1 personality"]');
  await personality.selectOption('assassin');
  const controls = personality.locator('..');
  await controls.locator('[data-brain="basic"]').click();
  await controls.locator('[data-level="4"]').click();
  const ui = await page.evaluate(async () => (await window.__game.ctx.console.exec('arena status')).data.bots[1]);
  check.check('developer panel selects personality and named difficulty independently', ui.personality === 'assassin' && ui.level === 4, JSON.stringify(ui));
  check.check('no page errors', errors.length === 0, errors.join('\n'));
  writeFileSync(`verify-out/ai-combat/${process.argv.includes('--scenarios') ? 'scenarios' : 'measured'}.json`, JSON.stringify({ rows, scenarios, liveStart, liveSamples, errors }, null, 2));
  await controls.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'verify-out/ai-combat/duel.png' });
} finally {
  await browser.close();
}
console.log(`AI combat: ${check.pass} passed, ${check.fail} failed`);
process.exitCode = check.fail ? 1 : 0;
