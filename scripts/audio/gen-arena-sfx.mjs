// Original premium ElevenLabs Sound Effects v2 takes. Cached paid responses.
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { SFX_PROMPTS } from './sfx-prompts.mjs';
process.env.AUDIO_LOG_NAME = 'generation-log.arena-sfx.jsonl';
const { soundEffect, Budget, measure } = await import('./elevenlabs.mjs');
const budget = new Budget(1500), report = [];
mkdirSync('src/assets/audio/sfx/arena', { recursive: true });
try {
  for (const [id, p] of Object.entries(SFX_PROMPTS).filter(([id]) => id.startsWith('arena.'))) {
    for (let take = 1; take <= p.t; take++) {
      console.log(`Generating ${id} take ${take}`);
      const result = await soundEffect({ text: p.p, durationSeconds: p.d, promptInfluence: p.i, outputFormat: 'mp3_44100_192', variant: take }, budget);
      const file = `src/assets/audio/sfx/arena/${id}-${take}.mp3`;
      // Remove generation dead air and preserve the attack. Short tails leave
      // rapid hits readable. Peak-normalize a measured file, never crush the transient.
      const filters = `aformat=channel_layouts=mono,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.003,atrim=duration=${p.max},afade=t=out:st=${p.max - 0.035}:d=0.035`;
      const run = args => { const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`Mastering ${id} failed`); return r.stderr; };
      const stat = run(['-i', result.file, '-af', `${filters},volumedetect`, '-f', 'null', '-']);
      const peak = Number(stat.match(/max_volume: (-?[\d.]+) dB/)?.[1]);
      if (!Number.isFinite(peak) || peak < -55) throw new Error(`Silent generated take ${id}`);
      const gain = -4 - peak;
      run(['-y', '-i', result.file, '-af', `${filters},volume=${gain}dB`, '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '160k', file]);
      let measured = measure(file);
      // MP3 overshoot and floating-point source peaks can exceed the integer
      // volumedetect estimate. Re-encode from the source with measured headroom.
      if (measured.truePeak > -3) {
        run(['-y', '-i', result.file, '-af', `${filters},volume=${gain - measured.truePeak - 3.5}dB`, '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '160k', file]);
        measured = measure(file);
      }
      // EBU's 400 ms gate cannot report integrated LUFS for the shortest hits.
      if (measured.lufs <= -69) measured.lufs = null;
      report.push({ id, take, model: 'eleven_text_to_sound_v2', cacheKey: result.key, ...measured, bytes: statSync(file).size, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
    }
  }
  writeFileSync('scripts/audio/arena-sfx-report.json', JSON.stringify(report, null, 2) + '\n');
} catch (e) { console.error(String(e.message).replace(/sk_[A-Za-z0-9]+/g, '[redacted]')); process.exitCode = 1; }
