import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
const browser = await launchBrowser(), errors = [], out = 'docs/arena/platform-fighter/evidence';
const webgpu = process.argv.includes('--webgpu');
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
 page.on('pageerror', e => errors.push(String(e)));
 const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5217/'); url.searchParams.set('link','off');
 if (webgpu) { url.searchParams.set('renderBackend','webgpu'); url.searchParams.set('enableWebGpuLiveCompose','1'); }
 await page.goto(url.href, { waitUntil: 'networkidle' });
 await leaveTitleIfShown(page); await waitForConsoleApi(page);
 await page.evaluate(async () => {
   const c = window.__game.ctx; await c.console.exec('run test --level fighter-duel --world campaign-level');
   c.fighters.equip('ilyra-voss'); await c.fighters.whenReady();
 });
 await page.getByRole('combobox', { name: 'Match rules', exact: true }).selectOption('stocks');
 await page.getByRole('button', { name: 'Add rival', exact: true }).click();
 await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
 await page.evaluate(async () => {
   const c = window.__game.ctx; await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
   c.state.paused = true; c.state.reduceCameraShake = true;
   document.getElementById('fighter-arena')?.classList.add('collapsed'); document.activeElement?.blur();
 });
 if (await page.locator('.controller-notice button').count()) await page.locator('.controller-notice button').click();
 const shots = [];
 for (const [name, bodies] of [
   ['close', [{x:785,y:639},{x:820,y:639}]],
   ['wide', [{x:320,y:630},{x:1280,y:630}]],
   ['recovery', [{x:1030,y:639},{x:1160,y:790}]],
 ]) {
   const shot = await page.evaluate(({ name, bodies }) => {
     const c = window.__game.ctx;
     bodies.forEach((body, slot) => Object.assign(c.arena.bundle(slot).player, body, { vx: 0, vy: 0, invuln: 0, dead: false, grounded: name === 'close' }));
     for (let i=0;i<300;i++) c.camera.update(c);
     window.__game.composer.capturePoses(c); window.__game.composeDirty = true;
     const cam = c.camera, halfW=320/cam.zoom, halfH=180/cam.zoom, x=cam.x+320, y=cam.y+180;
     return { name, x, y, zoom:cam.zoom, scale:cam.viewScale, bodies, framed:bodies.every(p=>Math.abs(p.x-x)<halfW-20 && p.y-y<halfH-40 && p.y-y>-halfH+25), stocks:c.arena.stockMatch.fighters.map(f=>f.stocks) };
   }, {name,bodies});
   await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const rendered = await page.evaluate(() => {
     const g=window.__game,c=g.ctx,cam=c.camera,p=c.player,box=document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
     const scale=cam.viewScale??1,z=cam.zoom*scale;
     const u=(p.x-cam.renderX)/(640*scale),v=(p.y-9-cam.renderY)/(360*scale);
     const ox=-(cam.presentationX-cam.renderX)*2/640/scale*z,oy=(cam.presentationY-cam.renderY)*2/360/scale*z;
     const screenX=box.x+box.width*(.5+(u-.5)*(1+4/640)*z+ox/2);
     const screenY=box.y+box.height*(.5+(v-.5)*(1+4/360)*z-oy/2);
     const costs=[];
     for(let i=0;i<35;i++){const t=performance.now();g.renderFrame(t,1);if(i>4)costs.push(performance.now()-t);}
     costs.sort((a,b)=>a-b);
     return { screenX,screenY,worldX:p.x,worldY:p.y-9,backend:g.renderer.getBackendStatus().actual,frameCpuMedian:costs[15],frameCpuP95:costs[28] };
   });
   await page.mouse.move(rendered.screenX,rendered.screenY);
   const mouse=await page.evaluate(()=>({...window.__game.ctx.input.mouse}));
   assert.ok(Math.abs(mouse.x-rendered.worldX)<=2 && Math.abs(mouse.y-rendered.worldY)<=2, `${name}: pointer maps to fighter world position`);
   if(webgpu)assert.equal(rendered.backend,'webgpu');
   await page.screenshot({path:`${out}/camera-${name}${webgpu?'-webgpu':''}.png`}); shots.push({...shot,...rendered,mouse}); assert.ok(shot.framed, `${name}: both fighters inside usable frame`);
 }
 const launch = await page.evaluate(() => {
   const g=window.__game,c=g.ctx,a=c.arena;
   a.reset();for(let i=0;i<125;i++)g.tick(false,{forcePaused:true});
   Object.assign(a.bundle(0).player,{x:785,y:639,vx:0,vy:0,grounded:true});
   Object.assign(a.bundle(1).player,{x:820,y:639,vx:0,vy:0,grounded:true});
   for(let i=0;i<160;i++)c.camera.update(c);
   a.with(1,()=>a.takeStockDamage(140,5,-3));
   const trace=[];
   for(let tick=0;tick<90;tick++){
     g.tick(true,{forcePaused:true});
     const cam=c.camera, x=cam.x+320,y=cam.y+180;
     const bodies=[0,1].map(slot=>{const p=a.bundle(slot).player;return{x:p.x,y:p.y,dead:p.dead,stocks:a.stockMatch.fighters[slot].stocks};});
     trace.push({tick,zoom:cam.zoom,x,y,bodies,framed:bodies.every(p=>p.dead||(Math.abs(p.x-x)<320/cam.zoom&&Math.abs(p.y-9-y)<180/cam.zoom))});
   }
   return trace;
 });
 assert.ok(launch.every(frame=>frame.framed),'A real launch stays in frame until the knockout');
 assert.ok(Math.min(...launch.map(frame=>frame.zoom))<1,'A real launch opens the composed view');
 const survival = await page.evaluate(() => {
   const g=window.__game,c=g.ctx,p=c.player; Object.assign(p,{x:1190,y:600,vx:0,vy:0,fx:0,fy:0,grounded:false});
   const stocks=c.arena.stockMatch.fighters[0].stocks;
   for(let i=0;i<12;i++)g.tick(false,{forcePaused:true});
   return {before:stocks,after:c.arena.stockMatch.fighters[0].stocks,x:p.x,y:p.y,zone:c.arena.stockMatch.zone};
 });
 assert.equal(survival.after,survival.before,'Leaving the old camera frame is not a KO');
 assert.ok(shots[0].zoom>1.5); assert.ok(shots[1].zoom<.65); assert.deepEqual(errors,[]);
 writeFileSync(`${out}/stock-camera${webgpu?'-webgpu':''}.json`,JSON.stringify({shots,launch,survival,errors},null,2)); console.log(JSON.stringify({shots,launchFrames:launch.length,survival,errors},null,2));
} finally {await browser.close();}
