import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {findFigures} from './figures.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'registration.json');
const config=JSON.parse(await fs.readFile(file,'utf8'));
const reviewFile=path.join(root,'review-overrides.json');
const reviews=JSON.parse(await fs.readFile(reviewFile,'utf8'));
for(const equipment of ['unarmed','armed']) {
  const clip=config.clips.find(c=>c.id===`ilyra-voss/${equipment}/ledge_hang`);
  const {data,info}=await sharp(path.join(root,clip.source)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {labels,figures}=findFigures(data,info.width,info.height,clip.cols,clip.count);
  clip.pivot={x:192,y:64};
  clip.roots=[];
  for(const f of figures) {
    const x0=Math.max(0,f.left-4),y0=Math.max(0,f.top-4);
    const cw=Math.min(info.width,f.right+5)-x0,ch=Math.min(info.height,f.bottom+5)-y0;
    const pixels=Buffer.alloc(cw*ch*4);
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++) {
      const p=(y+y0)*info.width+x+x0;
      if(labels[p]===f.label)data.copy(pixels,(y*cw+x)*4,p*4,p*4+4);
    }
    // Register the actual nearest-neighbor raster, including pixel rounding.
    const rw=Math.round(cw*clip.scale),rh=Math.round(ch*clip.scale);
    const raster=await sharp(pixels,{raw:{width:cw,height:ch,channels:4}}).resize(rw,rh,{kernel:'nearest'}).raw().toBuffer();
    let top=rh;
    for(let p=0;p<rw*rh;p++)if(raster[p*4+3]>=128)top=Math.min(top,Math.floor(p/rw));
    const xs=[];
    for(let y=top;y<top+6;y++)for(let x=0;x<rw;x++)if(raster[(y*rw+x)*4+3]>=128)xs.push(x);
    const handX=xs.reduce((n,x)=>n+x,0)/xs.length;
    const ox=Math.round(clip.pivot.x-handX),oy=clip.pivot.y-(top+4);
    clip.roots.push({x:x0+(clip.pivot.x-ox)/clip.scale,y:y0+(clip.pivot.y-oy)/clip.scale});
  }
  clip.anchorType='grip';
  clip.registration='gripping-hand';
  clip.review={status:'grip-registered-motion-review-pending',reason:'Grip contact is tracked in every source frame and packed at the same pivot. Body and feet remain free to swing.'};
  reviews[clip.id]={...clip.review,override:{
    ...reviews[clip.id]?.override,
    scale:clip.scale,pivot:clip.pivot,roots:clip.roots,
    anchorType:clip.anchorType,registration:clip.registration
  }};
  console.log(JSON.stringify({id:clip.id,pivot:clip.pivot,roots:clip.roots}));
}
await fs.writeFile(file,JSON.stringify(config,null,2)+'\n');
await fs.writeFile(reviewFile,JSON.stringify(reviews,null,2)+'\n');
