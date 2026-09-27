// ElevenLabs client for OFFLINE asset generation (sound effects, music,
// speech, voice design). Nothing here ships in the game: the build only ever
// sees the audio files these scripts write.
//
// The API key is read at run time from ELEVENLABS_API_KEY, or from the file
// named by ELEVENLABS_API_KEY_FILE (the first `sk_…` token in it). It is never
// logged, written to disk, or put in an error message.
//
// Every request is content-addressed: the response is cached under
// scripts/audio/.cache/<sha1>.<ext> (git-ignored), so re-running a generator
// never pays twice for the same prompt. A session budget (AUDIO_BUDGET_CREDITS)
// is enforced against the live subscription counter, and every paid call is
// appended to scripts/audio/generation-log.jsonl (prompts and costs, no key).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.elevenlabs.io';
// AUDIO_CACHE_DIR lets several worktrees share one paid cache.
export const CACHE_DIR = process.env.AUDIO_CACHE_DIR ?? join(HERE, '.cache');
// One log per generator (AUDIO_LOG_NAME) keeps parallel branches merge-friendly.
export const LOG_FILE = join(HERE, process.env.AUDIO_LOG_NAME ?? 'generation-log.jsonl');

let cachedKey = null;
export function loadApiKey() {
  if (cachedKey) return cachedKey;
  let raw = process.env.ELEVENLABS_API_KEY ?? '';
  if (!raw && process.env.ELEVENLABS_API_KEY_FILE) raw = readFileSync(process.env.ELEVENLABS_API_KEY_FILE, 'utf8');
  const token = raw.match(/sk_[A-Za-z0-9]{20,}/)?.[0];
  if (!token) throw new Error('No ElevenLabs key: set ELEVENLABS_API_KEY or ELEVENLABS_API_KEY_FILE (a file containing an sk_ token).');
  cachedKey = token;
  return token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, { method = 'GET', body, query, binary = false } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { 'xi-api-key': loadApiKey(), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
    const text = await res.text().catch(() => '');
    // 429 = rate/concurrency limit; 5xx = transient. Back off and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await sleep(1500 * 2 ** attempt + Math.random() * 500);
      continue;
    }
    throw new Error(`ElevenLabs ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
}

export async function subscription() {
  const s = await request('/v1/user/subscription');
  return { used: s.character_count, limit: s.character_limit, tier: s.tier, resetUnix: s.next_character_count_reset_unix };
}

/** Session spend guard. `cap` credits may be spent from the counter value at construction. */
export class Budget {
  constructor(cap = Number(process.env.AUDIO_BUDGET_CREDITS ?? 20000)) {
    this.cap = cap;
    this.start = null;
    this.spent = 0;
  }
  async init() {
    const s = await subscription();
    this.start = s.used;
    this.limit = s.limit;
    return s;
  }
  async refresh() {
    const s = await subscription();
    this.spent = s.used - this.start;
    return this.spent;
  }
  /** Throws before a request that would exceed the cap (estimate = expected credits). */
  async guard(estimate) {
    if (this.start === null) await this.init();
    if (this.spent + estimate > this.cap) await this.refresh();
    if (this.spent + estimate > this.cap) {
      throw new Error(`Audio budget reached: spent ${this.spent} of ${this.cap} credits (next ~${estimate}).`);
    }
  }
  note(estimate) {
    this.spent += estimate;
  }
}

function cacheKey(kind, payload) {
  return createHash('sha1').update(kind + '\n' + JSON.stringify(payload)).digest('hex');
}

async function cachedBinary(kind, payload, ext, estimate, budget, run) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const key = cacheKey(kind, payload);
  const file = join(CACHE_DIR, `${key}.${ext}`);
  if (existsSync(file)) return { file, bytes: readFileSync(file), cached: true, key };
  if (budget) await budget.guard(estimate);
  const bytes = await run();
  writeFileSync(file, bytes);
  if (budget) budget.note(estimate);
  appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), kind, key, estimate, payload }) + '\n');
  return { file, bytes, cached: false, key };
}

const extOf = (fmt) => (fmt.startsWith('mp3') ? 'mp3' : fmt.startsWith('opus') ? 'opus' : fmt.startsWith('pcm') ? 'pcm' : 'bin');

/**
 * The cached response file for a sound-effect request, or null when it has not
 * been bought yet. Free: lets a generator choose among takes already paid for.
 */
export function cachedSoundEffectFile({ text, durationSeconds, promptInfluence = 0.4, loop = false, outputFormat = 'mp3_44100_192', variant = 0 }) {
  const payload = { text, durationSeconds: durationSeconds ?? null, promptInfluence, loop, outputFormat, variant };
  const file = join(CACHE_DIR, `${cacheKey('sfx', payload)}.${extOf(outputFormat)}`);
  return existsSync(file) ? file : null;
}

/**
 * Text-to-sound-effect. `variant` only salts the cache key so several takes of
 * one prompt can be generated (the API itself is non-deterministic).
 */
export function soundEffect({ text, durationSeconds, promptInfluence = 0.4, loop = false, outputFormat = 'mp3_44100_192', variant = 0 }, budget) {
  const payload = { text, durationSeconds: durationSeconds ?? null, promptInfluence, loop, outputFormat, variant };
  const estimate = Math.ceil((durationSeconds ?? 5) * 40);
  return cachedBinary('sfx', payload, extOf(outputFormat), estimate, budget, () =>
    request('/v1/sound-generation', {
      method: 'POST',
      query: { output_format: outputFormat },
      body: {
        text,
        model_id: 'eleven_text_to_sound_v2',
        prompt_influence: promptInfluence,
        loop,
        ...(durationSeconds ? { duration_seconds: durationSeconds } : {}),
      },
      binary: true,
    }),
  );
}

/** Music. Pass either `prompt` or `compositionPlan`. Cost is measured, not documented; estimate is conservative. */
export function music({ prompt, compositionPlan, lengthMs, modelId = 'music_v1', forceInstrumental = true, outputFormat = 'mp3_44100_192', variant = 0, estimate }, budget) {
  const payload = { prompt: prompt ?? null, compositionPlan: compositionPlan ?? null, lengthMs: lengthMs ?? null, modelId, forceInstrumental, outputFormat, variant };
  // Measured 2026-09-27: ~22 credits per second of music (15 s ≈ 338). Round up.
  const est = estimate ?? Math.ceil(((lengthMs ?? 60000) / 1000) * 25);
  return cachedBinary('music', payload, extOf(outputFormat), est, budget, () =>
    request('/v1/music', {
      method: 'POST',
      query: { output_format: outputFormat },
      body: {
        model_id: modelId,
        ...(compositionPlan ? { composition_plan: compositionPlan } : { prompt, force_instrumental: forceInstrumental }),
        ...(lengthMs && !compositionPlan ? { music_length_ms: lengthMs } : {}),
      },
      binary: true,
    }),
  );
}

/** Text-to-speech with an existing voice. */
export function speech({ voiceId, text, modelId = 'eleven_v3', voiceSettings, outputFormat = 'mp3_44100_192', previousText, nextText, seed, variant = 0 }, budget) {
  const payload = { voiceId, text, modelId, voiceSettings: voiceSettings ?? null, outputFormat, previousText: previousText ?? null, nextText: nextText ?? null, seed: seed ?? null, variant };
  const estimate = text.length + 10;
  return cachedBinary('tts', payload, extOf(outputFormat), estimate, budget, () =>
    request(`/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      query: { output_format: outputFormat },
      body: {
        text,
        model_id: modelId,
        ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
        // eleven_v3 does not accept request stitching context.
        ...(previousText && modelId !== 'eleven_v3' ? { previous_text: previousText } : {}),
        ...(nextText && modelId !== 'eleven_v3' ? { next_text: nextText } : {}),
        ...(seed !== undefined ? { seed } : {}),
      },
      binary: true,
    }),
  );
}

