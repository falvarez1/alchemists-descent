import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_SUBTITLE, GAME_TAGLINE, GAME_TITLE } from '@/config/brand';

/**
 * index.html is static — it cannot import src/config/brand.ts — so its title,
 * description and share cards are a hand copy. This keeps the copy honest:
 * a rename in brand.ts fails here until the page (and the share previews
 * people see before they ever load the game) follows.
 */
describe('index.html carries the brand', () => {
  const html = readFileSync('index.html', 'utf8');
  const full = `${GAME_TITLE} — ${GAME_SUBTITLE}`;
  const attr = (selector: RegExp): string | null => html.match(selector)?.[1] ?? null;

  it('names the document after the game', () => {
    expect(attr(/<title>([^<]*)<\/title>/)).toBe(full);
  });

  it('describes it with the tagline, for search and share previews alike', () => {
    expect(attr(/<meta name="description" content="([^"]*)">/)).toBe(GAME_TAGLINE);
    expect(attr(/<meta property="og:description" content="([^"]*)">/)).toBe(GAME_TAGLINE);
    expect(attr(/<meta name="twitter:description" content="([^"]*)">/)).toBe(GAME_TAGLINE);
  });

  it('titles the share cards and the boot screen the same way', () => {
    expect(attr(/<meta property="og:title" content="([^"]*)">/)).toBe(full);
    expect(attr(/<meta name="twitter:title" content="([^"]*)">/)).toBe(full);
    expect(attr(/<meta property="og:site_name" content="([^"]*)">/)).toBe(GAME_TITLE);
    expect(attr(/<div class="boot-title">([^<]*)<\/div>/)).toBe(GAME_TITLE.toUpperCase());
    expect(attr(/<div class="boot-sub">([^<]*)<\/div>/)).toBe(GAME_SUBTITLE.toUpperCase());
  });
});
