import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The hosted game (Cloudflare Pages) is cross-origin isolated by `public/_headers`, so the Sandbox can
 * use SharedArrayBuffer and worker threads there (docs/SANDBOX-MT.md); dev and preview get the same pair
 * from ISOLATION_HEADERS in vite.config.ts. They must stay one pair, and the file must be the shape
 * Pages reads: a path line, then indented `Name: value` lines.
 */

function parseHeadersFile(text: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  let path: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { path = raw.trim(); rules.set(path, {}); continue; }
    if (path === null) throw new Error('a header line before any path: ' + raw);
    const at = raw.indexOf(':');
    if (at < 0) throw new Error('not a header line: ' + raw);
    rules.get(path)![raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
  }
  return rules;
}

function viteIsolationHeaders(): Record<string, string> {
  const source = readFileSync('vite.config.ts', 'utf8');
  const block = /const ISOLATION_HEADERS = \{([\s\S]*?)\};/.exec(source);
  if (!block) throw new Error('ISOLATION_HEADERS not found in vite.config.ts');
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/'([^']+)':\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

describe('the hosted game’s cross-origin isolation', () => {
  const rules = parseHeadersFile(readFileSync('public/_headers', 'utf8'));

  it('sends the same COOP/COEP pair as the dev and preview servers, on every path', () => {
    const vite = viteIsolationHeaders();
    expect(Object.keys(vite).sort()).toEqual(['Cross-Origin-Embedder-Policy', 'Cross-Origin-Opener-Policy']);
    expect(rules.get('/*')).toEqual(vite);
  });

  it('is isolated in a way a same-origin-only site survives', () => {
    const all = rules.get('/*')!;
    expect(all['Cross-Origin-Opener-Policy']).toBe('same-origin');
    // require-corp would block any no-cors cross-origin load outright; credentialless only strips its cookies.
    expect(all['Cross-Origin-Embedder-Policy']).toBe('credentialless');
  });

  it('has no other rule that could override the pair for some path', () => {
    expect([...rules.keys()]).toEqual(['/*']);
  });
});
