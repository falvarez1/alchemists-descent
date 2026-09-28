// Browse ElevenLabs voices for casting (free: no credits are spent here).
//
//   ELEVENLABS_API_KEY_FILE=… node scripts/audio/voice-library.mjs mine
//   ELEVENLABS_API_KEY_FILE=… node scripts/audio/voice-library.mjs search "young british" --gender male --age young --accent british
//
// Prints each voice's id, name, labels and preview URL; never the key.

import { loadApiKey } from './elevenlabs.mjs';

const API = 'https://api.elevenlabs.io';
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

async function get(path, query = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'xi-api-key': loadApiKey() } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const mode = args[0] ?? 'mine';
if (mode === 'mine') {
  const out = await get('/v2/voices', { page_size: 100 });
  for (const v of out.voices ?? []) console.log(`${v.voice_id}  ${v.category.padEnd(12)} ${v.name}  ${JSON.stringify(v.labels ?? {})}`);
} else if (mode === 'search') {
  const out = await get('/v1/shared-voices', {
    page_size: Number(option('n') ?? 30), search: args[1], gender: option('gender'), age: option('age'), accent: option('accent'),
    language: 'en', use_cases: option('use'), sort: option('sort') ?? 'trending',
  });
  for (const v of out.voices ?? []) {
    console.log(`${v.voice_id}  owner ${v.public_owner_id}  ${v.name} — ${v.gender}/${v.age}/${v.accent} · ${v.use_case ?? ''} · ${v.descriptive ?? ''} · used ${v.usage_character_count_1y ?? '?'}`);
    if (v.description) console.log(`    ${String(v.description).slice(0, 200).replace(/\s+/g, ' ')}`);
  }
} else {
  console.log('usage: voice-library.mjs mine | search "<words>" [--gender] [--age] [--accent] [--use] [--n]');
}
