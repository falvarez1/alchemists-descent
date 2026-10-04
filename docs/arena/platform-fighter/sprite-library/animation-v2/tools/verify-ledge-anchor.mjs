import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const observations=[];
for(const equipment of ['unarmed','armed']) {
  const directory=path.join(root,'exports/ilyra-voss',equipment,'ledge_hang');
  const clip=JSON.parse(await fs.readFile(path.join(directory,'animation.json'),'utf8'));
  for(const frame of clip.frames) {
    const {data,info}=await sharp(path.join(directory,frame.image)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let top=info.height;
    for(let p=0;p<info.width*info.height;p++) if(data[p*4+3]>=128)top=Math.min(top,Math.floor(p/info.width));
    // The raised gripping fist is the only ink above her hat in this animation.
    const xs=[];
    for(let y=top;y<top+6;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>=128)xs.push(x);
    assert(xs.length>0,'Visible gripping hand required');
    const hand={x:xs.reduce((n,x)=>n+x,0)/xs.length,y:top+4};
    const error={x:Math.abs(hand.x-clip.pivot.x),y:Math.abs(hand.y-clip.pivot.y)};
    observations.push({equipment,frame:frame.index,hand,error});
    assert(error.x<=0.5&&error.y===0,`${equipment}/${frame.index}: gripping hand ${JSON.stringify(hand)} is detached from pivot ${JSON.stringify(clip.pivot)}`);
  }
}
const browser=await chromium.launch({channel:'msedge',headless:true});
const server=http.createServer(async(req,res)=>{
  try {
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const body=await fs.readFile(target);
    const type={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png'}[path.extname(target)]??'application/octet-stream';
    res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(body);
  }catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browserChecks=[];
try {
  const page=await browser.newPage({viewport:{width:1100,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for(const equipment of ['unarmed','armed'])for(const mirrored of [false,true]) {
    const id=`ilyra-voss/${equipment}/ledge_hang`;
    await page.selectOption('#clip',id);
    await page.waitForFunction(id=>document.body.dataset.readyClip===id,id);
    await page.locator('#mirror').setChecked(mirrored);
    for(let frame=0;frame<12;frame++) {
      const hand=await page.evaluate(()=>{
        const canvas=document.getElementById('stage'),g=canvas.getContext('2d');
        const {data}=g.getImageData(0,0,canvas.width,canvas.height);
        let top=canvas.height;
        for(let p=0;p<canvas.width*canvas.height;p++)if(data[p*4+3]>=128)top=Math.min(top,Math.floor(p/canvas.width));
        const xs=[];
        for(let y=top;y<top+12;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]>=128)xs.push(x);
        return {x:xs.reduce((n,x)=>n+x,0)/xs.length,y:top+8};
      });
      assert.equal(hand.y,100,'Hand stays on the visible ledge in playback');
      assert(Math.abs(hand.x-384)<=3,'Hand stays at the same ledge corner in either facing');
      browserChecks.push({equipment,mirrored,frame,hand});
      if(frame===2&&((equipment==='unarmed'&&!mirrored)||(equipment==='armed'&&mirrored)))
        await page.screenshot({path:path.join(root,'evidence',`ledge-hang-${equipment}${mirrored?'-left':''}.png`)});
      await page.click('#next');
    }
  }
  assert.equal(errors.length,0,errors.join('\n'));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
await fs.writeFile(path.join(root,'evidence/ledge-anchor.json'),JSON.stringify({result:'pass',frames:observations.length,maxErrorPixels:Math.max(...observations.flatMap(o=>Object.values(o.error))),observations,browserChecks},null,2)+'\n');
console.log(JSON.stringify({result:'pass',frames:observations.length,maxErrorPixels:Math.max(...observations.flatMap(o=>Object.values(o.error)))}));
