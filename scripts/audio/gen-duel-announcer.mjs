// The Duel's arcade announcer: cast the voice, record every call in
// src/content/audio/duelLines.ts, check each take with speech-to-text, master
// it, and write the manifest the game reads.
//
//   ELEVENLABS_API_KEY_FILE=… AUDIO_CACHE_DIR=… \
//   AUDIO_BUDGET_CREDITS=<prior logged duel-voice spend + allowance> \
//   node scripts/audio/gen-duel-announcer.mjs --cast [--design]   # audition the candidates (writes the cast report)
//   node scripts/audio/gen-duel-announcer.mjs [--voice <key>] [--dry]
//
// We cannot listen, so the casting is measured: the same script read by every
// candidate, scored for pitch and range (energy), presence (a shout is bright),
// crisp S sounds (scripts/audio/cast-voices.mjs: a designed voice once lisped),
// and whether speech-to-text hears back the words. Every line is recorded in
// TAKES takes; the game plays the first take that speech-to-text confirms
// (the take nearest a lively pace when several do).
//
// Output: public/audio/duel/<id>.mp3, audition/announcer/*.mp3 (casting, never
// shipped), scripts/audio/duel-announcer-report.json and
// src/content/audio/duelAnnouncer.generated.ts. Logged to
// scripts/audio/generation-log.duel-voice.jsonl.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

process.env.AUDIO_LOG_NAME ??= 'generation-log.duel-voice.jsonl';
const { CACHE_DIR, LOG_FILE, LedgerBudget, designVoice, measure, speech, transcribe } = await import('./elevenlabs.mjs');
const { sibilance } = await import('./cast-voices.mjs');
const { heardAsAsked, voiceShape } = await import('./voice-metrics.mjs');
const { DUEL_LINES, DUEL_FIGHTER_NAMES, DUEL_SHORT_NAMES, DUEL_STAGE_NAMES, DUEL_ULTIMATE_NAMES } = await import('../../src/content/audio/duelLines.ts');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'public', 'audio', 'duel');
const CAST_DIR = join(ROOT, 'audition', 'announcer');
const CAST_REPORT = join(ROOT, 'scripts', 'audio', 'duel-announcer-cast.json');
const REPORT = join(ROOT, 'scripts', 'audio', 'duel-announcer-report.json');
const MANIFEST = join(ROOT, 'src', 'content', 'audio', 'duelAnnouncer.generated.ts');
const MODEL = 'eleven_v3';
const TAKES = 2;
const EXTRA_TAKES = 2;
/** Loudest 400 ms (momentary) of every call: a shout lands a little over the narrator's speech (-17 LUFS integrated). */
const TARGET_MOMENTARY = -13;
/** The shipped calls, compressed: a point louder again (the arcade direction). */
const PUNCH_MOMENTARY = -12;
/** eleven_v3 speed for the shipped calls (1.2 is its maximum): fast, punchy reads. */
const SPEED = 1.2;
const TRUE_PEAK = -1.5;

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(`--${name}`);

/**
 * Words a transcriber cannot tell apart in this accent: American English flaps the d of 'Edda' into
 * the t of 'Etta', so speech-to-text writes the name it knows.
 */
const HOMOPHONES = { edda: ['etta'] };

/** Every name a transcriber cannot know (matched by similarity, not spelling). */
const NAMES = [...Object.values(DUEL_FIGHTER_NAMES), ...Object.values(DUEL_SHORT_NAMES), ...Object.values(DUEL_STAGE_NAMES), ...Object.values(DUEL_ULTIMATE_NAMES)];

/* ------------------------------------------------------------- the cast */

