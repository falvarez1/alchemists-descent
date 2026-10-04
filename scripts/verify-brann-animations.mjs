import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5267/';
const fighter = process.argv[3] ?? 'brann-rook';
const out = 'output/playwright/' + (fighter === 'brann-rook' ? 'brann' : 'ilyra');
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await page.locator('[data-entry="duel"]').click();
  await page.locator('#versus-lobby').waitFor({ state: 'visible' });
  await page.evaluate(fighter => {
    const v = window.__game.ctx.versus;
    for (const slot of [0, 1]) { v.chooseDevice(slot, 'cpu'); v.chooseFighter(slot, fighter); }
    v.chooseStage('foundry'); v.start();
  }, fighter);
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.waitForFunction(fighter => window.__duelSprites?.atlases.get(fighter)?.animations?.tumble, fighter);
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    c.state.paused = true;
  });
  const result = await page.evaluate(() => {
    const g = window.__game, c = g.ctx, a = c.arena, p = c.player;
    const api = window.__duelSprites, atlas = api.atlases.get(c.fighters.id);
    const sample = () => {
      const pose = api.duelPose(c, p), selected = api.animatedFrame(atlas, pose.name, c);
      const name = [...atlas.frames].find(([, f]) => f === selected.frame)?.[0];
      return { pose: pose.name, name, anchor: selected.anchor };
    };
    const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    const fresh = () => {
      a.reset(); step(125); c.fx.hitstop = 0;
      for (const key of Object.keys(c.input.keys)) c.input.keys[key] = false;
      Object.assign(p, { x: a.stockStage.center.x - 50, y: a.stockStage.main.y - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, facing: 1, invuln: 0, staggerT: 0, firing: false });
      Object.assign(a.bundle(1).player, { x: a.stockStage.center.x + 100, y: a.stockStage.main.y - 1, vx: 0, vy: 0, grounded: true, invuln: 0 });
    };
    const attacks = [];
    for (const action of ['opener', 'launcher', 'aerial', 'finisher', 'neutral_air', 'back_air', 'up_air', 'down_air', 'up_smash', 'down_smash']) {
      fresh();
      if (action === 'aerial' || action.endsWith('_air')) { p.y -= 160; p.grounded = false; }
      a.requestStockAttack(action, 1);
      const spec = a.stockAttack(0).spec, samples = [];
      for (let i = 0; i < spec.startup + spec.active + spec.recovery; i++) {
        const attack = a.stockAttack(0);
        if (attack.busy) samples.push({ phase: attack.phase, ...sample() });
        step(1);
      }
      attacks.push({ action, samples });
    }
    fresh();
    c.state.paused = false;
    const idle0 = sample(); c.state.frameCount += atlas.animations.idle.frames[0].ticks + 1; const idle1 = sample();
    c.fx.hitstop = 3; c.state.frameCount += 7; const held = sample();
    c.fx.hitstop = 0; c.state.paused = true;
    const animations = Object.keys(atlas.animations).filter(name => !name.startsWith('fx/'));
    return { animations, attacks, idle0, idle1, held, frames: atlas.frames.size };
  });
  assert.equal(result.animations.length, 63);
  for (const attack of result.attacks) {
    for (const phase of ['startup', 'active', 'recovery']) {
      const samples = attack.samples.filter(s => s.phase === phase);
      assert(samples.length, attack.action + ' missing ' + phase);
      assert(samples.every(s => s.name.startsWith('clip:' + attack.action + ':')), JSON.stringify(samples));
      assert(new Set(samples.map(s => s.name)).size > 1, attack.action + ' phase remained static');
    }
  }
  assert.notEqual(result.idle0.name, result.idle1.name);
  assert.equal(result.idle1.name, result.held.name);
  const ledges = await page.evaluate(async () => {
    const { PLAYER_H, PLAYER_HALF_W } = await import('/src/core/types.ts');
    const g = window.__game, c = g.ctx, a = c.arena, p = c.player;
    const api = window.__duelSprites, atlas = api.atlases.get(c.fighters.id), results = [];
    const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    for (const side of [1, -1]) {
      a.reset(); step(125); const s = a.stockStage;
      for (const key of Object.keys(c.input.keys)) c.input.keys[key] = false;
      Object.assign(p, { x: side > 0 ? s.main.x0 - PLAYER_HALF_W - 2 : s.main.x1 + PLAYER_HALF_W + 2, y: s.main.y + PLAYER_H - 2, vx: side, vy: 1, fx: 0, fy: 0, grounded: false, invuln: 0 });
      c.input.keys.right = side > 0; c.input.keys.left = side < 0; step(1);
      const ledge = a.stockLedge(0), pose = api.duelPose(c, p), chosen = api.animatedFrame(atlas, pose.name, c);
      let body = null;
      const surface = { pixelStep: .5, setPx() {}, addPx() {}, blitFine(x, y, w, h) { body = { x, y, w, h }; } };
      api.drawDuelFighter(surface, { sample: () => ({ r: 1, g: 1, b: 1 }) }, c);
      const fr = chosen.frame, mirror = pose.facing < 0;
      const ax = mirror ? fr.w - 1 - fr.ax : fr.ax;
      results.push({ side, phase: ledge.phase, anchor: chosen.anchor,
        errorX: body.x + (ax + .5) * atlas.step - .5 - ledge.x,
        errorY: body.y + (fr.ay + 1) * atlas.step - 1 - ledge.y });
    }
    return results;
  });
  for (const ledge of ledges) {
    assert.equal(ledge.phase, 'hang'); assert.equal(ledge.anchor, 'grip');
    assert(Math.abs(ledge.errorX) < .001 && Math.abs(ledge.errorY) < .001, JSON.stringify(ledge));
  }
  await page.evaluate(() => {
    const g = window.__game, c = g.ctx, a = c.arena, s = a.stockStage;
    a.reset();
    for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
    for (const key of Object.keys(c.input.keys)) c.input.keys[key] = false;
    [0, 1].forEach(slot => Object.assign(a.bundle(slot).player, { x: s.center.x + (slot ? 16 : -16), y: s.main.y - 1, vx: 0, vy: 0, grounded: true, facing: slot ? -1 : 1, invuln: 0 }));
    for (let i = 0; i < 600; i++) c.camera.update(c);
    g.composer.capturePoses(c); g.composeDirty = true;
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: out + '/verified-mirror.png' });
  // A render-scale contact sheet for visual inspection of every runtime action.
  await page.evaluate(() => {
    const c=window.__game.ctx,atlas=window.__duelSprites.atlases.get(c.fighters.id);
    const clips=Object.entries(atlas.animations).filter(([name])=>!name.startsWith('fx/'));
    const canvas=document.createElement('canvas');canvas.id='duo-review';canvas.width=1008;canvas.height=792;
    const out=canvas.getContext('2d');out.fillStyle='#162126';out.fillRect(0,0,canvas.width,canvas.height);out.imageSmoothingEnabled=false;
    clips.forEach(([name,clip],i)=>{
      const f=atlas.frames.get(clip.frames[Math.floor(clip.frames.length/2)].name),tile=document.createElement('canvas');
      tile.width=f.w;tile.height=f.h;const tc=tile.getContext('2d'),data=tc.createImageData(f.w,f.h);
      for(let k=0;k<f.a.length;k++){for(let channel=0;channel<3;channel++)data.data[k*4+channel]=Math.min(255,f.rgb[k*3+channel]*255);data.data[k*4+3]=f.a[k]*255;}
      tc.putImageData(data,0,0);const x=(i%9)*112,y=Math.floor(i/9)*112;
      out.drawImage(tile,x+(112-f.w*1.6)/2,y+86-f.h*1.6,f.w*1.6,f.h*1.6);out.fillStyle='#ffffff';out.font='11px sans-serif';out.fillText(name,x+3,y+104);
    });
    canvas.style.cssText='position:absolute;left:0;top:0;z-index:999999';document.body.append(canvas);
  });
  await page.locator('#duo-review').screenshot({path:out+'/actions.png'});
  assert.deepEqual(errors, []);
  writeFileSync(out + '/checks.json', JSON.stringify({ ...result, ledges, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ animations: result.animations.length, frames: result.frames, attackPhases: result.attacks.length * 3, ledges, errors }));
} finally { await browser.close(); }
