import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root=path.resolve('docs/arena/platform-fighter/sprite-library/animation-v2');
const fighter=process.argv[2]??'brann-rook';
if(!['brann-rook','ilyra-voss'].includes(fighter))throw new Error('Unsupported fighter');
const target=path.resolve('public/assets/arena/fighters/'+fighter);
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const original=path.join(root,'runtime-base',...(fighter==='brann-rook'?[]:[fighter]));
await fs.mkdir(original,{recursive:true});
for(const name of ['sprites.png','sprites.json']) {
  if(!await fs.access(path.join(original,name)).then(()=>true,()=>false))await fs.copyFile(path.join(target,name),path.join(original,name));
}
const base=JSON.parse(await fs.readFile(path.join(original,'sprites.json'),'utf8'));
const items=[],animations={},sockets={};
for(const [name,[x,y,w,h,ax,ay]] of Object.entries(base.frames))items.push({name,w,h,ax,ay,input:await sharp(path.join(original,'sprites.png')).extract({left:x,top:y,width:w,height:h}).png().toBuffer()});
const idle=manifest.clips.find(c=>c.id===fighter+'/armed/idle');
const height=idle.frames.map(f=>f.content.h).sort((a,b)=>a-b)[Math.floor(idle.frames.length/2)];
const scale=38/height;
for(const clip of manifest.clips.filter(c=>c.id.startsWith(fighter+'/armed/')||c.id.startsWith('effects/'+fighter+'/'))) {
  if(clip.extractionReview)throw new Error('Repair extraction before runtime import: '+clip.id);
  const action=(clip.kind==='effect'?'fx/':'')+clip.id.split('/').at(-1),frames=[];
  for(const f of clip.frames) {
    const source=path.join(root,path.dirname(clip.data),f.image);
    const fxScale={'fx/guard_plate':1.6,'fx/crucible_spin':.35,'fx/volatile_spark':.45,'fx/scorch':.65,'fx/crucible_fragments':.7};
    const size=Math.round(clip.frameSize*scale*(fxScale[action]??1));
    const raw=await sharp(source).resize(size,size,{kernel:'nearest'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let left=size,top=size,right=0,bottom=0;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(raw.data[(y*size+x)*4+3]>=128){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    const w=right-left+1,h=bottom-top+1;
    if(w<1||h<1)throw new Error('Empty frame '+clip.id+'/'+f.index);
    const input=await sharp(raw.data,{raw:raw.info}).extract({left,top,width:w,height:h}).png().toBuffer();
    const name=`clip:${action}:${f.index}`;
    if(clip.kind==='fighter') {
      const ax=Math.round(f.pivot.x*size/clip.frameSize)-left,ay=Math.round(f.pivot.y*size/clip.frameSize)-top;
      const angle=action==='cast_up'?-Math.PI/2:action==='cast_down'?Math.PI/2:action==='cast_diagonal_up'?-Math.PI/4:action==='cast_diagonal_down'?Math.PI/4:0;
      const dx=Math.cos(angle),dy=Math.sin(angle), shoulder={x:ax,y:ay-19};
      let best=-Infinity,tip={x:shoulder.x+dx*18,y:shoulder.y+dy*18};
      // The brass muzzle is the furthest warm opaque cluster along the authored casting direction.
      for(let sy=top;sy<=bottom;sy++)for(let sx=left;sx<=right;sx++) {
        const k=(sy*size+sx)*4,[r,g,b,a]=raw.data.subarray(k,k+4);
        const px=sx-left-shoulder.x,py=sy-top-shoulder.y;
        if(a<128||r<80||g<40||r<g*1.08||g<b*1.15||Math.abs(px*dy-py*dx)>12)continue;
        const score=px*dx+py*dy-Math.abs(px*dy-py*dx)*.2;
        if(score>best){best=score;tip={x:sx-left,y:sy-top};}
      }
      sockets[name]={muzzle:tip,hand:{x:tip.x-dx*5,y:tip.y-dy*5},chest:shoulder,feet:{x:ax,y:ay}};
    }
    items.push({name,w,h,ax:Math.round(f.pivot.x*size/clip.frameSize)-left,ay:Math.round(f.pivot.y*size/clip.frameSize)-top,input});
    const newAttack=['neutral_air','back_air','up_air','down_air','up_smash','down_smash'].includes(action);
    const phase=f.phase??(newAttack?f.index<4?'startup':f.index<8?'active':'recovery':null);
    frames.push({name,ticks:f.durationTicks,...(phase?{phase}:{})});
  }
  animations[action]={loop:clip.loop,anchor:clip.anchorType==='grip'?'grip':clip.anchorType==='center'?'center':'feet',frames};
}
const width=1024,rects={},overlays=[];
let x=1,y=1,rowHeight=0;
for(const item of items){if(x+item.w+1>width){x=1;y+=rowHeight+2;rowHeight=0;}rects[item.name]=[x,y,item.w,item.h,item.ax,item.ay];overlays.push({input:item.input,left:x,top:y});x+=item.w+2;rowHeight=Math.max(rowHeight,item.h);}
await sharp({create:{width,height:y+rowHeight+1,channels:4,background:'#00000000'}}).composite(overlays).png().toFile(path.join(target,'sprites.png'));
await fs.writeFile(path.join(target,'sprites.json'),JSON.stringify({version:2,step:base.step,frames:rects,animations,sockets},null,2)+'\n');
console.log(JSON.stringify({fighter,animations:Object.keys(animations).length,frames:items.length,height:y+rowHeight+1}));
