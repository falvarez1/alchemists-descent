import { describe, expect, it } from 'vitest';

import { FIGHTER_DEFS, FIGHTER_ORDER, FIGHTER_ROLES } from '@/content/fighters';
import type { AbilityIconSlot } from '@/ui/fighterIcons';
import { ABILITY_ICON_KEYS, abilityIcon, roleIcon, slotIcon } from '@/ui/fighterIcons';

/**
 * The fighters' ability icon set (src/ui/fighterIcons.ts): thirty glyphs (ten fighters x passive /
 * tactical / ultimate), five role glyphs, three slot glyphs. The art is judged by eye
 * (scripts/preview-fighter-icons.mjs); these tests pin what a page can break on: every key exists, the markup is one
 * self-contained SVG, nothing in it can collide with another icon on the same page, and no two glyphs are the
 * same drawing.
 */

const SLOTS: readonly AbilityIconSlot[] = ['passive', 'tactical', 'ultimate'];

/** A tiny well-formedness check: every tag opens and closes in order, void-style tags self-close. */
function tagsBalance(markup: string): boolean {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(markup))) {
    // text between tags must be empty: these are pure shape icons
    if (markup.slice(consumed, m.index).trim() !== '') return false;
    consumed = m.index + m[0].length;
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  return stack.length === 0 && markup.slice(consumed).trim() === '';
}

const FORBIDDEN = [/<script/i, /<style/i, /\sid\s*=/i, /url\(\s*#/i, /\shref\s*=/i, /\son[a-z]+\s*=/i, /javascript:/i, /<image/i, /<use/i];

function allMarkups(): Array<{ label: string; markup: string }> {
  const out: Array<{ label: string; markup: string }> = [];
  for (const id of FIGHTER_ORDER) for (const slot of SLOTS) out.push({ label: `${id}.${slot}`, markup: abilityIcon(id, slot) });
  for (const role of FIGHTER_ROLES) out.push({ label: `role ${role}`, markup: roleIcon(role) });
  for (const slot of SLOTS) out.push({ label: `slot ${slot}`, markup: slotIcon(slot) });
  return out;
}

describe('fighter ability icons', () => {
  it('has a glyph for every fighter and slot, and lists exactly those keys', () => {
    const expected = FIGHTER_ORDER.flatMap((id) => SLOTS.map((slot) => `${id}.${slot}`));
    expect(expected).toHaveLength(30);
    expect([...ABILITY_ICON_KEYS].sort()).toEqual([...expected].sort());
    for (const id of FIGHTER_ORDER) {
      for (const slot of SLOTS) {
        const markup = abilityIcon(id, slot);
        // a body, not an empty fallback box
        expect(markup, `${id}.${slot}`).toMatch(/<(path|circle|rect|ellipse|g)\b/);
      }
    }
  });

  it('is one well-formed 24x24 svg per icon, tinted by currentColor, one stroke weight', () => {
    for (const { label, markup } of allMarkups()) {
      expect(markup.startsWith('<svg '), label).toBe(true);
      expect(markup.endsWith('</svg>'), label).toBe(true);
      expect(markup.match(/<svg\b/g), label).toHaveLength(1);
      expect(markup, label).toContain('viewBox="0 0 24 24"');
      expect(markup, label).toContain('stroke="currentColor"');
      expect(markup, label).toContain('fill="none"');
      expect(markup, label).toContain('stroke-linecap="round"');
      expect(markup, label).toContain('stroke-linejoin="round"');
      expect(tagsBalance(markup), label).toBe(true);
      // ONE stroke weight, set on the root and never overridden by a shape
      expect(markup.match(/stroke-width="[^"]*"/g), label).toEqual(['stroke-width="1.6"']);
    }
  });

  it('is safe to inline many times on one page: no script, style, ids or references', () => {
    for (const { label, markup } of allMarkups()) {
      for (const bad of FORBIDDEN) expect(markup, `${label} ${bad}`).not.toMatch(bad);
    }
  });

  it('draws thirty distinct ability glyphs, and no ability reuses a role or slot glyph', () => {
    const abilities = FIGHTER_ORDER.flatMap((id) => SLOTS.map((slot) => abilityIcon(id, slot)));
    expect(new Set(abilities).size).toBe(30);
    const generic = [...FIGHTER_ROLES.map((r) => roleIcon(r)), ...SLOTS.map((s) => slotIcon(s))];
    expect(new Set(generic).size).toBe(8);
    for (const g of generic) expect(abilities).not.toContain(g);
  });

  it('covers the five roles and the three slots', () => {
    expect(FIGHTER_ROLES).toEqual(['Duelist', 'Bulwark', 'Hunter', 'Controller', 'Support']);
    for (const role of FIGHTER_ROLES) expect(roleIcon(role), role).toMatch(/<(path|circle|rect|ellipse)\b/);
    for (const slot of SLOTS) expect(slotIcon(slot), slot).toMatch(/<(path|circle|rect|ellipse)\b/);
    // every role in the roster has a glyph (a new role would need one)
    for (const id of FIGHTER_ORDER) expect(FIGHTER_ROLES).toContain(FIGHTER_DEFS[id].role);
  });

  it('takes a pixel size, default 24', () => {
    expect(abilityIcon('ilyra-voss', 'passive')).toContain('width="24" height="24"');
    expect(abilityIcon('ilyra-voss', 'passive', 16)).toContain('width="16" height="16"');
    expect(roleIcon('Hunter', 40)).toContain('width="40" height="40"');
    expect(slotIcon('ultimate', 32)).toContain('width="32" height="32"');
  });
});
