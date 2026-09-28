import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveBuilderHtml, readBuilderHtml, readIndexHtml } from '../scripts/gen-builder-html.mjs';

/**
 * The editor route (/builder.html) boots the same Game as the play route, so
 * every node the runtime resolves strictly has to exist in both shells. The
 * route died silently once (Hud.ts appended into a #expedition-tools that only
 * index.html had), which is why builder.html is now derived from index.html and
 * this test refuses a stale copy.
 */
describe('builder.html is derived from index.html', () => {
  it('matches the generator output exactly', () => {
    expect(readBuilderHtml()).toBe(deriveBuilderHtml(readIndexHtml()));
  });

  it('keeps every node the HUD resolves strictly', () => {
    // `el('id')` in Hud.ts is a non-null lookup: a missing node throws inside
    // the Game constructor and the whole route fails to boot.
    const hud = readFileSync('src/ui/Hud.ts', 'utf8');
    const strictIds = [...hud.matchAll(/\bel\('([a-z0-9-]+)'\)/g)].map((m) => m[1]);
    expect(strictIds.length).toBeGreaterThan(10);
    const builder = readBuilderHtml();
    const index = readIndexHtml();
    for (const id of strictIds) {
      expect(index, `index.html lacks #${id}`).toContain(`id="${id}"`);
      expect(builder, `builder.html lacks #${id}`).toContain(`id="${id}"`);
    }
  });

  it('differs from index.html only where the editor shell should', () => {
    const builder = readBuilderHtml();
    expect(builder).toContain('src="/src/app/builderEntry.ts"');
    expect(builder).not.toContain('src="/src/main.ts"');
    expect(builder).not.toContain('id="material-palette"');
    expect(builder).toContain('class="builder-entry-note"');
    expect(builder).toContain('GENERATED from index.html');
  });
});
