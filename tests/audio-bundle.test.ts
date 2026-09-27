import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { SFX_PROMPTS } from '../scripts/audio/sfx-prompts.mjs';

/**
 * Nothing client-side may talk to ElevenLabs: the game ships only the audio
 * files the offline generator wrote. This builds the production bundle into a
 * scratch directory (or scans AUDIO_BUNDLE_DIR if a build is already there)
 * and checks every emitted file, source maps included.
 */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe('the production bundle', () => {
  it('carries no ElevenLabs key, no API endpoint, no prompts, and every sound file', async () => {
    const preset = process.env.AUDIO_BUNDLE_DIR;
    const outDir = preset ?? mkdtempSync(join(tmpdir(), 'bw-audio-bundle-'));
    try {
      if (!preset) {
        await build({
          configFile: join(__dirname, '..', 'vite.config.ts'),
          mode: 'production',
          logLevel: 'silent',
          build: { outDir, emptyOutDir: true },
        });
      }
      const files = walk(outDir);
      const text = files.filter((f) => /\.(js|mjs|css|html|json|map|txt|webmanifest)$/.test(f));
      expect(text.length).toBeGreaterThan(3);
      const leaks: string[] = [];
      // A distinctive phrase from the generation prompts must be tree-shaken out.
      const promptProbe = SFX_PROMPTS['player.step.stone'].p.slice(0, 40);
      for (const f of text) {
        const body = readFileSync(f, 'utf8');
        if (/sk_[A-Za-z0-9]{20,}/.test(body)) leaks.push(`${f}: sk_ token`);
        if (body.includes('api.elevenlabs.io')) leaks.push(`${f}: api.elevenlabs.io`);
        if (/xi-api-key/i.test(body)) leaks.push(`${f}: xi-api-key header`);
        if (body.includes(promptProbe)) leaks.push(`${f}: generation prompts`);
      }
      expect(leaks).toEqual([]);
      // The dev-only audition page is not part of a player build.
      expect(files.some((f) => /audition/i.test(f))).toBe(false);
      // Every mastered take is emitted as its own hashed file (none inlined into JS).
      const onDisk = walk(join(__dirname, '..', 'src', 'assets', 'audio')).filter((f) => f.endsWith('.mp3')).length;
      // The score and the narration stream from public/audio (copied verbatim, not hashed);
      // count only the hashed sound-effect takes Vite emitted under assets/.
      const emitted = files.filter((f) => f.endsWith('.mp3') && /[\\/]assets[\\/]/.test(f.slice(outDir.length))).length;
      expect(emitted).toBe(onDisk);
      for (const f of text.filter((x) => x.endsWith('.js'))) expect(readFileSync(f, 'utf8').includes('data:audio/mpeg')).toBe(false);
    } finally {
      if (!preset && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    }
  }, 300_000);
});
