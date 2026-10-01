import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { arrivalLine, narrationKey, normalizeNarration } from '@/audio/narrationText';
import { NARRATION_COOLDOWN_MS, NarrationGate } from '@/audio/narrationRules';
import { NARRATION_CLIPS, NARRATION_LINES, NARRATOR_VOICE } from '@/content/audio/narration.generated';
import { GAME_TAGLINE } from '@/config/brand';
import { FLOOR_LOOKS } from '@/config/floorLooks';
import { CAMPAIGN_FLOORS, LEVELS, floorDisplayName } from '@/config/worldgraph';
import { FLOOR_LORE } from '@/content/floorLore';
import { deathCauseLine, deathTitle, knownDeathCauseSources } from '@/ui/deathCauses';
import { VICTORY_EPITAPH, runHeadline } from '@/game/runRules';
import { readPlayerPreferences } from '@/ui/PlayerSettings';

const clipFor = (text: string) => NARRATION_CLIPS[narrationKey(text)];

describe('narration keys', () => {
  it('ignore case, curly punctuation, ellipses and spacing, but not words', () => {
    expect(narrationKey('Pour water through the grate into the duck’s bath'))
      .toBe(narrationKey("pour water through the grate into the duck's   bath"));
    expect(narrationKey('THE KILN IS COLD')).toBe(narrationKey('The kiln is cold'));
    expect(normalizeNarration('The boulder rolls down the ramp toward the dominoes…')).toContain('dominoes...');
    expect(narrationKey('You burned.')).not.toBe(narrationKey('You froze.'));
    expect(narrationKey('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('the narrator\'s manners', () => {
  it('never says the same words twice a session', () => {
    const g = new NarrationGate();
    expect(g.unheard(['a', 'b', 'a'])).toEqual(['a', 'b']);
    g.markHeard('a');
    expect(g.unheard(['a', 'b'])).toEqual(['b']);
  });

  it('speaks one line at a time: lower waits out the cooldown, higher interrupts, high queues behind high', () => {
    const g = new NarrationGate();
    expect(g.decide('low', 0, null, 0)).toBe('play');
    expect(g.decide('low', 0, 'low', 0)).toBe('drop');
    expect(g.decide('normal', 0, 'low', 0)).toBe('interrupt');
    expect(g.decide('high', 0, 'normal', 0)).toBe('interrupt');
    expect(g.decide('high', 0, 'high', 0)).toBe('queue');
    expect(g.decide('high', 0, 'high', 2)).toBe('drop');
    expect(g.decide('normal', 0, 'high', 0)).toBe('drop');
    g.finished(1000);
    expect(g.decide('normal', 1000 + NARRATION_COOLDOWN_MS - 1, null, 0)).toBe('drop');
    expect(g.decide('high', 1001, null, 0)).toBe('play');
    expect(g.decide('low', 1000 + NARRATION_COOLDOWN_MS, null, 0)).toBe('play');
  });

  it('is on by default and remembers being turned off', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    expect(readPlayerPreferences(storage).narration).toBe(true);
    store.set('ad-player-preferences-v1', JSON.stringify({ narration: false }));
    expect(readPlayerPreferences(storage).narration).toBe(false);
  });
});

describe('the recorded lines match what the game shows', () => {
  it('voices the title tagline and every floor\'s arrival', () => {
    expect(clipFor(GAME_TAGLINE)).toBeDefined();
    for (const id of CAMPAIGN_FLOORS) {
      const text = arrivalLine(floorDisplayName(id), FLOOR_LOOKS[LEVELS[id].biome].epigraph);
      expect(clipFor(text), text).toBeDefined();
    }
  });

  it('voices every death title and every variant of every cause line', () => {
    for (const source of knownDeathCauseSources()) {
      if (source === 'probe') continue;
      expect(clipFor(deathTitle(source)), deathTitle(source)).toBeDefined();
      for (let i = 0; i < 6; i++) expect(clipFor(deathCauseLine(source, i)), deathCauseLine(source, i)).toBeDefined();
    }
  });

  it('voices the ledger, the Sanctum\'s look below, and the bosses by name (captioned: nothing on screen says it)', () => {
    expect(clipFor(runHeadline({ outcome: 'victory', floorName: 'The Kiln Heart' }))).toBeDefined();
    expect(clipFor(VICTORY_EPITAPH)).toBeDefined();
    for (const id of CAMPAIGN_FLOORS) {
      for (const outcome of ['fallen', 'abandoned'] as const) expect(clipFor(runHeadline({ outcome, floorName: floorDisplayName(id) }))).toBeDefined();
    }
    for (const id of CAMPAIGN_FLOORS.slice(1)) expect(clipFor(FLOOR_LORE[id].line)).toBeDefined();
    for (const id of ['d3', 'd4']) expect(clipFor(FLOOR_LORE[id].resident)?.captioned).toBe(true);
    expect(clipFor('Please mind the duck')).toBeDefined();
    expect(clipFor('THE SUMP FALLS STILL')).toBeDefined();
  });

  it('ships a clip file for every line (takes included) and nothing orphaned', () => {
    const shipped = new Set(readdirSync(join('public', 'audio', 'voice')).filter(f => f.endsWith('.mp3')));
    const wanted = new Set<string>();
    for (const line of NARRATION_LINES) for (const u of line.urls) wanted.add(u.split('/').pop()!);
    for (const clip of Object.values(NARRATION_CLIPS)) expect(existsSync(join('public', clip.url)), clip.url).toBe(true);
    expect([...shipped].filter(f => !wanted.has(f))).toEqual([]);
    expect(NARRATION_LINES.length).toBeGreaterThanOrEqual(120);
    // The story (wave 3) added ~140 lines: pipes, Pell, Matron Ash, echoes, prologues, the escape
    // and the ending. Clips are fetched one line at a time as they are spoken, never preloaded.
    // The second doors (wave 3) added ~38: their arrivals, Sanctum lines, guardians, deaths and ledger.
    // 2026-09-30: the owner authorised recording the new Pell, Ash and Docent lines (+99 lines, +6.5 MB); still lazy, one line at a time.
    expect(NARRATION_LINES.length).toBeLessThanOrEqual(480);
    const bytes = [...shipped].reduce((s, f) => s + statSync(join('public', 'audio', 'voice', f)).size, 0);
    expect(bytes / 1048576).toBeLessThan(30);
    expect(NARRATOR_VOICE.model).toBe('eleven_v3');
  });
});

describe('no ElevenLabs in the game', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(d => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));

  it('never names the API, a key header or a key in shipped source', () => {
    for (const file of files('src').filter(f => /\.(ts|js|css|html|json)$/.test(f))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/api\.elevenlabs\.io|xi-api-key|sk_[A-Za-z0-9]{20,}/);
    }
  });
});
