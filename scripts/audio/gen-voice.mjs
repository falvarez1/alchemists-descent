// Voice the narrator: design the candidate voices, record the audition sample
// with each, then read every line of scripts/audio/voice-lines.mjs with the
// chosen narrator and write the manifest the game reads.
//
//   ELEVENLABS_API_KEY_FILE=… AUDIO_CACHE_DIR=… AUDIO_LOG_NAME=generation-log.voice.jsonl \
//   AUDIO_BUDGET_CREDITS=30000 node scripts/audio/gen-voice.mjs [--voice docent|george|<voice_id>] [--design] [--dry]
//
// Re-voicing the whole game is one command: change NARRATOR below (or pass
// --voice). Every line is cached by (voice, text, take), so switching back is free.
//
// Output: public/audio/voice/<key>.mp3 (+ <key>-2.mp3 for second takes),
// public/audio/voice/candidates/*.mp3, and src/content/audio/narration.generated.ts.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Budget, CACHE_DIR, createVoice, designVoice, measure, speech, subscription } from './elevenlabs.mjs';
import { SAMPLE_LINE, buildCatalog } from './voice-lines.mjs';

/**
 * THE narrator: 'daniel' (library), 'docent' (designed for this game) or
 * 'george' (premade), or any voice id. The Docent read its S sounds soft and
 * mushy (a lisp in the voice itself, measured on the raw 192 kbps output), so
 * Daniel took over on 2026-09-27; the Docent's lines stay cached if wanted back.
 */
export const NARRATOR = 'daniel';

/**
 * Lines recorded twice (the title, the arrivals, the victory) play take 1 in the
 * game. To prefer the other take after an audition, name the line's key here:
 * { '0b348985': 2 }. A re-run (free: everything is cached) rewrites the manifest.
 */
export const PREFERRED_TAKE = {};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'public', 'audio', 'voice');
const CANDIDATE_DIR = join(OUT_DIR, 'candidates');
const VOICES_FILE = join(ROOT, 'scripts', 'audio', 'narrator-voices.json');
const MANIFEST = join(ROOT, 'src', 'content', 'audio', 'narration.generated.ts');
const MODEL = 'eleven_v3';
/** eleven_v3 takes stability as 0 (creative), 0.5 (natural) or 1 (robust). Natural keeps the audio tags alive. */
const VOICE_SETTINGS = { stability: 0.5 };
const TARGET_LUFS = -17;

const DESCRIPTION = 'A wry old British naturalist and museum docent in his late sixties, leading a quiet tour of a vast Victorian steam refinery ' +
  'that happens to be alive. Warm, unhurried baritone with a little gravel, received pronunciation softened by age, dry understated wit, ' +
  'the faint amusement of a man who has seen every accident twice and catalogued both. Close, intimate microphone in a quiet room, no reverb. ' +
  'Measured pace with natural pauses.';

const PREMADE = { george: { voiceId: 'JBFqnCBsd6RMkjVDRZzb', name: 'George — Warm, Captivating Storyteller', source: 'premade (ElevenLabs library)' } };

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes('--dry');
const concurrency = Number(option('concurrency') ?? 3);

