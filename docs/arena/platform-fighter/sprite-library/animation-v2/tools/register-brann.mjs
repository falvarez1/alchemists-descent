import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { findFigures } from './figures.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
const config=await read('registration.json'),jobs=await read('prompts/brann-completion.json');
const provenance=await read('provenance.json');
const repairs=await read('prompts/brann-repairs.json');
const requested=new Set(process.argv.slice(2));
const report=[];
for(const job of jobs) {
  if(requested.size&&!requested.has(job.id))continue;
  const source=path.join(root,job.source);
  if(!await fs.access(source).then(()=>true,()=>false))continue;
  const raw=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let figures=null,error=null;
  if(job.kind==='fighter')try{figures=findFigures(raw.data,raw.info.width,raw.info.height,job.cols,job.count);}
  catch(e){error=e.message;}
  const clip={id:job.id,kind:job.kind,source:job.source,cols:job.cols,rows:job.rows,count:job.count,
    durationsTicks:job.durationsTicks,loop:job.loop,endBehavior:job.endBehavior??(job.loop?'loop':'hold'),
    registration:job.registration,scale:.5,
    review:{status:error?'extraction-repair-required':'generated-motion-review-required',notes:error??'Generated replacement. Motion and cross-state review required.'}};
  if(job.phaseNames)clip.phaseNames=job.phaseNames;
  if(job.kind==='effect')clip.pivot={x:192,y:192};
  if(job.id.endsWith('/ledge_hang')&&figures){
    // The raised gauntlet is the highest part of each hanging silhouette. Register
    // the contact row, preserving the whole-body swing instead of fixing the feet.
    clip.pivot={x:192,y:64};clip.anchorType='grip';clip.registration='gripping-hand';
    clip.roots=figures.figures.map(f=>{
      const points=[];
      for(let y=f.top;y<=f.top+5;y++)for(let x=f.left;x<=f.right;x++)
        if(figures.labels[y*raw.info.width+x]===f.label&&raw.data[(y*raw.info.width+x)*4+3]>=128)points.push(x);
      if(!points.length)throw new Error('No grip contact pixels '+job.id);
      return {x:(Math.min(...points)+Math.max(...points))/2,y:f.top};
    });
  }
  if(job.id.endsWith('/tumble')&&figures){
    clip.pivot={x:192,y:192};clip.anchorType='center';clip.registration='body-center';
    clip.roots=figures.figures.map(f=>({x:(f.left+f.right)/2,y:(f.top+f.bottom)/2}));
  }
  const index=config.clips.findIndex(c=>c.id===job.id);
  if(index<0)config.clips.push(clip);else config.clips[index]=clip;
  const prompt=job.id==='effects/brann-rook/guard_plate'?'prompts/brann-guard-repair.txt'
    :repairs.some(r=>r.id===job.id)?'prompts/brann-repairs.json':'prompts/brann-completion.json';
  const entry={id:job.id,source:job.source,prompt,promptId:job.id,
    sha256:createHash('sha256').update(await fs.readFile(source)).digest('hex'),review:clip.review.status};
  const p=provenance.selected.findIndex(c=>c.id===job.id);
  if(p<0)provenance.selected.push(entry);else provenance.selected[p]=entry;
  if(!provenance.promptFiles.includes(prompt))provenance.promptFiles.push(prompt);
  report.push({id:job.id,figures:figures?.figures.length??null,error});
}
if(!provenance.promptFiles.includes('prompts/brann-completion.json'))provenance.promptFiles.push('prompts/brann-completion.json');
await fs.writeFile(path.join(root,'registration.json'),JSON.stringify(config,null,2)+'\n');
await fs.writeFile(path.join(root,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
const prior=await read('evidence/brann-source-audit.json').catch(()=>[]);
const audit=[...prior.filter(r=>!report.some(n=>n.id===r.id)),...report];
await fs.writeFile(path.join(root,'evidence/brann-source-audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({registered:report.length,flagged:report.filter(r=>r.error)}));
