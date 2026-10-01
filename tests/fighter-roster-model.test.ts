import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FIGHTER_DEFS, FIGHTER_ORDER, FIGHTER_ROLES } from '@/content/fighters';
import {
  ABILITY_KINDS,
  CLASSIC_COPY,
  CLASSIC_ENTRY,
  DEFAULT_KEY_LABELS,
  ROLE_FILTERS,
  ROSTER_NOTE,
  STAT_MAX,
  STAT_ORDER,
  abilityKeyLabel,
  chooseLabel,
  classicMatches,
  emptyMessage,
  filterFighters,
  fighterSearchText,
  isGridKey,
  normalizeText,
  padNumber,
  resultSummary,
  roleCounts,
  rosterEntries,
  searchTerms,
  shortName,
  statBar,
  stepGridIndex,
  stepRadioIndex,
} from '@/ui/fighterRosterModel';

describe('role filters', () => {
  test('lead with All and cover every role the data has, once', () => {
    expect(ROLE_FILTERS[0]).toBe('All');
    expect([...ROLE_FILTERS.slice(1)].sort()).toEqual([...FIGHTER_ROLES].sort());
    expect(new Set(ROLE_FILTERS).size).toBe(ROLE_FILTERS.length);
  });

  test('counts match the design document: 3 duelists, 1 hunter, 3 controllers, 2 bulwarks, 1 support', () => {
    expect(roleCounts()).toEqual({ All: 10, Duelist: 3, Hunter: 1, Controller: 3, Bulwark: 2, Support: 1 });
  });

  test('the role counts add up to the roster', () => {
    const c = roleCounts();
    expect(c.Duelist + c.Hunter + c.Controller + c.Bulwark + c.Support).toBe(c.All);
    expect(c.All).toBe(FIGHTER_ORDER.length);
  });

  test('a query narrows the counts so a button reads 0 before it is clicked for nothing', () => {
    const c = roleCounts('mercury');
    expect(c).toEqual({ All: 1, Duelist: 1, Hunter: 0, Controller: 0, Bulwark: 0, Support: 0 });
    expect(roleCounts('zzzz').All).toBe(0);
  });
});

describe('search text', () => {
  test('normalizeText flattens case, accents, curly quotes and spaces', () => {
    expect(normalizeText('  The   ÉMBER’s  “Jaw” ')).toBe('the ember\'s "jaw"');
    expect(normalizeText('Wráith')).toBe('wraith');
  });

  test('searchTerms splits on whitespace and drops blanks', () => {
    expect(searchTerms('  smoke   duelist ')).toEqual(['smoke', 'duelist']);
    expect(searchTerms('   ')).toEqual([]);
    expect(searchTerms('')).toEqual([]);
  });

  test('a fighter is found by name, title, role, tag, lore and every part of the kit', () => {
    const ids = (q: string) => filterFighters('All', q);
    expect(ids('voss')).toEqual(['ilyra-voss']);
    expect(ids('ILYRA')).toEqual(['ilyra-voss']);
    expect(ids('bell witch')).toEqual(['mara-quell']);
    expect(ids('terrain control')).toEqual(['father-thorne']);
    expect(ids('flash crucible')).toEqual(['ilyra-voss']);
    expect(ids('pressure vessel')).toEqual(['brann-rook']);
    expect(ids('hooked tether')).toEqual(['sable-fen']);
    expect(ids('salamander')).toEqual(['ilyra-voss']);
    expect(ids('furnace')).toEqual(expect.arrayContaining(['kest-rel', 'rusk-emberjaw']));
  });

  test('accents and capitals in the query do not matter', () => {
    expect(filterFighters('All', 'WRÁITH')).toEqual(['selene-wraith']);
  });

  test('several words must all match (narrowing, not widening)', () => {
    const smoke = filterFighters('All', 'smoke');
    expect(smoke).toEqual(expect.arrayContaining(['kest-rel', 'nox-calder']));
    const smokeDuelist = filterFighters('All', 'smoke duelist');
    expect(smokeDuelist.every((id) => smoke.includes(id))).toBe(true);
    expect(smokeDuelist).toContain('kest-rel');
    expect(smokeDuelist).not.toContain('nox-calder');
    expect(filterFighters('All', 'smoke bulwark')).toEqual([]);
  });

  test('no query keeps everyone, in roster order', () => {
    expect(filterFighters('All', '')).toEqual([...FIGHTER_ORDER]);
    expect(filterFighters('All', '   ')).toEqual([...FIGHTER_ORDER]);
  });

  test('the role filter and the search compose; the order stays the roster order', () => {
    expect(filterFighters('Duelist', '')).toEqual(['ilyra-voss', 'kest-rel', 'selene-wraith']);
    expect(filterFighters('Duelist', 'smoke')).toEqual(['kest-rel']);
    expect(filterFighters('Controller', 'smoke')).toEqual(['nox-calder']);
    expect(filterFighters('Hunter', 'smoke')).toEqual([]);
    const all = filterFighters('All', 'the');
    expect(all).toEqual(FIGHTER_ORDER.filter((id) => all.includes(id)));
  });

  test('every fighter is findable by their own name and by each of their ability names', () => {
    for (const id of FIGHTER_ORDER) {
      const def = FIGHTER_DEFS[id];
      for (const text of [def.name, def.title, def.passive.name, def.tactical.name, def.ultimate.name]) {
        expect(filterFighters('All', text)).toContain(id);
      }
    }
  });

  test('the cached text is stable', () => {
    const def = FIGHTER_DEFS['nox-calder'];
    expect(fighterSearchText(def)).toBe(fighterSearchText(def));
    expect(fighterSearchText(def)).toContain('blackglass');
  });
});

