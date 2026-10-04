import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
const fighter = process.argv[3] ?? 'brann-rook';
const out = 'output/playwright/' + (fighter === 'brann-rook' ? 'brann' : 'ilyra');
mkdirSync(out, { recursive: true });
const browser = await launchBrowser(), errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.clear();
    window.testPads = [{ index: 0, id: 'Xbox probe', connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) }];
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.testPads });
  });
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5267/') + '?link=off', { waitUntil: 'networkidle' });
  await page.locator('[data-entry="duel"]').click();
  await page.evaluate(fighter => {
    const v = window.__game.ctx.versus;
    v.chooseDevice(0, 'pad:0'); v.chooseDevice(1, 'cpu');
    for (const s of [0,1]) v.chooseFighter(s, fighter);
    v.chooseStage('foundry'); v.ready(0); v.start();
  }, fighter);
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.waitForFunction(fighter => window.__duelSprites?.atlases.get(fighter)?.animations?.tumble, fighter);
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('arena bot 1 off'); c.state.paused = true; document.activeElement?.blur();
  });
  const results = await page.evaluate(async () => {
    const g = window.__game, c = g.ctx, a = c.arena, p = c.player, pad = window.testPads[0];
    const step = n => { for (let i=0;i<n;i++) g.tick(false, { forcePaused: true }); };
    const poll = () => { c.state.paused = false; g.pollInput(); c.state.paused = true; };
    const neutral = () => { pad.axes.fill(0); pad.buttons.forEach(b => b.pressed=false); poll(); };
    const fresh = (air=false) => {
      neutral(); a.reset(); step(125); c.fx.hitstop=0; c.state.arrivalGraceUntil=0;
      for (const key of Object.keys(c.input.keys)) c.input.keys[key]=false;
      for (const slot of [0,1]) Object.assign(a.bundle(slot).player, { x:a.stockStage.center.x+slot*140, y:a.stockStage.main.y-1-(air?160:0), grounded:!air, vx:0, vy:0, fx:0, fy:0, invuln:0, staggerT:0, facing:1 });
    };
    const cases = [
      ['neutral_air',true,[0,0,0,0],0], ['back_air',true,[-1,0,0,0],0],
      ['up_air',true,[0,-1,0,0],0], ['down_air',true,[0,1,0,0],0],
      ['up_smash',false,[0,0,0,-1],null], ['down_smash',false,[0,0,0,1],null],
    ];
    const attacks=[];
    for (const [expected,air,axes,button] of cases) {
      fresh(air); pad.axes.splice(0,4,...axes); if(button!==null) pad.buttons[button].pressed=true; poll();
      const attack=a.stockAttack(0), kind=attack.kind, spec=attack.spec;
      if (!spec) throw new Error('No attack '+expected);
      neutral();
      let damage=0, knock=null;
      for(let tick=0;tick<spec.startup+spec.active+2;tick++) {
        const v=a.bundle(1).player;
        // Track the intended contact point through startup; collision and damage still use the real engine.
        Object.assign(v,{x:p.x+((spec.minReach??1)+spec.reach)/2*attack.facing,y:p.y+(spec.top+spec.bottom)/2+8,vx:0,vy:0,fx:0,fy:0,grounded:false,invuln:0});
        step(1); damage=a.stockMatch.fighters[1].volatility;
        if(damage>0){knock={x:v.vx,y:v.vy};break;}
      }
      attacks.push({expected,kind,damage,knock});
    }
    fresh(); step(2); pad.buttons[2].pressed=true; poll(); step(3); neutral(); step(2);
    const first={y:p.y,vy:p.vy};
    pad.buttons[2].pressed=true;poll();step(1);
    const second={y:p.y,vy:p.vy,pose:window.__duelSprites.duelPose(c,p).name,t:p.stockAirJumpT};
    neutral();step(3);pad.buttons[2].pressed=true;poll();step(1);
    const third={vy:p.vy,t:p.stockAirJumpT}; neutral();
    // Real keyboard events through InputManager, with the controller detached.
    c.versus.seats[0].device='keyboard';
    const {setExternalControl}=await import('/src/input/externalControl.ts');
    setExternalControl(c.input,false);
    const keyboard=[];
    const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,key:code, bubbles:true}));
    for(const [direction,expected] of [['KeyW','up_smash'],['KeyS','down_smash']]) {
      fresh();c.state.paused=false;key('keydown','ShiftLeft');key('keydown',direction);key('keydown','KeyF');
      keyboard.push({expected,kind:a.stockAttack(0).kind});
      for(const code of ['KeyF',direction,'ShiftLeft'])key('keyup',code);c.state.paused=true;
    }
    fresh(); const fs=c.fighters;
    fs.press('tactical');step(30); const guard=fs.drawables.length;
    if(fs.id==='brann-rook')fs.press('tactical');step(1);const lowering=fs.drawables.length;step(100);const expired=fs.drawables.length;
    fresh(); fs.addCharge(1);fs.press('ultimate');step(1);const ultimate=fs.drawables.length;
    a.reset();const reset=fs.drawables.length;
    const {drawDuelEffect}=window.__duelSprites;
    const effectPixels=[];
    for(const name of Object.keys(window.__duelSprites.atlases.get(fs.id).animations).filter(n=>n.startsWith('fx/')).map(n=>n.slice(3))) {
      let pixels=0;const surface={pixelStep:.5,setPx(){pixels++;},addPx(){pixels++;}};
      const visible=drawDuelEffect(surface,c,name,12,100,100);
      const before=pixels; drawDuelEffect(surface,c,name,100,100,100);
      effectPixels.push({name,pixels,visible,latePixels:pixels-before});
    }
    fresh(); fs.press('tactical'); step(12);
    for(let i=0;i<600;i++)c.camera.update(c);
    g.composer.capturePoses(c);g.composeDirty=true;
    return {attacks,jump:{first,second,third},keyboard,effects:{guard,lowering,expired,ultimate,reset,effectPixels}};
  });
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.waitForTimeout(2000); // Let the presentation-only FIGHT banner finish before the evidence screenshot.
  await page.screenshot({path:out+'/tactical.png'});
  for(const a of results.attacks){assert.equal(a.kind,a.expected);assert(a.damage>0,JSON.stringify(a));}
  assert(results.attacks.find(a=>a.kind==='down_air').knock.y>0);
  assert(results.attacks.find(a=>a.kind==='back_air').knock.x<0);
  assert.equal(results.jump.second.pose,'double_jump');assert(results.jump.second.vy<0);
  assert(results.jump.third.t<results.jump.second.t,'third press cannot reset jump');
  for(const k of results.keyboard)assert.equal(k.kind,k.expected);
  assert(results.effects.guard>0);assert(results.effects.lowering>0);assert.equal(results.effects.expired,0);
  assert(results.effects.ultimate>=1);assert.equal(results.effects.reset,0);
  for(const e of results.effects.effectPixels){assert(e.pixels>0,JSON.stringify(e));assert(e.visible);assert.equal(e.latePixels,0);}
  assert.deepEqual(errors,[]);
  writeFileSync(out+'/playable.json',JSON.stringify({...results,errors},null,2)+'\n');
  console.log(JSON.stringify(results));
} finally {await browser.close();}
