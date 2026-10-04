#!/usr/bin/env node
// Generate, master and QC every sampled sound effect in the game.
//
//   ELEVENLABS_API_KEY_FILE=... AUDIO_CACHE_DIR=... AUDIO_LOG_NAME=generation-log.sfx.jsonl \
//   AUDIO_BUDGET_CREDITS=80000 node scripts/audio/gen-sfx.mjs [options]
//
//   --only a,b,c     only these cues (exact id, `prefix.*`, or /regex/)
//   --dry            print what would be bought (credits) and exit
//   --offline        never call the API: master whatever is cached, skip the rest
//   --rejects FILE   regenerate takes rejected in the audition page
//                    (default scripts/audio/sfx-rejects.json when present)
//   --concurrency N  parallel API requests (default 4)
//
// Every paid response lands in the shared content-addressed cache
// (scripts/audio/elevenlabs.mjs), so re-mastering is free: tweak the chain
// and re-run. Take choice is persistent (scripts/audio/sfx-takes.json): a
// take the QC or a human rejected is replaced by the next variant of the
// same prompt and never used again.
//
// The chain, per take: decode → DC block → QC (silence, late onset, hard
// clipping, truncation) → trim leading/trailing silence (one-shots) → cap
// length → fades → K-weighted loudness normalisation (BS.1770 filter; the
// loudest 100 ms window for one-shots, the whole file for loops/beds, so a
// 0.1 s click and a 3 s roar are matched the way ears match them — the
// single-pass loudnorm filter cannot measure sub-400 ms clips) → lookahead
// peak limiter at -1 dBFS → MP3 (mono one-shots/loops, stereo beds).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SFX_PROMPTS } from './sfx-prompts.mjs';
import { SFX_CUES } from '../../src/content/audio/sfxCues.ts';

// The client reads AUDIO_LOG_NAME at import time: default it BEFORE loading it
// (a static import would be hoisted above this line).
process.env.AUDIO_LOG_NAME ??= 'generation-log.sfx.jsonl';
const { soundEffect, cachedSoundEffectFile, subscription, LOG_FILE } = await import('./elevenlabs.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ASSET_ROOT = join(ROOT, 'src', 'assets', 'audio');
const TAKES_FILE = join(HERE, 'sfx-takes.json');
const REPORT_FILE = join(HERE, 'sfx-report.json');
const SR = 44100;
const CREDITS_PER_SECOND = 40;

// ---------------------------------------------------------------- options
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);
const DRY = has('--dry');
const OFFLINE = has('--offline');
const CONCURRENCY = Number(opt('--concurrency') ?? 4);
const ONLY = opt('--only');
const REJECTS_FILE = opt('--rejects') ?? join(HERE, 'sfx-rejects.json');

const matchers = ONLY ? ONLY.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  if (s.startsWith('/') && s.endsWith('/')) { const re = new RegExp(s.slice(1, -1)); return (id) => re.test(id); }
  if (s.endsWith('*')) { const p = s.slice(0, -1); return (id) => id.startsWith(p); }
  return (id) => id === s;
}) : null;
const selected = (id) => !matchers || matchers.some((m) => m(id));

// ------------------------------------------------------------ table check
const cueIds = Object.keys(SFX_CUES);
const promptIds = Object.keys(SFX_PROMPTS);
const missingPrompt = cueIds.filter((id) => !SFX_PROMPTS[id]);
const orphanPrompt = promptIds.filter((id) => !SFX_CUES[id]);
if (missingPrompt.length || orphanPrompt.length) {
  console.error('sfxCues.ts and sfx-prompts.mjs disagree.');
  if (missingPrompt.length) console.error('  no prompt for:', missingPrompt.join(', '));
  if (orphanPrompt.length) console.error('  prompt without a cue:', orphanPrompt.join(', '));
  process.exit(1);
}