describe('the classic option', () => {
  test('is first under All, and only under All', () => {
    expect(rosterEntries('All', '')).toEqual([CLASSIC_ENTRY, ...FIGHTER_ORDER]);
    expect(rosterEntries('Duelist', '')).toEqual(['ilyra-voss', 'kest-rel', 'selene-wraith']);
    expect(rosterEntries('Support', '')).not.toContain(CLASSIC_ENTRY);
  });

  test('answers to its own words and not to a fighter query', () => {
    for (const q of ['alchemist', 'classic', 'no fighter', 'no passive']) expect(rosterEntries('All', q)[0]).toBe(CLASSIC_ENTRY);
    expect(rosterEntries('All', 'smoke')).not.toContain(CLASSIC_ENTRY);
    expect(classicMatches([])).toBe(true);
    expect(rosterEntries('All', 'zzzz')).toEqual([]);
  });

  test('carries the copy the brief asks for', () => {
    expect(CLASSIC_COPY.name).toBe('The Alchemist');
    expect(CLASSIC_COPY.blurb).toBe('The classic descent: the Alchemist, no passive and no abilities.');
    expect(ROSTER_NOTE.weapons).toBe('Weapons come from your kit and from loot.');
  });
});

describe('stat bars', () => {
  test('lit ticks and width follow the rating', () => {
    expect(statBar('Offense', 8)).toEqual({ value: 8, filled: 8, percent: 80, label: 'Offense: 8 out of 10' });
    expect(statBar('Utility', 10).percent).toBe(100);
    expect(statBar('Survival', 0).filled).toBe(0);
  });

  test('are clamped, rounded and safe against nonsense', () => {
    expect(statBar('Offense', 14).value).toBe(STAT_MAX);
    expect(statBar('Offense', -3).value).toBe(0);
    expect(statBar('Offense', 6.6).value).toBe(7);
    expect(statBar('Offense', Number.NaN).value).toBe(0);
  });

  test('every fighter has the four ratings, 1 to 10', () => {
    for (const id of FIGHTER_ORDER) {
      for (const stat of STAT_ORDER) {
        const v = FIGHTER_DEFS[id].stats[stat];
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(STAT_MAX);
      }
    }
  });
});

