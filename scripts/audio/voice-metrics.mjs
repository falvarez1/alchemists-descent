// What we can measure about a voice without hearing it (scripts/audio/gen-duel-announcer.mjs
// casts and checks the Duel's announcer with these): pitch and its range, how much of the
// voice sits in the presence band (a shout is bright, a murmur is dark), the crispness of
// its S sounds (cast-voices.mjs `sibilance`: a lisp smears them into the mids), and whether
// speech-to-text hears back the words that were asked for.

import { spawnSync } from 'node:child_process';

const SR = 16000;

function pcm(file, sr = SR) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(sr), 'pipe:1'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${file}`);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;

/**
 * Per 40 ms frame (hop 10 ms): the fundamental by normalised autocorrelation
 * (70-420 Hz; voiced when the peak correlation passes 0.55 on a frame with
 * real energy) and the presence balance (1-5 kHz against 80 Hz-1 kHz, dB),
 * from a 512-point DFT of the voiced frames.
 */
export function voiceShape(file) {
  const x = pcm(file);
  const N = 640, hop = 160, minLag = Math.floor(SR / 420), maxLag = Math.ceil(SR / 70);
  let peakEnergy = 0;
  const energies = [];
  for (let off = 0; off + N <= x.length; off += hop) {
    let e = 0; for (let i = 0; i < N; i++) e += x[off + i] * x[off + i];
    energies.push(e); if (e > peakEnergy) peakEnergy = e;
  }
  const f0 = [], presence = [];
  const K = 512, cos = new Float64Array(K), sin = new Float64Array(K), hann = new Float64Array(K);
  for (let i = 0; i < K; i++) { cos[i] = Math.cos((2 * Math.PI * i) / K); sin[i] = Math.sin((2 * Math.PI * i) / K); hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (K - 1)); }
  for (let f = 0, off = 0; off + N <= x.length; f++, off += hop) {
    if (energies[f] < peakEnergy * 0.02) continue;
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0, a = 0, b = 0;
      for (let i = 0; i + lag < N; i++) { const p = x[off + i], q = x[off + i + lag]; num += p * q; a += p * p; b += q * q; }
      const r = num / Math.sqrt(a * b + 1e-12);
      if (r > best) { best = r; bestLag = lag; }
    }
    if (best < 0.55) continue;
    f0.push(SR / bestLag);
    // Band balance on the voiced frame (Hann window, plain DFT over K bins: frames are few).
    let low = 0, high = 0;
    for (let k = 3; k < K / 2; k++) {
      const hz = (k * SR) / K;
      if (hz < 80 || hz > 5000) continue;
      let re = 0, im = 0;
      for (let i = 0; i < K; i++) {
        const v = x[off + i] * hann[i], t = (k * i) % K;
        re += v * cos[t]; im -= v * sin[t];
      }
      const p = re * re + im * im;
      if (hz < 1000) low += p; else high += p;
    }
    presence.push(10 * Math.log10((high + 1e-12) / (low + 1e-12)));
  }
  const sorted = [...f0].sort((a, b) => a - b), pres = [...presence].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  return {
    voicedFrames: f0.length,
    f0Median: +median.toFixed(1),
    // The spread of the line's melody in semitones (10th to 90th percentile): a flat read scores low.
    f0RangeSt: +(12 * Math.log2(percentile(sorted, 0.9) / percentile(sorted, 0.1))).toFixed(1),
    presenceDb: +percentile(pres, 0.5).toFixed(1),
  };
}

const NUMBERS = { 3: 'three', 2: 'two', 1: 'one', '3!': 'three', '2!': 'two', '1!': 'one' };

/** Words as speech-to-text and a script would both spell them: lower case, no punctuation, digits as words. */
export function words(text) {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .toLowerCase()
    .replace(/k\.\s*o\.?/g, 'ko')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBERS[w] ?? w);
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** 1 for the same spelling, 0 for nothing in common (normalised character edit distance). */
export function similarity(a, b) {
  if (a === b) return 1;
  return 1 - editDistance([...a], [...b]) / Math.max(a.length, b.length, 1);
}

/**
 * Does what was heard say what was asked? Word by word (an alignment with
 * fuzzy substitution): an ordinary word must come back spelled the same, a
 * name (the fighters' invented ones, which no transcriber knows) close
 * enough (`nameSimilarity`). Returns the word error rate and the misses.
 */
export function heardAsAsked(asked, heard, names = [], nameSimilarity = 0.6, homophones = {}) {
  const a = words(asked), h = words(heard);
  const nameSet = new Set(names.flatMap((n) => words(n)));
  // A compound said as written but spelled apart or together ("Redline" heard as "Red line", "Kiln Heart"
  // as "Kilnhart": heart and hart sound alike) is the same words: the letters joined, an invented name's
  // within 85%. Never when the voice SPELLED it (single letters, "K-E-S-T"): that is not the word.
  const joinedA = a.join(''), joinedH = h.join('');
  if (!h.some((w) => w.length === 1) && (joinedA === joinedH || (a.every((w) => nameSet.has(w)) && similarity(joinedA, joinedH) >= 0.85))) {
    return { wer: 0, ok: true, closeness: similarity(joinedA, joinedH), misses: [], heardWords: h };
  }
  const cost = (x, y) => {
    if (x === y || homophones[x]?.includes(y)) return 0;
    if (nameSet.has(x) && similarity(x, y) >= nameSimilarity) return 0;
    return 1;
  };
  // How close the names came back (1 = every word spelled as asked): picks between confirmed takes.
  const near = (x, y) => (x === y || homophones[x]?.includes(y) ? 1 : nameSet.has(x) ? similarity(x, y) : 0);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= h.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost(a[i - 1], h[j - 1]));
  }
  const misses = [];
  let closeness = 0;
  for (let i = a.length, j = h.length; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + cost(a[i - 1], h[j - 1])) { closeness += near(a[i - 1], h[j - 1]); if (cost(a[i - 1], h[j - 1])) misses.push(`${a[i - 1]}→${h[j - 1]}`); i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { misses.push(`${a[i - 1]}→∅`); i--; }
    else { misses.push(`∅→${h[j - 1]}`); j--; }
  }
  return { wer: +(d[a.length][h.length] / Math.max(1, a.length)).toFixed(3), ok: d[a.length][h.length] === 0, closeness: +(closeness / Math.max(1, a.length, h.length)).toFixed(3), misses: misses.reverse(), heardWords: h };
}
