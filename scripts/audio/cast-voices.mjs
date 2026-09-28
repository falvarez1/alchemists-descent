// Cast the story's voices: read the same lines with each candidate for Pell
// and Matron Ash, master them, and score what we cannot hear — how crisp the
// S sounds are (the Docent was re-cast for a lisp baked into its voice), the
// pace, the level. Results go to audition/voices/cast-*.mp3 (outside public/,
// never shipped) and scripts/audio/cast-report.json; the audition page lists them.
//
//   ELEVENLABS_API_KEY_FILE=… AUDIO_CACHE_DIR=… AUDIO_LOG_NAME=generation-log.voice.jsonl \
//   AUDIO_BUDGET_CREDITS=<prior voice spend + allowance> node scripts/audio/cast-voices.mjs [--role pell|ash] [--dry]
//
// Library voices must be in the account to be spoken; a candidate that is not
// is added (one voice slot) as "BW cast — <role> — <name>".

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LedgerBudget, loadApiKey, measure, speech } from './elevenlabs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'audition', 'voices');
const REPORT = join(ROOT, 'scripts', 'audio', 'cast-report.json');
const API = 'https://api.elevenlabs.io';
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes('--dry');

/** Candidates: library voices (voiceId + owner) or ones already in the account (owner null). */
export const CANDIDATES = {
  pell: [
    { key: 'cameron', name: 'Cameron — young British (characters)', voiceId: 'FiQVBfstqvAXNba9nkRV', owner: 'd9cf88409e4a49d33b5585b33a518c53bbdfd599e359c105abcdc120395a5711' },
    { key: 'john', name: 'John — fresh, natural, approachable', voiceId: 'd8Hdz9ue70n2o0EmThd6', owner: 'b5a8031315ff2dfae55a17d3d8aa7e82e4af10ebb4649e33fea26f710a05005c' },
    { key: 'henry', name: 'Henry — expressive, character voices', voiceId: 'KP6QbSvtyKSTfuh4UzcQ', owner: '3d30f2332cefa6a2059a85a2fc3a98187994399deb3a7dc54cd99382f86ca08e' },
    { key: 'luca', name: 'Luca — calm, clear, 24', voiceId: '7tUJ0eKWdVAR5YodX8RL', owner: '182d8c1ee6b8ae1a23443278be0d0bd8c652e4990ff63caa2525e34cadcf032f' },
    { key: 'stephen', name: 'Stephen — well spoken, kind', voiceId: 'RbNTU8eTHcsao6T0f1ve', owner: 'a6d1146a70a6e9a0faba0e0067c98d8cae19576a963fb3f894438129adbdebbd' },
  ],
  ash: [
    { key: 'beatrice', name: 'Beatrice — mature, gentle (British)', voiceId: 'kkPJzQOWz2Oz9cUaEaQd', owner: 'e21da557bd3d3d214ca0cd46cb06720331c223a478ee711c3b62b8965330ec9d' },
    { key: 'maria', name: 'Maria Moody — grandmotherly storykeeper', voiceId: 'wGcFBfKz5yUQqhqr0mVy', owner: '38ce59162eff3a60d0f238a254659263b013e077722cc3c4b152a249ee9ce83a' },
    { key: 'morganna', name: 'Seer Morganna — old, wise', voiceId: '7NsaqHdLuKNFvEfjpUno', owner: 'a42905fd2095e55c89320aa75143b885e3ccd020577c280c8c0d0d022f3cfe44' },
    { key: 'eleanor', name: 'Eleanor — gracious, older British', voiceId: '2qQJWjw5XdG80GreshqG', owner: '64cbc624eb5aab4e95a968e1f41d75402277cca6e549036ed17e56ea33bbbc9e' },
  ],
};

/** The same words for every candidate of a role (with the tags the game will use). */
export const CAST_LINES = {
  pell: [
    { id: 'duck', text: '[nervous] Oh! Oh, thank goodness. You’re a person. Sorry. I’ve been talking to a duck all week.' },
    { id: 'map', text: 'Pell. Guild surveyor. I came down a year ago to finish the map, and I have very nearly finished being frightened.' },
  ],
  ash: [
    { id: 'greet', text: '[softly] Come in, little breath. We are the Old Ones. We were the Guild, once. Now we are what the Works kept.' },
  ],
};

const MODEL = 'eleven_v3';
const SETTINGS = { stability: 0.5 };

