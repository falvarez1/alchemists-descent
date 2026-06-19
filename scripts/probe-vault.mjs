// Runtime probe for the Gilded Vault branch (task #28):
//   - the hidden arch generates ONLY in the expedition's host level
//   - stepping between the pillars crosses to the vault; the vault's own
//     arch returns to the host AT the host arch (not the level spawn)
//   - the vault is gilded: gold veins, catalyst seams, elite golem guards,
//     the unique 'vitrify' tome, no portal/key (the arch is the way home)
//   - chemistry: acid + stone + touching catalyst transmutes to gold FAST
//     and consumes the catalyst; without catalyst (and without water) it
//     only corrodes
//   - the Vitric Seal card turns a lava pool into solid glass
// Usage: node scripts/probe-vault.mjs [url]
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const SEED = 1; // host = 'd' + (2 + SEED % 3) = d3
const HOST = 'd' + (2 + (SEED % 3));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));

let pass = 0,
  fail = 0;
const check = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (ok) pass++;
  else fail++;
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { seed: SEED, settleMs: 600 });

// ---------------- host arch placement + crossing over ----------------
const r1 = await page.evaluate(
  async ({ HOST }) => {
    const ctx = window.__game.ctx;
    // d1 must NOT carry the arch (host is d2..d4)
    const d1Arch = ctx.levels.current.vaultArch ?? null;
    ctx.levels.leaveLevel();
    ctx.levels.enterLevel(ctx, HOST);
    await new Promise((r) => setTimeout(r, 600));
    const rt = ctx.levels.current;
    const arch = rt?.vaultArch ?? null;
    if (!arch) return { d1Arch, arch: null };
    // the secret must be sealed: the arch alcove is not in the spawn-reachable
    // component until dug (validator covers this as info — here we just cross)
    ctx.enemies.length = 0; // mobs maul parked probes
    const p = ctx.player;
    p.x = arch.x;
    p.y = arch.y;
    p.vx = 0;
    p.vy = 0;
    await new Promise((r) => setTimeout(r, 1400));
    const after = ctx.levels.current;
    const backOk =
      after.vaultArch &&
      Math.abs(p.x - after.vaultArch.backX) < 4 &&
      Math.abs(p.y - after.vaultArch.backY) < 4;
    return {
      d1Arch,
      arch,
      crossedTo: after.def.id,
      biome: after.def.biome,
      backOk,
      portal: after.portal,
      name: after.def.name,
    };
  },
  { HOST },
);
check(r1.d1Arch === null, 'd1 carries no arch (host is mid-descent)');
check(!!r1.arch, `hidden arch generates in host ${HOST}`, r1.arch ? `@${r1.arch.x},${r1.arch.y}` : '');
check(r1.crossedTo === 'vault', 'stepping into the arch crosses to the vault', `now=${r1.crossedTo}`);
check(r1.biome === 'gilded', 'vault biome is gilded');
check(r1.backOk === true, 'arrival lands at the vault arch back-spot (not level spawn)');
check(r1.portal === null, 'the vault has no exit portal (the arch is the way home)');

// ---------------- vault contents ----------------
const r2 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const [goldCount, catalystCount] = await Promise.all([
    ctx.console.exec('count 17'),
    ctx.console.exec('count 35'),
  ]);
  const golems = ctx.enemies.filter((e) => e.kind === 'golem');
  const minHp = Math.min(...golems.map((g) => g.maxHp));
  const maxHp = Math.max(...golems.map((g) => g.maxHp));
  const tome = rt.pickups.find((p) => p.kind === 'tome' && p.data.card === 'vitrify');
  const key = rt.pickups.find((p) => p.kind === 'key');
  const locks = rt.mechanisms.filter((m) =>
    ['scale', 'buoy', 'chargelatch', 'sensor', 'brazier'].includes(m.kind),
  ).length;
  return {
    gold: goldCount.data?.count ?? 0,
    catalyst: catalystCount.data?.count ?? 0,
    goldCount,
    catalystCount,
    golems: golems.length,
    minHp,
    maxHp,
    hasTome: !!tome,
    hasKey: !!key,
    locks,
    waystones: rt.waystones.length,
    refuge: !!rt.refuge,
  };
});
check(r2.goldCount?.ok && r2.gold >= 800, 'the vault is gilded (gold veins + pockets)', `gold=${r2.gold}`);
check(r2.catalystCount?.ok && r2.catalyst >= 50, 'catalyst seams + hoard piles present', `catalyst=${r2.catalyst}`);
check(
  r2.golems >= 2 && r2.maxHp >= r2.minHp * 2.2,
  'elite golem guards posted at the hoard',
  `golems=${r2.golems} hp ${r2.minHp}..${r2.maxHp}`,
);
check(r2.hasTome, "the hoard carries the unique 'vitrify' tome");
check(!r2.hasKey, 'no golden key in the vault (no portal to open)');
check(r2.locks > 0, 'the vault has its Wave E physics lock', `locks=${r2.locks}`);
check(r2.waystones >= 1 && r2.refuge, 'waystones + refuge in the vault', `ws=${r2.waystones}`);

