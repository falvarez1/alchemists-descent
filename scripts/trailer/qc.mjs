// Footage QC: integrity (frames, rate, ticks) plus black / blown-out stretches
// for every shot in footage/ (or the ids given).
//   node scripts/trailer/qc.mjs [id...] [--out <footage dir>]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = resolve(outIdx >= 0 ? argv[outIdx + 1] : 'Y:/Projects/alchemists-descent-worktrees/trailer/footage');
const ids = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');

const sidecars = readdirSync(OUT)
  .filter((f) => f.endsWith('.json') && f !== 'shots.json')
  .map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')))
  .filter((s) => s.id && (!ids.length || ids.includes(s.id)));

/** Per-second mean luma (YAVG) and a count of near-black / near-white frames. */
function luma(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const values = [...r.stderr.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return values;
}

let problems = 0;
console.log('id'.padEnd(26), 'dur'.padStart(6), 'frames', 'ticks', 'luma(min/avg/max)', 'black', 'white', 'marks', 'flags');
for (const s of sidecars) {
  const file = join(OUT, s.file);
  if (!existsSync(file)) { console.log(s.id.padEnd(26), 'MISSING VIDEO'); problems++; continue; }
  const y = luma(file);
  const black = y.filter((v) => v < 20).length;
  const white = y.filter((v) => v > 200).length;
  const avg = y.reduce((a, b) => a + b, 0) / Math.max(1, y.length);
  const flags = [];
  const it = s.integrity ?? {};
  if (it.encodedFrames !== it.frames) flags.push(`encoded ${it.encodedFrames}/${it.frames}`);
  if (it.rate && it.rate !== '60/1') flags.push(`rate ${it.rate}`);
  if (it.tickGaps) flags.push(`${it.tickGaps} tick gaps`);
  if (it.ticks !== it.expectedTicks) flags.push(`ticks ${it.ticks}/${it.expectedTicks}`);
  if (y.length !== it.frames) flags.push(`decoded ${y.length}`);
  if (black > y.length * 0.1 && !/dark/.test(s.id)) flags.push('dark stretch');
  if (white > 3) flags.push('blown-out frames');
  if (!s.marks?.length) flags.push('no marks');
  if (flags.length) problems++;
  console.log(s.id.padEnd(26), s.durationS.toFixed(2).padStart(6), String(it.frames).padStart(6), String(it.ticks).padStart(5),
    `${Math.min(...y).toFixed(0)}/${avg.toFixed(0)}/${Math.max(...y).toFixed(0)}`.padStart(17), String(black).padStart(5),
    String(white).padStart(5), String(s.marks?.length ?? 0).padStart(5), flags.join(', '));
}
console.log(`${sidecars.length} shots, ${problems} with flags`);
