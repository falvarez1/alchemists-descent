import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADVANCED_OBJECTS, LEVEL_OBJECTS, NOTE_OBJECTS, PUZZLE_OBJECTS, TOOL_GROUPS, buildShellMarkup } from '@/builder/shellMarkup';

/**
 * The Builder binds its handlers by element id (`this.el('b-save')` throws when the id is missing,
 * and ~20 headless probes click the same ids). The shell markup lives in its own file now, so this
 * test is what keeps "a control can MOVE but keeps its id" true: every id the class looks up has to
 * exist in the template, and nothing in the hidden legacy block may outlive its handler.
 *
 * (String-level on purpose: the repo's unit tests run without a DOM.)
 */
const builderSource = readFileSync('src/builder/Builder.ts', 'utf8');
const markup = buildShellMarkup({ layerRows: '<div class="bp-layer" data-layer="gameplay"></div>' });

const idsIn = (html: string): string[] => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const allIds = idsIn(markup);
const markupIds = new Set(allIds);
const referenced = new Set([...builderSource.matchAll(/this\.el(?:<[^>]*>)?\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));

function legacyBlock(): string {
  const start = markup.indexOf('id="b-legacy-stubs"');
  if (start < 0) return '';
  return markup.slice(start, markup.indexOf('</div>', start));
}

describe('Builder shell markup', () => {
  it('has no duplicate ids', () => {
    expect(allIds.filter((id, i) => allIds.indexOf(id) !== i)).toEqual([]);
  });

  it('contains every element the Builder looks up by id', () => {
    expect([...referenced].filter((id) => !markupIds.has(id))).toEqual([]);
  });

  it('keeps hidden legacy stubs only for ids a handler still binds', () => {
    const stubs = idsIn(legacyBlock()).filter((id) => id !== 'b-legacy-stubs');
    expect(stubs.filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('gives every tool exactly one button or flyout entry, each with a data-tool id', () => {
    const ids = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.tool));
    expect(new Set(ids).size).toBe(ids.length);
    const toolbar = markup.slice(markup.indexOf('id="builder-toolbar"'), markup.indexOf('id="builder-center-slot"'));
    const rendered = [...toolbar.matchAll(/class="bp-tool[^"]*" data-tool="([^"]+)"/g)].map((m) => m[1]);
    expect([...rendered].sort()).toEqual([...ids].sort());
  });

  it('places every placeable object kind exactly once in the Objects pane', () => {
    const kinds = [...LEVEL_OBJECTS, ...PUZZLE_OBJECTS, ...ADVANCED_OBJECTS, ...NOTE_OBJECTS].map((c) => c.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    const pane = markup.slice(markup.indexOf('id="bp-pane-objects"'), markup.indexOf('id="bp-pane-library"'));
    const rendered = [...pane.matchAll(/class="bp-tool bp-card" data-kind="([^"]+)"/g)].map((m) => m[1]);
    expect([...rendered].sort()).toEqual([...kinds].sort());
  });

  it('wires the palette tabs to their panes', () => {
    for (const m of markup.matchAll(/<button[^>]*class="bp-tab"[^>]*data-pane="([^"]+)"[^>]*aria-controls="([^"]+)"/g)) {
      expect(markupIds.has(m[2]), m[2]).toBe(true);
      expect(markup).toContain(`id="${m[2]}" aria-labelledby`);
    }
  });

  it('keeps menu items reachable: every menu trigger has a dropdown', () => {
    for (const m of markup.matchAll(/class="builder-menu-btn" data-menu="([^"]+)"/g)) {
      expect(markup, m[1]).toContain(`data-menu-panel="${m[1]}"`);
    }
  });
});