// ---------------- catalyst chemistry ----------------
const r3 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const p = ctx.player;
  ctx.enemies.length = 0;
  // park the wizard on a built metal perch first — the cups must stay inside
  // the sim window for the whole poll, so the player may not fall anywhere
  const put0 = (X, Y, t) => {
    const i = w.idx(X, Y);
    w.types[i] = t;
    w.life[i] = 0;
    w.charge[i] = 0;
  };
  const px = Math.floor(p.x),
    py = Math.floor(p.y);
  for (let X = px - 8; X <= px + 8; X++) put0(X, py + 1, 13);
  for (let X = px - 8; X <= px + 8; X++) for (let Y = py - 22; Y <= py; Y++) put0(X, Y, 0);
  p.x = px;
  p.y = py;
  p.vx = 0;
  p.vy = 0;
  const by = py - 6;
  const put = (X, Y, t) => {
    const i = w.idx(X, Y);
    w.types[i] = t;
    w.life[i] = 0;
    w.charge[i] = 0;
  };
  // MICRO-REACTORS: each acid cell is single-use (it empties on its one
  // corrode event), so an isolated 1-wide stack of acid-over-stone-over-
  // catalyst runs EXACTLY one reaction — gold, once made, is permanent.
  // A shared acid bath re-eats its own product (observed; sim-honest).
  const reactor = (rx, withCatalyst) => {
    for (let Y = by - 6; Y <= by + 2; Y++) {
      put(rx - 1, Y, 13);
      put(rx + 1, Y, 13);
      put(rx, Y, 0);
    }
    put(rx - 1, by + 2, 13);
    put(rx, by + 2, 13);
    put(rx + 1, by + 2, 13); // metal floor
    if (withCatalyst) put(rx, by + 1, 35); // catalyst under...
    put(rx, by, 12); // ...the stone target
    put(rx, by - 3, 7); // one acid drop above
  };
  const N = 10;
  const armX = px + 20; // amplified bank
  const dryX = px - 34; // negative control: no catalyst, no water
  for (let k = 0; k < N; k++) reactor(armX + k * 3, true);
  for (let k = 0; k < 6; k++) reactor(dryX + k * 3, false);
  const countBank = (t, x0, n) => {
    let c = 0;
    for (let k = 0; k < n; k++)
      for (let Y = by - 6; Y <= by + 2; Y++) if (w.types[w.idx(x0 + k * 3, Y)] === t) c++;
    return c;
  };
  const cat0 = countBank(35, armX, N);
  let goldWith = 0;
  for (let t = 0; t < 30; t++) {
    await new Promise((r) => setTimeout(r, 150));
    goldWith = countBank(17, armX, N);
    if (goldWith >= 2 && countBank(7, armX, N) === 0) break;
  }
  const goldWithout = countBank(17, dryX, 6);
  const cat1 = countBank(35, armX, N);
  return { cat0, cat1, goldWith, goldWithout };
});
// 10 independent 45% reactions: P(zero gold) ~ 0.25% — >=1 is flake-safe
check(r3.goldWith >= 1, 'acid + catalyst + stone transmutes to gold', `gold=${r3.goldWith}`);
check(r3.cat1 < r3.cat0, 'transmutation CONSUMES the catalyst', `${r3.cat0} -> ${r3.cat1}`);
check(r3.goldWithout === 0, 'no catalyst, no water: acid only corrodes (negative)', `gold=${r3.goldWithout}`);

// ---------------- the Vitric Seal card ----------------
const r4 = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const p = ctx.player;
  const bx = Math.floor(p.x) - 30;
  const by = Math.floor(p.y) - 4;
  const put = (X, Y, t) => {
    const i = w.idx(X, Y);
    w.types[i] = t;
    w.life[i] = 0;
    w.charge[i] = 0;
  };
  // metal basin of lava
  for (let X = bx - 7; X <= bx + 7; X++) for (let Y = by - 6; Y <= by + 3; Y++) put(X, Y, 0);
  for (let Y = by - 6; Y <= by + 3; Y++) {
    put(bx - 6, Y, 13);
    put(bx + 6, Y, 13);
  }
  for (let X = bx - 6; X <= bx + 6; X++) put(X, by + 3, 13);
  for (let X = bx - 5; X <= bx + 5; X++) for (let Y = by; Y <= by + 2; Y++) put(X, Y, 11);
  await new Promise((r) => setTimeout(r, 300));
  ctx.input.mouse.x = bx;
  ctx.input.mouse.y = by + 1;
  ctx.wands.castActionAt(
    ctx,
    {
      card: 'vitrify',
      speedMul: 1,
      dmgMul: 1,
      spreadAdd: 0,
      infused: false,
      waterTrail: 0,
      oilTrail: 0,
      electricCharge: false,
      critWet: false,
      shortHoming: false,
      frostCharge: false,
      shatterCrit: false,
      bounces: 0,
      triggered: null,
    },
    p.x,
    p.y - 8,
    0,
  );
  await new Promise((r) => setTimeout(r, 400));
  let glass = 0;
  for (let X = bx - 5; X <= bx + 5; X++)
    for (let Y = by - 2; Y <= by + 2; Y++) if (w.types[w.idx(X, Y)] === 31) glass++;
  return { glass };
});
check(r4.glass >= 10, 'Vitric Seal turns the lava pool to solid glass', `glass=${r4.glass}`);

// ---------------- the way home ----------------
const r5 = await page.evaluate(
  async ({ HOST }) => {
    const ctx = window.__game.ctx;
    const rt = ctx.levels.current;
    const arch = rt.vaultArch;
    const p = ctx.player;
    ctx.enemies.length = 0;
    p.x = arch.x;
    p.y = arch.y;
    p.vx = 0;
    p.vy = 0;
    await new Promise((r) => setTimeout(r, 1400));
    const after = ctx.levels.current;
    const hostArch = after.vaultArch ?? null;
    return {
      backAt: after.def.id,
      expected: HOST,
      nearArch: hostArch ? Math.abs(p.x - hostArch.backX) < 4 : false,
    };
  },
  { HOST },
);
check(r5.backAt === r5.expected, 'the vault arch returns to the SAME host depth', `now=${r5.backAt}`);
check(r5.nearArch, 'return arrival lands beside the host arch (not level spawn)');

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