describe('arrow keys on the grid', () => {
  // The wide layout: the classic and the ten, six across: 6 + 5.
  const N = 11;
  const COLS = 6;

  test('Left and Right walk reading order and wrap at both ends', () => {
    expect(stepGridIndex(0, 'ArrowRight', N, COLS)).toBe(1);
    expect(stepGridIndex(N - 1, 'ArrowRight', N, COLS)).toBe(0);
    expect(stepGridIndex(0, 'ArrowLeft', N, COLS)).toBe(N - 1);
    expect(stepGridIndex(6, 'ArrowLeft', N, COLS)).toBe(5);
  });

  test('Down keeps the column and wraps from the last row to the first', () => {
    expect(stepGridIndex(1, 'ArrowDown', N, COLS)).toBe(7);
    expect(stepGridIndex(7, 'ArrowDown', N, COLS)).toBe(1);
    expect(stepGridIndex(10, 'ArrowDown', N, COLS)).toBe(4);
  });

  test('Up keeps the column and wraps from the first row to the last', () => {
    expect(stepGridIndex(7, 'ArrowUp', N, COLS)).toBe(1);
    expect(stepGridIndex(1, 'ArrowUp', N, COLS)).toBe(7);
  });

  test('a short last row clamps to its last card instead of skipping', () => {
    expect(stepGridIndex(5, 'ArrowDown', N, COLS)).toBe(10);
    expect(stepGridIndex(5, 'ArrowUp', N, COLS)).toBe(10);
  });

  test('four across (the compact layout): 4 + 4 + 3', () => {
    expect(stepGridIndex(0, 'ArrowDown', N, 4)).toBe(4);
    expect(stepGridIndex(4, 'ArrowDown', N, 4)).toBe(8);
    expect(stepGridIndex(8, 'ArrowDown', N, 4)).toBe(0);
    expect(stepGridIndex(3, 'ArrowDown', N, 4)).toBe(7);
    expect(stepGridIndex(7, 'ArrowDown', N, 4)).toBe(10);
    expect(stepGridIndex(0, 'ArrowUp', N, 4)).toBe(8);
    expect(stepGridIndex(3, 'ArrowUp', N, 4)).toBe(10);
  });

  test('on a single row (a strip, or one result) Up and Down stay put', () => {
    expect(stepGridIndex(3, 'ArrowDown', 11, 11)).toBe(3);
    expect(stepGridIndex(3, 'ArrowUp', 11, 11)).toBe(3);
    expect(stepGridIndex(0, 'ArrowDown', 3, 6)).toBe(0);
    expect(stepGridIndex(0, 'ArrowUp', 1, 6)).toBe(0);
  });

  test('Home and End', () => {
    expect(stepGridIndex(7, 'Home', N, COLS)).toBe(0);
    expect(stepGridIndex(2, 'End', N, COLS)).toBe(N - 1);
  });

  test('an empty grid has nowhere to go, a bad index is pulled into range, bad columns become one', () => {
    expect(stepGridIndex(0, 'ArrowRight', 0, COLS)).toBe(-1);
    expect(stepGridIndex(99, 'ArrowLeft', N, COLS)).toBe(N - 2);
    expect(stepGridIndex(-5, 'ArrowRight', N, COLS)).toBe(1);
    expect(stepGridIndex(2, 'ArrowDown', N, 0)).toBe(3);
    expect(stepGridIndex(2, 'ArrowDown', N, Number.NaN)).toBe(3);
  });

  test('every cell is reachable from every other by the four arrows (no trap cells)', () => {
    for (const cols of [1, 2, 3, 4, 5, 6, 11]) {
      const seen = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        const at = queue.pop() as number;
        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const) {
          const next = stepGridIndex(at, key, N, cols);
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      expect(seen.size).toBe(N);
    }
  });

  test('isGridKey names the six keys', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) expect(isGridKey(k)).toBe(true);
    for (const k of ['Enter', 'a', 'PageDown', 'Tab']) expect(isGridKey(k)).toBe(false);
  });
});

describe('the role filter row (a radio group)', () => {
  test('steps and wraps; Home and End jump', () => {
    const n = ROLE_FILTERS.length;
    expect(stepRadioIndex(0, 'ArrowRight', n)).toBe(1);
    expect(stepRadioIndex(n - 1, 'ArrowRight', n)).toBe(0);
    expect(stepRadioIndex(0, 'ArrowLeft', n)).toBe(n - 1);
    expect(stepRadioIndex(2, 'Home', n)).toBe(0);
    expect(stepRadioIndex(2, 'End', n)).toBe(n - 1);
    expect(stepRadioIndex(2, 'x', n)).toBe(2);
    expect(stepRadioIndex(0, 'ArrowRight', 0)).toBe(-1);
  });
});

