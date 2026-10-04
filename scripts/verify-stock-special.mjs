import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
const browser = await launchBrowser(), errors = [], out = 'docs/arena/platform-fighter/evidence';
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.specialPad = { index: 0, id: 'Xbox test', connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({length:18},()=>({pressed:false,touched:false,value:0})) };
    Object.defineProperty(navigator,'getGamepads',{value:()=>[window.specialPad]});
  });
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5217/')+'?link=off',{waitUntil:'networkidle'});
  await page.locator('[data-entry="duel"]').click();
  await page.getByRole('button',{name:'Ready player 1',exact:true}).click();
  await page.locator('#versus-start').click();
  await page.waitForFunction(()=>window.__game?.ctx.arena.stockMatch?.state==='fighting');
  await page.evaluate(async()=>{
    const g=window.__game,c=g.ctx,a=c.arena;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off'); c.state.paused=true;
    const poll=()=>{c.state.paused=false;g.pollInput();c.state.paused=true;};
    const step=n=>{for(let i=0;i<n;i++)g.tick(false,{forcePaused:true});};
    const fresh=()=>{ window.specialPad.axes.fill(0); for(const b of window.specialPad.buttons)b.pressed=false;poll(); a.reset();c.fx.hitstop=0;step(125);c.state.arrivalGraceUntil=0;
      for(const slot of [0,1]) {const b=a.bundle(slot);Object.assign(b.player,{x:800+slot*18,y:639,vx:0,vy:0,fx:0,fy:0,grounded:true,invuln:0,stunT:0,facing:slot?-1:1});Object.assign(b.input.mouse,{x:slot?700:900,y:629});}
    };
    window.specialFixture={g,c,a,poll,step,fresh}; fresh();
  });
  const shots=await page.evaluate(()=>{
    const {g,c,a,poll,fresh}=window.specialFixture; fresh(); a.bundle(1).player.x=960; a.bundle(0).player.facing=-1;
    const casts=[];const off=c.events.on('cardCast',e=>casts.push({tick:c.state.frameCount,id:e.id}));
    const start=c.state.frameCount; window.specialPad.buttons[1].pressed=true;
    const readings=[];
    for(let i=0;i<180;i++){poll();g.tick(false,{forcePaused:true});if([0,60,119,179].includes(i))readings.push({tick:i,charges:a.stockSpecial(0).charges,casts:casts.length});}
    off();window.specialPad.buttons[1].pressed=false;poll();
    return {readings,groups:new Set(casts.map(e=>e.tick)).size,casts:casts.map(e=>({...e,tick:e.tick-start}))};
  });
  console.log(JSON.stringify({shots}));
  assert.equal(shots.groups,2); assert.equal(shots.readings[2].charges,0);
  const empty=await page.evaluate(()=>{
    const {a,step,fresh}=window.specialFixture;fresh();a.spendStockSpecial(2);step(24);
    const b=a.bundle(0),before=a.stockSpecial(0).progress;
    b.input.queuedRecovery=true; const recovered=a.updateStockRecovery(false);
    return {charges:a.stockSpecial(0).charges,other:a.stockSpecial(1).charges,recovered,vy:b.player.vy,before};
  });
  assert.equal(empty.charges,0);assert.equal(empty.other,2);assert.equal(empty.recovered,true);assert.ok(empty.vy<0);
  const reward=await page.evaluate(()=>{
    const {a,step,fresh}=window.specialFixture;fresh();a.spendStockSpecial();step(24);const before=a.stockSpecial(0).progress;
    a.requestStockAttack('opener');step(10);return {before,after:a.stockSpecial(0).progress,damage:a.stockMatch.fighters[1].volatility};
  });
  assert.ok(reward.damage>0);assert.ok(reward.after-reward.before>60/180);
  const respawn=await page.evaluate(()=>{
    const {a,step,fresh}=window.specialFixture;fresh();a.spendStockSpecial(2);a.with(1,()=>a.spendStockSpecial());
    a.bundle(0).player.x=a.stockMatch.zone.left-20;step(1);const lost=a.stockMatch.fighters[0].stocks;
    step(61);return {lost,alive:!a.bundle(0).player.dead,charges:a.stockSpecial(0).charges,other:a.stockSpecial(1).charges};
  });
  assert.equal(respawn.lost,2);assert.equal(respawn.alive,true);assert.equal(respawn.charges,2);assert.equal(respawn.other,1);
  const roster=await page.evaluate(async()=>{
    const {c,a,step,fresh}=window.specialFixture;const {FIGHTER_ORDER}=await import('/src/content/fighters.ts');const rows=[];
    for(const id of FIGHTER_ORDER){
      await a.with(0,async()=>{c.fighters.equip(id);await c.fighters.whenReady();});fresh();a.spendStockSpecial(2);step(24);
      const f=a.bundle(0).fighters; f.refill(); const before=[f.view.tactical.usedAt,f.view.ultimate.usedAt];
      a.with(0,()=>{f.press('tactical');f.press('ultimate');f.update(c);c.wands.wands[0].cooldown=0;c.wands.fire(c);});
      const row={id,before,after:[f.view.tactical.usedAt,f.view.ultimate.usedAt],charges:a.stockSpecial(0).charges,ready:[]};
      for(const ability of ['tactical','ultimate']){
        fresh();f.refill();const used=f.view[ability].usedAt;
        a.with(0,()=>{f.press(ability);f.update(c);});
        row.ready.push({ability,fired:f.view[ability].usedAt!==used,charges:a.stockSpecial(0).charges});
      }
      rows.push(row);
    }return rows;
  });
  for(const row of roster){assert.deepEqual(row.after,row.before,row.id);assert.equal(row.charges,0);for(const ready of row.ready)assert.equal(ready.charges,ready.fired?(ready.ability==='tactical'?1:0):2,`${row.id} ${ready.ability} pays or refunds`);}
  await page.evaluate(async()=>{const {c,fresh}=window.specialFixture;c.fighters.equip('ilyra-voss');await c.fighters.whenReady();fresh();});
  for(const [name,cost] of [['ready',0],['one-spent',1],['empty',2]]){
    await page.evaluate(cost=>{const {a,step,fresh}=window.specialFixture;fresh();if(cost){a.spendStockSpecial(cost);step(24);}},cost);
    await page.waitForTimeout(100);
    await page.locator('.stock-fighter-0').screenshot({path:`${out}/special-${name}.png`});
  }
  await page.screenshot({path:`${out}/special-desktop.png`});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  const layout=await page.locator('.stock-fighter').evaluateAll(cards=>cards.map(card=>({width:card.clientWidth,scroll:card.scrollWidth,charge:card.querySelector('.stock-special').getBoundingClientRect().toJSON(),box:card.getBoundingClientRect().toJSON(),defense:card.querySelector('.stock-defense').getBoundingClientRect().toJSON(),percent:card.querySelector('.stock-percent').getBoundingClientRect().toJSON()})));
  for(const card of layout){assert.ok(card.scroll<=card.width);assert.ok(card.charge.bottom<=card.box.bottom);const apart=(a,b)=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;assert.ok(apart(card.defense,card.percent),'percent does not overlap defense');assert.ok(apart(card.defense,card.charge),'charge row does not overlap defense');assert.ok(card.percent.bottom<=card.charge.top,'percent does not overlap charge row');}
  await page.screenshot({path:`${out}/special-mobile.png`});
  assert.deepEqual(errors,[]);writeFileSync(`${out}/stock-special.json`,JSON.stringify({shots,empty,reward,respawn,roster,layout,errors},null,2));
  console.log(JSON.stringify({shots,empty,reward,respawn,rosterCount:roster.length,errors},null,2));
}finally{await browser.close();}