/** Library voices that fit the brief (voice-library.mjs search "announcer" / "arena announcer" / "hype"). */
export const CANDIDATES = [
  { key: 'xavier', name: 'Xavier — dominating, metallic announcer', voiceId: 'YOq2y2Up4RgXP2HyXjE5' },
  { key: 'david', name: 'David — sports arena announcer', voiceId: 'DduhIyyKkOosbP8VefhP' },
  { key: 'tyler', name: 'Tyler — energetic arena announcer', voiceId: 'GyIXYY876myKNtA1j8NI' },
  { key: 'jerry', name: 'Jerry B. — announcer and broadcast voice', voiceId: '6dcFFb31LVaCdYevmTAx' },
  { key: 'ryan', name: 'Ryan — event voice of god', voiceId: 'UII4xWDUviYCKDpBl5jC' },
  { key: 'grant', name: 'Grant — hyper, over-the-top and loud', voiceId: 'QvlD90AkjGTCqc9685Rq' },
  // Deliveries of the sports-arena voice (the first casting's pick): eleven_v3's creative setting, and a shouting tag.
  { key: 'david-creative', name: 'David — sports arena announcer, creative (stability 0)', voiceId: 'DduhIyyKkOosbP8VefhP', settings: { stability: 0 } },
  { key: 'david-shout', name: 'David — sports arena announcer, [shouting]', voiceId: 'DduhIyyKkOosbP8VefhP', prefix: '[shouting] ' },
];

/** The same calls for every candidate: names, numbers, S sounds, and the big ones. */
const CAST_TEXT = 'Choose your fighter! Selene Wraith! Three! Two! One! Fight! Here comes a new challenger! Last stock! Self-destruct! Game! Father Thorne wins!';

const DESIGN_BRIEF = 'A booming, larger-than-life arcade fighting game announcer in his forties. Deep, powerful American baritone with a ' +
  'little grit, shouting with adrenaline-pumping hype into a stadium microphone. Every word punched with crisp hard consonants and clean ' +
  'sharp S sounds, dramatic stretched vowels on the big calls. Huge arena energy, clean close studio recording, no music, no reverb.';

const SETTINGS = { stability: 0.5 };