export const voices = (query = {}) => request('/v2/voices', { query: { page_size: 100, ...query } });
/** Voice design: returns previews ({ generated_voice_id, audio_base_64, … }). */
export const designVoice = (body) => request('/v1/text-to-voice/design', { method: 'POST', body });
/** Saves a designed preview as a voice in the account (uses one voice slot). */
export const createVoice = (body) => request('/v1/text-to-voice', { method: 'POST', body });

/**
 * ffmpeg post-process: trim leading/trailing silence (one-shots), loudness-
 * normalise (EBU R128 single pass), downmix, and encode MP3 at `bitrate`.
 */
export function ffmpegProcess(input, output, { mono = true, lufs = -18, truePeak = -1.5, bitrate = '96k', trim = true, fadeOutMs = 0, sampleRate = 44100 } = {}) {
  mkdirSync(dirname(output), { recursive: true });
  const filters = [];
  if (trim) {
    filters.push('silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005');
    filters.push('areverse', 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.02', 'areverse');
  }
  if (lufs !== null) filters.push(`loudnorm=I=${lufs}:TP=${truePeak}:LRA=11`);
  if (fadeOutMs > 0) filters.push(`areverse,afade=t=in:d=${fadeOutMs / 1000},areverse`);
  const args = ['-y', '-v', 'error', '-i', input, ...(filters.length ? ['-af', filters.join(',')] : []), '-ar', String(sampleRate), '-ac', mono ? '1' : '2', '-codec:a', 'libmp3lame', '-b:a', bitrate, output];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${input}: ${r.stderr}`);
  return output;
}

/** Duration (s), integrated loudness (LUFS) and true peak (dBTP) via ffmpeg ebur128. */
export function measure(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const err = r.stderr ?? '';
  const I = Number(err.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
  const peak = Number(err.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
  const dur = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duration = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : NaN;
  return { duration, lufs: I, truePeak: peak };
}
