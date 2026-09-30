import type { Beat, Speaker, StoryBiome, StoryLine } from './types';
import { BOSS_EPILOGUES, BOSS_PROLOGUES, DOCENT_ASIDES, DOCENT_PIPES, ESCAPE_LINES } from './docent';
import { PELL, PELL_LAST_PAGE, PELL_MAP_PAGES } from './pell';
import { ASH_DOORS, ASH_GREETINGS } from './oldOnes';
import { ECHOES } from './echoes';
import { ENDING_AGAIN, ENDING_FIRST, OPENING } from './cinematics';

export * from './types';
export * from './docent';
export * from './pell';
export * from './oldOnes';
export * from './echoes';
export * from './cinematics';
export * from './clerk';

/** Floor names for the Journal (a biome a floor can be). */
export const STORY_FLOOR_NAMES: Readonly<Partial<Record<StoryBiome, string>>> = {
  earthen: 'The Bellows',
  fungal: 'The Rot Gardens',
  frozen: 'The Cold Store',
  flooded: 'The Drowned Cisterns',
  crystal: 'The Glass Galleries',
  volcanic: 'The Kiln Heart',
};

/** Order the Journal lists floors in (the descent, the branches beside their spine floor). */
export const STORY_FLOOR_ORDER: readonly StoryBiome[] = ['earthen', 'fungal', 'frozen', 'flooded', 'crystal', 'volcanic'];

/** Every Docent pipe beat of a floor (pinned sites first, then the sequence). */
export function pipeBeats(biome: StoryBiome): Beat[] {
  const script = DOCENT_PIPES[biome];
  if (!script) return [];
  return [...Object.values(script.sites ?? {}), ...script.sequence];
}

/* ---------------- the Journal ---------------- */

export type JournalKind = 'docent' | 'echo' | 'pell' | 'ash' | 'ending';

export interface JournalEntry {
  /** Stable id (the story meta unlocks entries by it). */
  id: string;
  kind: JournalKind;
  /** The floor it belongs to (null: the Sanctum, the ending). */
  biome: StoryBiome | null;
  title: string;
  /** Everything it can say. The Docent's notes only show the lines a player has heard (beat ids). */
  lines: ReadonlyArray<StoryLine & { beat?: string }>;
}

const docentEntry = (biome: StoryBiome): JournalEntry => ({
  id: `journal.docent.${biome}`,
  kind: 'docent',
  biome,
  title: `The Docent’s notes: ${STORY_FLOOR_NAMES[biome] ?? biome}`,
  lines: pipeBeats(biome).map(b => ({ speaker: 'docent' as Speaker, text: b.first, beat: b.id })),
});

/** Every Journal entry that exists, in reading order. */
export function journalEntries(): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const biome of STORY_FLOOR_ORDER) {
    if (DOCENT_PIPES[biome]) out.push(docentEntry(biome));
    const echo = ECHOES[biome];
    if (echo) out.push({ id: `journal.${echo.id}`, kind: 'echo', biome, title: `Echo: ${echo.title}${echo.cast?.length ? ` · ${echo.cast.join(', ')}` : ''}`, lines: echo.lines.map(text => ({ speaker: 'docent', text })) });
    const page = PELL_MAP_PAGES[biome];
    if (page) out.push({ id: `journal.pell.${biome}`, kind: 'pell', biome, title: `Pell’s map: ${page.title}`, lines: [{ speaker: 'pell', text: page.text }] });
    if (biome === 'volcanic') {
      out.push({ id: 'journal.pell.volcanic', kind: 'pell', biome, title: 'Pell’s last page', lines: PELL_LAST_PAGE.first.lines.map(text => ({ speaker: 'pell', text })) });
    }
  }
  out.push({
    id: 'journal.ash',
    kind: 'ash',
    biome: null,
    title: 'The Old Ones',
    lines: Object.values(ASH_GREETINGS).map(b => ({ speaker: 'ash' as Speaker, text: b.first, beat: b.id })),
  });
  out.push({
    id: 'journal.ending',
    kind: 'ending',
    biome: null,
    title: 'The last page',
    lines: [ENDING_FIRST.rise.line, ENDING_FIRST.town.line, ENDING_FIRST.farewell.line].filter((l): l is StoryLine => l !== null),
  });
  return out;
}

