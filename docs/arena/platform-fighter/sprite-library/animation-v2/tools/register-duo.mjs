import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { findFigures } from './figures.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=async n=>JSON.parse(await fs.readFile(path.join(root,n),'utf8'));
const config=await read('registration.json'), jobs=await read('prompts/duo-completion.json'), provenance=await read('provenance.json');
for(const job of jobs) {
  const source=await fs.readFile(path.join(root,job.source));
  const raw=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const figures=job.kind==='fighter'?findFigures(raw.data,raw.info.width,raw.info.height,4,12):null;
  const tumble=job.id.endsWith('/tumble');
  const clip={id:job.id,source:job.source,kind:job.kind,cols:4,rows:3,count:12,loop:job.loop,
    endBehavior:job.loop?'loop':job.kind==='effect'?'hide':'hold',durationsTicks:Array(12).fill(job.loop?4:3),
    scale:.5,registration:tumble?'body-center':job.kind==='effect'?'center':'planted-feet',
    pivot:tumble||job.kind==='effect'?{x:192,y:192}:{x:192,y:320},
    review:{status:'motion-reviewed',notes:'Replacement source reviewed for action, separation, equipment and chronology.'}};
  if(tumble) {clip.anchorType='center';clip.roots=figures.figures.map(f=>({x:(f.left+f.right)/2,y:(f.top+f.bottom)/2}));}
  if(job.id.endsWith('/up_smash'))clip.phaseNames=[...Array(4).fill('startup'),...Array(4).fill('active'),...Array(4).fill('recovery')];
  const i=config.clips.findIndex(c=>c.id===clip.id); if(i<0)config.clips.push(clip);else config.clips[i]=clip;
  const entry={id:job.id,source:job.source,prompt:'prompts/duo-completion.json',promptId:job.id,sha256:createHash('sha256').update(source).digest('hex'),review:'motion-reviewed'};
  const pi=provenance.selected.findIndex(c=>c.id===job.id);if(pi<0)provenance.selected.push(entry);else provenance.selected[pi]=entry;
}
if(!provenance.promptFiles.includes('prompts/duo-completion.json'))provenance.promptFiles.push('prompts/duo-completion.json');
await fs.writeFile(path.join(root,'registration.json'),JSON.stringify(config,null,2)+'\n');
await fs.writeFile(path.join(root,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log('Registered '+jobs.length+' replacement/new clips');
