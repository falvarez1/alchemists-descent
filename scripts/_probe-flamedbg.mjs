import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
page.on("dialog",(d)=>d.accept());
await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });
await page.waitForTimeout(400);
const out = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.levels.startRun(ctx, { mode:"test", worldSource:"campaign", seed:4242 });
  for (let f=0; f<40; f++) window.__game.tick();
  ctx.levels._transitioning=false;
  const p=ctx.player, w=ctx.world;
  for (let dx=-50;dx<=70;dx++) for(let dy=-40;dy<=20;dy++) w.clearCellAt(w.idx(400+dx,400+dy));
  p.x=400; p.y=400; ctx.camera.snapTo(400-287,400-195); ctx.enemies.length=0;
  const wand=ctx.wands.wands[ctx.wands.active]; wand.cards=["flame"]; wand.mana=wand.frame.manaMax; wand.cooldown=0; ctx.wands.invalidatePrograms();
  ctx.enemyCtl.spawn("bat", 426, 391); const e=ctx.enemies[ctx.enemies.length-1]; e.alerted=true; e.sleeping=false;
  const aim=Math.atan2((e.y-5)-(p.y-9), e.x-p.x);
  const log=[];
  for(let f=0; f<14; f++){
    p.aimAngle=aim; p.recharge=0; p.pullT=0; p.dead=false; p.hp=p.maxHp; p.invuln=600; wand.mana=wand.frame.manaMax;
    ctx.wands.fire(ctx);
    const fsBefore = !!ctx.wands.streamFlameInfo(ctx);
    window.__game.tick();
    const al = ctx.enemies.includes(e);
    log.push({f, fsBefore, fsAfter: !!ctx.wands.streamFlameInfo(ctx), fear: al?+(e.fear??0).toFixed(2):0, dodgeT: al?(e.dodgeT??0):0, fleeT: al?(e.fleeT??0):0, x: al?+e.x.toFixed(0):0, y: al?+e.y.toFixed(0):0 });
  }
  const G=globalThis; return { aim:+aim.toFixed(2), fsNN:G.__fsNN, fsLeth:G.__fsLeth, fsCone:G.__fsCone, fsDist:G.__fsDist, fsDa:G.__fsDa, lastFear:+(ctx.enemies[0]?.fear??0).toFixed(2) };
});
console.log(JSON.stringify(out));
await browser.close();
