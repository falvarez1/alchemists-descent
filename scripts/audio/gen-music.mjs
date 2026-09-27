// Generate the score (scripts/audio/music-prompts.mjs) with ElevenLabs music,
// master it, and write the manifest the game reads.
//
//   ELEVENLABS_API_KEY_FILE=… AUDIO_CACHE_DIR=… AUDIO_LOG_NAME=generation-log.music.jsonl \
//   AUDIO_BUDGET_CREDITS=60000 node scripts/audio/gen-music.mjs [--only title,bellows] [--dry] [--concurrency 2]
//
// Responses are cached by request (elevenlabs.mjs), so a re-run only pays for
// cues whose plan changed; mastering and the manifest are rebuilt every time.
// Mastering: leading silence trimmed to a quarter second, two-pass EBU R128
// loudness to -16 LUFS / -1.5 dBTP (one linear gain, so the dynamics the model
// wrote survive; a few intimate cues sit lower), stereo VBR MP3. Musical tails
// are never trimmed: the director reads measured loop points instead.
//
// Output: public/audio/music/<id>.mp3 and src/content/audio/score.generated.ts.

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Budget, music, measure, subscription } from './elevenlabs.mjs';
import { CUES, MUSIC_MODEL, cueSeconds, orderedCues } from './music-prompts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'public', 'audio', 'music');
const MANIFEST = join(ROOT, 'src', 'content', 'audio', 'score.generated.ts');
/** LAME VBR quality: V6 averages ~115 kbps on this material (sparse cues far less). */
const VBR_QUALITY = process.env.MUSIC_VBR ?? '6';
const TARGET_LUFS = -16;
const TARGET_TP = -1.5;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const only = option('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const concurrency = Number(option('concurrency') ?? 2);
const dry = flag('dry');

function ffmpeg(argv) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...argv], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg ${argv.join(' ')} failed: ${r.stderr?.slice(-800)}`);
  return r.stderr ?? '';
}

/** Two-pass loudnorm: measure, then apply as one linear gain (no pumping on music). */
function master(input, output, lufs = TARGET_LUFS) {
  mkdirSync(dirname(output), { recursive: true });
  // Leading dead air goes (a quarter second is kept); the tail is the music's own and stays.
  const head = 'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.25';
  const probe = ffmpeg(['-i', input, '-af', `${head},loudnorm=I=${lufs}:TP=${TARGET_TP}:LRA=20:print_format=json`, '-f', 'null', '-']);
  const json = JSON.parse(probe.slice(probe.lastIndexOf('{'), probe.lastIndexOf('}') + 1));
  const filter = `loudnorm=I=${lufs}:TP=${TARGET_TP}:LRA=20:measured_I=${json.input_i}:measured_TP=${json.input_tp}` +
    `:measured_LRA=${json.input_lra}:measured_thresh=${json.input_thresh}:offset=${json.target_offset}:linear=true`;
  ffmpeg(['-y', '-v', 'error', '-i', input, '-af', `${head},${filter}`, '-ar', '44100', '-ac', '2', '-codec:a', 'libmp3lame', '-q:a', VBR_QUALITY, output]);
  return { inputLufs: Number(json.input_i), normalization: json.normalization_type };
}

/**
 * Where a loop re-enters and where it should leave. The head is the leading
 * near-silence. The way out is the last moment the short-term loudness (3 s
 * window) is still within LOOP_DROP_LU of the whole cue (tension and boss
 * loops are held to 10 LU; exploration keeps its quiet passages): a model that was
 * asked for "no ending" still sometimes trails off into a quiet drone, and a
 * hunted loop must not spend half its length there. The director finishes its
 * loop crossfade by that point; the tail after it is simply never heard in a
 * loop (a one-shot plays it whole).
 */
const LOOP_DROP_LU = { tension: 10, boss: 10 };
function loopPoints(file, duration, integrated, role) {
  const drop = LOOP_DROP_LU[role] ?? 20;
  const silence = ffmpeg(['-i', file, '-af', 'silencedetect=n=-48dB:d=0.25', '-f', 'null', '-']);
  const starts = [...silence.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...silence.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const headSec = starts.length && starts[0] <= 0.05 && ends.length ? ends[0] : 0;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.S:file=-', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 << 20 });
  const series = [];
  let t = 0;
  for (const line of (r.stdout ?? '').split(/\r?\n/)) {
    const time = line.match(/pts_time:([\d.]+)/);
    if (time) t = Number(time[1]);
    const s = line.match(/lavfi\.r128\.S=(-?[\d.]+)/);
    if (s) series.push([t, Number(s[1])]);
  }
  let loopOut = duration;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i][1] >= integrated - drop) { loopOut = Math.min(duration, series[i][0]); break; }
  }
  return { headSec: round(headSec), tailSec: round(Math.max(0, duration - loopOut)) };
}

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

function compositionPlan(cue, songIds) {
  const chunks = cue.chunks.map((c) => ({ ...c }));
  if (cue.condition) {
    const songId = songIds.get(cue.condition.cue);
    if (!songId) throw new Error(`${cue.id}: the cue it is conditioned on (${cue.condition.cue}) has no stored song id`);
    chunks[0].conditioning_ref = { song_id: songId, range: { start_ms: cue.condition.startMs, end_ms: cue.condition.endMs } };
    chunks[0].condition_strength = cue.condition.strength;
  }
  return { chunks };
}

async function main() {
  const budget = new Budget();
  const cues = orderedCues(CUES);
  const total = cues.reduce((s, c) => s + cueSeconds(c), 0);
  console.log(`${cues.length} cues, ${total.toFixed(0)} s of music; estimate ~${Math.round(total * 26.5)} credits if nothing is cached.`);
  if (dry) {
    for (const cue of cues) console.log(`  ${cue.id.padEnd(18)} ${cueSeconds(cue).toFixed(0).padStart(4)} s  ${cue.key}, ${cue.bpm} BPM${cue.condition ? `  <- ${cue.condition.cue} (${cue.condition.strength})` : ''}`);
    return;
  }
  const start = await budget.init();
  console.log(`subscription: ${start.used}/${start.limit} used (${start.tier}); session cap ${budget.cap}`);

  const songIds = new Map();
  const results = new Map();
  const pending = new Set(cues.map((c) => c.id));
  const running = new Map();
  const wanted = (cue) => !only || only.includes(cue.id);

  const cacheOnly = new Budget(0);
  const runCue = async (cue, spendFrom) => {
    const t0 = Date.now();
    const plan = compositionPlan(cue, songIds);
    const res = await music({ compositionPlan: plan, modelId: MUSIC_MODEL, storeForInpainting: true, outputFormat: 'mp3_44100_192', variant: cue.variant ?? 0 }, spendFrom);
    if (res.meta?.songId) songIds.set(cue.id, res.meta.songId);
    const out = join(OUT_DIR, `${cue.id}.mp3`);
    const mastered = master(res.file, out, cue.lufs ?? TARGET_LUFS);
    const m = measure(out);
    const bounds = loopPoints(out, m.duration, m.lufs, cue.role);
    const bytes = statSync(out).size;
    results.set(cue.id, { cue, seconds: round(m.duration), lufs: round(m.lufs, 1), truePeak: round(m.truePeak, 1), bytes, ...bounds, cached: res.cached });
    console.log(`  ${res.cached ? 'cached' : 'NEW   '} ${cue.id.padEnd(18)} ${m.duration.toFixed(1)} s  ${m.lufs} LUFS  TP ${m.truePeak}  ${(bytes / 1024).toFixed(0)} KB` +
      `  head ${bounds.headSec}s tail ${bounds.tailSec}s  (raw ${mastered.inputLufs} LUFS, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  };

  // Dependency-aware pool: a cue starts once the cue it is conditioned on has its song id.
  while (pending.size > 0 || running.size > 0) {
    for (const id of [...pending]) {
      if (running.size >= concurrency) break;
      const cue = cues.find((c) => c.id === id);
      const dep = cue.condition?.cue;
      if (dep && (pending.has(dep) || running.has(dep))) continue;
      pending.delete(id);
      // Cues outside --only resolve from the cache alone (a zero budget refuses any paid call),
      // so their song ids and manifest rows still exist.
      const p = runCue(cue, wanted(cue) ? budget : cacheOnly).catch((error) => {
        console.error(`  ${wanted(cue) ? 'FAILED' : 'not cached'} ${cue.id}: ${error.message.slice(0, 200)}`);
        results.set(cue.id, { cue, error: error.message });
      }).finally(() => running.delete(id));
      running.set(id, p);
    }
    if (running.size > 0) await Promise.race(running.values());
    else if (pending.size > 0) {
      // Everything left depends on a failed cue.
      for (const id of pending) console.error(`  SKIPPED ${id}: its reference failed`);
      break;
    }
  }

  writeManifest(cues, results);
  const spent = await budget.refresh();
  const end = await subscription();
  const bytes = [...results.values()].reduce((s, r) => s + (r.bytes ?? 0), 0);
  console.log(`music payload ${(bytes / 1048576).toFixed(2)} MB; counter ${end.used} (session delta ${spent}, may lag)`);
}

function writeManifest(cues, results) {
  const rows = cues.filter((c) => results.get(c.id)?.bytes).map((c) => {
    const r = results.get(c.id);
    return {
      id: c.id, url: `audio/music/${c.id}.mp3`, label: c.label, group: c.group, role: c.role, floor: c.floor ?? null, loop: c.loop,
      key: c.key, bpm: c.bpm, seconds: r.seconds, headSec: r.headSec, tailSec: r.tailSec, lufs: r.lufs, bytes: r.bytes, summary: c.summary,
    };
  });
  const body = `// GENERATED by scripts/audio/gen-music.mjs — do not edit by hand.
// The score's tracks as mastered: timing (s), loudness, size, and the prompt summary for the audition page.
import type { ScoreTrack } from '@/content/audio/scoreTypes';

export const SCORE_TRACKS: readonly ScoreTrack[] = ${JSON.stringify(rows, null, 2)};
`;
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, body.replace(/"([a-zA-Z]+)":/g, '$1:'), 'utf8');
  console.log(`wrote ${rows.length} tracks to ${MANIFEST}`);
}

await main();
