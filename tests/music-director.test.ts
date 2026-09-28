import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOSS_CUES, BossGate, DARK_THIN, FLOOR_CUES, PHASE_DIP, PHASE_DIP_MS, TensionGate, chooseCue, cueLevel, dipFor, engagedBoss,
  equalPowerCurve, fadeSeconds, floorForLevel, inDeepDark, loopFadeSeconds, phaseDipActive, rampValue, threatScore, threatWeight,
  type DirectorInput, type ThreatSubject,
} from '@/audio/musicRules';
import { SCORE_TRACKS } from '@/content/audio/score.generated';
import { AUDITION_ENTRIES } from '@/content/audio/scoreManifest';
import { CAMPAIGN_FLOORS } from '@/config/worldgraph';

const calm: DirectorInput = {
  gestured: true, soundOn: true, verdict: null, verdictPending: false, builderOpen: false, entryActive: false, ledgerOpen: false,
  sanctumOpen: false, mode: 'play', runOver: false, teaActive: false, boss: null, floor: 'd1', tension: false, preview: false,
};

describe('chooseCue: the state machine', () => {
  it('is silent before the first gesture and with sound off, whatever else is true', () => {
    expect(chooseCue({ ...calm, gestured: false })).toBeNull();
    expect(chooseCue({ ...calm, entryActive: true, gestured: false })).toBeNull();
    expect(chooseCue({ ...calm, soundOn: false })).toBeNull();
    expect(chooseCue({ ...calm, gestured: false, preview: true })).toBeNull();
  });

  it('plays the title on the entrance, the workshop in the sandbox, nothing in the Builder', () => {
    expect(chooseCue({ ...calm, entryActive: true, mode: 'build' })).toBe('title');
    expect(chooseCue({ ...calm, mode: 'build' })).toBe('workshop');
    expect(chooseCue({ ...calm, builderOpen: true })).toBeNull();
  });

  it('walks a floor: exploration, hunted, the Tea Engine, a boss, the Sanctum', () => {
    for (const floor of CAMPAIGN_FLOORS) {
      expect(chooseCue({ ...calm, floor })).toBe(FLOOR_CUES[floor].explore);
      expect(chooseCue({ ...calm, floor, tension: true })).toBe(FLOOR_CUES[floor].tension);
    }
    expect(chooseCue({ ...calm, teaActive: true })).toBe('tea-engine');
    expect(chooseCue({ ...calm, floor: 'd3', tension: true, boss: 'leviathan' })).toBe('boss-leviathan');
    expect(chooseCue({ ...calm, floor: 'd4', boss: 'colossus' })).toBe('boss-colossus');
    expect(chooseCue({ ...calm, sanctumOpen: true, tension: true })).toBe('sanctum');
  });

  it('gives a verdict the floor, clears the air before it, and keeps the theme under the ledger', () => {
    expect(chooseCue({ ...calm, boss: 'colossus', verdictPending: true })).toBeNull();
    expect(chooseCue({ ...calm, boss: 'colossus', verdict: 'victory' })).toBe('victory');
    expect(chooseCue({ ...calm, verdict: 'fallen', ledgerOpen: true })).toBe('fallen');
    expect(chooseCue({ ...calm, ledgerOpen: true })).toBe('title');
    // A final fall: the floor's music does not come back underneath the death screen.
    expect(chooseCue({ ...calm, runOver: true })).toBeNull();
  });

  it('lets a slider preview the score when nothing else would play', () => {
    expect(chooseCue({ ...calm, runOver: true, preview: true })).toBe('title');
    expect(chooseCue({ ...calm, preview: true })).toBe('bellows');
  });
});