function ffmpeg(argv, binary = false) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...argv], binary ? { maxBuffer: 1 << 28 } : { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-400)}`);
  return binary ? r.stdout : (r.stderr ?? '');
}

/** Trim, two-pass loudness to -17 LUFS, mono (the narrator's mastering). */
export function masterSpeech(input, output, extraFilter = '') {
  mkdirSync(dirname(output), { recursive: true });
  const trim = 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.12,areverse';
  const pre = extraFilter ? `${trim},${extraFilter}` : trim;
  const probe = ffmpeg(['-i', input, '-af', `${pre},loudnorm=I=-17:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(probe.slice(probe.lastIndexOf('{'), probe.lastIndexOf('}') + 1));
  const norm = `loudnorm=I=-17:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  ffmpeg(['-y', '-v', 'error', '-i', input, '-af', `${pre},${norm}`, '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '96k', output]);
  return output;
}

/**
 * Sibilance: the share of voiced 23 ms frames whose energy above 3.5 kHz
 * (to 12 kHz) outweighs everything below — an S or a SH carries it; a lisped
 * S smears into the mids and scores low. Per second of speech, so lines of
 * different lengths compare.
 */
export function sibilance(file) {
  const pcm = ffmpeg(['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '32000', 'pipe:1'], true);
  const x = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  const N = 1024, sr = 32000;
  const lo = Math.round((3500 / sr) * N), hi = Math.round((12000 / sr) * N);
  const re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0, sib = 0, voiced = 0;
  for (let off = 0; off + N <= x.length; off += N / 2) {
    let e = 0;
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); re[i] = x[off + i] * w; im[i] = 0; e += re[i] * re[i]; }
    frames++;
    if (e < 0.02) continue;
    voiced++;
    fft(re, im);
    let high = 0, low = 0;
    for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; if (k >= lo && k <= hi) high += p; else if (k < lo) low += p; }
    if (high > low) sib++;
  }
  const seconds = x.length / sr;
  return { sibilantPerSecond: +(sib / seconds).toFixed(2), voicedShare: +(voiced / Math.max(1, frames)).toFixed(2) };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

async function accountVoices() {
  const res = await fetch(new URL(API + '/v2/voices?page_size=100'), { headers: { 'xi-api-key': loadApiKey() } });
  if (!res.ok) throw new Error(`voices -> ${res.status}`);
  return (await res.json()).voices ?? [];
}

async function addVoice(c, role) {
  const res = await fetch(new URL(`${API}/v1/voices/add/${c.owner}/${c.voiceId}`), {
    method: 'POST', headers: { 'xi-api-key': loadApiKey(), 'content-type': 'application/json' }, body: JSON.stringify({ new_name: `BW cast — ${role} — ${c.key}` }),
  });
  if (!res.ok) throw new Error(`add ${c.key} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).voice_id ?? c.voiceId;
}

async function main() {
  const roles = option('role') ? [option('role')] : Object.keys(CANDIDATES);
  const chars = roles.reduce((s, r) => s + CANDIDATES[r].length * CAST_LINES[r].reduce((a, l) => a + l.text.length + 10, 0), 0);
  console.log(`${roles.join(', ')}: ~${chars} credits if nothing is cached.`);
  if (dry) return;
  const budget = new LedgerBudget(['tts']);
  console.log(`prior logged voice spend ${budget.start}, cap ${budget.cap}`);
  const mine = await accountVoices();
  const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : {};
  for (const role of roles) {
    report[role] = [];
    for (const c of CANDIDATES[role]) {
      let voiceId = c.voiceId;
      if (!mine.some(v => v.voice_id === voiceId)) {
        voiceId = await addVoice(c, role);
        console.log(`  added ${c.key} to the account`);
      }
      const row = { key: c.key, name: c.name, voiceId, lines: [] };
      for (const line of CAST_LINES[role]) {
        const res = await speech({ voiceId, text: line.text, modelId: MODEL, voiceSettings: SETTINGS }, budget);
        const out = join(OUT, `cast-${role}-${c.key}-${line.id}.mp3`);
        masterSpeech(res.file, out);
        const m = measure(out);
        const s = sibilance(out);
        row.lines.push({ id: line.id, seconds: +m.duration.toFixed(2), charsPerSecond: +(line.text.replace(/\[[^\]]*\]\s*/g, '').length / m.duration).toFixed(1), ...s, url: `/audition/voices/cast-${role}-${c.key}-${line.id}.mp3`, cached: res.cached });
      }
      report[role].push(row);
      console.log(`  ${role} ${c.key.padEnd(9)} ${row.lines.map(l => `${l.id}: ${l.seconds}s ${l.charsPerSecond} ch/s sib ${l.sibilantPerSecond}/s`).join(' · ')}`);
    }
  }
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(`spent this run: ${budget.spent}; wrote ${REPORT}`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('cast-voices.mjs')) await main();
