// How immediate a one-shot is (the Duel's cabinet must hit at once, never swell): the time from the
// sound's onset to its loudest 10 ms, and how much of it is left 150 ms later. Usage: node sfx-attack.mjs <files…>
import { spawnSync } from 'node:child_process';

export function attackOf(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '44100', 'pipe:1'], { maxBuffer: 1 << 28 });
  const b = r.stdout, x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const win = 441, rms = [];
  for (let i = 0; i + win <= x.length; i += win) { let e = 0; for (let k = i; k < i + win; k++) e += x[k] * x[k]; rms.push(Math.sqrt(e / win)); }
  const peak = Math.max(...rms), at = rms.indexOf(peak);
  const onset = rms.findIndex((v) => v > peak * 0.03);
  const later = rms[Math.min(rms.length - 1, at + 15)] ?? 0;
  return { attackMs: (at - onset) * 10, onsetMs: onset * 10, seconds: +(x.length / 44100).toFixed(2), tail150Db: +(20 * Math.log10((later + 1e-9) / peak)).toFixed(1) };
}

if (process.argv[1]?.endsWith('sfx-attack.mjs')) for (const f of process.argv.slice(2)) console.log(f.split(/[\/]/).pop().padEnd(28), JSON.stringify(attackOf(f)));