const specOf = (id) => {
  const cue = SFX_CUES[id], p = SFX_PROMPTS[id];
  const loop = cue.loop === true;
  const bed = cue.cat === 'bed';
  return {
    id, pack: cue.pack, cat: cue.cat, loop, bed,
    prompt: p.p, dur: Math.max(0.5, Math.min(30, p.d)), takes: p.t ?? 2, influence: p.i ?? 0.55,
    soft: p.soft === true, fast: p.fast === true, max: p.max, stereo: p.stereo === true,
  };
};
const outDirOf = (spec) => join(ASSET_ROOT, spec.pack.startsWith('amb') ? 'ambience' : 'sfx', spec.pack);
const outFileOf = (spec, slot) => join(outDirOf(spec), `${spec.id}-${slot + 1}.mp3`);
const promptHash = (spec) => createHash('sha1').update(JSON.stringify([spec.prompt, spec.dur, spec.influence, spec.loop])).digest('hex').slice(0, 12);

// ----------------------------------------------------------------- state
// Per cue: `variants` are the chosen takes (slot order), `rejected` the ones a
// human turned down in the audition page (never used again), `failed` the ones
// the automatic QC refused (re-checked if the QC changes).
const takes = existsSync(TAKES_FILE) ? JSON.parse(readFileSync(TAKES_FILE, 'utf8')) : {};
function stateOf(spec) {
  const h = promptHash(spec);
  let s = takes[spec.id];
  if (!s || s.hash !== h) s = takes[spec.id] = { hash: h, variants: [], rejected: [], failed: [] };
  s.rejected ??= [];
  s.failed ??= [];
  return s;
}
function nextVariant(s, tried) {
  const used = new Set([...s.variants, ...s.rejected, ...s.failed, ...tried]);
  let v = 0;
  while (used.has(v)) v++;
  return v;
}

// Manual rejects from the audition page: { rejected: [{ id, take }] } | { id: [take] } | ['id#take'].
function readRejects() {
  if (!existsSync(REJECTS_FILE)) return [];
  const raw = JSON.parse(readFileSync(REJECTS_FILE, 'utf8'));
  const list = [];
  const push = (id, take) => { if (SFX_CUES[id] && Number.isInteger(take) && take >= 1) list.push({ id, take }); };
  if (Array.isArray(raw)) for (const s of raw) { const [id, t] = String(s).split('#'); push(id, Number(t)); }
  else if (Array.isArray(raw.rejected)) for (const r of raw.rejected) push(r.id, Number(r.take));
  else for (const [id, arr] of Object.entries(raw)) for (const t of arr) push(id, Number(t));
  return list;
}

// ---------------------------------------------------------------- budget
function priorSpend() {
  if (!existsSync(LOG_FILE)) return 0;
  let sum = 0;
  for (const line of readFileSync(LOG_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); if (e.kind === 'sfx') sum += e.estimate ?? 0; } catch { /* torn line */ }
  }
  return sum;
}
const CAP = Number(process.env.AUDIO_BUDGET_CREDITS ?? 80000);
const budget = {
  spent: 0,
  start: priorSpend(),
  guard(estimate) {
    if (this.start + this.spent + estimate > CAP) throw new Error(`SFX budget reached: ${this.start + this.spent} of ${CAP} credits spent (next ~${estimate}).`);
  },
  note(estimate) { this.spent += estimate; },
};

// ------------------------------------------------------------------- DSP
function decode(file, channels) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(channels), '-ar', String(SR), 'pipe:1'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${file}: ${r.stderr}`);
  const buf = r.stdout;
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function encode(samples, channels, out, bitrate) {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp.f32`;
  writeFileSync(tmp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', String(channels), '-i', tmp,
    '-codec:a', 'libmp3lame', '-b:a', bitrate, '-ar', String(SR), out], { encoding: 'utf8' });
  rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error(`ffmpeg encode failed for ${out}: ${r.stderr}`);
}

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const undb = (d) => 10 ** (d / 20);

