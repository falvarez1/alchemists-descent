import { describe, expect, it, vi } from 'vitest';
import { SfxAudioEngine } from '@/audio/SfxEngine';
import { arenaHurtVoice, needsArenaHurtImpact } from '@/audio/arenaAudio';
import { FIGHTER_ORDER } from '@/content/fighters';
import { sfxCue } from '@/content/audio/sfxCatalog';
import { readFileSync } from 'node:fs';

describe('Arena combat audio', () => {
  it('replaces generic hurt with the current fighter and avoids a second contact layer for stock melee/throw', () => {
    const engine = new SfxAudioEngine();
    vi.spyOn(engine.bank, 'has').mockReturnValue(true);
    const play = vi.spyOn(engine, 'sfx').mockImplementation(() => undefined);
    engine.setArenaHurtProvider(() => ({ ...arenaHurtVoice('brann-rook'), x: 800, y: 630, impact: needsArenaHurtImpact(true, 'melee.finisher') }));
    engine.hurt();
    expect(play.mock.calls.map(c => c[0])).toEqual(['arena.hurt.armored']);
    expect(play.mock.calls[0][3]?.pitch).toBe(-1);
    expect(needsArenaHurtImpact(true, 'throw.up')).toBe(false);
    play.mockClear();
    engine.setArenaHurtProvider(() => ({ ...arenaHurtVoice('mara-quell'), x: 820, y: 630, impact: needsArenaHurtImpact(false, 'melee') }));
    engine.hurt();
    expect(play.mock.calls.map(c => c[0])).toEqual(['arena.hit.light', 'arena.hurt.duelist']);
  });
  it('has a bounded pitch and voice mix for every playable fighter', () => {
    for (const id of FIGHTER_ORDER) {
      const v = arenaHurtVoice(id), cue = sfxCue(v.cue);
      expect(Math.abs(v.pitch)).toBeLessThanOrEqual(2);
      expect(cue.bus).toBe('voices');
      expect(cue.voices).toBe(2);
      expect(cue.cooldownMs).toBeGreaterThanOrEqual(90);
    }
  });
  it('ships premium model takes with safe measured true peaks and short tails', () => {
    const report = JSON.parse(readFileSync('scripts/audio/arena-sfx-report.json', 'utf8')) as Array<{ model: string; truePeak: number; duration: number }>;
    expect(report).toHaveLength(23);
    for (const take of report) {
      expect(take.model).toBe('eleven_text_to_sound_v2');
      expect(take.truePeak).toBeLessThanOrEqual(-2);
      expect(take.duration).toBeGreaterThan(0.1);
      expect(take.duration).toBeLessThan(0.8);
    }
  });
});
