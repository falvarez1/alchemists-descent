// Find the "constant sound" in the PHYSICS TEST playground: wrap every ctx.audio
// method, tick with NO input, and report which fires (near) every frame.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5219/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(400);

const res = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 20; f++) window.__game.tick(); // settle

  const audio = ctx.audio;
  const proto = Object.getPrototypeOf(audio);
  const names = [...new Set([...Object.getOwnPropertyNames(audio), ...Object.getOwnPropertyNames(proto)])]
    .filter((n) => n !== 'constructor' && typeof audio[n] === 'function');
  const counts = {};
  for (const n of names) {
    counts[n] = 0;
    const orig = audio[n].bind(audio);
    audio[n] = (...args) => { counts[n]++; return orig(...args); };
  }

  const FRAMES = 120;
  for (let f = 0; f < FRAMES; f++) window.__game.tick();

  const fired = Object.entries(counts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  // also: how much water/lava/fire is in the world (constant-emitter suspects)?
  const w = ctx.world;
  let water = 0, lava = 0, fire = 0;
  for (let i = 0; i < w.types.length; i++) { const t = w.types[i]; if (t === 2) water++; else if (t === 11) lava++; else if (t === 5) fire++; }
  const emitters = ctx.levels.current.emitters?.length ?? 0;
  return { frames: FRAMES, fired, water, lava, fire, emitters };
});

console.log('audio calls over', res.frames, 'frames (no input):');
for (const [name, c] of res.fired) console.log(`  ${String(c).padStart(4)}  ${name}${c >= res.frames * 0.5 ? '   <-- near every frame' : ''}`);
if (!res.fired.length) console.log('  (none)');
console.log(`world: water=${res.water} lava=${res.lava} fire=${res.fire} emitters=${res.emitters}`);
await browser.close();
process.exit(0);