/** One-pole DC blocker, in place, per channel. */
function dcBlock(s, ch) {
  const R = 0.9985;
  for (let c = 0; c < ch; c++) {
    let x1 = 0, y1 = 0;
    for (let i = c; i < s.length; i += ch) { const x = s[i]; const y = x - x1 + R * y1; x1 = x; y1 = y; s[i] = y; }
  }
}

/** BS.1770 K-weighting (libebur128 coefficients for any sample rate), returns filtered copy. */
function kWeight(s, ch) {
  const out = new Float32Array(s.length);
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / SR);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const pb = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0];
  const pa = [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / SR);
  a0 = 1 + K / Q + K * K;
  const ra = [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  for (let c = 0; c < ch; c++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
    for (let i = c; i < s.length; i += ch) {
      const x = s[i];
      const y = pb[0] * x + pb[1] * x1 + pb[2] * x2 - pa[0] * y1 - pa[1] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const z = y - 2 * u1 + u2 - ra[0] * z1 - ra[1] * z2;
      u2 = u1; u1 = y; z2 = z1; z1 = z;
      out[i] = z;
    }
  }
  return out;
}

/** Loudness (LUFS-like, ungated) of K-weighted samples over [a, b) frames. */
function loudnessOf(kw, ch, a, b) {
  let sum = 0;
  for (let i = a * ch; i < b * ch; i++) sum += kw[i] * kw[i];
  const frames = Math.max(1, b - a);
  return -0.691 + 10 * Math.log10(Math.max(1e-12, sum / frames));
}

/** Max loudness over a sliding window (ms), hop 10 ms. */
function maxWindowLoudness(kw, ch, windowMs) {
  const frames = kw.length / ch, w = Math.max(1, Math.round(SR * windowMs / 1000)), hop = Math.round(SR * 0.01);
  if (frames <= w) return loudnessOf(kw, ch, 0, frames);
  // Prefix sum of per-frame energy.
  const energy = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) { let e = 0; for (let c = 0; c < ch; c++) { const v = kw[f * ch + c]; e += v * v; } energy[f + 1] = energy[f] + e; }
  let best = 0;
  for (let a = 0; a + w <= frames; a += hop) best = Math.max(best, energy[a + w] - energy[a]);
  return -0.691 + 10 * Math.log10(Math.max(1e-12, best / w));
}

function analyze(s, ch) {
  const frames = s.length / ch;
  // ElevenLabs masters everything hot: decoded peaks of ~1.4 and a percent or
  // two of samples at full scale are normal. Only a crushed, square-topped take
  // (a big share of samples pinned at the rail) is refused.
  let peak = 0, pinned = 0;
  for (let i = 0; i < s.length; i++) {
    const a = Math.abs(s[i]);
    if (a > peak) peak = a;
    if (a >= 0.99) pinned++;
  }
  const pinnedPct = (100 * pinned) / Math.max(1, s.length);
  const frameAbs = (f) => { let m = 0; for (let c = 0; c < ch; c++) m = Math.max(m, Math.abs(s[f * ch + c])); return m; };
  const onsetThresh = Math.max(peak * 0.02, undb(-60));
  const tailThresh = Math.max(peak * 0.0035, undb(-66));
  let onset = 0; while (onset < frames && frameAbs(onset) < onsetThresh) onset++;
  let end = frames - 1; while (end > onset && frameAbs(end) < tailThresh) end--;
  // The sample-peak test above keeps a long hissy tail alive on stray noise
  // peaks; an RMS envelope (10 ms windows) ends the sound where it actually
  // falls 44 dB under its loudest moment.
  const win = Math.round(SR * 0.01);
  let maxRms = 0; const rms = [];
  for (let f = 0; f + win <= frames; f += win) {
    let e = 0; for (let k = f; k < f + win; k++) for (let c = 0; c < ch; c++) e += s[k * ch + c] ** 2;
    const r = Math.sqrt(e / (win * ch)); rms.push(r); if (r > maxRms) maxRms = r;
  }
  const rmsFloor = maxRms * undb(-44);
  let lastLoud = rms.length - 1; while (lastLoud > 0 && rms[lastLoud] < rmsFloor) lastLoud--;
  end = Math.min(end, Math.max(onset + win, (lastLoud + 1) * win));
  // Is the sound still loud at the very end (the model ran out of time mid-sound)?
  const tailFrames = Math.min(frames, Math.round(SR * 0.03));
  let tailSum = 0;
  for (let f = frames - tailFrames; f < frames; f++) for (let c = 0; c < ch; c++) tailSum += s[f * ch + c] ** 2;
  const tailDb = db(Math.sqrt(tailSum / Math.max(1, tailFrames * ch)));
  return { frames, peak, pinnedPct, onset, end, tailDb };
}

