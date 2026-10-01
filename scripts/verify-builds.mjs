// The choice update, PLAYED (pillar 2): the decisions that sit on the route, and what they cost.
//
// Real input throughout (real clicks on the offer tiles and buttons, a held mouse button to cast), the console
// (`goto`, `waystone light`, `boss kill`) only to reach a state fast. Covers:
//   - the arrival gift: held through the title card, then a three-card choice (burst / precision / utility)
//   - waystone altars: host / synergy / wild bargain, each kind taken by a real click, the price on the tile
//   - one altar in three also turns up a wand; a boss's wreckage turns up a frame
//   - the wand-frame overlay: stat diff, how YOUR cards cycle, the displaced cards named, a refit that sends
//     them back to the satchel (never deletes them), leaving it, pause restored
//   - the dead-card caption: once per card per run, in the toast stack AND the hotbar's cast caption
//   - a bargain's price in REAL casts (a wandering aim misses at range, hits point-blank)
//   - the bench's fit tells, the Sanctum/pause/ledger recap, the "Run notes" line, the playtest report JSON
// Usage: node scripts/verify-builds.mjs [url] [shotsDir]   (dev server running; default http://localhost:5173/)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { execConsoleCommand, waitForOpeningEnd, waitForRunReady } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const shots = process.argv[3] ?? null;
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text())) pageErrors.push('console: ' + m.text()); });

const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
const G = (fn, arg) => page.evaluate(fn, arg);
const overlayShown = (sel) => page.evaluate((s) => document.querySelector(s)?.classList.contains('visible') === true, sel);
const offerCards = () => page.evaluate(() => [...document.querySelectorAll('#card-offer-overlay .card-offer-card')].map((e) => ({
  id: e.dataset.cardOfferId, role: e.dataset.cardOfferRole ?? null, fit: e.dataset.cardFit, bargain: e.classList.contains('bargain'),
  price: e.querySelector('.card-offer-cost')?.textContent ?? null, fitLine: e.querySelector('.card-offer-fit-line')?.textContent ?? null,
})));

