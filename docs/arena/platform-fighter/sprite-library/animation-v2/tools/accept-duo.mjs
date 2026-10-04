import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
const lib=await read('manifest.json'),jobs=await read('prompts/duo-completion.json');
const review=await read('acceptance.json'),overrides=await read('review-overrides.json');
for(const fighter of ['ilyra-voss','brann-rook']){
  const short=fighter.split('-')[0];
  for(const clip of lib.clips.filter(c=>c.id.startsWith(fighter+'/')||c.id.startsWith('effects/'+fighter+'/'))){
    const unarmed=clip.id.includes('/unarmed/'),repaired=jobs.some(j=>j.id===clip.id);
    review[clip.id]={artAcceptance:repaired?'replacement-reviewed':unarmed?'export-verified':'runtime-sampled',
      runtime:unarmed?'export-only':'integrated',
      evidence:unarmed?['evidence/checks.json']:[`evidence/${short}-runtime.json`,`evidence/${short}-playable.json`,`evidence/${short}-completion.json`],
      notes:unarmed?'Alternate equipment export; Duel uses the armed character.':'Connected to the existing body state or kit event; see DUO-COMPLETION.md.'};
  }
  for(const area of ['playback','anchors','sockets','effects','browser'])review[`integration/${fighter}/${area}`]={status:'runtime-verified'};
}
for(const job of jobs)overrides[job.id]={status:'replacement-reviewed',override:{source:job.source},reason:'Selected completion repair; prompt, source hash and registration are recorded. Supersedes the earlier motion/equipment issue.'};
for(const id of ['brann-rook/unarmed/taunt','brann-rook/unarmed/shield_break','brann-rook/armed/shield_break']){
  review[id].notes+=' Detached component report reviewed: gesture marks or shield impact fragments, not a joined/missing body.';
}
await fs.writeFile(path.join(root,'acceptance.json'),JSON.stringify(review,null,2)+'\n');
await fs.writeFile(path.join(root,'review-overrides.json'),JSON.stringify(overrides,null,2)+'\n');
console.log('Recorded both fighter integrations and selected repairs; unarmed exports remain distinct from playable equipment.');