/** Lookahead brickwall-ish limiter at `ceiling` (linear), in place. */
function limit(s, ch, ceiling) {
  const frames = s.length / ch;
  const look = Math.round(SR * 0.0015), rel = Math.exp(-1 / (SR * 0.06));
  const need = new Float32Array(frames);
  let over = false;
  for (let f = 0; f < frames; f++) {
    let m = 0; for (let c = 0; c < ch; c++) m = Math.max(m, Math.abs(s[f * ch + c]));
    need[f] = m > ceiling ? ceiling / m : 1;
    if (m > ceiling) over = true;
  }
  if (!over) return 0;
  // Lookahead: the gain at f is the minimum need over [f, f + look].
  const gmin = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let g = 1; for (let k = f; k <= Math.min(frames - 1, f + look); k++) if (need[k] < g) g = need[k]; gmin[f] = g; }
  let g = 1, deepest = 1;
  for (let f = 0; f < frames; f++) {
    const target = gmin[f];
    g = target < g ? target : target + (g - target) * rel;
    if (g < deepest) deepest = g;
    for (let c = 0; c < ch; c++) s[f * ch + c] *= g;
  }
  return db(deepest);
}

function fadeIn(s, ch, frames) {
  for (let f = 0; f < Math.min(frames, s.length / ch); f++) { const g = f / frames; for (let c = 0; c < ch; c++) s[f * ch + c] *= g; }
}
function fadeOut(s, ch, frames) {
  const total = s.length / ch;
  frames = Math.min(frames, total);
  for (let k = 0; k < frames; k++) {
    const f = total - frames + k;
    const g = 0.5 + 0.5 * Math.cos(Math.PI * (k + 1) / frames);
    for (let c = 0; c < ch; c++) s[f * ch + c] *= g;
  }
}

/**
 * A `fast` cue (the Duel's cabinet: it hits at once, it never swells) reaches its loudest 10 ms within
 * this of its onset, or the take is refused.
 */
const FAST_ATTACK_MS = 40;

/** Onset (the first 10 ms window over 3% of the loudest) to the loudest 10 ms window, in ms. */
function attackMs(s, ch) {
  const win = Math.round(SR * 0.01), rms = [];
  for (let f = 0; (f + win) * ch <= s.length; f += win) {
    let e = 0; for (let i = f * ch; i < (f + win) * ch; i++) e += s[i] * s[i];
    rms.push(Math.sqrt(e / (win * ch)));
  }
  const peak = Math.max(...rms), at = rms.indexOf(peak), onset = rms.findIndex((v) => v > peak * 0.03);
  return (at - Math.max(0, onset)) * 10;
}

const TARGET = {
  oneShot: -15, // K-weighted loudest 100 ms (≈ short-term "punch" LUFS)
  loop: -21, // integrated, whole loop
  bed: -24, // integrated, whole bed
};

