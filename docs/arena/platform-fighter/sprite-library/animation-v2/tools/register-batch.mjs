import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'registration.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const queueFiles=process.argv.slice(2);
if(!queueFiles.length)queueFiles.push('ilyra-complete-pass.json','ilyra-mobility-specials.json','effects-pass.json','brann-idle-pass.json','brann-core-pass.json','artifacts-pass.json');
const queue=(await Promise.all(queueFiles.map(name=>fs.readFile(path.join(root,'prompts',name),'utf8').then(JSON.parse)))).flat();
const reviewPath = path.join(root, 'review-overrides.json');
const review = JSON.parse(await fs.readFile(reviewPath, 'utf8').catch(() => '{}'));
let added = 0;
for (const original of queue) {
  const job={...original,...review[original.id]?.override};
  if (review[job.id]?.reject || config.clips.some(c=>c.id===job.id)) continue;
  if (!await fs.stat(path.join(root, job.source)).catch(()=>null)) continue;
  if(job.kind && job.kind!=='fighter') {
    config.clips.push({id:job.id,kind:job.kind,source:job.source,cols:job.cols,rows:job.rows,count:job.count,
      durationsTicks:job.durationsTicks,loop:job.loop,endBehavior:job.endBehavior,registration:job.registration,
      scale:job.scale,pivot:job.pivot??{x:config.frameSize/2,y:job.registration==='ground'?config.pivot.y:config.frameSize/2},
      roots:job.roots,anchorType:job.anchorType,
      description:job.motion,review:review[job.id]??{status:'generated-motion-review-required'}});
    added++;continue;
  }
  const raw = await sharp(path.join(root, job.source)).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  const {width:w,height:h} = raw.info;
  const reference = ['stand_up','land','get_up','ledge_climb','recovery'].includes(job.action) ? job.count - 1 : 0;
  const cx = reference % job.cols, cy = Math.floor(reference / job.cols);
  const x0 = Math.round(cx*w/job.cols), x1 = Math.round((cx+1)*w/job.cols);
  const y0 = Math.round(cy*h/job.rows), y1 = Math.round((cy+1)*h/job.rows);
  const cw=x1-x0, ch=y1-y0, seen=new Uint8Array(cw*ch), queuePixels=new Int32Array(cw*ch);
  let best={count:0,top:0,bottom:0};
  for(let seed=0;seed<seen.length;seed++){
    const sx=seed%cw,sy=Math.floor(seed/cw);
    if(seen[seed] || raw.data[((sy+y0)*w+sx+x0)*4+3]<8)continue;
    let first=0,last=1,top=ch,bottom=0;queuePixels[0]=seed;seen[seed]=1;
    while(first<last){
      const p=queuePixels[first++],x=p%cw,y=Math.floor(p/cw);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy,np=ny*cw+nx;
        if(nx<0||ny<0||nx>=cw||ny>=ch||seen[np])continue;
        if(raw.data[((ny+y0)*w+nx+x0)*4+3]<8)continue;
        seen[np]=1;queuePixels[last++]=np;
      }
    }
    if(last>best.count)best={count:last,top,bottom};
  }
  if(best.count<500)throw new Error('Missing reference figure '+job.id);
  const target=job.targetHeight??({crouch_idle:108,crouch_walk:108,hurt_crouch:118,fall:155,hurt_air:155,aerial:155,shield:158,shield_hit:158,tumble:135}[job.action]??169);
  const scale=job.scale??Number((target/(best.bottom-best.top+1)).toFixed(6));
  const phases = job.phases ? job.phases.flatMap((n,i)=>Array(n).fill(['startup','active','recovery'][i])) : null;
  const clip={id:job.id,source:job.source,cols:job.cols,rows:job.rows,count:job.count,
    durationsTicks:job.durationsTicks,loop:job.loop,registration:job.registration??'planted-feet',scale,phaseNames:phases,
    pivot:job.pivot,roots:job.roots,anchorType:job.anchorType,
    description:job.motion,registrationReference:{frame:reference,targetHeight:target},
    review:review[job.id]??{status:'generated-motion-review-required'}};
  config.clips.push(clip);added++;
}
await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({added,clips:config.clips.length}));