describe('hunted: threat and hysteresis', () => {
  const hunter = (kind: ThreatSubject['kind'], x: number, extra: Partial<ThreatSubject> = {}): ThreatSubject =>
    ({ kind, x, y: 100, hp: 10, alerted: true, mind: { intent: 'hunt', visible: true }, ...extra });

  it('counts creatures that are hunting, near, alive and awake; fodder alone is not a hunt', () => {
    expect(threatScore([hunter('weaver', 150)], 100, 100)).toBe(1);
    expect(threatScore([hunter('slime', 150)], 100, 100)).toBeLessThan(1);
    expect(threatScore([hunter('slime', 150), hunter('bat', 120)], 100, 100)).toBeGreaterThanOrEqual(1);
    expect(threatScore([hunter('weaver', 900)], 100, 100)).toBe(0);
    expect(threatScore([hunter('weaver', 150, { hp: 0 })], 100, 100)).toBe(0);
    expect(threatScore([hunter('weaver', 150, { sleeping: true })], 100, 100)).toBe(0);
    expect(threatScore([hunter('weaver', 150, { mind: { intent: 'forage', visible: false }, alerted: false })], 100, 100)).toBe(0);
    expect(threatWeight('colossus')).toBe(0);
    expect(threatWeight('eggs')).toBe(0);
  });

  it('enters only after the threat holds, and holds after it lapses', () => {
    const gate = new TensionGate();
    expect(gate.update(1, 0)).toBe(false);
    expect(gate.update(1, 400)).toBe(false);
    expect(gate.update(1, 800)).toBe(true);
    expect(gate.update(0, 3000)).toBe(true); // a breath in the hunt keeps the layer
    expect(gate.update(0, 7900)).toBe(false);
    // A glance that does not hold never raises it.
    expect(gate.update(1, 10000)).toBe(false);
    expect(gate.update(0, 10300)).toBe(false);
    expect(gate.update(1, 10600)).toBe(false);
  });

  it('keeps a boss cue through a short disengagement, and drops it at once when the boss dies', () => {
    const boss: ThreatSubject = { kind: 'leviathan', x: 100, y: 100, hp: 50, alerted: true };
    expect(engagedBoss([boss], 120, 100)).toBe('leviathan');
    expect(engagedBoss([{ ...boss, alerted: false }], 120, 100)).toBeNull();
    expect(engagedBoss([boss], 2000, 100)).toBeNull();
    const gate = new BossGate();
    expect(gate.update('leviathan', () => true, 0)).toBe('leviathan');
    expect(gate.update(null, () => true, 10_000)).toBe('leviathan');
    expect(gate.update(null, () => true, 16_000)).toBeNull();
    gate.update('colossus', () => true, 20_000);
    expect(gate.update(null, () => false, 20_500)).toBeNull();
  });
});