/** QC + master one take. Returns { ok, reason?, samples?, ch, stats }. */
function master(spec, rawFile) {
  const ch = spec.stereo ? 2 : 1;
  const s = decode(rawFile, ch);
  dcBlock(s, ch);
  const a = analyze(s, ch);
  const stats = { rawSec: +(a.frames / SR).toFixed(3), peakDb: +db(a.peak).toFixed(1), onsetSec: +(a.onset / SR).toFixed(3), pinnedPct: +a.pinnedPct.toFixed(2) };
  // A take this far below the model's usual level is mostly noise floor.
  if (a.peak < undb(-32)) return { ok: false, reason: `weak take (peak ${stats.peakDb} dBFS)`, ch, stats };
  if (a.pinnedPct > 8) return { ok: false, reason: `crushed (${stats.pinnedPct}% of samples at full scale)`, ch, stats };
  if (spec.loop || spec.bed) {
    if (a.frames / SR < spec.dur * 0.85) return { ok: false, reason: `short loop (${stats.rawSec}s of ${spec.dur}s)`, ch, stats };
    const kw = kWeight(s, ch);
    // Quiet stretches inside a loop read as a gap every cycle.
    const quarters = [0, 1, 2, 3].map((q) => loudnessOf(kw, ch, Math.floor(a.frames * q / 4), Math.floor(a.frames * (q + 1) / 4)));
    const spread = Math.max(...quarters) - Math.min(...quarters);
    stats.quarterSpreadDb = +spread.toFixed(1);
    if (spread > (spec.bed ? 16 : 15)) return { ok: false, reason: `uneven loop (${spread.toFixed(1)} dB between quarters)`, ch, stats };
    const loud = loudnessOf(kw, ch, 0, a.frames);
    const gainDb = (spec.bed ? TARGET.bed : TARGET.loop) - loud;
    const g = undb(gainDb);
    for (let i = 0; i < s.length; i++) s[i] *= g;
    stats.gainDb = +gainDb.toFixed(1);
    stats.limitDb = +limit(s, ch, undb(-1)).toFixed(1);
    stats.sec = stats.rawSec;
    return { ok: true, samples: s, ch, stats };
  }
  // ---- one-shot ----
  const lateLimit = Math.max(0.2, spec.dur * 0.4);
  if (!spec.soft && a.onset / SR > lateLimit) return { ok: false, reason: `late onset (${stats.onsetSec}s)`, ch, stats };
  const pre = Math.round(SR * 0.004), post = Math.round(SR * 0.03);
  let start = Math.max(0, a.onset - pre);
  let end = Math.min(a.frames, a.end + post);
  const truncated = end >= a.frames - 1 && a.tailDb > -42;
  let out = s.slice(start * ch, end * ch);
  if (start > 0) fadeIn(out, ch, Math.round(SR * 0.002));
  let frames = out.length / ch;
  if (spec.max && frames / SR > spec.max) {
    frames = Math.round(SR * spec.max);
    out = out.slice(0, frames * ch);
    fadeOut(out, ch, Math.max(Math.round(SR * 0.03), Math.round(frames * 0.3)));
  } else {
    fadeOut(out, ch, truncated ? Math.min(Math.round(SR * 0.15), Math.round(frames * 0.2)) : Math.min(Math.round(SR * 0.025), Math.round(frames * 0.25)));
  }
  if (frames / SR < 0.025) return { ok: false, reason: `too short after trim (${(frames / SR).toFixed(3)}s)`, ch, stats };
  if (spec.fast) {
    stats.attackMs = attackMs(out, ch);
    if (stats.attackMs > FAST_ATTACK_MS) return { ok: false, reason: `slow attack (${stats.attackMs} ms to its peak)`, ch, stats };
  }
  const kw = kWeight(out, ch);
  const loud = maxWindowLoudness(kw, ch, 100);
  if (loud < -52) return { ok: false, reason: `near-silent (${loud.toFixed(1)} LUFS)`, ch, stats };
  // Match loudness, but never limit a transient by more than 3 dB to get
  // there: a click keeps its snap and simply sits a little under the target.
  let outPeak = 0;
  for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]); if (v > outPeak) outPeak = v; }
  const gainDb = Math.min(TARGET.oneShot - loud, -1 - db(outPeak) + 3);
  const g = undb(gainDb);
  for (let i = 0; i < out.length; i++) out[i] *= g;
  stats.gainDb = +gainDb.toFixed(1);
  stats.limitDb = +limit(out, ch, undb(-1)).toFixed(1);
  stats.sec = +(frames / SR).toFixed(3);
  stats.truncated = truncated;
  return { ok: true, samples: out, ch, stats };
}