describe('words on the screen', () => {
  test('the result line counts and names what narrows it', () => {
    expect(resultSummary(10, 10, 'All', '')).toBe('10 of 10 fighters shown.');
    expect(resultSummary(1, 10, 'Duelist', 'smoke')).toBe('1 of 10 fighter shown in Duelist matching “smoke”.');
    expect(resultSummary(0, 10, 'All', '  zzz ')).toBe('0 of 10 fighters shown matching “zzz”.');
  });

  test('the empty state says what to widen', () => {
    expect(emptyMessage('All', 'zzz')).toContain('“zzz”');
    expect(emptyMessage('Hunter', 'zzz')).toContain('hunter');
    expect(emptyMessage('Hunter', '')).toContain('Clear the filter');
  });

  test('the choose button says what it will do', () => {
    expect(chooseLabel('ilyra-voss', { current: CLASSIC_ENTRY, locked: false })).toBe('Choose Ilyra Voss');
    expect(chooseLabel('ilyra-voss', { current: 'ilyra-voss', locked: false })).toBe('Keep Ilyra Voss');
    expect(chooseLabel(CLASSIC_ENTRY, { current: CLASSIC_ENTRY, locked: false })).toBe('Keep the Alchemist');
    expect(chooseLabel(CLASSIC_ENTRY, { current: 'kest-rel', locked: false })).toBe('Choose the Alchemist');
    expect(chooseLabel('brann-rook', { current: 'brann-rook', locked: true })).toBe('Locked');
  });

  test('the ability chips carry the bound keys on the Tactical and the Ultimate only', () => {
    expect(ABILITY_KINDS).toEqual(['passive', 'tactical', 'ultimate']);
    expect(DEFAULT_KEY_LABELS).toEqual({ tactical: 'Z', ultimate: 'T' });
    expect(abilityKeyLabel('passive', DEFAULT_KEY_LABELS)).toBeNull();
    expect(abilityKeyLabel('tactical', DEFAULT_KEY_LABELS)).toBe('Z');
    expect(abilityKeyLabel('ultimate', { tactical: 'Q', ultimate: 'R' })).toBe('R');
  });

  test('the compact grid captions a card with its surname', () => {
    expect(shortName('father-thorne')).toBe('Thorne');
    expect(shortName('rusk-emberjaw')).toBe('Emberjaw');
    expect(shortName('selene-wraith')).toBe('Wraith');
    expect(shortName(CLASSIC_ENTRY)).toBe('Alchemist');
  });

  test('numbers are two digits', () => {
    expect(padNumber(1)).toBe('01');
    expect(padNumber(10)).toBe('10');
  });
});

/** The component itself needs a DOM (the repo's tests are node-only), so what can be pinned of it is pinned in text. */
describe('the roster component, as written', () => {
  const root = new URL('../', import.meta.url);
  const ts = readFileSync(new URL('src/ui/FighterRoster.ts', root), 'utf8');
  const css = readFileSync(new URL('src/styles/fighters.css', root), 'utf8');

  test('exposes the selectors a host adds to its keyboard-owner and pad lists', () => {
    expect(ts).toContain("export const FIGHTER_ROSTER_ID = 'fighter-roster';");
    expect(ts).toContain("export const FIGHTER_ROSTER_SELECTOR = '#fighter-roster';");
    expect(ts).toContain("export const FIGHTER_ROSTER_OPEN_SELECTOR = '#fighter-roster.visible';");
  });

  test('imports its own stylesheet, so main.ts needs no edit', () => {
    expect(ts).toMatch(/^import '@\/styles\/fighters\.css';/m);
  });

  test('sits above the title (88) and the sound widget (90), below the clip card (95)', () => {
    expect(css).toMatch(/#fighter-roster \{[^}]*z-index: 92;/);
  });

  test('keys its layout on its own size, never on the window (the view is a letterbox)', () => {
    expect(css).toMatch(/container: fighter-roster \/ size;/);
    const medias = css.match(/@media[^{]*/g) ?? [];
    for (const m of medias) expect(m).toMatch(/prefers-reduced-motion/);
    expect(css).toContain('@container fighter-roster');
  });

  test('stills itself for reduced motion, by the media query and by the player setting', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('#fighter-roster.fr-still');
    expect(ts).toContain('reduceFlashes');
  });

  test('never inlines art: no data URIs, no base64, and the concept sheet URL is built in one place', () => {
    expect(ts).not.toMatch(/base64|data:image/i);
    expect(css).not.toMatch(/base64|data:image/i);
    expect(ts.match(/fighterSheetUrl\(/g)?.length).toBe(1);
  });

  test('builds its DOM with the DOM API (no innerHTML) and uses no escape hatches', () => {
    expect(ts).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(ts).not.toMatch(/\bas any\b|: any\b|@ts-ignore|@ts-expect-error/);
  });

  test('every control is a real button or input (the pad moves focus over button, select, input)', () => {
    expect(ts).not.toContain("setAttribute('role', 'button')");
    expect(ts).toContain("el('button'");
    expect(ts).toContain("setAttribute('role', 'radio')");
  });
});
