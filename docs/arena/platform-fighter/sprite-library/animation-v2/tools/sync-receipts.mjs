import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const receipts=path.join(root,'prompts/receipts');
const result=new Map();
for(const name of await fs.readdir(receipts)){
  if(!name.endsWith('.json') || name.startsWith('correction-'))continue;
  const r=JSON.parse(await fs.readFile(path.join(receipts,name),'utf8'));result.set(r.id,r);
}
for(const name of ['ilyra-mobility-specials.json','effects-pass.json','brann-idle-pass.json','brann-core-pass.json','artifacts-pass.json']){
  const file=path.join(root,'prompts',name),jobs=JSON.parse(await fs.readFile(file,'utf8'));
  for(const job of jobs){
    const receipt=result.get(job.id);if(!receipt)continue;
    const source=await fs.readFile(path.join(root,job.source));
    Object.assign(job,receipt,{sourceSha256:createHash('sha256').update(source).digest('hex')});
  }
  await fs.writeFile(file,JSON.stringify(jobs,null,2)+'\n');
  console.log(name+': '+jobs.filter(j=>j.status==='generated').length+'/'+jobs.length);
}
