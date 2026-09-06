import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

// Inspect the actual encoded-loop source frames at matched scale, including
// the low poses that formerly pulled the hips outside the shell.
const frames = JSON.parse(readFileSync('verify-out/living-descent/gif-frames/weaver.json', 'utf8')).frames;
const poses = JSON.parse(readFileSync('screenshots/living-descent/creatures/manifest.json', 'utf8')).find(c => c.id === 'weaver').poses;
assert.equal(frames.length, poses.length * 30);
const selected = ['At ease', 'Wall crawling', 'Ceiling crawling', 'Rearing', 'Windup', 'Pouncing', 'Sleeping', 'Limping', 'Three legs lost'];
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1150 } });
  await page.setContent('<!doctype html><html lang="en"><title>Weaver anatomy studies</title><style>body{margin:0;background:#101e23;color:#dbe1cd;font:18px system-ui}h1{font-size:22px;margin:20px 24px}p{margin:0 24px 16px;font-size:14px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 8px}img{width:100%;height:auto;image-rendering:pixelated}</style><h1>Weaver · attached anatomy across poses</h1><p>Frames from the native pose loop. Live severing and melee are recorded separately in the gameplay clip.</p><main>' + selected.map(name => {
    const index = poses.indexOf(name); assert.ok(index >= 0);
    return `<img alt="${name}" src="data:image/png;base64,${frames[index * 30 + 15]}">`;
  }).join('') + '</main></html>');
  await page.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  await page.screenshot({ path: 'verify-out/living-descent/weaver-anatomy-studies.png', fullPage: true });
} finally { await browser.close(); }