/** Lower is better: prefer takes that are less crushed and start promptly. */
const scoreOf = (stats) => stats.pinnedPct + (stats.onsetSec > 0.1 ? 3 : 0) + (stats.limitDb < -2 ? 1 : 0)
  + Math.max(0, -20 - stats.peakDb) / 4; // quiet takes carry more noise floor once normalised

const bitrateOf = (spec) => (spec.bed ? '96k' : spec.loop ? '64k' : '72k');

// ------------------------------------------------------------------ main
const report = existsSync(REPORT_FILE) ? JSON.parse(readFileSync(REPORT_FILE, 'utf8')) : {};
const specs = cueIds.filter(selected).map(specOf);

// Apply audition rejects before anything else.
const rejects = readRejects();
for (const r of rejects) {
  const spec = specOf(r.id), s = stateOf(spec);
  const slot = r.take - 1;
  if (slot >= s.variants.length || s.variants[slot] === undefined || s.variants[slot] < 0) continue;
  s.rejected.push(s.variants[slot]);
  console.log(`audition reject: ${r.id} take ${r.take} (variant ${s.variants[slot]})`);
  s.variants[slot] = -1; // refilled from the cache or a fresh generation
}

const estimate = (spec) => Math.ceil(spec.dur * CREDITS_PER_SECOND);
if (DRY) {
  let total = 0; const byPack = {};
  for (const spec of specs) { const e = estimate(spec) * spec.takes; total += e; byPack[spec.pack] = (byPack[spec.pack] ?? 0) + e; }
  console.log(`${specs.length} cues, ${specs.reduce((n, s) => n + s.takes, 0)} takes, ~${total} credits before rejects (cached takes cost nothing).`);
  for (const [p, e] of Object.entries(byPack).sort((a, b) => b[1] - a[1])) console.log(`  ${p.padEnd(22)} ${e}`);
  console.log(`prior logged SFX spend: ${budget.start}, cap ${CAP}`);
  process.exit(0);
}

let startCounter = null;
if (!OFFLINE) { try { startCounter = (await subscription()).used; } catch (e) { console.warn('subscription check failed:', e.message); } }

const written = new Set();
const failures = [];
const MAX_EXTRA = 4;

const PROBE_CACHED = 40;

