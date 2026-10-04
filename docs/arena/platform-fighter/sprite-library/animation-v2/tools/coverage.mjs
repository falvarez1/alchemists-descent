import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lib=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const catalog=JSON.parse(await fs.readFile(path.join(root,'../catalog.json'),'utf8'));
const supportCatalog=JSON.parse(await fs.readFile(path.join(root,'../support-catalog.json'),'utf8'));
const actions=[...new Set([...Object.values(catalog.groups).flat().map(a=>a[0]).filter(a=>!['crouch','idle_relaxed'].includes(a)),'stand_up'])];
const aliases={crouch:'duck',idle_relaxed:'idle'};
const rows=[];
for(const fighter of catalog.fighters)for(const equipment of ['unarmed','armed'])for(const action of actions){
  const id=[fighter.id,equipment,action].join('/'),clip=lib.clips.find(c=>c.id===id);
  rows.push({id,fighter:fighter.id,equipment,action,status:clip?(clip.extractionReview?'extraction-repair-required':clip.review?.status??'exported-review-pending'):'missing',frames:clip?.frames.length??0,data:clip?.data??null});
}
const summary={version:2,aliases,requiredFighterClips:rows.length,exportedFighterClips:rows.filter(r=>r.frames>0).length,
  exportedEffectClips:lib.clips.filter(c=>c.kind==='effect').length,
  exportedProps:lib.clips.filter(c=>c.kind==='prop').length,
  exportedFrames:lib.clips.reduce((n,c)=>n+c.frames.length,0),rows};
await fs.writeFile(path.join(root,'coverage.json'),JSON.stringify(summary,null,2)+'\n');
await fs.writeFile(path.join(root,'coverage.csv'),'id,status,frames,data\n'+rows.map(r=>[r.id,r.status,r.frames,r.data??''].join(',')).join('\n')+'\n');
// Inventory is not approval or integration. Keep those independent in the combined report.
const supportAliases={brann_rod:'brann_pressure_rod',brann_shield:'brann_tower_shield'};
const supportRows=supportCatalog.flatMap(group=>group.actions.map(([action,description,animated])=>{
  const fighter=catalog.fighters.find(f=>action.startsWith(f.id+'-'));
  const name=fighter?action.slice(fighter.id.length+1):(supportAliases[action]??action);
  const clip=lib.clips.find(c=>(fighter?c.id===`effects/${fighter.id}/${name}`:c.id.split('/').at(-1)===name));
  return {id:clip?.id??`${group.kind}/${fighter?.id??group.id}/${name}`,kind:group.kind,group:group.id,
    fighter:fighter?.id??null,action:name,description,animated,status:clip?'exported-review-pending':'missing',
    frames:clip?.frames.length??0,data:clip?.data??null};
}));
for(const clip of lib.clips.filter(c=>c.kind!=='fighter'))if(!supportRows.some(r=>r.id===clip.id))supportRows.push({
  id:clip.id,kind:clip.kind==='effect'?'effects':clip.kind==='prop'?'props':clip.kind,group:'additional-exports',
  fighter:catalog.fighters.find(f=>clip.id.includes('/'+f.id+'/'))?.id??null,action:clip.id.split('/').at(-1),
  description:clip.description,animated:clip.frames.length>1,status:'exported-review-pending',frames:clip.frames.length,data:clip.data});
const review=await fs.readFile(path.join(root,'acceptance.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
const completeRows=[...rows.map(r=>({...r,kind:'fighter'})),...supportRows].map(row=>({...row,
  asset:row.frames?'exported':'missing',artAcceptance:review[row.id]?.artAcceptance??'pending',
  runtime:review[row.id]?.runtime??'not-integrated',evidence:review[row.id]?.evidence??[],
  notes:review[row.id]?.notes??''}));
const integrationTasks=catalog.fighters.flatMap(f=>[
  ['playback','Import clips, choose states, restart one-shots, hold hitstop and match authoritative attack phases'],
  ['anchors','Verify feet, ledge gripping hand, root continuity and both facings'],
  ['sockets','Register hands, muzzle and equipment attachment points per frame'],
  ['effects','Connect fighter-specific effects to gameplay events and test lifetime and reduced flashes'],
  ['browser','Verify moves, interruption, landing, ledges and mirror match in actual Duel'],
].map(([area,description])=>({id:`integration/${f.id}/${area}`,fighter:f.id,description,status:review[`integration/${f.id}/${area}`]?.status??'pending'})));
const report={version:3,requiredFighterClips:rows.length,exportedFighterClips:summary.exportedFighterClips,
  missingFighterClips:rows.filter(r=>r.status==='missing').length,supportAssets:supportRows.length,
  missingSupportAssets:supportRows.filter(r=>r.status==='missing').length,
  scope:'Asset targets include future moves. Exporting art does not implement a gameplay move. Runtime means use of the replacement asset, not absence of existing procedural effects.',
  rows:completeRows,integrationTasks};
await fs.writeFile(path.join(root,'completion.json'),JSON.stringify(report,null,2)+'\n');
const cols=['id','kind','fighter','action','asset','artAcceptance','runtime','frames','data','notes'];
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
await fs.writeFile(path.join(root,'completion.csv'),cols.join(',')+'\n'+completeRows.map(r=>cols.map(k=>csv(r[k])).join(',')).join('\n')+'\n');
const table=catalog.fighters.map(f=>{const rs=rows.filter(r=>r.fighter===f.id);return `| ${f.name} | ${rs.filter(r=>r.frames).length} | ${rs.filter(r=>!r.frames).length} |`;}).join('\n');
const missingSupport=supportRows.filter(r=>!r.frames).map(r=>`- [ ] ${r.id}: ${r.description}`).join('\n');
await fs.writeFile(path.join(root,'COMPLETION.md'),`# Duel asset completion checklist\n\nGenerated by tools/coverage.mjs. [Full filterable checklist](completion.csv), [machine-readable report](completion.json), [motion repairs](MOTION-REVIEW.md), [Ilyra and Brann playable completion](DUO-COMPLETION.md).\n\nThe target is 63 actions in armed and unarmed variants for each fighter. Art targets include moves not yet implemented in gameplay. Exported, art-approved, and integrated are independent fields. Both facings use mirrored playback and require visual verification. Existing procedural effects and older pose atlases are not counted as replacement exports.\n\n| Fighter | Exported clips | Missing clips |\n| --- | ---: | ---: |\n${table}\n\n## Support assets still missing\n\n${missingSupport}\n\n## Acceptance gates for every clip\n\n- [ ] Correct action, chronology, silhouette and character identity.\n- [ ] Equipment retained; unarmed clips have no held weapons.\n- [ ] Clean extraction, transparent gutters and no clipped or joined figures.\n- [ ] Fixed world scale, root continuity and relevant hand/muzzle sockets.\n- [ ] Loop seam or one-shot completion checked at normal and quarter speed.\n- [ ] Left and right facing checked, including ledge grip.\n- [ ] Runtime selection, timing, interruption and hitstop verified in Duel.\n\n## Integration work\n\n${integrationTasks.map(t=>`- [${t.status === "verified" || t.status.endsWith("-verified") ? "x" : " "}] ${t.id}: ${t.description} (${t.status})`).join('\n')}\n`);
console.log(JSON.stringify({...summary,rows:undefined}));
