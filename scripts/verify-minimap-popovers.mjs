// Focused minimap POI popover probe.
// Usage: node scripts/verify-minimap-popovers.mjs [url]  (dev server running)
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

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

const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined));

async function hoverMarker(canvasSelector, marker) {
  const point = await page.evaluate(({ canvasSelector: selector, marker: target }) => {
    const canvas = document.querySelector(selector);
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((target.x >> 3) + target.offsetX) / canvas.width * rect.width,
      y: rect.top + ((target.y >> 3) + target.offsetY) / canvas.height * rect.height,
    };
  }, { canvasSelector, marker });
  if (!point) return false;
  await page.mouse.move(1, 1);
  await page.waitForTimeout(20);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(120);
  return true;
}

async function popoverState() {
  return page.evaluate(() => {
    const pop = document.getElementById('minimap-poi-pop');
    const style = pop ? getComputedStyle(pop) : null;
    return {
      visible: !!pop && style?.display !== 'none' && style?.visibility !== 'hidden',
      text: pop?.textContent ?? '',
      hasThumb: !!pop?.querySelector('canvas.map-poi-thumb, canvas.px-icon, .bp-matpop-dot'),
      fields: [...(pop?.querySelectorAll('.bp-pop-prop') ?? [])].map((el) => el.textContent ?? ''),
    };
  });
}