async function runCue(spec) {
  const s = stateOf(spec);
  const params = (variant) => ({ text: spec.prompt, durationSeconds: spec.dur, promptInfluence: spec.influence, loop: spec.loop || spec.bed, variant });
  const evaluated = new Map(); // variant -> master result
  const evaluate = (variant, file) => {
    if (!evaluated.has(variant)) evaluated.set(variant, master(spec, file));
    return evaluated.get(variant);
  };
  const human = new Set(s.rejected);
  // 1. Keep current choices that still pass (stable across runs), in slot order.
  const chosen = new Array(spec.takes).fill(-1);
  for (let slot = 0; slot < spec.takes; slot++) {
    const v = s.variants[slot];
    if (v === undefined || v < 0 || human.has(v)) continue;
    const file = cachedSoundEffectFile(params(v));
    if (file && evaluate(v, file).ok) chosen[slot] = v;
  }
  // 2. Fill empty slots from takes already paid for, best score first.
  const pool = [];
  for (let v = 0; v < PROBE_CACHED && chosen.includes(-1); v++) {
    if (human.has(v) || chosen.includes(v)) continue;
    const file = cachedSoundEffectFile(params(v));
    if (!file) continue;
    if (evaluate(v, file).ok) pool.push(v);
  }
  pool.sort((a, b) => scoreOf(evaluated.get(a).stats) - scoreOf(evaluated.get(b).stats));
  for (let slot = 0; slot < spec.takes; slot++) if (chosen[slot] < 0 && pool.length) chosen[slot] = pool.shift();
  // 3. Buy new takes for whatever is still empty.
  let lastFail = null;
  for (let slot = 0; slot < spec.takes; slot++) {
    let attempts = 0;
    while (chosen[slot] < 0 && attempts <= MAX_EXTRA && !OFFLINE) {
      const v = nextVariant({ variants: chosen, rejected: s.rejected, failed: [] }, [...evaluated.keys()]);
      const res = await soundEffect(params(v), budget);
      const m = evaluate(v, res.file);
      if (m.ok) chosen[slot] = v;
      else { lastFail = m.reason; console.log(`  QC reject ${spec.id} variant ${v}: ${m.reason}`); attempts++; }
    }
  }
  s.variants = chosen;
  s.failed = [...evaluated.entries()].filter(([, m]) => !m.ok).map(([v]) => v).sort((a, b) => a - b);
  // 4. Write the chosen takes.
  const rows = [];
  for (let slot = 0; slot < spec.takes; slot++) {
    const v = chosen[slot];
    const out = outFileOf(spec, slot);
    if (v < 0) {
      failures.push(`${spec.id} take ${slot + 1}: ${OFFLINE ? 'not cached' : lastFail}`);
      if (existsSync(out)) written.add(out); // keep the previous good file, if any
      continue;
    }
    const m = evaluated.get(v);
    encode(m.samples, m.ch, out, bitrateOf(spec));
    written.add(out);
    rows.push({ take: slot + 1, variant: v, ...m.stats, bytes: statSync(out).size });
  }
  report[spec.id] = { pack: spec.pack, cat: spec.cat, prompt: spec.prompt, dur: spec.dur, takes: rows };
  const secs = rows.map((r) => r.sec).join('/');
  console.log(`${spec.id.padEnd(30)} ${rows.length}/${spec.takes} takes  ${secs}s`);
}

// Simple worker pool.
const queue = [...specs];
let aborted = null;
async function worker() {
  while (queue.length && !aborted) {
    const spec = queue.shift();
    try { await runCue(spec); } catch (e) { aborted = e; }
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
writeFileSync(TAKES_FILE, JSON.stringify(takes, null, 1) + '\n');
writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1) + '\n');

// Consume the audition rejects file once applied.
if (rejects.length && existsSync(REJECTS_FILE)) renameSync(REJECTS_FILE, REJECTS_FILE.replace(/\.json$/, `.applied-${Date.now()}.json`));

// A full run owns the asset tree: delete files no cue produced (renamed or dropped cues, fewer takes).
if (!matchers && !aborted && !OFFLINE) {
  const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
  for (const f of [...walk(join(ASSET_ROOT, 'sfx')), ...walk(join(ASSET_ROOT, 'ambience'))]) {
    if (f.endsWith('.mp3') && !written.has(f)) { rmSync(f); console.log('removed stale', relative(ROOT, f)); }
  }
}

let bytes = 0, files = 0, seconds = 0;
for (const r of Object.values(report)) for (const t of r.takes) { bytes += t.bytes ?? 0; files++; seconds += t.sec ?? 0; }
console.log(`\n${files} files, ${(bytes / 1048576).toFixed(2)} MB, ${seconds.toFixed(1)} s of audio.`);
console.log(`SFX spend this run: ${budget.spent} credits (logged total ${budget.start + budget.spent} of ${CAP}).`);
if (startCounter !== null) {
  try { const now = (await subscription()).used; console.log(`account counter moved ${now - startCounter} during this run (includes any parallel generators).`); } catch { /* ignore */ }
}
if (failures.length) { console.log(`\n${failures.length} slot(s) without a good take:`); for (const f of failures) console.log('  ' + f); }
if (aborted) { console.error('\nAborted:', aborted.message); process.exit(1); }
