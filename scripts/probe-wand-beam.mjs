// Wand directional-beam probe + screenshots.
// Verifies the new aim-direction beam (src/render/Lighting.ts raycastWandBeam)
// at the REAL wand intensity, in an open scene, isolating the beam from the
// omni wand light by sampling ON-AXIS (along the aim) vs PERPENDICULAR (90° off
// the aim — a clean omni-only baseline, since the omni light is radial).
//
// Design claims under test:
//   1. NO HIGHER EXPOSURE NEAR THE PLAYER — the omni light already saturates
//      the tonemap in the near radius, and the field combines by max + clamp,
//      so the PEAK brightness on-axis equals the peak perpendicular (both hit
//      the clamp). The beam extends the lit AREA, never the peak VALUE.
//   2. REACHES FURTHER DOWN A CORRIDOR — far down the aim is clearly lit while
//      the same distance off-axis (and the omni light) has fallen to ambient.
//   3. DIRECTIONAL — flipping the aim flips which side reaches far.
//   4. NEVER DIMS — on-axis >= perpendicular at every distance (beam only adds).
import { chromium } from 'playwright-core';
import { getGameViewSize } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0,
  fail = 0;
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
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1000);
const viewSize = await getGameViewSize(page);

const OFFSETS = [20, 60, 100, 140, 180]; // world cells from the wand tip

const data = await page.evaluate(({ OFFSETS, view }) => {
  const game = window.__game;
  const ctx = game.ctx;
  const light = game.composer.light; // Lighting instance (private at TS level)
  const w = ctx.world;
  const AMBIENT = ctx.params.global.ambient;

  const PX = 600,
    PY = 500;
  w.clear(); // open scene — omni wand light radiates as a clean disk

  ctx.state.mode = 'play';
  ctx.state.paused = true;
  const p = ctx.player;
  p.x = PX;
  p.y = PY;
  p.dead = false;
  if (p.status) p.status.torch = 0;
  if (p.perks) p.perks.torchbearer = false;

  ctx.projectiles.length = 0;
  ctx.enemies.length = 0;
  ctx.shockwaves.length = 0;
  if (ctx.lightning?.arcs) ctx.lightning.arcs.length = 0;
  if (ctx.critters?.list) ctx.critters.list.length = 0;
  ctx.state.runtimeInspectionLight = null;

  // keep REAL intensity; just make it deterministic and remove the player fill
  // so the field is exactly omni + beam.
  const wand = ctx.state.wandLight;
  const saved = { ...wand };
  wand.flicker = 0;
  wand.fillR = 0;
  wand.fillG = 0;
  wand.fillB = 0;

  const sampleSet = (aim) => {
    p.aimAngle = aim;
    const tipX = PX + Math.cos(aim) * 9;
    const tipY = PY - 9 + Math.sin(aim) * 9;
    ctx.camera.renderX = Math.round(tipX - view.w / 2);
    ctx.camera.renderY = Math.round(tipY - view.h / 2);
    light.build(ctx);
    const along = OFFSETS.map((d) => light.sample(tipX + Math.cos(aim) * d, tipY + Math.sin(aim) * d).r);
    // perpendicular: rotate the offset 90°
    const px = Math.cos(aim + Math.PI / 2),
      py = Math.sin(aim + Math.PI / 2);
    const perp = OFFSETS.map((d) => light.sample(tipX + px * d, tipY + py * d).r);
    return { along, perp };
  };

  const right = sampleSet(0); // aim +x
  const left = sampleSet(Math.PI); // aim -x (control: far light should flip)
  const ambientFloor = (AMBIENT * 1) ** 2; // (ambient*vg)^2 at vg≈1 — fully unlit

  Object.assign(wand, saved);
  return { right, left, ambientFloor, offsets: OFFSETS };
}, { OFFSETS, view: viewSize });

console.log('\nLit (R channel), distance from wand tip:');
console.log('  offset      :', data.offsets.map((d) => String(d).padStart(8)).join(''));
const fmt = (arr) => arr.map((v) => v.toFixed(4).padStart(8)).join('');
console.log('  aim→ along  :', fmt(data.right.along), '  (down the aim = omni + beam)');
console.log('  aim→ perp   :', fmt(data.right.perp), '  (90° off aim = omni only)');
console.log('  aim← along  :', fmt(data.left.along), '  (control: aim flipped)');
console.log(`  ambient floor (fully unlit) ≈ ${data.ambientFloor.toFixed(4)}`);

const i = (d) => data.offsets.indexOf(d);
const along = data.right.along,
  perp = data.right.perp;

// 1) NO HIGHER EXPOSURE NEAR THE PLAYER — peak brightness identical (both clamp).
const peakAlong = Math.max(...along);
const peakPerp = Math.max(...perp);
check(
  'peak brightness on-axis == peak perpendicular (no higher exposure)',
  Math.abs(peakAlong - peakPerp) < 1e-3,
  `peakAlong=${peakAlong.toFixed(4)} peakPerp=${peakPerp.toFixed(4)}`,
);
check(
  'immediate near (20 cells) on-axis == perpendicular (wizard area unchanged)',
  Math.abs(along[i(20)] - perp[i(20)]) < 1e-3,
  `along=${along[i(20)].toFixed(4)} perp=${perp[i(20)].toFixed(4)}`,
);

