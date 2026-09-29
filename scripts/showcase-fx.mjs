// FX showcase: opens a VISIBLE Edge window on the physics test arena and runs
// the boss-fight FX storm around the player (spell projectiles, lightning,
// GPU spark/ember/smoke bursts, explosions that throw GPU sparks). You play in
// the window as normal.
//
//   K   toggle the storm (you are invulnerable while it runs)
//   F3  the in-game FPS / frame-time overlay
//
// Closing the window ends the script.
// Usage: node scripts/showcase-fx.mjs [url]   (dev server running)
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5190/';
const browser = await launchBrowser({ headless: false, args: ['--start-maximized'] });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
browser.on('disconnected', () => process.exit(0));
page.on('close', () => browser.close().catch(() => {}));

await page.goto(url, { waitUntil: 'networkidle' });
await startConsoleTestRun(page, { seed: 777, level: 'physics-test', loadout: 'advanced', settleMs: 1500 });

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const timers = [];
  let on = false;
  const kinds = ['bolt', 'fireball', 'wisp', 'frostbolt', 'scatter', 'acidglob', 'pellet', 'meteor'];
  const embers = [0xffb040, 0xff6020, 0xffe070, 0x80d0ff, 0xc070ff];
  let k = 0;
  const around = () => ({ x: ctx.player.x, y: ctx.player.y - 40 });
  const start = () => {
    ctx.player.invuln = 1e9;
    timers.push(setInterval(() => {
      const c = around();
      while (ctx.projectiles.length < 50) {
        const a = Math.random() * Math.PI * 2, s = 2.5 + Math.random() * 2.5;
        ctx.projectiles.push({
          x: c.x - 220 + Math.random() * 440, y: c.y - 110 + Math.random() * 90,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          type: kinds[k++ % kinds.length], life: 110, age: 0, charging: false, hostile: false,
        });
      }
    }, 60));
    timers.push(setInterval(() => {
      const c = around();
      ctx.lightning.cast(c.x - 220 + Math.random() * 440, c.y - 150, Math.PI / 2 + (Math.random() - 0.5) * 0.8);
    }, 220));
    timers.push(setInterval(() => {
      const c = around();
      const col = embers[(Math.random() * embers.length) | 0];
      const x = c.x - 200 + Math.random() * 400, y = c.y - 100 + Math.random() * 80;
      ctx.sparks?.burst(x, y, { count: 260, speed: 3.2, kind: Math.random() < 0.5 ? 'spark' : 'magic', glow: 1.4, colors: [col, 0xfff0c0] });
      ctx.sparks?.burst(x, y, { count: 40, speed: 1, kind: 'ember', colors: [0xff6a10, 0xffae40] });
      ctx.particles.burst(x, y, 60, null, () => col, 3, { glow: 1.4, grav: 0.05 });
    }, 140));
    timers.push(setInterval(() => {
      const c = around();
      ctx.explosions.trigger(c.x - 180 + Math.random() * 360, c.y - 80 + Math.random() * 60, 12);
    }, 1100));
  };
  const stop = () => {
    for (const t of timers.splice(0)) clearInterval(t);
    ctx.player.invuln = 60;
  };
  window.__fxStorm = (want) => {
    const next = typeof want === 'boolean' ? want : !on;
    if (next === on) return on;
    on = next;
    if (on) start(); else stop();
    ctx.events.emit('toast', { text: on ? 'FX STORM ON (K to stop)' : 'FX STORM OFF (K to start)' });
    return on;
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyK' && !e.repeat) window.__fxStorm();
  }, true);
  window.__fxStorm(true);
});

console.log('Edge is open on the physics test arena with the FX storm running.');
console.log('  K = toggle the storm    F3 = FPS overlay    close the window to quit');
await new Promise(() => {}); // keep running until the window closes
