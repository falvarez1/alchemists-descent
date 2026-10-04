import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const browser = await launchBrowser();
try {
  for (const fighter of ['ilyra-voss', 'brann-rook']) {
    const page = await browser.newPage({viewport:{width:1280,height:720}}), errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.goto((process.argv[2]??'http://127.0.0.1:5267/')+'?link=off',{waitUntil:'networkidle'});
    await page.locator('[data-entry="duel"]').click();
    await page.evaluate(fighter=>{
      const v=window.__game.ctx.versus;
      for(const slot of [0,1]){v.chooseDevice(slot,'cpu');v.chooseFighter(slot,fighter);}
      v.chooseStage('foundry');v.start();
    },fighter);
    await page.waitForFunction(()=>window.__game.ctx.arena.stockMatch?.state==='fighting');
    await page.waitForFunction(fighter=>window.__duelSprites?.atlases.get(fighter)?.animations?.tumble,fighter);
    const result=await page.evaluate(async()=>{
      const g=window.__game,c=g.ctx,a=c.arena,p=c.player,fs=c.fighters,api=window.__duelSprites,atlas=api.atlases.get(fs.id);
      await c.console.exec('arena bot 0 off');await c.console.exec('arena bot 1 off');c.state.paused=true;
      const step=n=>{for(let i=0;i<n;i++)g.tick(false,{forcePaused:true});};
      const fresh=()=>{
        a.reset();step(125);c.fx.hitstop=0;c.state.arrivalGraceUntil=0;
        for(const slot of [0,1]){
          const b=a.bundle(slot);
          Object.assign(b.player,{x:a.stockStage.center.x+slot*140,y:a.stockStage.main.y-1,vx:0,vy:0,_svx:0,fx:0,fy:0,grounded:true,facing:1,invuln:0,staggerT:0,stunT:0,firing:false,recoilT:0,crouchT:0,crawling:false,skidT:0,swapT:0,fidgetT:0,landTimer:0});
          for(const k of Object.keys(b.input.keys))b.input.keys[k]=false;
          for(const k of Object.keys(b.player.status))if(typeof b.player.status[k]==='number')b.player.status[k]=0;
        }
      };
      fresh();
      const passive={};
      if(fs.id==='brann-rook'){
        const hp=p.hp;
        c.playerCtl.damage(40,0,0,'fighter');step(1);
        passive.pressure=fs.view.meter?.value;passive.hpUnchanged=p.hp===hp;
        for(let i=0;i<3;i++){p.invuln=0;c.playerCtl.damage(100,0,0,'fighter');step(1);}
        passive.ventResist=fs.staggerResist;passive.effects=fs.drawables.length;
      }else{
        // A real spell/body hit followed by a real melee hit must prime Mixture.
        a.with(0,()=>c.enemyCtl.damage(c.enemies.find(e=>e.fighter===1),20,0,0,'direct'));
        step(3);
        const hit=()=>{
          a.stockAttack(0).reset();p.staggerT=p.stunT=0;p.invuln=0;c.fx.hitstop=0;
          if(!a.requestStockAttack('opener',1))throw new Error('Melee refused');
          const attack=a.stockAttack(0),spec=attack.spec,v=a.bundle(1).player;
          const before=a.stockMatch.fighters[1].volatility;
          for(let i=0;i<spec.startup+spec.active+2;i++){
            Object.assign(v,{x:p.x+14,y:p.y,vx:0,vy:0,invuln:0,fx:0,fy:0});step(1);
            if(a.stockMatch.fighters[1].volatility>before)break;
          }
          step(1);return a.stockMatch.fighters[1].volatility-before;
        };
        passive.primeDamage=hit();passive.primed=fs.view.meter?.label;
        step(3);passive.scorchDamage=hit();passive.spent=fs.view.meter?.label!=='SCORCH PRIMED';
        passive.burning=a.bundle(1).player.status.burning;
      }
      const poses=[];
      const choose=pose=>{
        const fr=api.animatedFrame(atlas,pose,c).frame;
        return [...atlas.frames].find(([,f])=>f===fr)?.[0];
      };
      const cases=[
        ['idle',{},'idle0'],['idle_ready',{near:true},'idle0'],['walk',{vx:.8},'run0'],['run',{vx:2},'run0'],
        ['duck',{crouchT:2},'land'],['crouch_idle',{crouchT:8},'land'],['crouch_walk',{crouchT:8,vx:1},'land'],
        ['brake',{skidT:5},'idle0'],['pickup',{swapT:5},'idle0'],['taunt',{fidgetT:5},'idle0'],
        ['stun',{stunT:5},'idle0'],['burning',{burning:true},'idle0'],['frozen',{frozen:true},'idle0'],
        ['hurt_crouch',{crawling:true},'hurt'],['hurt_air',{grounded:false},'hurt'],['hurt_back',{staggerDir:1},'hurt'],
        ['ko',{dead:true},'idle0'],['defeat',{finished:true,dead:true},'idle0'],['victory',{finished:true,winner:true},'idle0'],
      ];
      for(const [expected,patch,pose] of cases){
        fresh();choose('cast');Object.assign(p,patch);
        if(patch.near)a.bundle(1).player.x=p.x+50;
        if(patch.burning)p.status.burning=10;
        if(patch.frozen)p.chill.shell=10;
        if(patch.finished){a.stockMatch.state='finished';a.stockMatch.winner=patch.winner?0:1;}
        poses.push({expected,frame:choose(pose)});
        if(patch.frozen)p.chill.shell=0;
      }
      for(const [from,to,patch,pose] of [['duck','stand_up',{},'idle0'],['tumble','get_up',{},'land'],['ledge_hang','ledge_release',{grounded:false},'fall'],['idle','dash',{vx:2},'run0']]){
        fresh();choose(from);Object.assign(p,patch);poses.push({expected:to,frame:choose(pose)});
      }
      // Cosmetic sockets use precisely the same origin and reflection as the body blit.
      const sockets=[];
      for(const facing of [-1,1]){
        fresh();p.facing=facing;p.aimAngle=facing<0?Math.PI:0;p.firing=true;
        const chosen=api.animatedFrame(atlas,'cast',c).frame,point=chosen.sockets.muzzle;
        let body;
        api.drawDuelFighter({pixelStep:.5,setPx(){},addPx(){},blitFine(x,y){body={x,y};}},{sample:()=>({r:1,g:1,b:1})},c);
        const socket=api.duelSocket(c,'muzzle');
        sockets.push({facing,errorX:socket.x-(body.x+(facing<0?chosen.w-1-point.x:point.x)*atlas.step),errorY:socket.y-(body.y+point.y*atlas.step)});
      }
      fresh();
      const deadSlots=[],draw=g.composer.drawPlayer;
      p.dead=true;a.bundle(1).player.dead=true;
      g.composer.drawPlayer=(...args)=>{deadSlots.push(c.arena.bound);draw(...args);};
      try{g.composer.compose(c);}finally{g.composer.drawPlayer=draw;}
      fresh();
      return {fighter:fs.id,passive,poses,sockets,deadSlots};
    });
    for(const p of result.poses)assert(p.frame?.startsWith('clip:'+p.expected+':'),JSON.stringify(p));
    for(const s of result.sockets)assert(Math.abs(s.errorX)<.001&&Math.abs(s.errorY)<.001,JSON.stringify(s));
    assert.deepEqual([...new Set(result.deadSlots)].sort(),[0,1],'Both seats must reach their KO/result renderer');
    if(fighter==='brann-rook'){assert(result.passive.pressure>0);assert(result.passive.hpUnchanged);assert(result.passive.ventResist);assert(result.passive.effects>0);}
    else{assert.equal(result.passive.primed,'SCORCH PRIMED');assert(result.passive.spent);assert(result.passive.scorchDamage>result.passive.primeDamage);assert(result.passive.burning>0);}
    assert.deepEqual(errors,[]);
    const out='output/playwright/'+(fighter==='brann-rook'?'brann':'ilyra');mkdirSync(out,{recursive:true});
    writeFileSync(out+'/completion.json',JSON.stringify({...result,errors},null,2)+'\n');
    console.log(JSON.stringify(result));await page.close();
  }
}finally{await browser.close();}
