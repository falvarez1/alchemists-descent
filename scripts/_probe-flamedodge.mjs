import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
const errs=[]; page.on("pageerror",(e)=>errs.push(String(e))); page.on("dialog",(d)=>d.accept());
await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });
await page.waitForTimeout(400);
const out = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.levels.startRun(ctx, { mode:"test", worldSource:"campaign", seed:4242 });
  for (let f=0; f<40; f++) window.__game.tick();
  ctx.levels._transitioning=false;
  const p=ctx.player, w=ctx.world;
  const clear=()=>{ for (let dx=-50;dx<=70;dx++) for(let dy=-40;dy<=20;dy++) w.clearCellAt(w.idx(400+dx,400+dy)); };
  const tick=()=>{ ctx.levels._transitioning=false; p.dead=false; p.hp=p.maxHp; p.invuln=600; window.__game.tick(); };
  function flameTest(kind){
    p.x=400; p.y=400; p.vx=p.vy=0; clear(); ctx.camera.snapTo(400-287,400-195); ctx.enemies.length=0;
    const wand=ctx.wands.wands[ctx.wands.active]; wand.cards=["flame"]; wand.mana=wand.frame.manaMax; wand.cooldown=0; ctx.wands.invalidatePrograms();
    ctx.enemyCtl.spawn(kind, 426, 391); const e=ctx.enemies[ctx.enemies.length-1]; e.alerted=true; e.sleeping=false;
    const x0=e.x, y0=e.y;
    const aim=Math.atan2((e.y-5)-(p.y-9), e.x-p.x);
    let dodged=0, maxOff=0, everFlame=false;
    for(let f=0; f<30; f++){ p.aimAngle=aim; p.recharge=0; p.pullT=0; wand.mana=wand.frame.manaMax; ctx.wands.fire(ctx); if(ctx.wands.streamFlameInfo(ctx)) everFlame=true; tick();
      if(ctx.enemies.includes(e)){ if((e.dodgeT??0)>0||(e.fleeT??0)>0) dodged=1; maxOff=Math.max(maxOff, Math.hypot(e.x-x0, e.y-y0)); } }
    return { kind, everFlame, dodged, maxOffset:+maxOff.toFixed(1), alive: ctx.enemies.includes(e)?1:0 };
  }
  return { bat: flameTest("bat"), imp: flameTest("imp"), slime: flameTest("slime") };
});
console.log(JSON.stringify(out));
console.log("err", errs.length, errs.slice(0,2).join(" | "));
await browser.close();