async function livePickupMarker(kind, options = {}) {
  return page.evaluate(({ kind: pickupKind, amount: expectedAmount, near }) => {
    const ctx = window.__game.ctx;
    const rt = ctx.levels.current;
    const canvas = document.getElementById('minimap-corner');
    if (!rt || !(canvas instanceof HTMLCanvasElement)) return null;
    const matches = rt.pickups.filter((entry) => (
      !entry.taken &&
      entry.kind === pickupKind &&
      (expectedAmount === undefined || entry.data?.amount === expectedAmount)
    ));
    if (matches.length === 0) return null;
    const pickup = near
      ? matches.sort((a, b) => {
        const adx = a.x - near.x;
        const ady = a.y - near.y;
        const bdx = b.x - near.x;
        const bdy = b.y - near.y;
        return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
      })[0]
      : matches[0];
    if (!pickup) return null;
    if (near) {
      pickup.x = near.x;
      pickup.y = near.y;
      pickup.vx = 0;
      pickup.vy = 0;
    }
    rt.explored[(pickup.x >> 3) + (pickup.y >> 3) * canvas.width] = 1;
    return { x: pickup.x, y: pickup.y, offsetX: 1, offsetY: 1 };
  }, { kind, amount: options.amount, near: options.near });
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await startConsoleTestRun(page, {
  level: 'd1',
  loadout: 'review',
  settleMs: 250,
});

const markers = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  if (!rt) return null;
  const mark = (x, y) => {
    const canvas = document.getElementById('minimap-corner');
    const width = canvas instanceof HTMLCanvasElement ? canvas.width : 200;
    rt.explored[(x >> 3) + (y >> 3) * width] = 1;
  };
  if (!rt.portal) rt.portal = { x: ctx.player.x + 160, y: ctx.player.y, open: false };
  if (!rt.refuge) rt.refuge = { x: ctx.player.x + 80, y: ctx.player.y + 32 };
  mark(rt.refuge.x, rt.refuge.y);
  const occupied = [];
  const occupy = (x, y) => occupied.push({ mx: x >> 3, my: y >> 3 });
  occupy(ctx.player.x, ctx.player.y);
  if (rt.portal) occupy(rt.portal.x, rt.portal.y);
  if (rt.refuge) occupy(rt.refuge.x, rt.refuge.y);
  if (rt.exit) occupy(rt.exit.x, rt.exit.sealY);
  if (rt.cauldron) occupy(rt.cauldron.x, rt.cauldron.y);
  if (rt.spellLab) occupy(rt.spellLab.x, rt.spellLab.y);
  if (rt.vaultArch) occupy(rt.vaultArch.x, rt.vaultArch.y);
  for (const waystone of rt.waystones) occupy(waystone.x, waystone.y);
  for (const pickup of rt.pickups) if (!pickup.taken) occupy(pickup.x, pickup.y);
  for (const mechanism of rt.mechanisms) occupy(mechanism.x, mechanism.y);
  for (const vault of rt.runeVaults) occupy(vault.rx, vault.ry);
  const freeMapSpot = () => {
    let found = { mx: 24, my: 24 };
    outer: for (let my = 18; my < 120; my += 13) {
      for (let mx = 18; mx < 185; mx += 17) {
        if (occupied.every((entry) => {
          const dx = entry.mx - mx;
          const dy = entry.my - my;
          return dx * dx + dy * dy > 144;
        })) {
          found = { mx, my };
          break outer;
        }
      }
    }
    occupied.push(found);
    return found;
  };
  const portalMap = freeMapSpot();
  const heartMap = freeMapSpot();
  const chestMap = freeMapSpot();
  const leverMap = freeMapSpot();
  const goldMap = freeMapSpot();
  const portalX = portalMap.mx * 8 + 4;
  const portalY = portalMap.my * 8 + 4;
  const heartX = heartMap.mx * 8 + 4;
  const heartY = heartMap.my * 8 + 4;
  const chestX = chestMap.mx * 8 + 4;
  const chestY = chestMap.my * 8 + 4;
  const leverX = leverMap.mx * 8 + 4;
  const leverY = leverMap.my * 8 + 4;
  const goldX = goldMap.mx * 8 + 4;
  const goldY = goldMap.my * 8 + 4;
  const maxMechanismId = rt.mechanisms.reduce((max, mechanism) => Math.max(max, mechanism.id), 0);
  rt.portal = { x: portalX, y: portalY, open: false };
  rt.pickups.push({ kind: 'heart', x: heartX, y: heartY, vx: 0, vy: 0, taken: false, data: {} });
  rt.pickups.push({ kind: 'chest', x: chestX, y: chestY, vx: 0, vy: 0, taken: false, data: { amount: 42 } });
  rt.mechanisms.push({
    id: maxMechanismId + 101,
    kind: 'lever',
    x: leverX,
    y: leverY,
    w: 1,
    h: 1,
    state: 0,
    targetId: -1,
  });
  const goldIndex = rt.world.idx(goldX, goldY);
  rt.world.types[goldIndex] = 17; // Cell.Gold
  rt.world.colors[goldIndex] = 0xffd23c;
  for (let dx = -1; dx <= 1; dx++) {
    const supportX = goldX + dx;
    const supportY = goldY + 1;
    if (!rt.world.inBounds(supportX, supportY)) continue;
    const supportIndex = rt.world.idx(supportX, supportY);
    rt.world.types[supportIndex] = 13; // Cell.Metal
    rt.world.colors[supportIndex] = 0x8f9ba8;
  }
  mark(portalX, portalY);
  mark(chestX, chestY);
  mark(leverX, leverY);
  mark(goldX, goldY);
  return {
    portal: { x: rt.portal.x, y: rt.portal.y, offsetX: 0.5, offsetY: 0.5 },
    refuge: { x: rt.refuge.x, y: rt.refuge.y, offsetX: 0.5, offsetY: 0.5 },
    heart: { x: heartX, y: heartY, offsetX: 1, offsetY: 1 },
    chest: { x: chestX, y: chestY, offsetX: 1, offsetY: 1 },
    lever: { x: leverX, y: leverY, offsetX: 1, offsetY: 1 },
    gold: { x: goldX, y: goldY, offsetX: 0.5, offsetY: 0.5 },
  };
});
check('Probe runtime has minimap marker anchors', !!markers, JSON.stringify(markers));

await page.keyboard.press('KeyM');
await page.waitForSelector('#minimap-overlay.visible', { timeout: 5000 });
await hoverMarker('#minimap-canvas', markers.portal);
const portalPop = await popoverState();
check(
  'Full map hover shows portal POI details',
  portalPop.visible && portalPop.text.includes('Exit Portal') && portalPop.text.includes('position') && portalPop.hasThumb,
  JSON.stringify(portalPop),
);

await page.keyboard.press('KeyM');
await page.waitForTimeout(160);
await hoverMarker('#minimap-corner', markers.refuge);
const refugePop = await popoverState();
check(
  'Corner map hover shows discovered Refuge details',
  refugePop.visible && refugePop.text.includes('Refuge') && refugePop.text.includes('bench') && refugePop.hasThumb,
  JSON.stringify(refugePop),
);