/* ---------------- every spoken line (the voice generator reads this) ---------------- */

export interface StoryVoiceLine extends StoryLine {
  /** The audition page's group. */
  group: string;
  /** Spoken where nothing on screen shows the words: the caption shows them. */
  captioned: boolean;
}

/**
 * Every line the story can say, with its speaker — scripts/audio/voice-lines.mjs
 * bundles this and records each with that speaker's voice. Duplicates are fine
 * (the generator keys by speaker and text).
 */
export function storyVoiceLines(): StoryVoiceLine[] {
  const out: StoryVoiceLine[] = [];
  const add = (speaker: Speaker, text: string | null | undefined, group: string, captioned: boolean): void => {
    if (text) out.push({ speaker, text, group, captioned });
  };
  for (const biome of STORY_FLOOR_ORDER) {
    const name = STORY_FLOOR_NAMES[biome] ?? biome;
    for (const b of pipeBeats(biome)) {
      add('docent', b.first, `Story · Docent · ${name}`, true);
      add('docent', b.again, `Story · Docent · ${name}`, true);
    }
    const echo = ECHOES[biome];
    if (echo) for (const text of echo.lines) add('docent', text, `Story · Echoes · ${name}`, true);
    const pell = PELL[biome];
    if (pell) {
      for (const visit of [pell.first, pell.again, pell.veteran]) {
        if (!visit) continue;
        for (const text of visit.greet) add('pell', text, `Story · Pell · ${name}`, false);
        for (const c of visit.choices) for (const text of c.reply) add('pell', text, `Story · Pell · ${name}`, false);
        add('pell', visit.farewell, `Story · Pell · ${name}`, false);
      }
    }
    const page = PELL_MAP_PAGES[biome];
    if (page) add('pell', page.text, 'Story · Pell · map pages', false);
  }
  for (const text of [...PELL_LAST_PAGE.first.lines, ...PELL_LAST_PAGE.again.lines]) add('pell', text, 'Story · Pell · The Kiln Heart', false);
  for (const b of Object.values(BOSS_PROLOGUES)) {
    if (!b) continue;
    add('docent', b.first, 'Story · Boss prologues', true);
    add('docent', b.again, 'Story · Boss prologues', true);
  }
  for (const b of Object.values(BOSS_EPILOGUES)) {
    if (!b) continue;
    add('docent', b.first, 'Story · Boss prologues', true);
  }
  for (const b of Object.values(ESCAPE_LINES)) {
    add('docent', b.first, 'Story · The Kiln escape', true);
    add('docent', b.again, 'Story · The Kiln escape', true);
  }
  for (const b of Object.values(DOCENT_ASIDES)) add('docent', b.first, 'Story · Docent · asides', true);
  for (const b of Object.values(ASH_GREETINGS)) {
    add('ash', b.first, 'Story · Matron Ash', false);
    add('ash', b.again, 'Story · Matron Ash', false);
  }
  for (const b of Object.values(ASH_DOORS)) {
    if (!b) continue;
    add('ash', b.first, 'Story · Matron Ash · doors', false);
    add('ash', b.again, 'Story · Matron Ash · doors', false);
  }
  for (const plate of OPENING) if (plate.line) add(plate.line.speaker, plate.line.text, 'Story · Opening', false);
  for (const script of [ENDING_FIRST, ENDING_AGAIN]) {
    for (const plate of [script.rise, script.town, script.pellWaiting, script.pellLantern, script.farewell]) {
      if (plate.line) add(plate.line.speaker, plate.line.text, 'Story · Ending', false);
    }
  }
  return out;
}
