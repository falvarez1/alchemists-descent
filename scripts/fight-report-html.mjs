// THE FIGHT REPORT, AS A PAGE (docs/arena/TELEMETRY-AND-BALANCE.md 3.4): one self-contained HTML file to read a batch by eye: who wins (with
// intervals), the matchup grid, where each fighter's damage comes from, how each moves, and a TIMELINE of any fight (health of both
// fighters, who hit whom and with what, every ability, how far apart they stood).
//
//   node scripts/fight-report-html.mjs <dir> [--fights 36]          (needs report.json: run fight-analyse.mjs first)
//
// Writes <dir>/report.html. No network, no libraries: inline SVG and a few lines of script.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const dir = process.argv[2];
if (!dir || !existsSync(`${dir}/report.json`)) { console.error('usage: node scripts/fight-report-html.mjs <dir>  (run fight-analyse.mjs first)'); process.exit(2); }
const nFights = Number(process.argv.includes('--fights') ? process.argv[process.argv.indexOf('--fights') + 1] : 36);
const report = JSON.parse(readFileSync(`${dir}/report.json`, 'utf8'));
const index = readFileSync(`${dir}/index.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error);

// ---- choose the fights to embed: the shortest, the longest, the closest, and a spread over pairs ----
const byClose = [...index].sort((a, b) => Math.abs(a.hp[0] - a.hp[1]) - Math.abs(b.hp[0] - b.hp[1]));
const chosen = new Map();
const add = (r) => { if (r && !chosen.has(r.i) && chosen.size < nFights) chosen.set(r.i, r); };
for (const r of [...index].sort((a, b) => a.ticks - b.ticks).slice(0, 3)) add(r);
for (const r of [...index].sort((a, b) => b.ticks - a.ticks).slice(0, 3)) add(r);
for (const r of byClose.slice(0, 4)) add(r);
const seenPair = new Set();
for (const r of index) { const k = `${r.a}|${r.b}`; if (!seenPair.has(k)) { seenPair.add(k); add(r); } }

const fights = [];
for (const r of chosen.values()) {
  const text = readFileSync(`${dir}/${r.file}`, 'utf8');
  const samples = [], events = [];
  let header = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line);
    if (o.k === 'h') header = o;
    else if (o.k === 's') samples.push([o.t, ...o.f.flatMap((f) => [f[0], f[4], f[10]])]); // t, x0, hp0, flags0, x1, hp1, flags1
    else if (o.k === 'e' && (o.e === 'hurt' || o.e === 'ability')) events.push(o.e === 'hurt' ? ['h', o.t, o.src, o.dst, o.taken, o.tag ?? o.source] : ['a', o.t, o.who, o.slot, o.res]);
  }
  fights.push({ i: r.i, a: r.a, b: r.b, seed: r.seed, winner: r.winner, reason: r.reason, ticks: r.ticks, maxHp: header.fighters.map((f) => f.maxHp), samples, events });
}

const data = { report, fights };
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fight report</title>
<style>
:root{--bg:#10171b;--panel:#17222a;--line:#2a3b46;--text:#dfe7e2;--mute:#8da39b;--a:#e0a458;--b:#6bb8d6;--good:#8fd19e;--bad:#e07a6a;--warn:#e6c35c}
@media (prefers-color-scheme: light){:root{--bg:#f4f1ea;--panel:#fffdf8;--line:#d8d1c3;--text:#1f2a2e;--mute:#6c7a76;--a:#b8741a;--b:#2a7ba0;--good:#2f8a4a;--bad:#b84a3a;--warn:#a07a10}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:30px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
.sub{color:var(--mute);margin-bottom:12px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:4px 8px;text-align:right;border-bottom:1px solid var(--line)}th:first-child,td:first-child{text-align:left}
th{color:var(--mute);font-weight:600;position:sticky;top:0;background:var(--bg)}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;margin:8px 0}
.bar{position:relative;height:14px;background:var(--line);border-radius:3px;min-width:140px}.bar i{position:absolute;top:0;bottom:0;border-radius:3px;background:var(--b)}.bar u{position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--text)}
.bar b{position:absolute;top:0;bottom:0;background:var(--b);opacity:.35}.mid{position:absolute;top:-3px;bottom:-3px;left:50%;border-left:1px dashed var(--mute)}
.heat td{text-align:center;font-variant-numeric:tabular-nums}.flag{margin:2px 0}.flag b{color:var(--warn)}select{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:4px;padding:5px 8px;font:inherit;max-width:100%}
svg{width:100%;height:auto;display:block}.legend span{display:inline-block;margin-right:14px}.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.stack{display:flex;height:14px;border-radius:3px;overflow:hidden;min-width:200px;background:var(--line)}.stack span{display:block;height:100%}
</style></head><body><main>
<h1>Fight report</h1><div class="sub" id="sub"></div>
<h2>Strength</h2><div id="strength"></div>
<h2>Matchups</h2><div class="sub">Row beats column, share of fights. Both sides are run, so a side or a slot advantage cancels in a cell.</div><div id="heat"></div>
<h2>Where the damage comes from</h2><div class="legend" id="legend"></div><div id="damage"></div>
<h2>Style: how each fighter moves and uses its kit</h2><div id="style"></div>
<h2>Flags</h2><div id="flags"></div>
<h2>A fight, tick by tick</h2><div class="sub">Pick one. Top: health (the left fighter amber, the right blue); marks: Z and T presses (a ring when refused), and a tick for every blow that landed, its height the damage. Bottom: where each stood across the room.</div>
<select id="pick"></select><div class="card"><svg id="tl" viewBox="0 0 1000 330"></svg><div class="sub" id="tlinfo"></div></div>
</main><script>
const D=${JSON.stringify(data)};const R=D.report;
const $=(id)=>document.getElementById(id);const pct=(x)=>Math.round(x*100)+'%';const f1=(x)=>Math.round(x*10)/10;
const short=(id)=>id.split('-')[0];
$('sub').textContent=R.fights+' fights, '+R.ko+' knockouts, '+R.timeout+' timeouts, median '+f1(R.medianSeconds)+' s'+(R.run&&R.run.git?', git '+R.run.git+(R.run.dirty?'+dirty':''):'')+(R.run&&R.run.overrides&&Object.keys(R.run.overrides).length?', '+Object.keys(R.run.overrides).length+' overrides':'');
// strength
let h='<table><tr><th>fighter</th><th>win rate (95%)</th><th></th><th>left</th><th>right</th><th>DPS</th><th>median win</th><th>median loss</th></tr>';
for(const r of R.fighters){h+='<tr><td>'+r.id+'</td><td><b>'+pct(r.winRate)+'</b> ('+pct(r.lo)+'-'+pct(r.hi)+')</td><td><div class="bar"><b style="left:'+r.lo*100+'%;width:'+(r.hi-r.lo)*100+'%"></b><i style="left:0;width:'+r.winRate*100+'%"></i><span class="mid"></span></div></td><td>'+pct(r.left)+'</td><td>'+pct(r.right)+'</td><td>'+f1(r.dps)+'</td><td>'+f1(r.ttkWin)+' s</td><td>'+f1(r.ttkLose)+' s</td></tr>';}
$('strength').innerHTML=h+'</table>';
// heat
const ids=R.fighters.map(r=>r.id).sort();let t='<table class="heat"><tr><th></th>'+ids.map(i=>'<th>'+short(i)+'</th>').join('')+'</tr>';
for(const a of ids){t+='<tr><td>'+short(a)+'</td>';for(const b of ids){const m=R.matrix[a]&&R.matrix[a][b];if(a===b||!m||!m.n){t+='<td>.</td>';continue;}const p=m.wins/m.n;const c=p>=.5?'rgba(143,209,158,'+(Math.abs(p-.5)*1.6).toFixed(2)+')':'rgba(224,122,106,'+(Math.abs(p-.5)*1.6).toFixed(2)+')';t+='<td style="background:'+c+'">'+Math.round(p*100)+'</td>';}t+='</tr>';}
$('heat').innerHTML=t+'</table>';
// damage
const TAGS=[['spell','#e0a458'],['kick','#c97b5b'],['ability.tactical','#6bb8d6'],['ability.ultimate','#8d7bd6'],['passive','#8fd19e'],['world','#8da39b']];
$('legend').innerHTML=TAGS.map(([k,c])=>'<span><i class="dot" style="background:'+c+'"></i>'+k+'</span>').join('');
let dm='<table><tr><th>fighter</th><th>share of its damage</th><th>per fight</th></tr>';
for(const r of R.fighters){const tags=r.tags||{};const tot=Object.values(tags).reduce((s,v)=>s+v,0)||1;dm+='<tr><td>'+r.id+'</td><td><div class="stack">'+TAGS.map(([k,c])=>'<span title="'+k+' '+f1(tags[k]||0)+'" style="width:'+((tags[k]||0)/tot*100)+'%;background:'+c+'"></span>').join('')+'</div></td><td>'+f1(tot)+'</td></tr>';}
$('damage').innerHTML=dm+'</table>';
// style
let st='<table><tr><th>fighter</th><th>tactical per fight</th><th>refused</th><th>ultimate per fight</th><th>speed</th><th>airborne</th><th>gap to foe</th></tr>';
for(const r of R.fighters)st+='<tr><td>'+r.id+'</td><td>'+f1(r.abil.tactical.fired)+'</td><td>'+f1(r.abil.tactical.refused)+'</td><td>'+f1(r.abil.ultimate.fired)+'</td><td>'+f1(r.speed)+'</td><td>'+pct(r.air)+'</td><td>'+Math.round(r.gap)+'</td></tr>';
$('style').innerHTML=st+'</table>';
$('flags').innerHTML=(R.flags.length||R.lopsided.length)?R.flags.map(f=>'<div class="flag"><b>'+f.id+'</b> '+f.kind+': '+f.detail+'</div>').join('')+R.lopsided.map(m=>'<div class="flag"><b>'+m.a+' vs '+m.b+'</b> lopsided: '+m.aWins+'/'+m.n+'</div>').join(''):'<div class="sub">None.</div>';
// timeline
const sel=$('pick');D.fights.forEach((f,i)=>{const o=document.createElement('option');o.value=i;o.textContent=f.a+' (left) vs '+f.b+' (right), seed '+f.seed+': '+(f.winner===null?'draw':(f.winner===0?f.a:f.b)+' wins')+' in '+f1(f.ticks/60)+' s';sel.appendChild(o);});
function draw(i){const f=D.fights[i];const W=1000,H1=210,top=14,left=40,right=10,pw=W-left-right;const T=Math.max(60,f.ticks);const X=(t)=>left+t/T*pw;
 const hy=(hp,m)=>top+(1-Math.max(0,hp)/m)*(H1-top-6);let s='';
 for(let k=0;k<=4;k++){const y=top+k*(H1-top-6)/4;s+='<line x1="'+left+'" x2="'+(W-right)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)"/>';}
 for(let sec=0;sec<=T/60;sec+=Math.max(1,Math.round(T/60/10))){s+='<text x="'+X(sec*60)+'" y="'+(H1+12)+'" fill="var(--mute)" font-size="10" text-anchor="middle">'+sec+'s</text>';}
 const cols=['var(--a)','var(--b)'];
 for(let k=0;k<2;k++){let d='';f.samples.forEach((p,j)=>{const hp=p[2+k*3];d+=(j?'L':'M')+X(p[0]).toFixed(1)+' '+hy(hp,f.maxHp[k]).toFixed(1);});s+='<path d="'+d+'" fill="none" stroke="'+cols[k]+'" stroke-width="2.2"/>';}
 // events
 for(const e of f.events){if(e[0]==='h'&&e[2]>=0){const dmg=e[4];const y0=hy(f.samples.reduce((a,p)=>a,0),1);const col=cols[e[2]];s+='<line x1="'+X(e[1])+'" x2="'+X(e[1])+'" y1="'+(H1-6)+'" y2="'+(H1-6-Math.min(60,dmg*3))+'" stroke="'+col+'" stroke-width="2" opacity=".85"><title>'+f1(dmg)+' from '+(e[2]===0?f.a:f.b)+' ('+e[5]+')</title></line>';}
  else if(e[0]==='a'){const col=cols[e[2]];const y=22+e[2]*16;if(e[4]==='refused')s+='<circle cx="'+X(e[1])+'" cy="'+y+'" r="4" fill="none" stroke="'+col+'" opacity=".6"><title>'+(e[3])+' refused</title></circle>';else s+='<text x="'+X(e[1])+'" y="'+(y+4)+'" fill="'+col+'" font-size="12" font-weight="700" text-anchor="middle">'+(e[3]==='tactical'?'Z':'T')+'<title>'+e[3]+' '+e[4]+'</title></text>';}}
 // positions
 const py0=H1+30,ph=84;s+='<text x="4" y="'+(py0+10)+'" fill="var(--mute)" font-size="10">x</text>';
 for(let k=0;k<2;k++){let d='';f.samples.forEach((p,j)=>{d+=(j?'L':'M')+X(p[0]).toFixed(1)+' '+(py0+ph-((p[1+k*3]-520)/560)*ph).toFixed(1);});s+='<path d="'+d+'" fill="none" stroke="'+cols[k]+'" stroke-width="1.6"/>';}
 s+='<text x="'+left+'" y="10" fill="var(--a)" font-size="11">'+f.a+' '+Math.round(f.maxHp[0])+' hp</text><text x="'+(W-right)+'" y="10" fill="var(--b)" font-size="11" text-anchor="end">'+f.b+' '+Math.round(f.maxHp[1])+' hp</text>';
 $('tl').innerHTML=s;
 const hurts=f.events.filter(e=>e[0]==='h');const by=(k)=>hurts.filter(e=>e[2]===k).reduce((s,e)=>s+e[4],0);const ab=(k,sl)=>f.events.filter(e=>e[0]==='a'&&e[2]===k&&e[3]===sl&&e[4]==='fired').length;
 $('tlinfo').textContent=f.a+' dealt '+f1(by(0))+', used Z '+ab(0,'tactical')+'x and T '+ab(0,'ultimate')+'x.  '+f.b+' dealt '+f1(by(1))+', used Z '+ab(1,'tactical')+'x and T '+ab(1,'ultimate')+'x.  '+(f.reason==='ko'?'Knockout.':'Time ran out.');}
sel.onchange=()=>draw(+sel.value);if(D.fights.length)draw(0);
</script></body></html>`;
writeFileSync(`${dir}/report.html`, html);
console.log(`${dir}/report.html: ${fights.length} fights embedded, ${(html.length / 1024).toFixed(0)} KB`);