describe('crossfades and levels', () => {
  it('crossfades calm and hunted on one floor quicker than a change of place, and a boss quicker still', () => {
    expect(fadeSeconds('bellows', 'bellows-tension')).toBeGreaterThanOrEqual(1.5);
    expect(fadeSeconds('bellows', 'bellows-tension')).toBeLessThanOrEqual(2);
    expect(fadeSeconds('bellows-tension', 'bellows')).toBe(fadeSeconds('bellows', 'bellows-tension'));
    expect(fadeSeconds('cisterns-tension', 'boss-leviathan')).toBeLessThan(fadeSeconds('bellows', 'sanctum'));
    expect(fadeSeconds(null, 'title')).toBeGreaterThan(1);
    expect(fadeSeconds('kiln', 'victory')).toBeLessThan(0.5);
    expect(loopFadeSeconds('bellows')).toBeGreaterThan(loopFadeSeconds('bellows-tension'));
  });

  it('is equal-power: a crossfade never dips in summed power', () => {
    const up = equalPowerCurve(0, 1, 33), down = equalPowerCurve(1, 0, 33);
    for (let i = 0; i < up.length; i++) expect(up[i] ** 2 + down[i] ** 2).toBeCloseTo(1, 5);
    expect(up[0]).toBe(0); expect(up[32]).toBeCloseTo(1, 6);
    const r = { from: 0, to: 1, t0: 10, t1: 12 };
    expect(rampValue(r, 9)).toBe(0); expect(rampValue(r, 13)).toBe(1);
    expect(rampValue(r, 11)).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('breathes out on a death, sits back under pause and the ledger, and is silent hidden', () => {
    const d = { hidden: false, paused: false, playerDead: false, ledgerOpen: false, mode: 'play' as const };
    expect(dipFor(d)).toBe(1);
    expect(dipFor({ ...d, hidden: true })).toBe(0);
    expect(dipFor({ ...d, playerDead: true })).toBeLessThan(dipFor({ ...d, paused: true }));
    expect(dipFor({ ...d, ledgerOpen: true })).toBeLessThan(1);
    expect(dipFor({ ...d, paused: true, mode: 'build' })).toBe(1);
    expect(cueLevel('bellows')).toBeLessThan(cueLevel('bellows-tension'));
  });

  it('thins a floor\'s calm cue in the deep dark, never a hunt or a boss', () => {
    const d = { hidden: false, paused: false, playerDead: false, ledgerOpen: false, mode: 'play' as const, dark: true };
    expect(dipFor({ ...d, cue: 'cisterns' })).toBe(DARK_THIN);
    expect(dipFor({ ...d, cue: 'cisterns-tension' })).toBe(1);
    expect(dipFor({ ...d, cue: BOSS_CUES.leviathan })).toBe(1);
    expect(dipFor({ ...d, cue: 'cisterns', dark: false })).toBe(1);
    // Hysteresis: in at the light wave's "entered the dark", out only once it is properly lit again.
    expect(inDeepDark(false, 0.6)).toBe(false);
    expect(inDeepDark(false, 0.8)).toBe(true);
    expect(inDeepDark(true, 0.5)).toBe(true);
    expect(inDeepDark(true, 0.3)).toBe(false);
  });

  it('holds its breath under a boss phase roar, then swells back', () => {
    const d = { hidden: false, paused: false, playerDead: false, ledgerOpen: false, mode: 'play' as const, cue: BOSS_CUES.colossus };
    expect(dipFor({ ...d, sincePhaseMs: 100 })).toBe(PHASE_DIP);
    expect(dipFor({ ...d, sincePhaseMs: PHASE_DIP_MS + 1 })).toBe(1);
    expect(dipFor({ ...d, sincePhaseMs: undefined })).toBe(1);
    expect(phaseDipActive(0)).toBe(true);
    expect(phaseDipActive(PHASE_DIP_MS)).toBe(false);
    // A death still wins: the breath out is deeper than the roar's dip.
    expect(dipFor({ ...d, sincePhaseMs: 100, playerDead: true })).toBeLessThan(PHASE_DIP);
  });

  it('maps off-spine levels onto the floor whose organ they resemble', () => {
    expect(floorForLevel('d3', 'flooded')).toBe('d3');
    expect(floorForLevel('physics-test', 'earthen')).toBe('d1');
    expect(floorForLevel('gasworks', 'fungal')).toBe('d2');
    expect(floorForLevel('range', 'frozen')).toBe('d3');
    expect(floorForLevel(null, null)).toBeNull();
  });
});

describe('the score on disk', () => {
  const byId = new Map(SCORE_TRACKS.map(t => [t.id, t]));
  const cues = ['title', 'sanctum', 'tea-engine', 'workshop', 'victory', 'fallen', ...Object.values(BOSS_CUES),
    ...Object.values(FLOOR_CUES).flatMap(p => [p.explore, p.tension])];

  it('has every cue the director can ask for, mastered and present', () => {
    for (const id of cues) {
      const t = byId.get(id);
      expect(t, id).toBeDefined();
      expect(existsSync(join('public', t!.url)), t!.url).toBe(true);
      expect(Math.abs(t!.lufs - -16), `${id} loudness`).toBeLessThan(3.5);
      expect(t!.tailSec, `${id} loop-out inside the track`).toBeLessThan(t!.seconds - 20 > 0 ? t!.seconds - 10 : t!.seconds);
    }
    expect(byId.get('victory')!.loop).toBe(false);
    expect(byId.get('fallen')!.loop).toBe(false);
    expect(byId.get('bellows')!.loop).toBe(true);
  });

  it('pairs each floor\'s calm and hunted cues in one key and tempo', () => {
    for (const pair of Object.values(FLOOR_CUES)) {
      const a = byId.get(pair.explore)!, b = byId.get(pair.tension)!;
      expect(b.key).toBe(a.key);
      expect(b.bpm).toBe(a.bpm);
    }
  });

  it('keeps the whole score near 25 MB, fetched a cue at a time', () => {
    // Raised from 21 MB for the second doors (wave 3: the Cold Store and the
    // Glass Galleries, a calm and a hunted cue each, ~4.4 MB). A run takes one
    // door per floor and only the floor it stands on streams, so what a player
    // downloads per run did not grow — only the deploy did.
    const bytes = SCORE_TRACKS.reduce((s, t) => s + statSync(join('public', t.url)).size, 0);
    expect(bytes / 1048576).toBeLessThan(25);
  });

  it('lists every cue and narrator line for the audition page', () => {
    for (const id of cues) expect(AUDITION_ENTRIES.some(e => e.id === `score-${id}`)).toBe(true);
    expect(AUDITION_ENTRIES.filter(e => e.group.startsWith('Narrator')).length).toBeGreaterThanOrEqual(3);
    for (const e of AUDITION_ENTRIES) {
      expect(e.urls.length).toBeGreaterThan(0);
      for (const u of e.urls) expect(existsSync(join('public', u.replace(/^\//, ''))), u).toBe(true);
    }
  });
});