async function realClick(selector) {
  const handle = await page.waitForSelector(selector, { state: 'visible', timeout: 20000 });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Wait for the card offer, return its tiles. */
async function waitForOffer(timeout = 30000) {
  await page.waitForSelector('#card-offer-overlay.visible', { timeout });
  await page.waitForTimeout(350);
  return offerCards();
}

async function takeCard(cardId) {
  await realClick(`#card-offer-overlay [data-card-offer-id="${cardId}"]`);
  await page.waitForFunction(() => !document.getElementById('card-offer-overlay')?.classList.contains('visible'), null, { timeout: 5000 });
}

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#expedition-entry:not([hidden])', { timeout: 60000 });
  await realClick('#expedition-entry [data-entry="begin"]');
  await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'd1', null, { timeout: 60000 });
  await waitForOpeningEnd(page);

  /* ---------------- the arrival gift ---------------- */
  await execConsoleCommand(page, 'goto d2');
  await waitForRunReady(page);
  await page.waitForTimeout(1500);
  check('the arrival gift waits for the floor title (no offer 1.5 s after arrival)', !(await overlayShown('#card-offer-overlay')));
  const gift = await waitForOffer();
  await shot('1-arrival-gift');
  check('the gift is a three-card choice: a burst, a precise shot, a utility', gift.length === 3 && gift.map((c) => c.role).join() === 'Burst,Precision,Utility', JSON.stringify(gift.map((c) => [c.id, c.role])));
  check('the game is paused while it is up', await G(() => window.__game.ctx.state.paused));
  const before = await G(() => window.__game.ctx.wands.collection.length);
  await takeCard(gift[1].id);
  check('a real click takes the card into the satchel and hands the pause back', (await G(() => window.__game.ctx.wands.collection.length)) === before + 1 && !(await G(() => window.__game.ctx.state.paused)));

  /* ---------------- altars: a host, a synergy, a bargain ---------------- */
  const roles = ['Host', 'Synergy', 'Wild · a bargain'];
  const taken = [];
  let wandOfferSeen = false;
  for (let altar = 0; altar < 3; altar++) {
    const lit = await execConsoleCommand(page, 'waystone light', { rejectOnError: false });
    if (!lit.ok) {
      // the floor ran out of unlit waystones: carry on one floor down
      await execConsoleCommand(page, altar === 1 ? 'goto d3' : 'goto d2b');
      await waitForRunReady(page);
      await page.waitForTimeout(500);
      const gift2 = await Promise.race([waitForOffer(15000).catch(() => null), page.waitForTimeout(8000).then(() => null)]);
      if (gift2) await takeCard(gift2[0].id);
      await execConsoleCommand(page, 'waystone light');
    }
    await page.waitForTimeout(300);
    const tiles = await waitForOffer(30000);
    await shot(`2-altar-${altar + 1}`);
    check(`altar ${altar + 1}: three different cards, labelled host / synergy / wild`, tiles.length === 3 && new Set(tiles.map((t) => t.id)).size === 3 && tiles.map((t) => t.role).join() === roles.join(), JSON.stringify(tiles.map((t) => [t.id, t.role])));
    check(`altar ${altar + 1}: the wild card is a bargain with its price on the tile`, tiles[2].bargain && !!tiles[2].price && tiles[2].price.length > 20, tiles[2].price ?? '');
    check(`altar ${altar + 1}: no dead synergy`, tiles[1].fit !== 'dead', tiles[1].fitLine ?? '');
    taken.push(tiles[altar].id);
    await takeCard(tiles[altar].id); // altar 1 takes the host, 2 the synergy, 3 the bargain
    check(`altar ${altar + 1}: a real click on the ${roles[altar]} tile grants it`, await G((id) => window.__game.ctx.wands.collection.includes(id) || window.__game.ctx.wands.wands.some((w) => w.cards.includes(id)), tiles[altar].id));
    if (altar === 2) {
      await page.waitForSelector('#wand-offer-overlay.visible', { timeout: 20000 });
      wandOfferSeen = true;
      await page.waitForTimeout(300);
      await shot('3-altar-wand-find');
    }
  }
  check('the third altar also turned up a wand', wandOfferSeen);
  const found = await G(() => [...document.querySelectorAll('#wand-offer-overlay .wand-offer-frame')].map((f) => f.dataset.wandOfferFrame));
  check('a single frame is on offer, never one already in hand', found.length === 1 && !['oak', 'bone'].includes(found[0]), found.join());
  const hasStats = await G(() => document.querySelectorAll('#wand-offer-overlay .wand-offer-stats dt').length >= 12 && !!document.querySelector('#wand-offer-overlay .wand-offer-cycle'));
  check('the overlay shows the stat diff for both wands and how your cards cycle', hasStats);
  check('the game is paused during the wand offer', await G(() => window.__game.ctx.state.paused));
  await realClick('#wand-offer-overlay .wand-offer-leave');
  await page.waitForFunction(() => !document.getElementById('wand-offer-overlay')?.classList.contains('visible'), null, { timeout: 5000 });
  check('leaving it changes nothing and hands the pause back', (await G(() => window.__game.ctx.wands.wands.map((w) => w.frame.id).join())) === 'oak,bone' && !(await G(() => window.__game.ctx.state.paused)));

  /* ---------------- a frame from a boss's wreckage; displaced cards named, never deleted ---------------- */
  await execConsoleCommand(page, 'goto d3');
  await waitForRunReady(page);
  await page.waitForTimeout(500);
  const g3 = await waitForOffer(30000).catch(() => null);
  if (g3) await takeCard(g3[0].id);
  // four cards on wand II (bone, 4 slots): a three-slot frame will have to push one out
  await G(() => {
    const w = window.__game.ctx.wands;
    w.wands[1].cards.splice(0, 4, 'dig', 'spark', 'heavy', 'bomb');
    w.invalidatePrograms();
  });
  await execConsoleCommand(page, 'boss kill');
  await page.waitForSelector('#wand-offer-overlay.visible', { timeout: 30000 });
  await page.waitForTimeout(300);
  check('a fallen boss leaves a frame in the wreckage', (await G(() => document.querySelector('#wand-offer-overlay .menu-title')?.textContent)) === 'A frame in the wreckage');
  // PLAY the real find: refit wand II with whatever the wreckage held. Whatever the overlay promised
  // (the slot count, the cards that would not fit) must be exactly what happens.
  const bossFrame = await G(() => document.querySelector('#wand-offer-overlay .wand-offer-frame')?.dataset.wandOfferFrame ?? '');
  const claim = await G(() => {
    const target = document.querySelector('#wand-offer-overlay [data-offer-wand="1"]');
    const slotsDd = [...target.querySelectorAll('dt')].find((n) => n.textContent === 'Slots')?.nextElementSibling?.textContent ?? '';
    return { slots: Number(slotsDd.split('→').pop().trim()), displaced: target.querySelector('.wand-offer-displaced')?.textContent ?? '' };
  });
  await shot('3b-boss-frame');
  const preBoss = await G(() => ({ cards: window.__game.ctx.wands.wands[1].cards.filter(Boolean), spare: window.__game.ctx.wands.collection.length }));
  await realClick(`#wand-offer-overlay [data-offer-frame="${bossFrame}"][data-offer-wand="1"]`);
  await page.waitForFunction(() => !document.getElementById('wand-offer-overlay')?.classList.contains('visible'), null, { timeout: 5000 });
  const postBoss = await G(() => ({ frame: window.__game.ctx.wands.wands[1].frame.id, cap: window.__game.ctx.wands.wands[1].cards.length, cards: window.__game.ctx.wands.wands[1].cards.filter(Boolean), spare: window.__game.ctx.wands.collection.length, paused: window.__game.ctx.state.paused }));
  const pushedOut = Math.max(0, preBoss.cards.length - claim.slots);
  check('the boss frame really fits wand II, with the slot count the overlay promised', postBoss.frame === bossFrame && postBoss.cap === claim.slots, JSON.stringify({ bossFrame, claim, postBoss }));
  check('the cards the overlay said would not fit are exactly the ones that went back to the satchel', postBoss.cards.length === preBoss.cards.length - pushedOut && postBoss.spare === preBoss.spare + pushedOut && (pushedOut > 0) === /Does not fit/.test(claim.displaced), JSON.stringify({ preBoss, postBoss, claim }));
  // back to the bone crook for the controlled case below
  await G(() => {
    const w = window.__game.ctx.wands;
    w.upgradeFrame(window.__game.ctx, 1, 'bone');
    w.wands[1].cards.splice(0, 4, 'dig', 'spark', 'heavy', 'bomb');
    w.collection.length = 0;
    w.invalidatePrograms();
  });
  await page.waitForTimeout(200);
  // the displaced-cards case, on a frame we choose: the same overlay, the same code path
  await G(() => {
    const ctx = window.__game.ctx;
    ctx.wands.__probeOffer = { chosen: null, declined: 0 };
    ctx.events.emit('wandOfferRequested', {
      source: 'sanctum', title: 'The Wandwright’s rack', frames: ['quill', 'mortar'],
      onChoose: (frame, wand) => { ctx.wands.__probeOffer.chosen = [frame, wand]; ctx.wands.upgradeFrame(ctx, wand, frame); },
      onDecline: () => { ctx.wands.__probeOffer.declined++; },
    });
  });
  await page.waitForSelector('#wand-offer-overlay.visible');
  await page.waitForTimeout(400);
  await shot('4-wand-offer-displaced');
  const displaced = await G(() => [...document.querySelectorAll('#wand-offer-overlay [data-offer-frame="quill"][data-offer-wand="1"] .wand-offer-displaced')].map((n) => n.textContent + '|' + n.className));
  check('the overlay names the card a three-slot frame would push out', displaced.length === 1 && /Cast Bomb/.test(displaced[0]) && /cost/.test(displaced[0]), displaced.join());
  const keptBefore = await G(() => window.__game.ctx.wands.collection.length);
  await realClick('#wand-offer-overlay [data-offer-frame="quill"][data-offer-wand="1"]');
  await page.waitForFunction(() => !document.getElementById('wand-offer-overlay')?.classList.contains('visible'), null, { timeout: 5000 });
  const after = await G(() => ({ cards: window.__game.ctx.wands.wands[1].cards.slice(), frame: window.__game.ctx.wands.wands[1].frame.id, collection: window.__game.ctx.wands.collection.slice(), paused: window.__game.ctx.state.paused }));
  check('the refit lands: wand II is a Hornet Needle holding the first three cards', after.frame === 'quill' && after.cards.join() === 'dig,spark,heavy', JSON.stringify(after.cards));
  check('the card that did not fit went back to the satchel (not deleted)', after.collection.length === keptBefore + 1 && after.collection.includes('bomb'));
  check('the pause is handed back', after.paused === false);
  await shot('5-after-refit');

  /* ---------------- the dead-card caption ---------------- */
  await G(() => {
    const ctx = window.__game.ctx;
    ctx.wands.wands[0].cards.splice(0, ctx.wands.wands[0].cards.length, 'watertrail', 'lightning', null);
    ctx.wands.invalidatePrograms();
    ctx.wands.wands[0].mana = ctx.wands.wands[0].frame.manaMax;
    ctx.wands.active = 0;
  });
  await page.waitForTimeout(300);
  await page.mouse.move(900, 300);
  await page.mouse.down();
  await page.waitForTimeout(260);
  await page.mouse.up();
  await page.waitForTimeout(500);
  await shot('6-dead-card-caption');
  const toast1 = await G(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).filter((t) => /does nothing/.test(t)));
  const cap1 = await G(() => document.querySelector('.wand-cast-caption')?.textContent ?? '');
  check('casting a Water Trail on Chain Lightning says so in the toast stack', toast1.length === 1 && /Water Trail does nothing on Chain Lightning/.test(toast1[0]), JSON.stringify(toast1));
  const castCaption = await G(() => [...document.querySelectorAll('#hotbar *, #hud *')].map((n) => n.textContent ?? '').find((t) => /does nothing on/.test(t)) ?? '');
  check('...and in the hotbar caption the player is looking at', /does nothing on/.test(castCaption) || /does nothing on/.test(cap1), castCaption || cap1);
  const countBefore = await G(() => window.__game.ctx.wands.buildNotes().deadCardCasts);
  await page.waitForTimeout(1500);
  await page.mouse.down();
  await page.waitForTimeout(260);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('a second cast does not say it again (once per card per run)', (await G(() => window.__game.ctx.wands.buildNotes().deadCardCasts)) === countBefore && countBefore === 1);

  /* ---------------- a bargain's price, in real casts ---------------- */
  const price = await G(async () => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const clear = () => { for (let y = 90; y <= 130; y++) for (let x = 20; x <= 330; x++) if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y)); };
    const measure = (cards, dist) => {
      const w = ctx.wands.wands[0];
      w.cards.fill(null);
      cards.forEach((c, i) => { w.cards[i] = c; });
      ctx.wands.invalidatePrograms();
      let total = 0;
      for (let rep = 0; rep < 3; rep++) {
        clear();
        ctx.projectiles.length = 0; ctx.enemies.length = 0;
        ctx.player.x = 30; ctx.player.y = 120; ctx.player.invuln = 1e6; ctx.player.dead = false;
        ctx.state.frameCount = 100 + rep * 1000;
        ctx.enemyCtl.spawn('slime', 30 + dist, 120);
        const e = ctx.enemies[ctx.enemies.length - 1];
        e.hp = e.maxHp = 1e7;
        w.mana = w.frame.manaMax; w.cooldown = 0; w.castIndex = 0;
        for (let t = 0; t < 360; t++) {
          if (t % 2 === 0) clear();
          e.x = 30 + dist; e.y = 120; e.vx = 0; e.vy = 0;
          ctx.player.x = 30; ctx.player.y = 120; ctx.player.vx = 0; ctx.player.vy = 0; ctx.player.grounded = true;
          for (let k = 0; k < 4; k++) { const tip = ctx.spells.wandTip(); ctx.player.aimAngle = Math.atan2(e.y - 5 - tip.y, e.x - tip.x); }
          ctx.player.firing = true; ctx.player.firePressed = false; ctx.player.recharge = 0;
          ctx.wands.update(ctx);
          ctx.wands.fire(ctx);
          ctx.state.frameCount++;
          ctx.projectileCtl.update(ctx);
          total += 1e7 - e.hp; e.hp = 1e7;
        }
      }
      return total / 3 / 6; // damage per second over 6 s of held fire
    };
    ctx.wands.upgradeFrame(ctx, 0, 'oak');
    const out = {
      sparkNear: measure(['spark'], 30), sparkFar: measure(['spark'], 200),
      looseNear: measure(['loosecannon', 'spark'], 30), looseFar: measure(['loosecannon', 'spark'], 200),
      heavyFar: measure(['heavy', 'spark'], 200),
    };
    return out;
  });
  check('Loose Cannon is strong point-blank (>= 1.6x the plain Spark Bolt)', price.looseNear >= 1.6 * price.sparkNear, JSON.stringify(price));
  check('...and its price is real: at range it falls under half of the plain bolt', price.looseFar < 0.5 * price.sparkFar, JSON.stringify(price));
  check('Heavy Charm is one bolt that really hits harder (>= 1.4x at range)', price.heavyFar >= 1.4 * price.sparkFar, JSON.stringify(price));
  // The other prices, felt in ONE real cast each: Kickback shoves the alchemist, Overcharge empties the tank,
  // Short Fuse's bolt dies within a few dozen cells, Millstone crawls.
  const felt = await G(() => {
    const ctx = window.__game.ctx;
    const w = ctx.wands.wands[0];
    const cast = (cards) => {
      w.cards.fill(null);
      cards.forEach((c, i) => { w.cards[i] = c; });
      ctx.wands.invalidatePrograms();
      ctx.projectiles.length = 0;
      w.mana = w.frame.manaMax; w.cooldown = 0; w.castIndex = 0;
      Object.assign(ctx.player, { x: 30, y: 120, vx: 0, vy: 0, grounded: false, aimAngle: 0, firing: true, firePressed: false, recharge: 0, invuln: 1e6, dead: false });
      ctx.wands.update(ctx);
      ctx.wands.fire(ctx);
      const bolt = ctx.projectiles.find((p) => p.type === 'bolt') ?? null;
      const out = { kick: Math.abs(ctx.player.vx), spent: w.frame.manaMax - w.mana, life: bolt?.life ?? null, speed: bolt ? Math.hypot(bolt.vx, bolt.vy) : null };
      ctx.projectiles.length = 0;
      return out;
    };
    return { plain: cast(['spark']), kick: cast(['kickback', 'spark']), over: cast(['overcharge', 'spark']), fuse: cast(['shortfuse', 'spark']), mill: cast(['millstone', 'spark']) };
  });
  check('Kickback really shoves the alchemist (>= 4x the plain cast)', felt.kick.kick >= 4 * Math.max(0.2, felt.plain.kick), JSON.stringify(felt));
  check('Overcharged Coil really costs 26 mana more than the plain cast', Math.abs(felt.over.spent - felt.plain.spent - 26) < 0.5, JSON.stringify(felt));
  check('Short Fuse gives the bolt a few ticks of life (under a tenth of the plain bolt)', felt.fuse.life !== null && felt.fuse.life < 0.1 * felt.plain.life, JSON.stringify(felt));
  check('Millstone slows the bolt to under a third of the plain speed', felt.mill.speed !== null && felt.mill.speed < 0.35 * felt.plain.speed, JSON.stringify(felt));

  /* ---------------- the bench's fit tells ---------------- */
  await G(() => {
    const w = window.__game.ctx.wands;
    w.wands[0].cards.splice(0, w.wands[0].cards.length, 'spark', 'lightning', null);
    w.collection.length = 0;
    w.collection.push('watertrail', 'critwet', 'shattercrit', 'overcharge', 'double');
    w.invalidatePrograms();
  });
  await page.keyboard.press('KeyB');
  await page.waitForSelector('#wand-bench.visible');
  await page.waitForTimeout(300);
  const tile = await page.waitForSelector('#wand-bench .bench-card[data-bench-card-id="overcharge"]');
  const box = await tile.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await shot('7-bench-fit-tells');
  const inspect = await G(() => document.querySelector('#wand-bench .bench-inspect')?.textContent ?? '');
  check('the bench inspect shows the bargain price and the fit line', /Price/.test(inspect) && /Works with your/.test(inspect), inspect.slice(0, 160));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* ---------------- the recap: pause, Sanctum, ledger, report ---------------- */
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause-overlay.visible');
  const pauseRows = await G(() => document.querySelector('#pause-stats')?.textContent ?? '');
  check('the pause menu reads the wands back', /Wand I/.test(pauseRows) && /Wand II/.test(pauseRows), pauseRows.slice(-160));
  await page.waitForTimeout(700);
  await shot('8-pause-recap');
  // the playtest report carries the decision record
  const reportToast = page.locator('#pause-copy-report');
  if (await reportToast.count()) {
    await realClick('#pause-copy-report');
    await page.waitForTimeout(400);
    const text = await G(() => navigator.clipboard.readText().catch(() => ''));
    let report = null;
    try { report = JSON.parse(text); } catch { /* clipboard blocked */ }
    check('the playtest report carries the build decisions', !!report?.choices?.notes && report.choices.notes.offersShown >= 4 && report.choices.notes.altars === 3 && report.choices.wands.length === 2, text.slice(0, 80));
    if (report) console.log('     report.choices.notes.summary:', report.choices.notes.summary);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* ---------------- a save in the gap between "earned" and "shown" ---------------- */
  const owed = await G(() => {
    const ctx = window.__game.ctx;
    ctx.events.emit('waystoneLit', { index: 0, depth: 3, levelId: 'd3' });
    const snap = JSON.parse(JSON.stringify(ctx.wands.snapshotRuntimeState()));
    ctx.wands.restoreRuntimeState(snap); // what a resumed run does with the saved record
    return snap.build?.owed ?? null;
  });
  check('a save written the moment a waystone caught carries the offer it owes', owed?.altar === 1, JSON.stringify(owed));
  const resumedAltar = await waitForOffer(30000);
  check('...and the resumed run still gets its altar', resumedAltar.length === 3 && resumedAltar[2].bargain, JSON.stringify(resumedAltar.map((t) => t.id)));
  await takeCard(resumedAltar[1].id);

  await G(() => { const ctx = window.__game.ctx; ctx.state.score = 900; ctx.sanctum.openShop(ctx); });
  await page.waitForSelector('#sanctum-overlay.visible');
  await page.waitForTimeout(300);
  check('the Sanctum shows the build above its shop', await G(() => !!document.querySelector('#sanc-shop .build-recap .build-recap-row')));
  await shot('9-sanctum-recap-rack');
  await realClick('#sanc-shop .shop-row:has(.sh-name:text("rack")) button');
  await page.waitForSelector('#wand-offer-overlay.visible');
  await page.waitForTimeout(700);
  await shot('10-rack');
  const rack = await G(() => [...document.querySelectorAll('#wand-offer-overlay .wand-offer-frame')].map((f) => f.dataset.wandOfferFrame));
  check('the Wandwright’s rack offers up to three specialists', rack.length >= 1 && rack.length <= 3 && rack.every((id) => ['quill', 'pepperpot', 'mortar', 'samovar'].includes(id)), rack.join());
  const gold0 = await G(() => window.__game.ctx.state.score);
  await realClick('#wand-offer-overlay .wand-offer-leave');
  await page.waitForTimeout(300);
  check('leaving the rack costs nothing', (await G(() => window.__game.ctx.state.score)) === gold0 && (await G(() => window.__game.ctx.state.paused)));
  // taking a frame pays 200 oz and refits
  await realClick('#sanc-shop .shop-row:has(.sh-name:text("rack")) button');
  await page.waitForSelector('#wand-offer-overlay.visible');
  const pick = await G(() => { const b = document.querySelector('#wand-offer-overlay .wand-offer-target:not([disabled])'); return b ? [b.dataset.offerFrame, b.dataset.offerWand] : null; });
  await realClick(`#wand-offer-overlay .wand-offer-target[data-offer-frame="${pick[0]}"][data-offer-wand="${pick[1]}"]`);
  await page.waitForTimeout(500);
  check('taking a frame from the rack pays 200 oz and refits the wand', (await G(() => window.__game.ctx.state.score)) === gold0 - 200 && (await G((w) => window.__game.ctx.wands.wands[Number(w)].frame.id, pick[1])) === pick[0]);
  await G(() => window.__game.ctx.sanctum.dismiss?.());
  await page.waitForTimeout(300);

  // the ledger: build, run notes, share line
  await G(() => window.__game.ctx.run.abandon(window.__game.ctx));
  await page.waitForSelector('#run-summary.visible', { timeout: 10000 });
  await page.waitForTimeout(2600);
  await shot('11-ledger');
  const ledger = await G(() => ({
    build: document.querySelector('#run-summary .rs-build')?.textContent ?? '',
    notes: document.querySelector('#run-summary .rs-notes')?.textContent ?? '',
    share: document.querySelector('#run-summary .rs-share')?.textContent ?? '',
  }));
  check('the ledger names what the run was built on', /Built on/.test(ledger.build) && ledger.build.length > 12, ledger.build);
  check('the ledger carries the run notes (offers, altars, frames, floor clocks)', /Run notes/.test(ledger.notes) && /offers/.test(ledger.notes) && /frame/.test(ledger.notes) && /floor/.test(ledger.notes), ledger.notes);
  check('the share line ends with the wands', /wands: /.test(ledger.share), ledger.share);
  console.log('     ledger.notes:', ledger.notes);

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 400));
} catch (error) {
  failures++;
  console.log('FAIL probe crashed -', error?.stack ?? error);
  await shot('crash').catch(() => undefined);
} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nverify-builds: all checks passed' : `\nverify-builds: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
