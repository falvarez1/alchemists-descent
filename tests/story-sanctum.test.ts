import { describe, expect, it } from 'vitest';
import {
  ASH_BOONS,
  ASH_FLUSH_GOLD,
  ASH_NOTES,
  ASH_PURCHASES,
  BOSS_EPILOGUES,
  CLERK_NOTICES,
  DOCENT_ASIDES,
  ECHOES,
  ENDING_AGAIN,
  ENDING_ARCHMAGE_RISE,
  ENDING_DAILY_TOWN,
  ENDING_FIRST,
  ESCAPE_LINES,
  PELL_CUP_ENDING,
  ashRunNote,
  clerkNotice,
  endingPlates,
  journalEntries,
  type Beat,
} from '@/content/story';
import { SANCTUM_PERK_DEFS } from '@/content/perks';

describe('Matron Ash reads the run', () => {
  const at = (floor: number, phialsOnArrival: number, gold: number) => ashRunNote({ floor, phialsOnArrival, maxPhials: 3, gold });

  it('says nothing after the first floor, or off the spine', () => {
    expect(at(1, 0, 900)).toBeNull();
    expect(at(0, 0, 0)).toBeNull();
    expect(at(4, 0, 0)).toBeNull();
  });

  it('hard going outranks a full purse, which outranks a clean record', () => {
    expect(at(2, 0, 500)?.id).toBe('ash.note.dire.2');
    expect(at(2, 1, 500)?.id).toBe('ash.note.lean.2');
    expect(at(3, 2, 0)?.id).toBe('ash.note.lean.3');
    expect(at(2, 3, ASH_FLUSH_GOLD)?.id).toBe('ash.note.flush.2');
    expect(at(3, 3, ASH_FLUSH_GOLD - 1)?.id).toBe('ash.note.clean.3');
  });

  it('has a line for each Sanctum after floor 2 and floor 3, and each reads differently', () => {
    for (const lines of Object.values(ASH_NOTES)) {
      expect(lines).toHaveLength(2);
      expect(lines[0]).not.toBe(lines[1]);
    }
    expect(at(2, 3, 0)?.text).toBe(ASH_NOTES.clean[0]);
    expect(at(3, 3, 0)?.text).toBe(ASH_NOTES.clean[1]);
  });

  it('answers every boon the Sanctum offers (and only real ones), and every shop item', () => {
    const offered = ['vitality', ...SANCTUM_PERK_DEFS.map(p => p.id)];
    for (const id of offered) expect(ASH_BOONS[id], id).toBeTruthy();
    for (const id of Object.keys(ASH_BOONS)) expect(offered, id).toContain(id);
    expect(Object.keys(ASH_PURCHASES).sort()).toEqual(['brass', 'brew', 'mend', 'pages', 'toughen', 'void']);
  });

  it('keeps each reply short enough to type on beside a greeting', () => {
    for (const text of [...Object.values(ASH_BOONS), ...Object.values(ASH_PURCHASES), ...Object.values(ASH_NOTES).flat()]) {
      expect(text.length, text).toBeLessThan(120);
    }
  });
});

describe('the Clerk of Works', () => {
  it('posts a signed notice after each of floors 1-3, and chooses between two by the pick', () => {
    for (const floor of [1, 2, 3]) {
      expect(CLERK_NOTICES[floor]).toHaveLength(2);
      const a = clerkNotice(floor, 0)!, b = clerkNotice(floor, 1)!;
      expect(a.text).not.toBe(b.text);
      expect(a.text).toMatch(/^NOTICE\. /);
      expect(a.signature).toBe('The Clerk of Works');
      expect(clerkNotice(floor, 2)).toEqual(a);
    }
    expect(clerkNotice(0, 0)).toBeNull();
    expect(clerkNotice(4, 0)).toBeNull();
  });

  it('never throws on a bad pick', () => {
    expect(clerkNotice(1, -7)).not.toBeNull();
    expect(clerkNotice(1, 3.9)).not.toBeNull();
  });
});

describe('the Docent’s asides and epilogues', () => {
  const beats: Beat[] = [...Object.values(DOCENT_ASIDES), ...Object.values(BOSS_EPILOGUES).filter((b): b is Beat => !!b), ESCAPE_LINES.retry];

  it('are each said once ever (they go quiet when heard), with ids that are their own', () => {
    const ids = beats.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of Object.values(DOCENT_ASIDES)) expect(b.again, b.id).toBeNull();
    for (const b of Object.values(BOSS_EPILOGUES)) expect(b!.again, b!.id).toBeNull();
    for (const b of beats) expect(b.first.trim().length, b.id).toBeGreaterThan(20);
  });

  it('keep the typographic apostrophe and never run long enough to be a speech', () => {
    for (const b of beats) {
      expect(b.first, b.id).not.toMatch(/\w'\w/);
      expect(b.first.length, b.id).toBeLessThan(150);
    }
  });

  it('retry has a fuller first line and a short one for later runs', () => {
    expect(ESCAPE_LINES.retry.again).toBeTruthy();
    expect(ESCAPE_LINES.retry.again!.length).toBeLessThan(ESCAPE_LINES.retry.first.length);
  });
});

describe('the endings read the run', () => {
  const none = { waiting: true, tookTea: false, daily: false, archmage: false };
  const art = (first: boolean, facts: Partial<typeof none>) => endingPlates(first, { ...none, ...facts }).map(p => p.art);

  it('is the script as written when nothing shades it', () => {
    expect(endingPlates(true, none)).toEqual([ENDING_FIRST.rise, ENDING_FIRST.town, ENDING_FIRST.pellWaiting, ENDING_FIRST.farewell]);
    expect(endingPlates(false, { ...none, waiting: false })).toEqual([ENDING_AGAIN.rise, ENDING_AGAIN.town, ENDING_AGAIN.pellLantern, ENDING_AGAIN.farewell]);
  });

  it('has Pell wait with a cup when his tea was taken, in either ending', () => {
    expect(art(true, { tookTea: true })).toEqual(['flue', 'window', 'pellcup', 'farewell']);
    const again = endingPlates(false, { ...none, tookTea: true })[2];
    expect(again).toMatchObject({ art: 'pellcup', line: { speaker: 'pell', text: PELL_CUP_ENDING.again } });
  });

  it('leaves only his lantern when he is not waiting, tea or no tea', () => {
    expect(art(true, { waiting: false, tookTea: true })).toEqual(['flue', 'window', 'lantern', 'farewell']);
  });

  it('gives a later victory the tier and the day, and the first victory neither', () => {
    const again = endingPlates(false, { ...none, archmage: true, daily: true });
    expect(again[0].line?.text).toBe(ENDING_ARCHMAGE_RISE);
    expect(again[1].line?.text).toBe(ENDING_DAILY_TOWN);
    expect(endingPlates(true, { ...none, archmage: true, daily: true })).toEqual(endingPlates(true, none));
  });
});

describe('named echo workers', () => {
  it('Hobb, Dunmore and Wick are named in the narration and listed on the Journal page', () => {
    const cast = new Set(Object.values(ECHOES).flatMap(e => e!.cast ?? []));
    expect([...cast].sort()).toEqual(['Dunmore', 'Hobb', 'Wick']);
    for (const e of Object.values(ECHOES)) {
      for (const name of e!.cast ?? []) expect(e!.lines.join(' '), `${e!.id} names ${name}`).toContain(name);
    }
    const titles = journalEntries().filter(j => j.kind === 'echo').map(j => j.title);
    expect(titles.some(t => t.includes('Hobb'))).toBe(true);
  });
});