// 2) REACHES FURTHER DOWN A CORRIDOR
check(
  'far (140 cells) down the aim is clearly lit above ambient',
  along[i(140)] > data.ambientFloor * 1.5,
  `along140=${along[i(140)].toFixed(4)} floor=${data.ambientFloor.toFixed(4)}`,
);
check(
  'far (140 cells) the omni light alone has died to ~ambient',
  perp[i(140)] < data.ambientFloor * 1.3,
  `perp140=${perp[i(140)].toFixed(4)} floor=${data.ambientFloor.toFixed(4)}`,
);
check(
  'far (140 cells): on-axis >> perpendicular (sees down the corridor)',
  along[i(140)] > perp[i(140)] * 2.0,
  `along=${along[i(140)].toFixed(4)} perp=${perp[i(140)].toFixed(4)}`,
);

// 3) DIRECTIONAL — flipping the aim flips which side reaches far.
check(
  'flipping aim flips the far reach (beam is directional, not scene bias)',
  data.left.along[i(140)] > data.left.perp[i(140)] * 2.0,
  `aim←: along140=${data.left.along[i(140)].toFixed(4)} perp140=${data.left.perp[i(140)].toFixed(4)}`,
);

// 4) NEVER DIMS
check(
  'beam never dims any cell (on-axis >= perpendicular everywhere)',
  along.every((v, k) => v >= perp[k] - 1e-4),
  '',
);

// 5) NON-OCCLUDED AMBIENT GLOW — put a wall across the aim and sample a cell
//    behind it. The occluded omni light + beam are blocked there, so any light
//    that remains is the non-occluded glow painting through terrain. With the
//    wall removed, the same cell is lit by the (much brighter) beam, proving the
//    shadow contrast still reads.
const occ = await page.evaluate((view) => {
  const game = window.__game;
  const ctx = game.ctx;
  const light = game.composer.light;
  const w = ctx.world;
  const Stone = 12,
    Empty = 0;
  const AMBIENT = ctx.params.global.ambient;
  const PX = 600,
    PY = 500;

  const p = ctx.player;
  p.x = PX;
  p.y = PY;
  p.dead = false;
  p.aimAngle = 0; // aim +x
  ctx.state.mode = 'play';
  ctx.state.paused = true;
  const wand = ctx.state.wandLight;
  wand.flicker = 0;
  wand.fillR = wand.fillG = wand.fillB = 0;

  const tipX = PX + 9,
    tipY = PY - 9;
  ctx.camera.renderX = Math.round(tipX - view.w / 2);
  ctx.camera.renderY = Math.round(tipY - view.h / 2);

  const sampleAt = 26; // cells ahead of the tip — inner cone where the glow is brightest
  const wallAt = 16; // wall sits between the tip and the sample point

  const buildAndSample = (withWall) => {
    w.clear();
    if (withWall) {
      for (let x = tipX + wallAt; x <= tipX + wallAt + 3; x++) {
        for (let y = tipY - 20; y <= tipY + 20; y++) {
          const i = w.idx(x, y);
          w.types[i] = Stone;
          w.colors[i] = 0x555048;
        }
      }
    }
    void Empty;
    light.build(ctx);
    return light.sample(tipX + sampleAt, tipY).r;
  };

  const shadow = buildAndSample(true); // behind the wall: glow only
  const open = buildAndSample(false); // no wall: beam + omni + glow
  return { shadow, open, floor: AMBIENT * AMBIENT };
}, viewSize);

console.log(
  `\nNon-occluded glow (inner cone): behind-wall=${occ.shadow.toFixed(4)} open=${occ.open.toFixed(4)} floor=${occ.floor.toFixed(4)}`,
);
check(
  'glow lights a cell BEHIND a wall (non-occluded — paints through terrain)',
  occ.shadow > occ.floor * 1.4,
  `behind-wall=${occ.shadow.toFixed(4)} floor=${occ.floor.toFixed(4)}`,
);
// The bloom pass fires once a lit cell pushes past ~1.06 (terrain × lit > 0.85).
// The glow cap must keep its fill below that so the third light never blooms.
check(
  'glow fill stays below the bloom threshold (capped — no bloom from the glow)',
  occ.shadow < 0.85,
  `behind-wall=${occ.shadow.toFixed(4)} (must be < 0.85)`,
);
check(
  'shadow still reads: directly-lit cell is much brighter than behind the wall',
  occ.open > occ.shadow * 1.8,
  `open=${occ.open.toFixed(4)} behind-wall=${occ.shadow.toFixed(4)}`,
);

console.log(`\nDirectional beam probe: ${pass} ok, ${fail} fail`);
if (pageErrors.length) console.log('PAGE ERRORS:', pageErrors.slice(0, 5));
await browser.close();
process.exit(fail === 0 && pageErrors.length === 0 ? 0 : 1);