function ffmpeg(argv) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...argv], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-400)}`);
  return r.stderr ?? '';
}

/**
 * A call, mastered: both ends trimmed (a breath of room kept), the loudest
 * momentary (400 ms) loudness set to a target — short shouts have no
 * integrated loudness to speak of — and a true-peak ceiling, mono 96 kbps.
 *
 * `punch` (the shipped calls; the user's direction, 2026-10-03: "everything
 * about Duel mode should scream fast-paced, adrenaline-pumping ARCADE"): the
 * tail is cut tighter, rumble under 70 Hz goes, a fast 4:1 compressor packs
 * the shout dense, and it lands at PUNCH_MOMENTARY. `maxSeconds`: a call that
 * must fit its beat is sped up (pitch kept, at most 1.4×) to fit.
 */
export function masterCall(input, output, { punch = false, maxSeconds } = {}) {
  mkdirSync(dirname(output), { recursive: true });
  // Punch trims relative to the take's own peak: a soft breath or a quiet lead-in before the shout goes too.
  const peak = punch ? Number(ffmpeg(['-i', input, '-af', 'volumedetect', '-f', 'null', '-']).match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0) : 0;
  const head = punch ? `start_threshold=${(peak - 30).toFixed(1)}dB:start_silence=0.01` : 'start_threshold=-50dB:start_silence=0.03';
  const tail = punch ? `start_threshold=${(peak - 36).toFixed(1)}dB:start_silence=0.04` : 'start_threshold=-50dB:start_silence=0.08';
  let chain = `silenceremove=start_periods=1:${head},areverse,silenceremove=start_periods=1:${tail},areverse`;
  if (punch) chain += ',highpass=f=70,acompressor=threshold=0.1:ratio=4:attack=2:release=60:makeup=2';
  // The chain rendered once to a scratch WAV: its exact length (the loudness log's 100 ms frames are too
  // coarse to fit a 0.6 s beat) and its loudest momentary loudness.
  const scratch = join(CACHE_DIR, 'duel-master-scratch.wav');
  const measureChain = (c) => {
    ffmpeg(['-y', '-v', 'error', '-i', input, '-af', c, '-ar', '44100', '-ac', '1', scratch]);
    const log = ffmpeg(['-i', scratch, '-af', 'ebur128=framelog=info', '-f', 'null', '-']);
    const momentary = [...log.matchAll(/ M:\s*(-?[\d.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite);
    if (momentary.length === 0) throw new Error(`no loudness frames measured for ${input}`);
    return { loudest: Math.max(...momentary), seconds: measure(scratch).duration };
  };
  let m = measureChain(chain);
  let tempo = 1;
  if (maxSeconds && m.seconds > maxSeconds) {
    tempo = Math.min(1.4, m.seconds / maxSeconds);
    chain += `,atempo=${tempo.toFixed(3)}`;
    m = measureChain(chain);
  }
  const gain = (punch ? PUNCH_MOMENTARY : TARGET_MOMENTARY) - m.loudest;
  const ceiling = 10 ** (TRUE_PEAK / 20);
  ffmpeg(['-y', '-v', 'error', '-i', input, '-af', `${chain},volume=${gain.toFixed(2)}dB,alimiter=limit=${ceiling.toFixed(3)}:attack=1:release=40:level=disabled`,
    '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '96k', output]);
  return { loudestMomentary: +m.loudest.toFixed(1), gainDb: +gain.toFixed(1), ...(tempo !== 1 ? { tempo: +tempo.toFixed(3) } : {}) };
}

/** What we measure of a recording: length, level, S crispness, pitch/range, presence. */
function profile(file) {
  const m = measure(file);
  return { seconds: +m.duration.toFixed(2), truePeak: m.truePeak, ...sibilance(file), ...voiceShape(file) };
}

async function cast(budget) {
  mkdirSync(CAST_DIR, { recursive: true });
  const rows = [];
  for (const c of CANDIDATES) {
    const res = await speech({ voiceId: c.voiceId, text: (c.prefix ?? '') + CAST_TEXT, modelId: MODEL, voiceSettings: c.settings ?? SETTINGS }, budget);
    const out = join(CAST_DIR, `cast-${c.key}.mp3`);
    masterCall(res.file, out);
    const heard = await transcribe(out, {}, budget);
    rows.push({ key: c.key, name: c.name, voiceId: c.voiceId, source: 'library', url: `audition/announcer/cast-${c.key}.mp3`, ...profile(out), heard: heard.text, ...pick(heardAsAsked(CAST_TEXT, heard.text, NAMES), ['wer', 'misses']) });
    console.log(`  ${c.key.padEnd(8)} ${JSON.stringify(rows.at(-1)).slice(0, 220)}`);
  }
  if (has('design')) {
    const designed = await design(budget);
    for (const d of designed) {
      const heard = await transcribe(d.file, {}, budget);
      rows.push({ key: d.key, name: d.name, generatedVoiceId: d.generatedVoiceId, source: 'designed', url: `audition/announcer/${d.key}.mp3`, ...profile(d.file), heard: heard.text, ...pick(heardAsAsked(CAST_TEXT, heard.text, NAMES), ['wer', 'misses']) });
      console.log(`  ${d.key.padEnd(8)} ${JSON.stringify(rows.at(-1)).slice(0, 220)}`);
    }
  }
  const ranked = rank(rows);
  writeFileSync(CAST_REPORT, JSON.stringify({ text: CAST_TEXT, brief: DESIGN_BRIEF, model: MODEL, settings: SETTINGS, rule: RULE, candidates: ranked }, null, 2) + '\n');
  console.log(`\nranked (${RULE}):`);
  for (const r of ranked) console.log(`  ${String(r.rank).padStart(2)} ${r.key.padEnd(10)} energy ${r.energy.toFixed(2).padStart(6)}  f0 ${r.f0Median} Hz ±${r.f0RangeSt} st  presence ${r.presenceDb} dB  S ${r.sibilantPerSecond}/s  WER ${r.wer}${r.excluded ? `  EXCLUDED: ${r.excluded}` : ''}`);
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/** Designed previews (eleven_ttv_v3), each reading the casting script. Designed once; reruns re-master the cached previews. */
async function design(budget) {
  const record = existsSync(CAST_REPORT) ? JSON.parse(readFileSync(CAST_REPORT, 'utf8')) : null;
  const previous = record?.candidates?.filter((c) => c.source === 'designed') ?? [];
  const rawOf = (id) => join(CACHE_DIR, `voice-design-${id}.mp3`);
  if (previous.length && previous.every((p) => existsSync(rawOf(p.generatedVoiceId)))) {
    return previous.map((p) => {
      const file = join(ROOT, p.url);
      masterCall(rawOf(p.generatedVoiceId), file);
      return { key: p.key, name: p.name, generatedVoiceId: p.generatedVoiceId, file };
    });
  }
  await budget.guard(CAST_TEXT.length * 3 + 200);
  console.log('designing the announcer (3 previews)…');
  const res = await designVoice({ voice_description: DESIGN_BRIEF, text: CAST_TEXT, model_id: 'eleven_ttv_v3', guidance_scale: 5, loudness: 0.75 });
  budget.note(CAST_TEXT.length * 3);
  appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), kind: 'design', estimate: CAST_TEXT.length * 3, payload: { description: DESIGN_BRIEF, text: CAST_TEXT, model: 'eleven_ttv_v3' } }) + '\n');
  return res.previews.map((p, i) => {
    const raw = rawOf(p.generated_voice_id);
    writeFileSync(raw, Buffer.from(p.audio_base_64, 'base64'));
    const key = `design-${i + 1}`;
    const file = join(CAST_DIR, `${key}.mp3`);
    masterCall(raw, file);
    return { key, name: `Designed preview ${i + 1}`, generatedVoiceId: p.generated_voice_id, file };
  });
}

const RULE = 'drop a candidate speech-to-text did not hear back word for word (an invented name within 60% of its spelling) or whose S sounds ' +
  'score under 60% of the field median; rank the rest by boom-and-hype = z(presence: vocal effort) + z(pitch range: a lively read) - z(median pitch: a booming register)';

function rank(rows) {
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const sibMedian = median(rows.map((r) => r.sibilantPerSecond));
  const z = (key) => {
    const xs = rows.map((r) => r[key]);
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length) || 1;
    return (r) => (r[key] - mean) / sd;
  };
  const zf0 = z('f0Median'), zr = z('f0RangeSt'), zp = z('presenceDb');
  const scored = rows.map((r) => ({
    ...r,
    energy: zp(r) + zr(r) - zf0(r),
    excluded: r.wer > 0 ? `misheard ${r.misses.join(', ')}` : r.sibilantPerSecond < 0.6 * sibMedian ? `soft S (${r.sibilantPerSecond}/s vs median ${sibMedian})` : null,
  }));
  scored.sort((a, b) => Number(!!a.excluded) - Number(!!b.excluded) || b.energy - a.energy);
  return scored.map((r, i) => ({ rank: i + 1, ...r }));
}

/* ------------------------------------------------------------- the lines */

/**
 * The announcer the game uses (--voice overrides): the casting's top-ranked candidate in
 * scripts/audio/duel-announcer-cast.json — David, the sports-arena announcer, with every call shouted.
 */
export const ANNOUNCER = 'david-shout';

function resolveVoice(which) {
  const castRecord = existsSync(CAST_REPORT) ? JSON.parse(readFileSync(CAST_REPORT, 'utf8')) : { candidates: [] };
  const lib = CANDIDATES.find((c) => c.key === which);
  if (lib) return { key: lib.key, name: lib.name, voiceId: lib.voiceId, settings: lib.settings ?? SETTINGS, prefix: lib.prefix ?? '' };
  const saved = castRecord.saved?.[which];
  if (saved) return { key: which, name: saved.name, voiceId: saved.voiceId, settings: SETTINGS, prefix: '' };
  if (/^[A-Za-z0-9]{16,}$/.test(which)) return { key: which, name: which, voiceId: which, settings: SETTINGS, prefix: '' };
  throw new Error(`unknown announcer "${which}"`);
}

async function record(budget) {
  const voice = resolveVoice(option('voice') ?? ANNOUNCER);
  console.log(`announcer: ${voice.name} (${voice.voiceId})`);
  mkdirSync(OUT_DIR, { recursive: true });
  const rows = [];
  for (const line of DUEL_LINES) {
    const say = voice.prefix + (line.say ?? line.text);
    const takes = [];
    // TAKES takes; a line no take of which speech-to-text confirms gets up to EXTRA_TAKES more.
    for (let take = 0; take < TAKES + EXTRA_TAKES && (take < TAKES || !takes.some((t) => t.ok)); take++) {
      const res = await speech({ voiceId: voice.voiceId, text: say, modelId: MODEL, voiceSettings: line.speed === 1 ? voice.settings : { ...voice.settings, speed: line.speed ?? SPEED }, variant: take }, budget);
      const file = join(OUT_DIR, take === 0 ? `${line.id}.mp3` : `${line.id}-${take + 1}.mp3`);
      const mastered = masterCall(res.file, file, { punch: true, maxSeconds: line.maxSeconds });
      const heard = await transcribe(file, {}, budget);
      const check = heardAsAsked(line.text, heard.text, NAMES, 0.6, HOMOPHONES);
      takes.push({ take: take + 1, file, heard: heard.text, ok: check.ok, closeness: check.closeness, misses: check.misses, cacheKey: res.key, ...mastered, ...profile(file) });
    }
    // The take the game plays: of those speech-to-text confirms, the one whose names came back
    // closest to their spelling ("Brian Rook" over "Fran Rooke"), then the brisker read (a call
    // that drags is the weaker take); with none confirmed, take 1, flagged for a human.
    const confirmed = takes.filter((t) => t.ok);
    const better = (a, b) => (b.closeness > a.closeness + 0.02 || (Math.abs(b.closeness - a.closeness) <= 0.02 && b.seconds < a.seconds * 0.85) ? b : a);
    const chosen = confirmed.length ? confirmed.reduce(better) : takes[0];
    rows.push({ ...line, say, takes: takes.map(({ file, ...t }) => ({ ...t, url: `audio/duel/${file.split(/[\\/]/).pop()}` })), chosen: chosen.take, confirmed: confirmed.length > 0 });
    const flag = confirmed.length ? '' : '   <-- NOT CONFIRMED';
    console.log(`  ${line.id.padEnd(22)} ${takes.map((t) => `${t.take}:${t.ok ? 'ok' : 'MISS'} ${t.seconds}s "${t.heard}"`).join('  ')}  -> take ${chosen.take}${flag}`);
  }
  // Only the chosen takes ship; the others stay in the paid cache (free to re-master) and the report.
  const keep = new Set(rows.map((r) => r.takes[r.chosen - 1].url.split('/').pop()));
  for (const f of readdirSync(OUT_DIR)) {
    if (!keep.has(f)) rmSync(join(OUT_DIR, f));
  }
  // Ship under the line's id whichever take won.
  for (const r of rows) {
    const chosen = r.takes[r.chosen - 1];
    const from = join(OUT_DIR, chosen.url.split('/').pop()), to = join(OUT_DIR, `${r.id}.mp3`);
    if (from !== to) { writeFileSync(to, readFileSync(from)); rmSync(from); }
    chosen.url = `audio/duel/${r.id}.mp3`;
    chosen.sha256 = createHash('sha256').update(readFileSync(to)).digest('hex');
    chosen.bytes = statSync(to).size;
  }
  writeFileSync(REPORT, JSON.stringify({ voice, model: MODEL, speed: SPEED, targetMomentary: PUNCH_MOMENTARY, truePeak: TRUE_PEAK, lines: rows }, null, 2) + '\n');
  writeManifest(voice, rows);
  const missing = rows.filter((r) => !r.confirmed).map((r) => r.id);
  if (missing.length) console.log(`\n${missing.length} line(s) speech-to-text did not confirm: ${missing.join(', ')}`);
  console.log(`\nspent this run ~${budget.spent} credits (logged ${budget.start + budget.spent} of ${budget.cap}).`);
}

function writeManifest(voice, rows) {
  const clips = Object.fromEntries(rows.map((r) => {
    const t = r.takes[r.chosen - 1];
    return [r.id, { url: t.url, seconds: t.seconds }];
  }));
  const lines = rows.map((r) => ({ id: r.id, text: r.text, group: r.group, heard: r.takes[r.chosen - 1].heard, confirmed: r.confirmed }));
  const castRecord = existsSync(CAST_REPORT) ? JSON.parse(readFileSync(CAST_REPORT, 'utf8')) : { candidates: [] };
  const cast = castRecord.candidates.map((c) => ({ rank: c.rank, key: c.key, name: c.name, url: c.url, seconds: c.seconds, f0Median: c.f0Median, f0RangeSt: c.f0RangeSt,
    presenceDb: c.presenceDb, sibilantPerSecond: c.sibilantPerSecond, heard: c.heard, excluded: c.excluded ?? null }));
  const body = `// GENERATED by scripts/audio/gen-duel-announcer.mjs — do not edit by hand.
