import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, LevelRuntime } from '@/core/types';
import type { StoryDialogueView, StoryRunSave } from '@/core/story';
import { PELL } from '@/content/story';
import { PellCamp, secretMark } from '@/game/story/PellCamp';
import type { StoryHost } from '@/game/story/host';
import { defaultStoryMeta, type StoryMetaData } from '@/game/story/storyMeta';
import { freshStoryRun } from '@/game/story/storyRun';

/**
 * PELL's dialogue as a state machine (wave 3 WS-S): greeting line by line,
 * up to three choices, a reply, a real gift, a farewell; a second talk on
 * the same floor is only his farewell; he recognises a repeat visitor; the
 * Kiln's camp is cold and holds his last page.
 */

function harness(biome: 'earthen' | 'fungal' | 'flooded' | 'volcanic', levelId: string, meta: StoryMetaData = defaultStoryMeta()) {
  const events = new EventBus();
  let clock = 10;
  let run: StoryRunSave = freshStoryRun(1);
  let m = meta;
  const views: StoryDialogueView[] = [];
  const said: string[] = [];
  const toasts: string[] = [];
  const cards: string[] = [];
  events.on('storyDialogue', (v) => views.push(v));
  events.on('toast', ({ text }) => toasts.push(text));
  const camp = { x: 500, floorY: 400, facing: -1 as const, x0: 460, x1: 540 };
  const rt = {
    def: { id: levelId, biome }, story: { pipes: [], camp, valve: null, flue: null }, living: biome === 'earthen' ? { glowseeds: 0 } : undefined,
    pickups: [{ kind: 'tome', x: 900, y: 300, taken: false, data: {} }], runeVaults: [], spawn: { x: 100, y: 100 }, mapWaypoint: null,
  } as unknown as LevelRuntime;
  const player = { x: 490, y: 400, dead: false, hp: 20, maxHp: 100 };
  const ctx = {
    events, player, levels: { current: rt },
    audio: new Proxy({}, { get: () => () => undefined }),
    narrator: { cutSource: () => undefined },
    wands: { collection: [], wands: [], grantCard: (_c: Ctx, id: string) => cards.push(id) },
  } as unknown as Ctx;
  const host: StoryHost = {
    ctx, meta: () => m, updateMeta: (fn) => { m = fn(m); }, run: () => run, setRun: (next) => { run = next; },
    say: (lines) => { said.push(...lines.map(l => l.text)); return true; }, lineSeconds: () => 2, unlockJournal: () => undefined,
    levelId: () => levelId, biome: () => biome, floor: () => Number(levelId.slice(1)), now: () => clock,
  };
  const pell = new PellCamp(host);
  const tick = (s: number): void => { for (let i = 0; i < Math.round(s * 60); i++) { clock += 1 / 60; pell.update(1 / 60); } };
  return { pell, tick, views, said, toasts, cards, rt, player, get run() { return run; }, get meta() { return m; } };
}

describe('Pell', () => {
  it('greets line by line, offers his choices, gives a real gift, says farewell and closes', () => {
    const h = harness('earthen', 'd1');
    expect(h.pell.prompt()?.verb).toBe('Talk to Pell');
    expect(h.pell.interact()).toBe(true);
    expect(h.said[0]).toBe(PELL.earthen!.first.greet[0]);
    expect(h.views.at(-1)).toMatchObject({ open: true, name: 'Pell', choices: [] });
    h.tick(2.6);
    expect(h.said[1]).toBe(PELL.earthen!.first.greet[1]);
    h.tick(2.6);
    expect(h.views.at(-1)!.choices).toEqual(PELL.earthen!.first.choices.map(c => c.label));
    // The glowseeds.
    h.pell.choose(2);
    expect((h.rt.living as { glowseeds: number }).glowseeds).toBe(3);
    expect(h.run.pell.d1).toEqual({ met: true, gift: 'seeds' });
    h.tick(2.6);
    expect(h.said.at(-1)).toBe(PELL.earthen!.first.farewell);
    h.tick(2.6);
    expect(h.views.at(-1)!.open).toBe(false);
    expect(h.meta.pellRuns).toBe(1);
    // Again on the same floor this run: only a farewell (he knows you now).
    h.pell.interact();
    expect(h.said.at(-1)).toBe(PELL.earthen!.again.farewell);
    expect(h.views.at(-1)!.choices).toEqual([]);
  });

  it('E skips the typing first, then moves on; walking away ends it', () => {
    const h = harness('earthen', 'd1');
    h.pell.interact();
    h.pell.advance();
    expect(h.views.at(-1)!.instant).toBe(true);
    expect(h.said).toHaveLength(1);
    h.pell.advance();
    expect(h.said).toHaveLength(2);
    h.player.x = 700;
    h.tick(0.1);
    expect(h.pell.talking).toBe(false);
  });

  it('recognises a repeat visitor', () => {
    const h = harness('earthen', 'd1', { ...defaultStoryMeta(), heard: [PELL.earthen!.first.id], pellRuns: 1 });
    h.pell.interact();
    expect(h.said[0]).toBe(PELL.earthen!.again.greet[0]);
    const v = harness('earthen', 'd1', { ...defaultStoryMeta(), heard: [PELL.earthen!.first.id], pellRuns: 4 });
    v.pell.interact();
    expect(v.said[0]).toBe(PELL.earthen!.veteran!.greet[0]);
  });

  it('marks a secret on the compass, or pours his tea', () => {
    const h = harness('flooded', 'd3');
    h.pell.interact();
    h.tick(6);
    h.pell.choose(0);
    expect(h.rt.mapWaypoint).toMatchObject({ x: 900, y: 300, label: 'Pell’s mark' });
    const t = harness('flooded', 'd3');
    t.pell.interact();
    t.tick(6);
    t.pell.choose(2);
    expect(t.player.hp).toBe(100);
    expect(secretMark({ pickups: [], runeVaults: [], spawn: { x: 0, y: 0 } } as unknown as LevelRuntime, null)).toBeNull();
  });

  it('on the Kiln his camp is cold, and his last page is read once', () => {
    const h = harness('volcanic', 'd4');
    expect(h.pell.view()).toBeNull();
    expect(h.pell.prompt()?.verb).toBe('Read the page');
    h.pell.interact();
    expect(h.said[0]).toMatch(/The stoker is sad/);
    expect(h.run.pell.d4).toEqual({ met: false, gift: 'page' });
    h.tick(6);
    expect(h.pell.prompt()).toBeNull();
  });
});