function ffmpeg(argv) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...argv], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.slice(-600)}`);
  return r.stderr ?? '';
}

/** Trim both ends (a breath of room kept), two-pass linear loudness to -17 LUFS, mono 64 kbps. */
function masterSpeech(input, output) {
  mkdirSync(dirname(output), { recursive: true });
  const trim = 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.12,areverse';
  const probe = ffmpeg(['-i', input, '-af', `${trim},loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(probe.slice(probe.lastIndexOf('{'), probe.lastIndexOf('}') + 1));
  const norm = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}` +
    `:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  ffmpeg(['-y', '-v', 'error', '-i', input, '-af', `${trim},${norm}`, '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '96k', output]);
  return output;
}

const readVoices = () => (existsSync(VOICES_FILE) ? JSON.parse(readFileSync(VOICES_FILE, 'utf8')) : { voices: {} });
const writeVoices = (v) => writeFileSync(VOICES_FILE, JSON.stringify(v, null, 2) + '\n', 'utf8');

/** Design three candidates from the description (once; the result is recorded), save the most unhurried as 'docent'. */
async function design(budget) {
  const record = readVoices();
  if (record.design?.previews?.length && record.voices.docent) return record;
  await budget.guard(SAMPLE_LINE.length * 3 + 200);
  console.log('designing the narrator (3 previews)…');
  const res = await designVoice({ voice_description: DESCRIPTION, text: SAMPLE_LINE, model_id: 'eleven_ttv_v3', guidance_scale: 5, loudness: 0.5 });
  budget.note(SAMPLE_LINE.length * 3);
  const previews = [];
  res.previews.forEach((p, i) => {
    const raw = join(CACHE_DIR, `voice-design-${p.generated_voice_id}.mp3`);
    writeFileSync(raw, Buffer.from(p.audio_base_64, 'base64'));
    const out = join(CANDIDATE_DIR, `design-${i + 1}.mp3`);
    masterSpeech(raw, out);
    previews.push({ generatedVoiceId: p.generated_voice_id, file: `audio/voice/candidates/design-${i + 1}.mp3`, seconds: Number(measure(out).duration.toFixed(2)) });
  });
  // Can't listen from here, so the brief decides: "unhurried" — the preview that takes its time over the same words.
  const chosen = previews.reduce((best, p, i) => (p.seconds > previews[best].seconds ? i : best), 0);
  const created = await createVoice({ voice_name: 'Breathing Works — the Docent', voice_description: DESCRIPTION, generated_voice_id: previews[chosen].generatedVoiceId });
  const next = {
    description: DESCRIPTION,
    design: { model: 'eleven_ttv_v3', sample: SAMPLE_LINE, previews, chosen, rule: 'longest read of the sample (the most unhurried)' },
    voices: { ...record.voices, docent: { voiceId: created.voice_id, name: 'The Docent (designed for Breathing Works)', source: `designed; preview ${chosen + 1} of 3` } },
  };
  writeVoices(next);
  return next;
}

function resolveVoice(record, which) {
  const all = { ...PREMADE, ...record.voices };
  if (all[which]) return { key: which, ...all[which] };
  if (/^[A-Za-z0-9]{16,}$/.test(which)) return { key: which, voiceId: which, name: which, source: 'voice id' };
  throw new Error(`unknown narrator "${which}" (known: ${Object.keys(all).join(', ')})`);
}

async function pool(items, n, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

async function main() {
  const { lines } = await buildCatalog();
  const chars = lines.reduce((s, l) => s + l.say.length * l.takes, 0);
  console.log(`${lines.length} lines, ${chars} characters with takes.`);
  if (dry) return;
  const budget = new Budget();
  const start = await budget.init();
  console.log(`subscription: ${start.used}/${start.limit}; session cap ${budget.cap}`);

  const record = await design(budget);
  const narrator = resolveVoice(record, option('voice') ?? process.env.NARRATOR ?? NARRATOR);
  console.log(`narrator: ${narrator.name} (${narrator.key})`);

  // The audition sample, read by every saved candidate (the design previews read it already).
  const candidates = [];
  record.design.previews.forEach((p, i) => candidates.push({ id: `design-${i + 1}`, label: `Designed preview ${i + 1}${i === record.design.chosen ? ' (saved as the Docent)' : ''}`, url: p.file }));
  for (const key of ['daniel', 'docent', 'george']) {
    const v = resolveVoice(record, key);
    const res = await speech({ voiceId: v.voiceId, text: SAMPLE_LINE, modelId: MODEL, voiceSettings: VOICE_SETTINGS }, budget);
    masterSpeech(res.file, join(CANDIDATE_DIR, `${key}.mp3`));
    candidates.push({ id: key, label: `${v.name} — full sample`, url: `audio/voice/candidates/${key}.mp3` });
  }

  // Every line with the narrator; stale clips from copy that no longer exists are removed.
  mkdirSync(OUT_DIR, { recursive: true });
  const rows = [];
  let fresh = 0;
  const jobs = lines.flatMap((line) => Array.from({ length: line.takes }, (_, take) => ({ line, take })));
  await pool(jobs, concurrency, async ({ line, take }) => {
    const res = await speech({ voiceId: narrator.voiceId, text: line.say, modelId: MODEL, voiceSettings: VOICE_SETTINGS, variant: take }, budget);
    if (!res.cached) fresh++;
    const name = take === 0 ? `${line.key}.mp3` : `${line.key}-${take + 1}.mp3`;
    masterSpeech(res.file, join(OUT_DIR, name));
  });
  const wanted = new Set();
  for (const line of lines) {
    const urls = Array.from({ length: line.takes }, (_, t) => `audio/voice/${t === 0 ? line.key : `${line.key}-${t + 1}`}.mp3`);
    urls.forEach((u) => wanted.add(u.split('/').pop()));
    const seconds = Number(measure(join(OUT_DIR, `${line.key}.mp3`)).duration.toFixed(2));
    rows.push({ key: line.key, text: line.text, say: line.say, group: line.group, captioned: line.captioned, seconds, urls });
  }
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.mp3') && !wanted.has(f)) rmSync(join(OUT_DIR, f));
  writeManifest(narrator, rows, candidates);

  const bytes = readdirSync(OUT_DIR).filter((f) => f.endsWith('.mp3')).reduce((s, f) => s + statSync(join(OUT_DIR, f)).size, 0);
  const end = await subscription();
  console.log(`${fresh} new clips; voice payload ${(bytes / 1048576).toFixed(2)} MB (+ candidates); counter ${end.used}`);
}

function writeManifest(narrator, rows, candidates) {
  const clips = Object.fromEntries(rows.map((r) => [r.key, { url: r.urls[(PREFERRED_TAKE[r.key] ?? 1) - 1] ?? r.urls[0], seconds: r.seconds, ...(r.captioned ? { captioned: true } : {}) }]));
  const body = `// GENERATED by scripts/audio/gen-voice.mjs — do not edit by hand.
// The narrator's clips, keyed by narrationKey(text) (src/audio/narrationText.ts).
import type { NarrationCandidate, NarrationClip, NarrationLine } from '@/content/audio/narrationTypes';

export const NARRATOR_VOICE = ${JSON.stringify({ key: narrator.key, name: narrator.name, model: MODEL })} as const;

/** The line every narrator candidate reads on the audition page. */
export const NARRATOR_SAMPLE = ${JSON.stringify(SAMPLE_LINE)};

/** What the game needs at run time: key → clip. */
export const NARRATION_CLIPS: Readonly<Record<string, NarrationClip>> = ${JSON.stringify(clips, null, 1)};

/** Every line with its text, for the audition page (the game never reads this). */
export const NARRATION_LINES: readonly NarrationLine[] = ${JSON.stringify(rows.map(({ key, text, say, group, seconds, urls }) => ({ key, text, say, group, seconds, urls })), null, 1)};

/** The narrator candidates reading the same sample line. */
export const NARRATOR_CANDIDATES: readonly NarrationCandidate[] = ${JSON.stringify(candidates, null, 1)};
`;
  writeFileSync(MANIFEST, body.replace(/"([a-zA-Z]+)":/g, '$1:'), 'utf8');
  console.log(`wrote ${rows.length} lines to ${MANIFEST}`);
}

await main();