// The Duel announcer's calls (content/audio/duelLines.ts), one mastered take each.

export const DUEL_ANNOUNCER_VOICE = ${JSON.stringify({ key: voice.key, name: voice.name, model: MODEL })} as const;

/** What the game needs at run time: line id → clip. */
export const DUEL_CLIPS: Readonly<Record<string, { readonly url: string; readonly seconds: number }>> = ${JSON.stringify(clips, null, 1)};

/** Every line with what speech-to-text heard in the shipped take (the audition page reads this). */
export const DUEL_CLIP_LINES: ReadonlyArray<{ readonly id: string; readonly text: string; readonly group: string; readonly heard: string; readonly confirmed: boolean }> = ${JSON.stringify(lines, null, 1)};

/** The casting (scripts/audio/duel-announcer-cast.json): every candidate read the same script; the audition page lists them. */
export const DUEL_ANNOUNCER_CAST: ReadonlyArray<{ readonly rank: number; readonly key: string; readonly name: string; readonly url: string; readonly seconds: number;
  readonly f0Median: number; readonly f0RangeSt: number; readonly presenceDb: number; readonly sibilantPerSecond: number; readonly heard: string; readonly excluded: string | null }> = ${JSON.stringify(cast, null, 1)};

export const DUEL_CAST_SCRIPT = ${JSON.stringify(castRecord.text ?? CAST_TEXT)};
export const DUEL_CAST_RULE = ${JSON.stringify(castRecord.rule ?? RULE)};
`;
  writeFileSync(MANIFEST, body.replace(/"([a-zA-Z][a-zA-Z0-9]*)":/g, '$1:'), 'utf8');
  console.log(`wrote ${rows.length} calls to ${MANIFEST}`);
}

async function main() {
  const chars = DUEL_LINES.reduce((s, l) => s + (l.say ?? l.text).length + 10, 0) * TAKES;
  console.log(`${DUEL_LINES.length} calls, ~${chars} credits of speech for ${TAKES} takes if nothing is cached; casting ~${(CAST_TEXT.length + 10) * CANDIDATES.length}.`);
  if (has('dry')) return;
  const budget = new LedgerBudget(['tts', 'stt', 'design']);
  console.log(`prior logged duel-voice spend ${budget.start}; cap ${budget.cap}`);
  if (has('cast')) await cast(budget);
  else await record(budget);
}

await main();
