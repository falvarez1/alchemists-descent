#!/usr/bin/env node
// Regenerate the cue table in docs/AUDIO.md (between the cue-table markers)
// from the catalog, the prompt table, the mastering report and a scan of
// src/ for what triggers each cue. `--check` fails when the doc is stale.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_PROMPTS } from './sfx-prompts.mjs';
import { SFX_CATEGORIES, SFX_CUES, TEA_STAGE_SFX, FLOOR_BEDS } from '../../src/content/audio/sfxCues.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DOC = join(ROOT, 'docs', 'AUDIO.md');
const report = JSON.parse(readFileSync(join(HERE, 'sfx-report.json'), 'utf8'));
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const src = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.ts') && !f.includes(join('content', 'audio')));

const triggers = new Map();
const add = (id, what) => { if (!SFX_CUES[id]) return; const s = triggers.get(id) ?? new Set(); s.add(what); triggers.set(id, s); };
for (const f of src) {
  const text = readFileSync(f, 'utf8').replace(/\r/g, '');
  const name = basename(f, '.ts');
  for (const m of text.matchAll(/\.sfx\(\s*'([^']+)'/g)) add(m[1], name);
  for (const m of text.matchAll(/\.sfx\([^)]*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) { add(m[1], name); add(m[2], name); }
  for (const m of text.matchAll(/`body\.(impact|smash)\.\$\{/g)) for (const mat of ['wood', 'stone', 'metal']) add(`body.${m[1]}.${mat}`, name);
  // Cue ids carried as data (e.g. ElementalCritFx.sfx) and played by a shared call.
  for (const m of text.matchAll(/\bsfx: '([^']+)'/g)) add(m[1], name);
}
// AudioApi presets implemented by the sampled engine.
const engine = readFileSync(join(ROOT, 'src', 'audio', 'SfxEngine.ts'), 'utf8').replace(/\r/g, '');
// One chunk per override (one-liners included): from `override name(` to the next.
for (const chunk of engine.split('\n  override ').slice(1)) {
  const name = /^(\w+)\(/.exec(chunk)?.[1];
  if (!name || ['ensure', 'toggle', 'dispose', 'stinger'].includes(name)) continue;
  const body = chunk.split('\n  // ---')[0];
  for (const id of body.matchAll(/'((?:[a-z]+\.)+[a-zA-Z]+)'/g)) add(id[1], `audio.${name}()`);
  if (name === 'footstep') for (const s of ['stone', 'soft', 'wet', 'wood']) add(`player.step.${s}`, 'audio.footstep()');
}
for (const k of ['alchemy', 'phialCrack', 'phialFill', 'victory', 'fallen', 'shutter']) add(`stinger.${k}`, `audio.stinger('${k}') ← Stingers`);
for (const id of Object.keys(SFX_CUES)) {
  const m = /^creature\.([a-z]+)\.(idle|alert|hurt|death|attack|step|hop)$/.exec(id);
  if (m) add(id, `creature(${m[1]}, '${m[2]}')`);
}
for (const [stage, id] of Object.entries(TEA_STAGE_SFX)) add(id, `Tea Engine stage ${stage}`);
for (const [floor, id] of Object.entries(FLOOR_BEDS)) add(id, `${floor} bed (AudioDirector)`);
const habitat = readFileSync(join(ROOT, 'src', 'audio', 'HabitatAudio.ts'), 'utf8');
for (const m of habitat.matchAll(/'((?:spell|proj)\.[a-z.]+\.loop)'/g)) add(m[1], 'HabitatAudio (in flight)');
for (const m of habitat.matchAll(/id: '(mat\.[a-z]+\.loop)'/g)) add(m[1], 'HabitatAudio (material scan)');
const ui = readFileSync(join(ROOT, 'src', 'audio', 'UiSounds.ts'), 'utf8');
for (const m of ui.matchAll(/'(ui\.[a-z.]+)'/g)) add(m[1], 'UiSounds');

const esc = (s) => String(s).replace(/\|/g, '\\|');
const rows = [];
let lastPack = null;
const ids = Object.keys(SFX_CUES).sort((a, b) => SFX_CUES[a].pack.localeCompare(SFX_CUES[b].pack) || a.localeCompare(b));
for (const id of ids) {
  const cue = SFX_CUES[id], cat = SFX_CATEGORIES[cue.cat], r = report[id];
  if (cue.pack !== lastPack) { rows.push(`| **${cue.pack}** | | | | | |`); lastPack = cue.pack; }
  const secs = r?.takes?.map((t) => t.sec?.toFixed(2)).join(' / ') ?? '';
  const loop = cue.loop ? ' ⟲' : '';
  rows.push(`| \`${id}\`${loop} | ${cue.cat} · ${cue.bus ?? cat.bus} | ${(cat.gain * (cue.gain ?? 1)).toFixed(2)} | ${secs} | ${esc([...(triggers.get(id) ?? ['—'])].join(', '))} | ${esc(SFX_PROMPTS[id].p)} |`);
}
const table = ['| cue | family · bus | gain | takes (s) | triggered by | prompt |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');

const doc = readFileSync(DOC, 'utf8').replace(/\r/g, '');
const START = '<!-- cue-table:start -->', END = '<!-- cue-table:end -->';
const next = doc.replace(new RegExp(`${START}[\\s\\S]*?${END}`), `${START}\n${table}\n${END}`);
if (process.argv.includes('--check')) {
  if (next !== doc) { console.error('docs/AUDIO.md cue table is stale: run node scripts/audio/sfx-doc.mjs'); process.exit(1); }
  console.log('docs/AUDIO.md cue table is current.');
} else {
  writeFileSync(DOC, next);
  const untriggered = ids.filter((id) => !triggers.has(id));
  console.log(`wrote ${ids.length} rows${untriggered.length ? `; no trigger found for: ${untriggered.join(', ')}` : ''}`);
}
