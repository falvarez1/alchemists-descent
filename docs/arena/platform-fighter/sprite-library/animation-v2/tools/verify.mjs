import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { frameAtTick, frameForAttack } from '../playback.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const evidence = path.join(root, 'evidence');
await fs.mkdir(evidence, { recursive: true });
let frameCount = 0;
const bounds = [];
for (const clip of lib.clips) {
  const size = clip.frameSize;
  const meta = await sharp(path.join(root, clip.image)).metadata();
  assert.equal(meta.width, clip.grid.columns * size);
  assert.equal(meta.height, clip.grid.rows * size);
  assert(meta.hasAlpha);
  const atlasMap=JSON.parse(await fs.readFile(path.join(root,clip.atlasMap),'utf8'));
  assert.equal(Object.keys(atlasMap.frames).length,clip.frames.length);
  assert.equal(clip.frames.reduce((n,f)=>n+f.durationTicks,0), clip.totalTicks);
  let age = 0;
  for (const f of clip.frames) {
    assert.equal(frameAtTick(clip, age), f.index);
    assert.equal(frameAtTick(clip, age + f.durationTicks - .001), f.index);
    age += f.durationTicks;
    assert.deepEqual(f.pivot, clip.pivot);
    assert.deepEqual(atlasMap.frames[f.image].frame,f.rect);
    assert.deepEqual(atlasMap.frames[f.image].pivot,{x:f.pivot.x/size,y:f.pivot.y/size});
    const png = await sharp(path.join(root, path.dirname(clip.data), f.image)).ensureAlpha().raw().toBuffer();
    assert.equal(png.length, size * size * 4);
    let opaque = 0, transparent = 0, edge = 0;
    for (let p = 0; p < size * size; p++) {
      const a = png[p * 4 + 3];
      if (a >= 48) opaque++;
      if (a === 0) transparent++;
      if ((p % size === 0 || p % size === size - 1 || p < size || p >= (size - 1) * size) && a > 0) edge++;
    }
    assert((clip.kind!=='fighter'||opaque>1000) && transparent > 10000);
    assert.equal(edge, 0, 'Export must have a transparent gutter: '+clip.id+'/'+f.index);
    if (f.sourceBoundaryPixels) bounds.push({ clip: clip.id, frame: f.index, pixels: f.sourceBoundaryPixels });
    frameCount++;
  }
  assert.equal(frameAtTick(clip, -1), 0);
  const endFrame=clip.loop?0:clip.endBehavior==='hide'?-1:clip.frames.length-1;
  assert.equal(frameAtTick(clip, clip.totalTicks),endFrame);
  assert.equal(frameAtTick(clip, clip.totalTicks * 10),endFrame);
  if (clip.attackPhaseTicks) {
    const fighter=clip.id.split('/')[0];
    const timings=fighter==='brann-rook'
      ? {opener:[6,4,14],launcher:[10,5,18],aerial:[8,7,19],finisher:[23,5,33]}
      : {opener:[4,3,10],launcher:[7,5,14],aerial:[5,5,15],finisher:[18,4,28]};
    const expected=timings[clip.id.split('/').at(-1)];
    if (expected) assert.deepEqual(Object.values(clip.attackPhaseTicks), expected);
    else assert(Object.values(clip.attackPhaseTicks).every(n=>n>0), 'Every added attack needs all three authored phases');
    for (const factor of [0.5,1,2]) {
      const spec = Object.fromEntries(Object.entries(clip.attackPhaseTicks).map(([k,v])=>[k,v*factor]));
      let start = 0;
      for (const phase of ['startup','active','recovery']) {
        const frames = clip.frames.filter(f=>f.phase===phase);
        const attack = {spec,phase,age:start};
        assert.equal(frameForAttack(clip,attack),frames[0].index);
        attack.age = start + spec[phase] - .0001;
        const held = frameForAttack(clip,attack);
        assert.equal(held,frames.at(-1).index);
        assert.equal(frameForAttack(clip,attack),held,'Hitstop holds the selected frame');
        start += spec[phase];
      }
    }
  }
}
assert.throws(()=>frameAtTick(lib.clips[0], NaN));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', e=>errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  for(const clip of lib.clips) {
    await page.selectOption('#clip',clip.id);
    await page.waitForFunction(id=>document.body.dataset.readyClip===id,clip.id);
    assert((await page.locator('#status').textContent()).includes('Frame 1 / '+clip.frames.length));
    await page.click('#next');
    assert((await page.locator('#status').textContent()).includes('Frame '+Math.min(2,clip.frames.length)+' / '+clip.frames.length));
  }
  await page.selectOption('#clip','ilyra-voss/unarmed/idle');
  await page.waitForFunction(()=>document.body.dataset.readyClip==='ilyra-voss/unarmed/idle');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Frame 1 / 12'));
  assert.equal(await page.locator('#play').textContent(), 'Play');
  await page.click('#next');
  assert((await page.locator('#status').textContent()).includes('Frame 2 / 12'));
  await page.selectOption('#clip', 'ilyra-voss/unarmed/duck');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('One-shot'));
  await page.click('#play');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Frame 12 / 12'));
  await page.waitForTimeout(400);
  assert((await page.locator('#status').textContent()).includes('Frame 12 / 12'));
  await page.click('#play'); await page.click('#restart');
  assert((await page.locator('#status').textContent()).includes('Frame 1 / 12'));
  await page.check('#mirror'); await page.click('#next');
  await page.screenshot({ path: path.join(evidence, 'duck-preview.png'), fullPage: true });
  await page.selectOption('#clip', 'ilyra-voss/unarmed/run');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Frame 1 / 12'));
  await page.click('#play');
  await page.waitForFunction(()=>!document.getElementById('status').textContent.includes('Frame 1 / 12'));
  await page.click('#play');
  await page.selectOption('#clip', 'ilyra-voss/unarmed/idle');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Frame 1 / 12'));
  await page.screenshot({ path: path.join(evidence, 'idle-preview.png'), fullPage: true });
  const effect=lib.clips.find(c=>c.kind==='effect'&&c.endBehavior==='hide');
  if(effect) {
    await page.selectOption('#clip',effect.id);
    await page.waitForFunction(id=>document.body.dataset.readyClip===id,effect.id);
    await page.click('#play');
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Complete (hidden)'));
    await page.click('#play');
    await page.click('#restart');
    assert((await page.locator('#status').textContent()).includes('Frame 1 /'));
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally { await browser.close(); }
const result = { format: 'pass', timing: 'pass', browser: 'pass', clips: lib.clips.length, frames: frameCount,
  sourceBoundaryFlags: bounds,
  extractionReviewFlags:lib.clips.filter(c=>c.extractionReview).map(c=>({id:c.id,reason:c.extractionReview})),
  detachedComponentFlags:lib.clips.filter(c=>c.detachedComponents?.length).map(c=>({id:c.id,components:c.detachedComponents})),
  productionReady: false,
  animationReview: 'Generated animation clips require motion and cross-state continuity review. The full roster replacement is in progress.',
  checks: ['Transparent nonempty PNGs and atlas bounds', 'Fixed root and export gutters', 'Tick boundaries and held one-shot end', 'Attack phase boundaries, retiming and held hitstop age', 'Every clip loads and steps in the offline browser', 'Playback, restart and facing control'] };
await fs.writeFile(path.join(evidence, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
