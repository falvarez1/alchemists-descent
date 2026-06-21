import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
try {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });
  await page.evaluate(() => {
    const ctx = window.__game.ctx, w = ctx.world;
    const e = ctx.enemies.filter(g=>g.kind==='weaver').sort((a,b)=>Math.abs(a.x-512)-Math.abs(b.x-512))[0];
    e.__probeId = 1;
    for (const o of ctx.enemies) if (o.kind==='weaver'&&o!==e){o.x=30;o.alerted=false;}
    const fy=742;
    for(let x=380;x<=660;x++)for(let y=fy;y<=fy+10;y++) if(w.inBounds(x,y)) w.replaceCellAt(w.idx(x,y),12,0x6f6f6f);
    for(let x=380;x<=660;x++)for(let y=fy-60;y<fy;y++) if(w.inBounds(x,y)) w.clearCellAt(w.idx(x,y));
    e.x=520;e.y=fy-1;e.vx=e.vy=0;e.alerted=false;e.sleeping=false;e.attackCd=9999;
  });
  await page.evaluate(()=>new Promise(res=>{let k=0;const t=()=>{const ctx=window.__game.ctx;const e=ctx.enemies.find(g=>g.__probeId===1);ctx.camera.snapTo(e.x,e.y-12);if(++k>=70)return res();requestAnimationFrame(t);};requestAnimationFrame(t);}));
  const legs = await page.evaluate(()=>{
    const e=window.__game.ctx.enemies.find(g=>g.__probeId===1);
    return (e.weaverLegs||[]).map(l=>({s:+(l.strain??0).toFixed(2),surf:l.surface,pl:l.planted===true,fdy:Math.round((e.y-9)-l.y)}));
  });
  console.log('orient',(await page.evaluate(()=>window.__game.ctx.enemies.find(g=>g.__probeId===1).weaverOrient)).toFixed(2));
  for(const l of legs) console.log(JSON.stringify(l));
} finally { await browser.close(); }