const undiscoveredSpellLab = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  if (!rt) return null;
  rt.spellLab = { x: rt.refuge.x + 112, y: rt.refuge.y + 24, rewardX: rt.refuge.x + 116, rewardY: rt.refuge.y + 18 };
  const canvas = document.getElementById('minimap-corner');
  const width = canvas instanceof HTMLCanvasElement ? canvas.width : 200;
  rt.explored[(rt.spellLab.x >> 3) + (rt.spellLab.y >> 3) * width] = 0;
  return { x: rt.spellLab.x, y: rt.spellLab.y, offsetX: 0.5, offsetY: 0.5 };
});
await hoverMarker('#minimap-corner', undiscoveredSpellLab);
const hiddenLabPop = await popoverState();
check(
  'Undiscovered Spell Lab marker has no popover yet',
  !hiddenLabPop.visible || !hiddenLabPop.text.includes('Spell Lab'),
  JSON.stringify(hiddenLabPop),
);

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const canvas = document.getElementById('minimap-corner');
  if (!rt?.spellLab || !(canvas instanceof HTMLCanvasElement)) return;
  rt.explored[(rt.spellLab.x >> 3) + (rt.spellLab.y >> 3) * canvas.width] = 1;
});
await page.waitForTimeout(120);
await hoverMarker('#minimap-corner', undiscoveredSpellLab);
const labPop = await popoverState();
check(
  'Newly discovered Spell Lab marker gets the same popover effect',
  labPop.visible && labPop.text.includes('Spell Lab') && labPop.text.includes('reward') && labPop.hasThumb,
  JSON.stringify(labPop),
);

const heartMarker = await livePickupMarker('heart', { near: markers.heart });
await hoverMarker('#minimap-corner', heartMarker ?? markers.heart);
const heartPop = await popoverState();
check(
  'New pickup markers expose useful POI details',
  heartPop.visible && heartPop.text.includes('Heart Vessel') && heartPop.text.includes('pickup') && heartPop.hasThumb,
  JSON.stringify(heartPop),
);

const chestMarker = await livePickupMarker('chest', { amount: 42, near: markers.chest });
await hoverMarker('#minimap-corner', chestMarker ?? markers.chest);
const chestPop = await popoverState();
check(
  'Discovered optional pickup markers get POI details',
  chestPop.visible && chestPop.text.includes('Treasure Chest') && chestPop.text.includes('42 gold') && chestPop.hasThumb,
  JSON.stringify(chestPop),
);

await hoverMarker('#minimap-corner', markers.lever);
const leverPop = await popoverState();
check(
  'Small mechanism trigger markers get POI details',
  leverPop.visible && leverPop.text.includes('Lever #') && leverPop.text.includes('target') && leverPop.hasThumb,
  JSON.stringify(leverPop),
);

await page.evaluate((gold) => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  if (!rt) return;
  const gx = gold.x >> 3;
  const gy = gold.y >> 3;
  const goldIndex = rt.world.idx(gold.x, gold.y);
  rt.world.types[goldIndex] = 17; // Cell.Gold
  rt.world.colors[goldIndex] = 0xffd23c;
  for (let dx = -1; dx <= 1; dx++) {
    const supportX = gold.x + dx;
    const supportY = gold.y + 1;
    if (!rt.world.inBounds(supportX, supportY)) continue;
    const supportIndex = rt.world.idx(supportX, supportY);
    rt.world.types[supportIndex] = 13; // Cell.Metal
    rt.world.colors[supportIndex] = 0x8f9ba8;
  }
  const canvas = document.getElementById('minimap-corner');
  const width = canvas instanceof HTMLCanvasElement ? canvas.width : 200;
  rt.explored[gx + gy * width] = 1;
  for (let i = rt.mechanisms.length - 1; i >= 0; i--) {
    const mechanism = rt.mechanisms[i];
    const dx = (mechanism.x >> 3) - gx;
    const dy = (mechanism.y >> 3) - gy;
    if (dx * dx + dy * dy <= 100) rt.mechanisms.splice(i, 1);
  }
}, markers.gold);
await page.mouse.move(1, 1);
await page.waitForTimeout(40);
await hoverMarker('#minimap-corner', markers.gold);
const goldPop = await popoverState();
check(
  'Tiny terrain-material map pixels get Palette-style details',
  goldPop.visible && goldPop.text.includes('Gold Powder') && goldPop.text.includes('powder') && goldPop.hasThumb,
  JSON.stringify(goldPop),
);

check('No page errors', pageErrors.length === 0, pageErrors.join('\n'));

await browser.close();

console.log(`\nverify-minimap-popovers: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
